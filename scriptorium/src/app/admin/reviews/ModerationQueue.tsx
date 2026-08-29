'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

type Row = {
  id: string; rating: number; body: string | null; createdAt: Date
  authorName: string | null; authorId: string
  itemTitle: string | null; reportCount: number
}

export function ModerationQueue({ initial }: { initial: Row[] }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [busy, setBusy] = useState<string | null>(null)

  const act = (reviewId: string, action: 'publish' | 'reject' | 'ban') => {
    if (action === 'ban' && !confirm('Ban this author from posting reviews?')) return
    setBusy(reviewId)
    start(async () => {
      await fetch('/api/admin/reviews', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewId, action }),
      })
      setBusy(null)
      router.refresh()
    })
  }

  if (initial.length === 0) {
    return <p className="text-sm text-black/50 dark:text-white/50">Queue is empty.</p>
  }

  return (
    <ul className="space-y-3" data-testid="moderation-queue">
      {initial.map((r) => (
        <li key={r.id} className="rounded-lg border border-black/10 dark:border-white/15 p-4 space-y-3">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-black/50 dark:text-white/50">
            <span className="text-amber-600 dark:text-amber-400">{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</span>
            <span>{r.itemTitle}</span>
            <span>· {r.authorName ?? 'unnamed'}</span>
            {r.reportCount > 0 && (
              <span className="text-red-700 dark:text-red-400">
                · reported {r.reportCount}×
              </span>
            )}
          </div>

          {r.body && <p className="text-sm whitespace-pre-wrap">{r.body}</p>}

          <div className="flex flex-wrap gap-2">
            <button disabled={pending && busy === r.id} onClick={() => act(r.id, 'publish')}
              className="rounded bg-foreground text-background px-3 py-1 text-xs font-medium disabled:opacity-50">
              Publish
            </button>
            <button disabled={pending && busy === r.id} onClick={() => act(r.id, 'reject')}
              className="rounded border border-black/20 dark:border-white/25 px-3 py-1 text-xs disabled:opacity-50">
              Reject
            </button>
            <button disabled={pending && busy === r.id} onClick={() => act(r.id, 'ban')}
              className="rounded border border-red-500/40 text-red-700 dark:text-red-400 px-3 py-1 text-xs disabled:opacity-50">
              Ban author
            </button>
          </div>
        </li>
      ))}
    </ul>
  )
}
