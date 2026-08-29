import type Stripe from 'stripe'
import { eq } from 'drizzle-orm'
import { db, subscriptions, processedEvents, purchases } from '@/db'
import { stripeWebhooks, toSubStatus, STARTER_SLOTS } from '@/lib/stripe'
import { TRIAL_DAYS } from '@/lib/redeem-codes'

export const runtime = 'nodejs'

const HANDLED = new Set([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
])

/**
 * The only writer of `subscriptions` — SPEC.3.md §9.3.
 *
 * Four rules, all load-bearing:
 *  1. Webhooks are the sole writer. Success redirects update nothing, because a
 *     user who closes the tab mid-redirect must still get access.
 *  2. Idempotent by `event.id`. Stripe retries; repeats must be no-ops.
 *  3. Verify or reject. An unverified webhook is an unauthenticated request
 *     that grants subscriptions.
 *  4. Writes bypass RLS by design: there is no user session on this request.
 */
export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) return new Response('stripe not configured', { status: 503 })

  const signature = req.headers.get('stripe-signature')
  if (!signature) return new Response('missing signature', { status: 400 })

  // MUST be the raw, unparsed body. Any parser that touches it first breaks
  // verification with a misleading error.
  const raw = await req.text()

  let event: Stripe.Event
  try {
    event = stripeWebhooks().constructEvent(raw, signature, secret)
  } catch (e) {
    return new Response(`signature verification failed: ${(e as Error).message}`, { status: 400 })
  }

  // Rule 2 — replay protection.
  const [seen] = await db.select({ id: processedEvents.id }).from(processedEvents)
    .where(eq(processedEvents.id, event.id)).limit(1)
  if (seen) return Response.json({ received: true, duplicate: true })

  try {
    if (HANDLED.has(event.type)) await apply(event)
  } catch (e) {
    // Do NOT record the event: let Stripe retry a genuine failure.
    return new Response(`handler error: ${(e as Error).message}`, { status: 500 })
  }

  await db.insert(processedEvents)
    .values({ id: event.id, type: event.type })
    .onConflictDoNothing()

  return Response.json({ received: true })
}

async function apply(event: Stripe.Event) {
  switch (event.type) {
    case 'checkout.session.completed': {
      const s = event.data.object as Stripe.Checkout.Session
      const userId = s.client_reference_id ?? s.metadata?.userId
      if (!userId) return

      if (s.mode === 'payment') {
        if (s.payment_status !== 'paid') return

        // The $1 trial: 14 days of full access, then it simply lapses. Recorded
        // as a `trialing` row with cancel_at_period_end so the ONE access rule
        // in getEntitlement covers it — there is no Stripe subscription behind
        // it, so nothing can auto-charge at the end.
        if (s.metadata?.plan === 'trial') {
          const customerId = typeof s.customer === 'string' ? s.customer : s.customer?.id
          await db.insert(subscriptions).values({
            userId,
            stripeCustomerId: customerId ?? `trial_${s.id}`,
            stripeSubscriptionId: null,
            status: 'trialing',
            priceId: process.env.STRIPE_PRICE_TRIAL ?? null,
            currentPeriodEnd: new Date(Date.now() + TRIAL_DAYS * 86400_000),
            cancelAtPeriodEnd: true,
            updatedAt: new Date(event.created * 1000),
          }).onConflictDoNothing()
          return
        }

        await db.insert(purchases).values({
          userId,
          stripeSessionId: s.id,
          stripePaymentIntent: typeof s.payment_intent === 'string'
            ? s.payment_intent : s.payment_intent?.id ?? null,
          priceId: process.env.STRIPE_PRICE_STARTER ?? null,
          slots: STARTER_SLOTS,
        }).onConflictDoNothing()   // session id is unique: replays are no-ops
        return
      }

      const customerId = typeof s.customer === 'string' ? s.customer : s.customer?.id
      if (!customerId) return
      // Link the customer to the user. Subscription detail arrives separately,
      // and may arrive FIRST — which is why upsert, not insert.
      await upsert({ userId, customerId, event })
      return
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription
      const userId = sub.metadata?.userId
      const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id
      if (!customerId) return

      const item = sub.items?.data?.[0]
      const periodEnd = item?.current_period_end
        ?? (sub as unknown as { current_period_end?: number }).current_period_end

      await upsert({
        userId, customerId, event,
        subscriptionId: sub.id,
        status: event.type === 'customer.subscription.deleted'
          ? 'canceled' : toSubStatus(sub.status),
        priceId: item?.price?.id ?? null,
        currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
        cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
      })
      return
    }

    // Payment health only. Subscription status itself always comes from the
    // subscription.* events, so these never invent a status of their own.
    case 'invoice.paid':
    case 'invoice.payment_failed': {
      const inv = event.data.object as Stripe.Invoice
      const customerId = typeof inv.customer === 'string' ? inv.customer : inv.customer?.id
      if (!customerId) return
      const [row] = await db.select().from(subscriptions)
        .where(eq(subscriptions.stripeCustomerId, customerId)).limit(1)
      if (!row) return
      if (event.type === 'invoice.payment_failed' && row.status === 'active') {
        await guardedUpdate(row.userId, event, { status: 'past_due' })
      }
      return
    }
  }
}

type UpsertInput = {
  userId?: string | null
  customerId: string
  event: Stripe.Event
  subscriptionId?: string
  status?: ReturnType<typeof toSubStatus>
  priceId?: string | null
  currentPeriodEnd?: Date | null
  cancelAtPeriodEnd?: boolean
}

async function upsert(input: UpsertInput) {
  const { customerId, event } = input

  const [existing] = await db.select().from(subscriptions)
    .where(eq(subscriptions.stripeCustomerId, customerId)).limit(1)

  const userId = input.userId ?? existing?.userId
  if (!userId) return // customer not linked to a user yet; a later event will link it

  if (!existing) {
    await db.insert(subscriptions).values({
      userId,
      stripeCustomerId: customerId,
      stripeSubscriptionId: input.subscriptionId ?? null,
      status: input.status ?? 'incomplete',
      priceId: input.priceId ?? null,
      currentPeriodEnd: input.currentPeriodEnd ?? null,
      cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? false,
      updatedAt: new Date(event.created * 1000),
    }).onConflictDoNothing()
    return
  }

  await guardedUpdate(existing.userId, event, {
    stripeSubscriptionId: input.subscriptionId ?? existing.stripeSubscriptionId,
    status: input.status ?? existing.status,
    priceId: input.priceId ?? existing.priceId,
    currentPeriodEnd: input.currentPeriodEnd ?? existing.currentPeriodEnd,
    cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? existing.cancelAtPeriodEnd,
  })
}

/**
 * Out-of-order protection. Stripe does not guarantee delivery order, so an
 * older event arriving late must not overwrite newer state. The row's
 * `updatedAt` holds the event timestamp that last wrote it.
 */
async function guardedUpdate(
  userId: string,
  event: Stripe.Event,
  set: Partial<typeof subscriptions.$inferInsert>,
) {
  const eventAt = new Date(event.created * 1000)
  const [row] = await db.select({ updatedAt: subscriptions.updatedAt })
    .from(subscriptions).where(eq(subscriptions.userId, userId)).limit(1)
  if (row && row.updatedAt > eventAt) return // stale event, ignore

  await db.update(subscriptions)
    .set({ ...set, updatedAt: eventAt })
    .where(eq(subscriptions.userId, userId))
}
