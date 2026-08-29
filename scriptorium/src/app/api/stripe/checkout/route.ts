import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db, subscriptions } from '@/db'
import { currentUserId } from '@/lib/session'
import { createClient } from '@/lib/supabase/server'
import { stripe, stripeConfigured, PRICES } from '@/lib/stripe'

export const runtime = 'nodejs'

const Body = z.object({ plan: z.enum(['starter', 'unlimited']).default('unlimited') })

export async function POST(req: Request) {
  if (!stripeConfigured()) return Response.json({ error: 'billing not configured' }, { status: 503 })

  const userId = await currentUserId()
  if (!userId) return new Response(null, { status: 401 })

  const parsed = Body.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return Response.json({ error: 'bad plan' }, { status: 400 })

  const isBundle = parsed.data.plan === 'starter'
  const price = isBundle ? PRICES.starter : PRICES.unlimited
  if (!price) return Response.json({ error: 'price not configured' }, { status: 503 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Reuse the customer if this user already has one, so Stripe does not
  // accumulate duplicates across re-subscribes.
  const [existing] = await db.select({ customerId: subscriptions.stripeCustomerId })
    .from(subscriptions).where(eq(subscriptions.userId, userId)).limit(1)

  const origin = new URL(req.url).origin
  const session = await stripe().checkout.sessions.create({
    // The bundle is a one-off payment, not a subscription. Getting this wrong
    // makes Stripe try to renew a purchase that was never recurring.
    mode: isBundle ? 'payment' : 'subscription',
    line_items: [{ price, quantity: 1 }],
    client_reference_id: userId,
    ...(existing?.customerId
      ? { customer: existing.customerId }
      : { customer_email: user?.email ?? undefined }),
    // Stamping userId on the SUBSCRIPTION is what makes every later
    // subscription.* webhook self-describing, so event order stops mattering.
    ...(isBundle ? {} : { subscription_data: { metadata: { userId } } }),
    // Read back by the webhook to decide what the payment bought (§9.3).
    metadata: { userId, plan: parsed.data.plan },
    success_url: `${origin}/account?checkout=success`,
    cancel_url: `${origin}/account?checkout=cancelled`,
    allow_promotion_codes: true,
  })

  return Response.json({ url: session.url })
}
