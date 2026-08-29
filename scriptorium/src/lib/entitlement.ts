import 'server-only'
import { eq } from 'drizzle-orm'
import { db, subscriptions } from '@/db'

export type Entitlement = 'free' | 'subscriber'

/**
 * The single source of truth for access (SPEC.3.md §9.4, §5.2 fence one).
 *
 * Every gated route and gated Server Component calls this. There is no second
 * path. RLS is defence in depth and knows nothing about subscriptions.
 *
 * - `active` / `trialing` with a future period end  → subscriber
 * - `past_due`  → subscriber through the grace window (Stripe is still retrying)
 * - `canceled`  → subscriber until current_period_end; the user paid for it
 */
export async function getEntitlement(userId: string): Promise<Entitlement> {
  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .limit(1)

  if (!sub) return 'free'

  const stillPaidFor = sub.currentPeriodEnd ? sub.currentPeriodEnd > new Date() : false

  switch (sub.status) {
    case 'active':
    case 'trialing':
    case 'past_due':
      return stillPaidFor ? 'subscriber' : 'free'
    case 'canceled':
      return stillPaidFor ? 'subscriber' : 'free'
    default:
      return 'free'
  }
}

export function canAccess(entitlement: Entitlement, tier: 'free' | 'subscriber') {
  return tier === 'free' || entitlement === 'subscriber'
}
