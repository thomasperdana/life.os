'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Spending a bundle slot is permanent, so it asks first. The confirm names the
 * study and the remaining count, because "unlock" alone does not convey that
 * something finite is being spent.
 */
export function ClaimButton({
  itemId, title, remaining,
}: { itemId: string; title: string; remaining: number }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="space-y-1">
      <button
        data-testid="claim-button"
        disabled={pending}
        onClick={() => {
          if (!confirm(`Unlock “${title}” with one of your ${remaining} remaining slots? This cannot be undone.`)) return
          start(async () => {
            const res = await fetch('/api/entitlements/claim', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ itemId }),
            })
            if (!res.ok) {
              const d = await res.json().catch(() => ({}))
              setError(d.error ?? 'Could not unlock.')
              return
            }
            router.refresh()
          })
        }}
        className="w-full rounded-md bg-foreground text-background px-3 py-1.5 text-xs font-medium disabled:opacity-50">
        {pending ? 'Unlocking…' : `Unlock with a slot (${remaining} left)`}
      </button>
      {error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  )
}
