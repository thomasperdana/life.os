import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db, reviews, reviewReports } from '@/db'
import { currentUserId } from '@/lib/session'

export const runtime = 'nodejs'

const Body = z.object({ reviewId: z.uuid(), reason: z.string().max(500).optional() })

/** Reporting a published review returns it to the moderation queue (§10.2). */
export async function POST(req: Request) {
  const userId = await currentUserId()
  if (!userId) return new Response(null, { status: 401 })

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: 'bad request' }, { status: 400 })

  const [review] = await db.select().from(reviews)
    .where(eq(reviews.id, parsed.data.reviewId)).limit(1)
  if (!review) return new Response(null, { status: 404 })

  if (review.userId === userId) {
    return Response.json({ error: 'You cannot report your own review.' }, { status: 400 })
  }

  const inserted = await db.insert(reviewReports)
    .values({ reviewId: review.id, reporterId: userId, reason: parsed.data.reason ?? null })
    .onConflictDoNothing()
    .returning({ id: reviewReports.id })

  if (!inserted.length) {
    return Response.json({ error: 'You already reported this.' }, { status: 409 })
  }

  // Back to the queue. A human decides; the report itself is not a verdict.
  if (review.status === 'published') {
    await db.update(reviews)
      .set({ status: 'pending', moderatedBy: null, moderatedAt: null })
      .where(eq(reviews.id, review.id))
  }

  return new Response(null, { status: 204 })
}
