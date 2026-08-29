import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import Link from 'next/link'
import { db, subscriptions } from '@/db'
import { createClient } from '@/lib/supabase/server'
import { getEntitlement } from '@/lib/entitlement'
import { stripeConfigured } from '@/lib/stripe'
import { BillingButtons } from './BillingButtons'

export const dynamic = 'force-dynamic'

export default async function AccountPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/signin?next=/account')

  const entitlement = await getEntitlement(user.id)
  const [sub] = await db.select().from(subscriptions)
    .where(eq(subscriptions.userId, user.id)).limit(1)

  return (
    <main className="mx-auto max-w-2xl px-6 py-12 space-y-8">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
        <Link href="/library" className="text-sm text-black/60 dark:text-white/60 hover:underline">Library →</Link>
      </div>

      <section className="rounded-lg border border-black/10 dark:border-white/15 p-5 space-y-3">
        <p className="text-sm text-black/60 dark:text-white/60">{user.email}</p>
        <p className="text-lg font-medium">
          {entitlement.plan === 'full' ? 'Unlimited'
            : entitlement.plan === 'bundle' ? 'Starter bundle'
            : 'Free account'}
        </p>

        {entitlement.plan === 'bundle' && (
          <p className="text-sm text-black/60 dark:text-white/60" data-testid="slot-count">
            {entitlement.claimed} of {entitlement.slots} studies unlocked
            {entitlement.remaining > 0
              ? ` · ${entitlement.remaining} left to choose`
              : ' · all slots used'}
          </p>
        )}

        {sub && (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm pt-2 border-t border-black/5 dark:border-white/10">
            <dt className="text-black/50 dark:text-white/50">Status</dt>
            <dd className="tabular-nums">{sub.status}</dd>
            {sub.currentPeriodEnd && (
              <>
                <dt className="text-black/50 dark:text-white/50">
                  {sub.cancelAtPeriodEnd ? 'Access until' : 'Renews'}
                </dt>
                <dd className="tabular-nums">{sub.currentPeriodEnd.toISOString().slice(0, 10)}</dd>
              </>
            )}
          </dl>
        )}

        {sub?.cancelAtPeriodEnd && (
          <p className="text-sm text-amber-700 dark:text-amber-400">
            Cancelled. You keep access until the end of the period you paid for.
          </p>
        )}
      </section>

      {stripeConfigured() ? (
        <BillingButtons hasCustomer={Boolean(sub?.stripeCustomerId)} plan={entitlement.plan} />
      ) : (
        <p className="text-sm text-black/50 dark:text-white/50">
          Billing is not configured on this deployment.
        </p>
      )}
    </main>
  )
}
