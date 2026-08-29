import { eq } from 'drizzle-orm'
import { db, subscriptions } from '@/db'
import { currentUserId } from '@/lib/session'
import { stripe, stripeConfigured } from '@/lib/stripe'

export const runtime = 'nodejs'

/** Hosted Customer Portal — cancel, update card, change plan (§9.2). */
export async function POST(req: Request) {
  if (!stripeConfigured()) return Response.json({ error: 'billing not configured' }, { status: 503 })

  const userId = await currentUserId()
  if (!userId) return new Response(null, { status: 401 })

  const [row] = await db.select({ customerId: subscriptions.stripeCustomerId })
    .from(subscriptions).where(eq(subscriptions.userId, userId)).limit(1)
  if (!row?.customerId) return Response.json({ error: 'no customer' }, { status: 404 })

  const session = await stripe().billingPortal.sessions.create({
    customer: row.customerId,
    return_url: `${new URL(req.url).origin}/account`,
  })
  return Response.json({ url: session.url })
}
