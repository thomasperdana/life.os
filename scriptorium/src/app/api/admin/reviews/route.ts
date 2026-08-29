import { z } from 'zod'
import { desc, eq, sql as raw } from 'drizzle-orm'
import { db, reviews, reviewReports, contentItems, profiles } from '@/db'
import { assertAdmin, adminErrorResponse } from '@/lib/admin'

export const runtime = 'nodejs'

/** The moderation queue: everything pending, newest first (§10.2). */
export async function GET() {
  try { await assertAdmin() } catch (e) {
    const r = adminErrorResponse(e); if (r) return r; throw e
  }

  const rows = await db.select({
    id: reviews.id, rating: reviews.rating, body: reviews.body,
    status: reviews.status, createdAt: reviews.createdAt,
    authorId: reviews.userId, authorName: profiles.displayName,
    authorBanned: profiles.bannedAt,
    itemTitle: contentItems.title, itemSlug: contentItems.slug,
    reportCount: raw<number>`(select count(*)::int from public.review_reports rr where rr.review_id = ${reviews.id})`,
  })
    .from(reviews)
    .leftJoin(profiles, eq(profiles.id, reviews.userId))
    .leftJoin(contentItems, eq(contentItems.id, reviews.itemId))
    .where(eq(reviews.status, 'pending'))
    .orderBy(desc(reviews.createdAt))
    .limit(200)

  return Response.json({ queue: rows })
}

const Action = z.object({
  reviewId: z.uuid(),
  action: z.enum(['publish', 'reject', 'ban']),
  reason: z.string().max(500).optional(),
})

export async function PATCH(req: Request) {
  let admin
  try { admin = await assertAdmin() } catch (e) {
    const r = adminErrorResponse(e); if (r) return r; throw e
  }

  const parsed = Action.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: 'bad request' }, { status: 400 })
  const { reviewId, action } = parsed.data

  const [review] = await db.select().from(reviews).where(eq(reviews.id, reviewId)).limit(1)
  if (!review) return new Response(null, { status: 404 })

  if (action === 'ban') {
    await db.update(profiles).set({ bannedAt: new Date() }).where(eq(profiles.id, review.userId))
    await db.update(reviews)
      .set({ status: 'rejected', moderatedBy: admin.userId, moderatedAt: new Date() })
      .where(eq(reviews.id, reviewId))
    return Response.json({ ok: true, banned: review.userId })
  }

  const [row] = await db.update(reviews)
    .set({
      status: action === 'publish' ? 'published' : 'rejected',
      moderatedBy: admin.userId, moderatedAt: new Date(),
    })
    .where(eq(reviews.id, reviewId)).returning()

  // Publishing settles the outstanding reports; keeping them would re-queue it.
  if (action === 'publish') {
    await db.delete(reviewReports).where(eq(reviewReports.reviewId, reviewId))
  }

  return Response.json({ review: row })
}
