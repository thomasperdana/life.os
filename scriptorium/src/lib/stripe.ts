import 'server-only'
import Stripe from 'stripe'
import { checkStripeKey } from './stripe-key-policy'

let cached: Stripe | null = null

/**
 * Lazy so the app boots without Stripe configured (P0–P3 did not need it).
 *
 * Refuses a LIVE key outside production. A live key on a dev machine creates
 * real customers and real payment pages against real money; the only reason it
 * is ever there is that someone copied the wrong key out of the dashboard.
 * Set STRIPE_ALLOW_LIVE_KEY=1 to override, deliberately.
 */
export function stripe(): Stripe {
  if (cached) return cached
  const key = process.env.STRIPE_SECRET_KEY
  const verdict = checkStripeKey(key, process.env.NODE_ENV, process.env.STRIPE_ALLOW_LIVE_KEY)
  if (!verdict.ok) throw new Error(verdict.reason)
  cached = new Stripe(key!)
  return cached
}

let webhookClient: Stripe | null = null

/**
 * Webhook signature verification ONLY.
 *
 * `constructEvent` is a local HMAC over the request body using the `whsec_`
 * signing secret. It makes no API call and never transmits the secret key, so
 * it must NOT sit behind the live-key policy — that guard exists to stop
 * outbound calls against a production account from a dev machine, and applying
 * it here breaks webhook processing in development for no security gain.
 */
export function stripeWebhooks() {
  if (!webhookClient) {
    webhookClient = new Stripe(process.env.STRIPE_SECRET_KEY ?? 'sk_unused_for_local_hmac')
  }
  return webhookClient.webhooks
}

export function stripeConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET)
}

export const PRICES = {
  /** $197 one-time — 10 studies, kept permanently. */
  get starter() { return process.env.STRIPE_PRICE_STARTER },
  /** $297/year — the whole library. */
  get unlimited() { return process.env.STRIPE_PRICE_UNLIMITED },
  /** $1 one-time — 14 days of full access. Does NOT renew (§9.5). */
  get trial() { return process.env.STRIPE_PRICE_TRIAL },
}

/** How many studies a one-time purchase grants. */
export const STARTER_SLOTS = 10

export { TRIAL_DAYS, REDEEM_CODES, normaliseCode } from './redeem-codes'

export type SubStatus =
  | 'active' | 'trialing' | 'past_due' | 'canceled'
  | 'incomplete' | 'incomplete_expired' | 'unpaid'

export function toSubStatus(s: string): SubStatus {
  const known: SubStatus[] = ['active', 'trialing', 'past_due', 'canceled',
    'incomplete', 'incomplete_expired', 'unpaid']
  return (known as string[]).includes(s) ? (s as SubStatus) : 'canceled'
}
