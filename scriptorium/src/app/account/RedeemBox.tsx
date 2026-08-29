'use client'
import { useState } from 'react'

export function RedeemBox({
  trialUsed, plan, trialEndsAt,
}: { trialUsed: boolean; plan: 'free' | 'bundle' | 'full'; trialEndsAt: string | null }) {
  const [code, setCode] = useState('')
  const [target, setTarget] = useState<'unlimited' | 'starter'>('unlimited')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/redeem', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, plan: target }),
      })
      const d = await res.json()
      if (!res.ok || !d.url) throw new Error(d.error ?? 'Could not redeem that code.')
      location.href = d.url
    } catch (err) {
      setError((err as Error).message); setBusy(false)
    }
  }

  // Which code is worth suggesting depends on where they are in the flow.
  const hint = !trialUsed
    ? 'New here? TRIAL-1 gives 14 days for $1. It does not renew and never auto-charges.'
    : plan === 'full'
      ? null
      : 'Your trial has been used. FOUNDER-50 takes 50% off your first payment.'

  return (
    <section className="space-y-3 rounded-lg border border-black/10 dark:border-white/15 p-5">
      <div className="space-y-1">
        <h2 className="text-sm font-medium">Have a code?</h2>
        {hint && <p className="text-sm text-black/60 dark:text-white/60">{hint}</p>}
        {trialEndsAt && plan === 'full' && (
          <p className="text-sm text-amber-700 dark:text-amber-400" data-testid="trial-ends">
            Trial access until {new Date(trialEndsAt).toISOString().slice(0, 10)}. Nothing will be charged.
          </p>
        )}
      </div>

      <form onSubmit={submit} className="flex flex-wrap gap-2">
        <input
          value={code} onChange={(e) => setCode(e.target.value)}
          placeholder="TRIAL-1" aria-label="Discount or trial code"
          data-testid="redeem-input"
          className="flex-1 min-w-[10rem] rounded-md border border-black/15 dark:border-white/20 bg-transparent px-3 py-2 text-sm uppercase"
        />
        <select value={target} onChange={(e) => setTarget(e.target.value as 'unlimited' | 'starter')}
          aria-label="Apply to"
          className="rounded-md border border-black/15 dark:border-white/20 bg-transparent px-2 py-2 text-sm">
          <option value="unlimited">Unlimited · $297/yr</option>
          <option value="starter">Starter · $197 once</option>
        </select>
        <button disabled={busy || !code.trim()} data-testid="redeem-submit"
          className="rounded-md bg-foreground text-background px-4 py-2 text-sm font-medium disabled:opacity-50">
          {busy ? 'Opening…' : 'Redeem'}
        </button>
      </form>

      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </section>
  )
}
