import { z } from 'zod'
import { and, desc, eq, gt, sql as raw } from 'drizzle-orm'
import { db, reviews, contentItems, progress, profiles } from '@/db'
import { currentUserId } from '@/lib/session'
import { moderateReview, MAX_BODY_LENGTH } from '@/lib/moderation'
import { rateLimit, limitResponse } from '@/lib/ratelimit'

export const runtime = 'nodejs'

const Body = z.object({
  itemId: z.uuid(),
  rating: z.number().int().min(1).max(5),
  body: z.string().max(MAX_BODY_LENGTH).optional(),
})

/** Published reviews for an item, plus the caller's own at any status (§10.2). */
export async function GET(req: Request) {
  const itemId = new URL(req.url).searchParams.get('itemId')
  if (!itemId) return Response.json({ error: 'itemId required' }, { status: 400 })
  const userId = await currentUserId()

  const rows = await db.select({
    id: reviews.id, userId: reviews.userId, rating: reviews.rating,
    body: reviews.body, status: reviews.status, createdAt: reviews.createdAt,
    authorName: profiles.displayName,
  })
    .from(reviews)
    .leftJoin(profiles, eq(profiles.id, reviews.userId))
    .where(and(eq(reviews.itemId, itemId), eq(reviews.status, 'published')))
    .orderBy(desc(reviews.createdAt))
    .limit(100)

  const [agg] = await db.select({
    count: raw<number>`count(*)::int`,
    average: raw<number>`coalesce(round(avg(${reviews.rating})::numeric, 2), 0)::float`,
  }).from(reviews).where(and(eq(reviews.itemId, itemId), eq(reviews.status, 'published')))

  const distribution = await db.select({
    rating: reviews.rating, n: raw<number>`count(*)::int`,
  }).from(reviews)
    .where(and(eq(reviews.itemId, itemId), eq(reviews.status, 'published')))
    .groupBy(reviews.rating)

  let mine = null
  if (userId) {
    const [own] = await db.select().from(reviews)
      .where(and(eq(reviews.itemId, itemId), eq(reviews.userId, userId))).limit(1)
    mine = own ?? null
  }

  return Response.json({ reviews: rows, aggregate: agg, distribution, mine })
}

export async function POST(req: Request) {
  const userId = await currentUserId()
  if (!userId) return new Response(null, { status: 401 })

  const limited = await rateLimit(`review:${userId}`, 10, 3600)
  if (!limited.allowed) return limitResponse(limited)

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }
  const b = parsed.data

  const [author] = await db.select({ bannedAt: profiles.bannedAt })
    .from(profiles).where(eq(profiles.id, userId)).limit(1)
  if (author?.bannedAt) return Response.json({ error: 'account cannot post reviews' }, { status: 403 })

  const [item] = await db.select({ status: contentItems.status })
    .from(contentItems).where(eq(contentItems.id, b.itemId)).limit(1)
  if (!item || item.status !== 'published') return new Response(null, { status: 404 })

  // §10.1 — no reviews of things nobody opened.
  const [seen] = await db.select({ itemId: progress.itemId }).from(progress)
    .where(and(eq(progress.userId, userId), eq(progress.itemId, b.itemId))).limit(1)
  if (!seen) {
    return Response.json(
      { error: 'Open this before reviewing it.' }, { status: 403 })
  }

  // §10.2 — one submission per user per item per hour, to make abuse tedious.
  const hourAgo = new Date(Date.now() - 3600_000)
  const [recent] = await db.select({ id: reviews.id }).from(reviews)
    .where(and(eq(reviews.userId, userId), eq(reviews.itemId, b.itemId),
               gt(reviews.createdAt, hourAgo)))
    .limit(1)

  const [existing] = await db.select().from(reviews)
    .where(and(eq(reviews.userId, userId), eq(reviews.itemId, b.itemId))).limit(1)

  if (existing && recent) {
    return Response.json({ error: 'You just submitted this. Try again later.' }, { status: 429 })
  }

  const mod = moderateReview(b.body)
  const status = mod.verdict === 'clean' ? 'published' as const : 'pending' as const

  if (existing) {
    const [row] = await db.update(reviews)
      .set({ rating: b.rating, body: mod.cleaned || null, status,
             moderatedBy: null, moderatedAt: null, createdAt: new Date() })
      .where(eq(reviews.id, existing.id)).returning()
    return Response.json({ review: row, moderation: mod })
  }

  const [row] = await db.insert(reviews).values({
    userId, itemId: b.itemId, rating: b.rating,
    body: mod.cleaned || null, status,
  }).returning()

  return Response.json({ review: row, moderation: mod }, { status: 201 })
}
