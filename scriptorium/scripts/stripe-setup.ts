/**
 * Creates the Scriptorium catalog in Stripe — SPEC.3.md §9.1.
 *
 * Creates ONLY catalog objects: products, prices, one coupon, one promotion
 * code. It never creates a customer, a subscription, or a charge, so running it
 * cannot move money.
 *
 * Idempotent by `lookup_key` on prices and by id on the coupon, so re-running
 * reports what already exists instead of duplicating it. Stripe prices cannot
 * be deleted, only archived, which is exactly why this is written to be re-run
 * safely rather than "carefully once".
 */
import Stripe from 'stripe'

const key = process.env.STRIPE_SECRET_KEY
if (!key) throw new Error('STRIPE_SECRET_KEY is not set.')
const mode = key.startsWith('sk_live_') ? 'LIVE' : 'TEST'
console.log(`\n  Stripe mode: ${mode}\n`)

const stripe = new Stripe(key)
const DRY = process.argv.includes('--dry-run')
const say = (s: string) => console.log(`  ${s}`)

const PLAN = {
  starter: {
    lookupKey: 'scriptorium_starter_10_onetime',
    product: 'Scriptorium — Starter Bundle',
    description: '10 studies: each PDF with its corresponding MP3. One-time purchase, kept permanently.',
    amount: 19700,          // $197.00
    recurring: false,
  },
  unlimited: {
    lookupKey: 'scriptorium_unlimited_annual',
    product: 'Scriptorium — Unlimited',
    description: 'Unlimited access to every PDF and MP3 in the library. Billed yearly.',
    amount: 29700,          // $297.00
    recurring: true,
  },
} as const

const COUPON_ID = 'founder-50'
/**
 * Stripe: "Valid characters are lower case letters (a-z), upper case letters
 * (A-Z), digits (0-9), and dashes (-)." A period is rejected, so the requested
 * "FOUNDER.50" cannot exist as a promotion code. A dash is the closest legal
 * form and keeps the same visual break.
 */
const PROMO_CODE = 'FOUNDER-50'

async function ensurePrice(p: typeof PLAN.starter | typeof PLAN.unlimited) {
  const found = await stripe.prices.list({ lookup_keys: [p.lookupKey], limit: 1, active: true })
  if (found.data.length) {
    say(`price EXISTS  ${p.lookupKey}  ${found.data[0].id}  $${(found.data[0].unit_amount ?? 0) / 100}`)
    return found.data[0]
  }
  if (DRY) { say(`price WOULD CREATE  ${p.lookupKey}  $${p.amount / 100}`); return null }

  const product = await stripe.products.create({ name: p.product, description: p.description })
  const price = await stripe.prices.create({
    product: product.id,
    currency: 'usd',
    unit_amount: p.amount,
    lookup_key: p.lookupKey,
    ...(p.recurring ? { recurring: { interval: 'year' as const } } : {}),
  })
  say(`price CREATED  ${p.lookupKey}  ${price.id}  $${p.amount / 100}${p.recurring ? '/year' : ' one-time'}`)
  return price
}

const starter = await ensurePrice(PLAN.starter)
const unlimited = await ensurePrice(PLAN.unlimited)

// ── Founder discount ────────────────────────────────────────────────────────
let coupon: Stripe.Coupon | null = null
try {
  coupon = await stripe.coupons.retrieve(COUPON_ID)
  say(`coupon EXISTS  ${coupon.id}  ${coupon.percent_off}% off`)
} catch {
  if (DRY) say(`coupon WOULD CREATE  ${COUPON_ID}  50% off`)
  else {
    coupon = await stripe.coupons.create({
      id: COUPON_ID,
      percent_off: 50,
      // 'once' = the first payment. For the one-time bundle that is the whole
      // purchase; for the annual plan it is the first year, then full price.
      duration: 'once',
      name: 'Founder 50%',
    })
    say(`coupon CREATED  ${coupon.id}  50% off, first payment`)
  }
}

if (coupon && !DRY) {
  const existing = await stripe.promotionCodes.list({ code: PROMO_CODE, limit: 1 })
  if (existing.data.length) {
    say(`promo EXISTS   ${PROMO_CODE}  ${existing.data[0].id}  active=${existing.data[0].active}`)
  } else {
    try {
      // API 2026-08-26 nests the discount: `promotion: { type, coupon }`.
      // The older flat `coupon` field is rejected as an unknown parameter.
      const promo = await stripe.promotionCodes.create({
        promotion: { type: 'coupon', coupon: coupon.id },
        code: PROMO_CODE,
      })
      say(`promo CREATED  ${promo.code}  ${promo.id}`)
    } catch (e) {
      say(`promo FAILED   ${PROMO_CODE} -> ${(e as Error).message}`)
    }
  }
}

console.log('\n  --- paste into .env.local ---')
if (starter)   console.log(`  STRIPE_PRICE_STARTER=${starter.id}`)
if (unlimited) console.log(`  STRIPE_PRICE_UNLIMITED=${unlimited.id}`)
console.log()
