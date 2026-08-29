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

export function stripeConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET)
}

export const PRICES = {
  get monthly() { return process.env.STRIPE_PRICE_MONTHLY },
  get annual() { return process.env.STRIPE_PRICE_ANNUAL },
}

/** Stripe's subscription statuses, narrowed to the enum in our schema. */
export type SubStatus =
  | 'active' | 'trialing' | 'past_due' | 'canceled'
  | 'incomplete' | 'incomplete_expired' | 'unpaid'

export function toSubStatus(s: string): SubStatus {
  const known: SubStatus[] = ['active', 'trialing', 'past_due', 'canceled',
    'incomplete', 'incomplete_expired', 'unpaid']
  return (known as string[]).includes(s) ? (s as SubStatus) : 'canceled'
}
