import 'server-only'
import { and, eq, sql } from 'drizzle-orm'
import { db, subscriptions, purchases, itemEntitlements, contentItems } from '@/db'

/**
 * Access model — SPEC.3.md §9.4, extended for the one-time Starter bundle.
 *
 * Three states, not two:
 *   - 'full'   an active Unlimited subscription: everything, always.
 *   - 'bundle' one or more one-time purchases: a fixed number of SLOTS, each
 *              claimed against one study. Ownership is permanent.
 *   - 'free'   neither.
 *
 * 'bundle' is the reason this is no longer a boolean. Whether a bundle holder
 * may open a given item depends on the ITEM, so every access decision needs the
 * item in hand — see `canAccessItem`.
 */
export type Plan = 'free' | 'bundle' | 'full'

export type Entitlement = {
  plan: Plan
  /** Total slots bought across all purchases. */
  slots: number
  /** Slots already spent on a study. */
  claimed: number
  /** slots - claimed, floored at zero. */
  remaining: number
}

/**
 * The unit a purchase is spent on. A PDF and its MP3 share a `pair_key` and are
 * therefore ONE unit; an item without a pair_key stands alone.
 */
export function unitKeyFor(item: { pairKey: string | null; id: string }) {
  return item.pairKey ?? item.id
}

export async function getEntitlement(userId: string): Promise<Entitlement> {
  const [sub] = await db.select().from(subscriptions)
    .where(eq(subscriptions.userId, userId)).limit(1)

  const stillPaidFor = sub?.currentPeriodEnd ? sub.currentPeriodEnd > new Date() : false
  const subscribed = Boolean(sub) && stillPaidFor && (
    sub.status === 'active' || sub.status === 'trialing' ||
    sub.status === 'past_due' ||          // grace window; Stripe is still retrying
    sub.status === 'canceled'             // they paid for the period; honour it
  )

  const [tally] = await db.select({
    slots: sql<number>`coalesce(sum(${purchases.slots}), 0)::int`,
  }).from(purchases).where(eq(purchases.userId, userId))

  const [used] = await db.select({
    claimed: sql<number>`count(*)::int`,
  }).from(itemEntitlements).where(eq(itemEntitlements.userId, userId))

  const slots = tally?.slots ?? 0
  const claimed = used?.claimed ?? 0

  return {
    plan: subscribed ? 'full' : slots > 0 ? 'bundle' : 'free',
    slots,
    claimed,
    remaining: Math.max(0, slots - claimed),
  }
}

/** Has this user already claimed this study? */
export async function ownsUnit(userId: string, unitKey: string) {
  const [row] = await db.select({ id: itemEntitlements.id }).from(itemEntitlements)
    .where(and(eq(itemEntitlements.userId, userId), eq(itemEntitlements.unitKey, unitKey)))
    .limit(1)
  return Boolean(row)
}

export type AccessDecision =
  | { allowed: true; reason: 'free' | 'subscription' | 'owned' }
  | { allowed: false; reason: 'locked'; claimable: boolean }

/**
 * The single access decision for one item. Every gated route calls this.
 *
 * Order matters: free content is free to everyone, an Unlimited subscription
 * beats everything else, and only then does bundle ownership come into it.
 */
export async function canAccessItem(
  userId: string,
  item: { id: string; pairKey: string | null; accessTier: 'free' | 'subscriber' },
  entitlement?: Entitlement,
): Promise<AccessDecision> {
  if (item.accessTier === 'free') return { allowed: true, reason: 'free' }

  const ent = entitlement ?? await getEntitlement(userId)
  if (ent.plan === 'full') return { allowed: true, reason: 'subscription' }

  if (await ownsUnit(userId, unitKeyFor(item))) {
    return { allowed: true, reason: 'owned' }
  }
  // Locked, but a bundle holder with a spare slot can unlock it themselves.
  return { allowed: false, reason: 'locked', claimable: ent.remaining > 0 }
}

/**
 * Spend one slot on a study. Returns why it failed rather than a bare boolean,
 * because "no slots left" and "already yours" need different messages.
 */
export async function claimUnit(userId: string, itemId: string): Promise<
  | { ok: true; unitKey: string; remaining: number }
  | { ok: false; error: 'not_found' | 'free_item' | 'already_owned' | 'no_slots' | 'subscription' }
> {
  const [item] = await db.select().from(contentItems)
    .where(eq(contentItems.id, itemId)).limit(1)
  if (!item || item.status !== 'published') return { ok: false, error: 'not_found' }
  if (item.accessTier === 'free') return { ok: false, error: 'free_item' }

  const ent = await getEntitlement(userId)
  if (ent.plan === 'full') return { ok: false, error: 'subscription' }

  const unitKey = unitKeyFor(item)
  if (await ownsUnit(userId, unitKey)) return { ok: false, error: 'already_owned' }
  if (ent.remaining <= 0) return { ok: false, error: 'no_slots' }

  const [oldest] = await db.select({ id: purchases.id }).from(purchases)
    .where(eq(purchases.userId, userId)).limit(1)

  // The unique index on (user_id, unit_key) is what makes a double-click safe.
  const inserted = await db.insert(itemEntitlements)
    .values({ userId, unitKey, purchaseId: oldest?.id ?? null })
    .onConflictDoNothing()
    .returning({ id: itemEntitlements.id })

  if (!inserted.length) return { ok: false, error: 'already_owned' }
  return { ok: true, unitKey, remaining: ent.remaining - 1 }
}
