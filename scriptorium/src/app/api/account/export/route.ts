import { eq } from 'drizzle-orm'
import {
  db, profiles, progress, bookmarks, journals, reviews, subscriptions, downloadEvents,
} from '@/db'
import { currentUserId } from '@/lib/session'
import { rateLimit, limitResponse } from '@/lib/ratelimit'

export const runtime = 'nodejs'

/** GDPR data export — SPEC.3.md §11. Everything this app holds about you. */
export async function GET() {
  const userId = await currentUserId()
  if (!userId) return new Response(null, { status: 401 })

  const limited = await rateLimit(`export:${userId}`, 5, 3600)
  if (!limited.allowed) return limitResponse(limited)

  const [profile] = await db.select().from(profiles).where(eq(profiles.id, userId)).limit(1)
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId)).limit(1)

  const payload = {
    exportedAt: new Date().toISOString(),
    profile,
    // Billing identifiers only; card data never touches this system (§9.2).
    subscription: sub
      ? { status: sub.status, priceId: sub.priceId, currentPeriodEnd: sub.currentPeriodEnd,
          cancelAtPeriodEnd: sub.cancelAtPeriodEnd, stripeCustomerId: sub.stripeCustomerId }
      : null,
    progress: await db.select().from(progress).where(eq(progress.userId, userId)),
    bookmarks: await db.select().from(bookmarks).where(eq(bookmarks.userId, userId)),
    journals: await db.select().from(journals).where(eq(journals.userId, userId)),
    reviews: await db.select().from(reviews).where(eq(reviews.userId, userId)),
    downloads: await db.select().from(downloadEvents).where(eq(downloadEvents.userId, userId)),
  }

  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="scriptorium-export-${userId.slice(0, 8)}.json"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
