import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db, subscriptions } from '@/db'
import { currentUserId } from '@/lib/session'
import { createClient } from '@/lib/supabase/server'
import { stripe, stripeConfigured, PRICES } from '@/lib/stripe'
import { REDEEM_CODES, normaliseCode } from '@/lib/redeem-codes'
import { getEntitlement } from '@/lib/entitlement'
import { rateLimit, limitResponse } from '@/lib/ratelimit'

export const runtime = 'nodejs'

/**
 * One code box, two mechanisms — SPEC.3.md §9.5.
 *
 * TRIAL-1 selects the $1 trial product. FOUNDER-50 is a real Stripe promotion
 * code applied to a normal checkout. The reader types either into the same
 * field and does not need to know the difference.
 */
export async function POST(req: Request) {
  if (!stripeConfigured()) return Response.json({ error: 'billing not configured' }, { status: 503 })

  const userId = await currentUserId()
  if (!userId) return new Response(null, { status: 401 })

  // Codes are guessable by design, so brute force must be expensive.
  const limited = await rateLimit(`redeem:${userId}`, 10, 3600)
  if (!limited.allowed) return limitResponse(limited)

  const parsed = z.object({
    code: z.string().min(1).max(64),
    plan: z.enum(['starter', 'unlimited']).optional(),
  }).safeParse(await req.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: 'Enter a code.' }, { status: 400 })

  const code = normaliseCode(parsed.data.code)
  const entry = REDEEM_CODES[code as keyof typeof REDEEM_CODES]
  if (!entry) return Response.json({ error: 'That code is not recognised.' }, { status: 404 })

  const ent = await getEntitlement(userId)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const origin = new URL(req.url).origin

  const [existing] = await db.select().from(subscriptions)
    .where(eq(subscriptions.userId, userId)).limit(1)

  if (entry.kind === 'trial') {
    if (ent.plan === 'full') {
      return Response.json({ error: 'You already have full access.' }, { status: 409 })
    }
    // One trial per account, ever. A lapsed trial still counts as used —
    // otherwise the $1 fortnight renews forever for a dollar a fortnight.
    if (existing?.priceId && existing.priceId === PRICES.trial) {
      return Response.json(
        { error: 'Your trial has already been used. FOUNDER-50 takes 50% off your first payment.' },
        { status: 409 },
      )
    }
    if (!PRICES.trial) return Response.json({ error: 'trial price not configured' }, { status: 503 })

    const session = await stripe().checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: PRICES.trial, quantity: 1 }],
      client_reference_id: userId,
      ...(existing?.stripeCustomerId
        ? { customer: existing.stripeCustomerId }
        : { customer_email: user?.email ?? undefined }),
      metadata: { userId, plan: 'trial' },
      success_url: `${origin}/account?redeemed=trial`,
      cancel_url: `${origin}/account?redeemed=cancelled`,
    })
    return Response.json({ url: session.url, kind: 'trial' })
  }

  // FOUNDER-50: a normal purchase with the promotion code pre-applied.
  const plan = parsed.data.plan ?? 'unlimited'
  const isBundle = plan === 'starter'
  const price = isBundle ? PRICES.starter : PRICES.unlimited
  if (!price) return Response.json({ error: 'price not configured' }, { status: 503 })

  const promos = await stripe().promotionCodes.list({ code: entry.stripeCode, active: true, limit: 1 })
  if (!promos.data.length) {
    return Response.json({ error: 'That code is no longer active.' }, { status: 410 })
  }

  const session = await stripe().checkout.sessions.create({
    mode: isBundle ? 'payment' : 'subscription',
    line_items: [{ price, quantity: 1 }],
    client_reference_id: userId,
    ...(existing?.stripeCustomerId
      ? { customer: existing.stripeCustomerId }
      : { customer_email: user?.email ?? undefined }),
    ...(isBundle ? {} : { subscription_data: { metadata: { userId } } }),
    metadata: { userId, plan },
    discounts: [{ promotion_code: promos.data[0].id }],
    success_url: `${origin}/account?redeemed=founder`,
    cancel_url: `${origin}/account?redeemed=cancelled`,
  })
  return Response.json({ url: session.url, kind: 'promo' })
}
