import 'server-only'
import Stripe from 'stripe'

let cached: Stripe | null = null

/** Lazy so the app boots without Stripe configured (P0–P3 did not need it). */
export function stripe(): Stripe {
  if (cached) return cached
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set.')
  cached = new Stripe(key)
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
