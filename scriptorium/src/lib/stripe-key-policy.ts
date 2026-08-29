/**
 * Which Stripe secret keys may be used where — SPEC.3.md §11.
 *
 * Pure so it is testable without a server context. A live key on a dev machine
 * creates real customers and real payment pages against real money, and the
 * only reason it is ever there is that someone copied the wrong key out of the
 * dashboard.
 */
export type KeyVerdict = { ok: true } | { ok: false; reason: string }

export function checkStripeKey(
  key: string | undefined,
  nodeEnv: string | undefined,
  allowLiveOverride: string | undefined,
): KeyVerdict {
  if (!key) return { ok: false, reason: 'STRIPE_SECRET_KEY is not set.' }

  const isLive = key.startsWith('sk_live_')
  const isProd = nodeEnv === 'production'

  if (isLive && !isProd && allowLiveOverride !== '1') {
    return {
      ok: false,
      reason:
        'Refusing to use a LIVE Stripe key outside production. Use an sk_test_ key ' +
        'for development, or set STRIPE_ALLOW_LIVE_KEY=1 if you really mean it.',
    }
  }
  return { ok: true }
}
