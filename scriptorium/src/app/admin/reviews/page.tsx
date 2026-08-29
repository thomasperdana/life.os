import { desc, eq, sql as raw } from 'drizzle-orm'
import { db, reviews, contentItems, profiles } from '@/db'
import { ModerationQueue } from './ModerationQueue'

export const dynamic = 'force-dynamic'

export default async function AdminReviewsPage() {
  const queue = await db.select({
    id: reviews.id, rating: reviews.rating, body: reviews.body,
    createdAt: reviews.createdAt,
    authorName: profiles.displayName, authorId: reviews.userId,
    itemTitle: contentItems.title,
    reportCount: raw<number>`(select count(*)::int from public.review_reports rr where rr.review_id = ${reviews.id})`,
  })
    .from(reviews)
    .leftJoin(profiles, eq(profiles.id, reviews.userId))
    .leftJoin(contentItems, eq(contentItems.id, reviews.itemId))
    .where(eq(reviews.status, 'pending'))
    .orderBy(desc(reviews.createdAt))

  return (
    <section className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Moderation</h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          The queue exists for abuse, not for disagreement. A review you dislike is not a review
          you should remove.
        </p>
      </div>
      <ModerationQueue initial={queue} />
    </section>
  )
}
