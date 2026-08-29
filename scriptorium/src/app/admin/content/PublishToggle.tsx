'use client'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'

export function PublishToggle({ id, status }: { id: string; status: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()

  const next = status === 'published' ? 'draft' : 'published'

  return (
    <button
      disabled={pending}
      onClick={() => start(async () => {
        await fetch('/api/admin/content', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, status: next }),
        })
        router.refresh()
      })}
      className={`rounded px-2 py-0.5 text-xs font-medium ${
        status === 'published'
          ? 'bg-green-600/15 text-green-700 dark:text-green-400'
          : 'bg-black/10 dark:bg-white/15'
      } disabled:opacity-50`}
    >
      {pending ? '…' : status}
    </button>
  )
}
