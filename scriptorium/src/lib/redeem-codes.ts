/**
 * Redeemable codes — pure data and one pure function, so both the server and
 * the tests can read them. No secrets, no I/O, therefore no `server-only`.
 */
export const TRIAL_DAYS = 14

export const REDEEM_CODES = {
  /** Not a Stripe promotion code: selects the $1 trial product (§9.5). */
  'TRIAL-1': { kind: 'trial' as const },
  /** A real Stripe promotion code, applied at checkout. */
  'FOUNDER-50': { kind: 'promo' as const, stripeCode: 'FOUNDER-50' },
}

/**
 * Both codes were requested with a period ("TRIAL.1", "FOUNDER.50"), which
 * Stripe forbids in promotion codes. Normalising means the reader can type it
 * either way and it still works.
 */
export function normaliseCode(input: string) {
  return input.trim().toUpperCase().replace(/[.\s_]+/g, '-')
}
