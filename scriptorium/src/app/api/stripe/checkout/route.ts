import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db, subscriptions } from '@/db'
import { currentUserId } from '@/lib/session'
import { createClient } from '@/lib/supabase/server'
import { stripe, stripeConfigured, PRICES } from '@/lib/stripe'

export const runtime = 'nodejs'

const Body = z.object({ plan: z.enum(['monthly', 'annual']).default('monthly') })

export async function POST(req: Request) {
  if (!stripeConfigured()) return Response.json({ error: 'billing not configured' }, { status: 503 })

  const userId = await currentUserId()
  if (!userId) return new Response(null, { status: 401 })

  const parsed = Body.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return Response.json({ error: 'bad plan' }, { status: 400 })

  const price = parsed.data.plan === 'annual' ? PRICES.annual : PRICES.monthly
  if (!price) return Response.json({ error: 'price not configured' }, { status: 503 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Reuse the customer if this user already has one, so Stripe does not
  // accumulate duplicates across re-subscribes.
  const [existing] = await db.select({ customerId: subscriptions.stripeCustomerId })
    .from(subscriptions).where(eq(subscriptions.userId, userId)).limit(1)

  const origin = new URL(req.url).origin
  const session = await stripe().checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price, quantity: 1 }],
    client_reference_id: userId,
    ...(existing?.customerId
      ? { customer: existing.customerId }
      : { customer_email: user?.email ?? undefined }),
    // Stamping userId on the SUBSCRIPTION is what makes every later
    // subscription.* webhook self-describing, so event order stops mattering.
    subscription_data: { metadata: { userId } },
    metadata: { userId },
    success_url: `${origin}/account?checkout=success`,
    cancel_url: `${origin}/account?checkout=cancelled`,
    allow_promotion_codes: true,
  })

  return Response.json({ url: session.url })
}
