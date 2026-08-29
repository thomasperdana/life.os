'use client'
import { useCallback, useEffect, useState } from 'react'

type Review = {
  id: string; userId: string; rating: number; body: string | null
  status: string; createdAt: string; authorName: string | null
}
type Payload = {
  reviews: Review[]
  aggregate: { count: number; average: number }
  distribution: { rating: number; n: number }[]
  mine: { id: string; rating: number; body: string | null; status: string } | null
}

const Stars = ({ n }: { n: number }) => (
  <span className="text-amber-600 dark:text-amber-400" aria-label={`${n} out of 5`}>
    {'★'.repeat(n)}{'☆'.repeat(5 - n)}
  </span>
)

export function Reviews({ itemId, canReview }: { itemId: string; canReview: boolean }) {
  const [data, setData] = useState<Payload | null>(null)
  const [rating, setRating] = useState(5)
  const [body, setBody] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`/api/reviews?itemId=${itemId}`)
    if (res.ok) {
      const d: Payload = await res.json()
      setData(d)
      if (d.mine) { setRating(d.mine.rating); setBody(d.mine.body ?? '') }
    }
  }, [itemId])

  useEffect(() => { void load() }, [load])

  const submit = async () => {
    setBusy(true); setMessage(null)
    const res = await fetch('/api/reviews', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId, rating, body: body || undefined }),
    })
    const out = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setMessage(out.error ?? 'Could not submit.'); return }
    setMessage(out.review?.status === 'pending'
      ? 'Thanks — held for review before it appears.'
      : 'Published. Thank you.')
    void load()
  }

  const report = async (reviewId: string) => {
    const res = await fetch('/api/reviews/report', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewId }),
    })
    setMessage(res.ok ? 'Reported. A human will look at it.'
      : (await res.json().catch(() => ({}))).error ?? 'Could not report.')
    void load()
  }

  if (!data) return null
  const { aggregate, distribution, reviews, mine } = data

  return (
    <section className="space-y-6 border-t border-black/10 dark:border-white/15 pt-8"
      data-testid="reviews">
      <div className="flex items-baseline gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Reviews</h2>
        {aggregate.count > 0 && (
          <p className="text-sm text-black/60 dark:text-white/60" data-testid="review-aggregate">
            <Stars n={Math.round(aggregate.average)} /> {aggregate.average} · {aggregate.count}
            {aggregate.count === 1 ? ' review' : ' reviews'}
          </p>
        )}
      </div>

      {aggregate.count > 0 && (
        <ul className="space-y-1 max-w-xs" data-testid="review-distribution">
          {[5, 4, 3, 2, 1].map((star) => {
            const n = distribution.find((d) => d.rating === star)?.n ?? 0
            const pct = aggregate.count ? (n / aggregate.count) * 100 : 0
            return (
              <li key={star} className="flex items-center gap-2 text-xs">
                <span className="w-3 tabular-nums">{star}</span>
                <span className="flex-1 h-1.5 rounded bg-black/10 dark:bg-white/15 overflow-hidden">
                  <span className="block h-full bg-amber-500" style={{ width: `${pct}%` }} />
                </span>
                <span className="w-6 text-right tabular-nums text-black/50 dark:text-white/50">{n}</span>
              </li>
            )
          })}
        </ul>
      )}

      {canReview ? (
        <div className="space-y-3 rounded-lg border border-black/10 dark:border-white/15 p-4">
          <p className="text-sm font-medium">{mine ? 'Your review' : 'Leave a review'}</p>
          <div className="flex gap-1" role="group" aria-label="Rating">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} onClick={() => setRating(n)} aria-label={`${n} star`}
                className={`text-xl leading-none ${n <= rating ? 'text-amber-500' : 'text-black/20 dark:text-white/25'}`}>
                ★
              </button>
            ))}
          </div>
          <textarea
            value={body} onChange={(e) => setBody(e.target.value)} rows={3}
            placeholder="What did this give you? (optional)"
            aria-label="Review text"
            className="w-full rounded border border-black/15 dark:border-white/20 bg-transparent p-2 text-sm"
          />
          <button onClick={submit} disabled={busy}
            className="rounded-md bg-foreground text-background px-4 py-2 text-sm font-medium disabled:opacity-50">
            {busy ? 'Sending…' : mine ? 'Update review' : 'Submit review'}
          </button>
          {mine?.status === 'pending' && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Your review is held for moderation.
            </p>
          )}
          {message && <p role="status" className="text-sm text-black/70 dark:text-white/70">{message}</p>}
        </div>
      ) : (
        <p className="text-sm text-black/50 dark:text-white/50">
          Open this before reviewing it.
        </p>
      )}

      <ul className="space-y-4">
        {reviews.map((r) => (
          <li key={r.id} className="space-y-1">
            <div className="flex items-baseline gap-2 text-xs text-black/50 dark:text-white/50">
              <Stars n={r.rating} />
              <span>{r.authorName ?? 'A reader'}</span>
              <button onClick={() => report(r.id)}
                className="ml-auto hover:underline">Report</button>
            </div>
            {r.body && <p className="text-sm whitespace-pre-wrap">{r.body}</p>}
          </li>
        ))}
        {reviews.length === 0 && (
          <li className="text-sm text-black/50 dark:text-white/50">No reviews yet.</li>
        )}
      </ul>
    </section>
  )
}
