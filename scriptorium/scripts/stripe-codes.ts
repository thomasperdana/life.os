/**
 * Scopes the discount codes to Scriptorium and creates the 14-day trial.
 *
 * Two Stripe constraints drive the shape of this:
 *  1. A coupon's `applies_to` is set at creation and cannot be edited, so
 *     restricting FOUNDER-50 means a NEW coupon and moving the code onto it.
 *     A promotion code's coupon is likewise immutable.
 *  2. A coupon cannot express "$1 for 14 days then stop" — coupons discount
 *     whole invoices by duration. The trial is therefore its own $1 one-time
 *     PRODUCT, and the app grants 14 days of access when it is paid.
 */
import Stripe from 'stripe'

const key = process.env.STRIPE_SECRET_KEY!
console.log(`\n  Stripe mode: ${key.startsWith('sk_live_') ? 'LIVE' : 'TEST'}\n`)
const stripe = new Stripe(key)
const DRY = process.argv.includes('--dry-run')
const say = (s: string) => console.log(`  ${s}`)

// ── the two Scriptorium products, the only things these codes may touch ─────
const prices = await stripe.prices.list({
  lookup_keys: ['scriptorium_starter_10_onetime', 'scriptorium_unlimited_annual'],
  expand: ['data.product'], limit: 10,
})
const productIds = prices.data.map((p) => (p.product as Stripe.Product).id)
if (productIds.length !== 2) throw new Error(`expected 2 Scriptorium products, found ${productIds.length}`)
say(`scoping to ${productIds.length} Scriptorium products: ${productIds.join(', ')}`)

// ── 1. $1 / 14-day trial price ─────────────────────────────────────────────
const TRIAL_LOOKUP = 'scriptorium_trial_14day'
let trialPrice = (await stripe.prices.list({ lookup_keys: [TRIAL_LOOKUP], limit: 1, active: true })).data[0]
if (trialPrice) say(`trial price EXISTS  ${trialPrice.id}  $${(trialPrice.unit_amount ?? 0) / 100}`)
else if (DRY) say('trial price WOULD CREATE  $1 one-time')
else {
  const prod = await stripe.products.create({
    name: 'Scriptorium — 14-Day Trial',
    description: 'Full library access for 14 days. One-time $1. Does not renew and does not auto-charge.',
  })
  trialPrice = await stripe.prices.create({
    product: prod.id, currency: 'usd', unit_amount: 100, lookup_key: TRIAL_LOOKUP,
  })
  say(`trial price CREATED  ${trialPrice.id}  $1 one-time (does not renew)`)
}

// ── 2. FOUNDER-50, restricted to Scriptorium ───────────────────────────────
const NEW_COUPON = 'founder-50-scriptorium'
let coupon: Stripe.Coupon | null = null
try {
  coupon = await stripe.coupons.retrieve(NEW_COUPON)
  say(`coupon EXISTS  ${coupon.id}  applies_to=${JSON.stringify(coupon.applies_to)}`)
} catch {
  if (DRY) say(`coupon WOULD CREATE  ${NEW_COUPON}  50% off, restricted`)
  else {
    coupon = await stripe.coupons.create({
      id: NEW_COUPON, percent_off: 50, duration: 'once', name: 'Founder 50% (Scriptorium)',
      applies_to: { products: productIds },
    })
    say(`coupon CREATED  ${coupon.id}  50% off, restricted to Scriptorium`)
  }
}

if (!DRY && coupon) {
  const existing = (await stripe.promotionCodes.list({ code: 'FOUNDER-50', limit: 5 })).data
  const onOldCoupon = existing.find((p) => {
    const c = p.promotion?.coupon
    const id = typeof c === 'string' ? c : c?.id
    return id !== NEW_COUPON
  })
  if (onOldCoupon?.active) {
    await stripe.promotionCodes.update(onOldCoupon.id, { active: false })
    say(`promo DEACTIVATED  old unrestricted FOUNDER-50 (${onOldCoupon.id})`)
  }
  if (!existing.some((p) => {
    const c = p.promotion?.coupon
    return (typeof c === 'string' ? c : c?.id) === NEW_COUPON
  })) {
    const p = await stripe.promotionCodes.create({
      promotion: { type: 'coupon', coupon: NEW_COUPON }, code: 'FOUNDER-50',
    })
    say(`promo CREATED  FOUNDER-50 -> ${NEW_COUPON}  ${p.id}`)
  } else say('promo EXISTS   FOUNDER-50 already on the restricted coupon')

  // The old account-wide coupon must not survive: any code on it discounts
  // every product, including the $12,497 package.
  try {
    await stripe.coupons.del('founder-50')
    say('coupon DELETED  the old account-wide founder-50')
  } catch (e) { say(`coupon delete skipped  ${(e as Error).message.slice(0, 60)}`) }
}

console.log('\n  --- .env.local ---')
if (trialPrice) console.log(`  STRIPE_PRICE_TRIAL=${trialPrice.id}`)
console.log()
