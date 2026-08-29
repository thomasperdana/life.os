'use client'
import { useState } from 'react'

export function BillingButtons({
  hasCustomer, plan,
}: { hasCustomer: boolean; plan: 'free' | 'bundle' | 'full' }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const go = async (path: string, body?: unknown) => {
    setBusy(path); setError(null)
    try {
      const res = await fetch(path, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      })
      const data = await res.json()
      if (!res.ok || !data.url) throw new Error(data.error ?? 'Could not start billing.')
      location.href = data.url
    } catch (e) {
      setError((e as Error).message); setBusy(null)
    }
  }

  return (
    <section className="space-y-3">
      {plan !== 'full' && (
        <div className="flex flex-wrap gap-3">
          <button disabled={!!busy} onClick={() => go('/api/stripe/checkout', { plan: 'starter' })}
            className="rounded-md border border-black/20 dark:border-white/25 px-4 py-2 text-sm font-medium disabled:opacity-50">
            {busy ? 'Opening…' : 'Starter bundle · $197 once'}
          </button>
          <button disabled={!!busy} onClick={() => go('/api/stripe/checkout', { plan: 'unlimited' })}
            className="rounded-md bg-foreground text-background px-4 py-2 text-sm font-medium disabled:opacity-50">
            Unlimited · $297/year
          </button>
        </div>
      )}

      {hasCustomer && (
        <button disabled={!!busy} onClick={() => go('/api/stripe/portal')}
          className="rounded-md border border-black/20 dark:border-white/25 px-4 py-2 text-sm font-medium disabled:opacity-50">
          Manage subscription
        </button>
      )}

      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </section>
  )
}
