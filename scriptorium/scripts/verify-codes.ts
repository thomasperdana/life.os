import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'
import postgres from 'postgres'
import { normaliseCode, REDEEM_CODES, TRIAL_DAYS } from '../src/lib/redeem-codes'

const BASE = 'http://localhost:3000'
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ref = new URL(url).hostname.split('.')[0]
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const sql = postgres(process.env.DIRECT_URL!, { prepare: false, max: 1, idle_timeout: 10 })
const pass = (n: string, ok: boolean, x = '') => console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '  ' + x : ''}`)
const signer = new Stripe('sk_test_dummy')
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
const now = Math.floor(Date.now() / 1000)
let seq = 0

async function send(type: string, object: unknown) {
  const ev = { id: `evt_c_${Date.now()}_${seq++}`, object: 'event', created: now, type, livemode: false, data: { object } }
  const payload = JSON.stringify(ev)
  const header = await signer.webhooks.generateTestHeaderStringAsync({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET! })
  const r = await fetch(`${BASE}/api/stripe/webhook`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'stripe-signature': header }, body: payload })
  return r.status
}

const users: string[] = []
const password = crypto.randomUUID() + 'Aa1!'
const anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
async function mk(tag: string) {
  const email = `codes-${tag}-${Date.now()}@example.com`
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error || !data) throw new Error(error?.message)
  users.push(data.user.id)
  const { data: s } = await anon.auth.signInWithPassword({ email, password })
  return { id: data.user.id, cookie: `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(s!.session)).toString('base64')}` }
}
const J = (c: string) => ({ 'Content-Type': 'application/json', cookie: c })

try {
  console.log('\nCODE NORMALISATION (you asked for periods; Stripe forbids them)')
  pass('"TRIAL.1" -> TRIAL-1', normaliseCode('TRIAL.1') === 'TRIAL-1')
  pass('"founder.50" -> FOUNDER-50', normaliseCode('founder.50') === 'FOUNDER-50')
  pass('"trial 1" -> TRIAL-1', normaliseCode('trial 1') === 'TRIAL-1')
  pass('both codes registered', 'TRIAL-1' in REDEEM_CODES && 'FOUNDER-50' in REDEEM_CODES)

  console.log('\nSTRIPE SCOPE — codes must not reach your other 7 products')
  const promos = await stripe.promotionCodes.list({ code: 'FOUNDER-50', active: true, limit: 5 })
  pass('exactly one active FOUNDER-50', promos.data.length === 1, `${promos.data.length}`)
  const cid = typeof promos.data[0].promotion?.coupon === 'string'
    ? promos.data[0].promotion.coupon : promos.data[0].promotion?.coupon?.id
  // `applies_to` is NOT returned by default — it must be expanded, and it is
  // also absent from the create response. Reading it without expand makes a
  // correctly restricted coupon look account-wide.
  const coupon = await stripe.coupons.retrieve(cid!, { expand: ['applies_to'] } as never)
  pass('coupon is 50% off', coupon.percent_off === 50)
  pass('restricted to exactly 2 products', coupon.applies_to?.products?.length === 2,
       `${coupon.applies_to?.products?.length ?? 0}`)
  const prods = await stripe.products.list({ limit: 100, active: true })
  const scriptorium = prods.data.filter(p => p.name.startsWith('Scriptorium')).map(p => p.id)
  pass('and those two are the Scriptorium products',
    coupon.applies_to!.products!.every(p => scriptorium.includes(p)))
  let oldGone = false
  try { await stripe.coupons.retrieve('founder-50') } catch { oldGone = true }
  pass('old account-wide coupon is gone', oldGone)

  console.log('\nREDEEM GUARDS')
  const u = await mk('a')
  let r = await fetch(`${BASE}/api/redeem`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'TRIAL-1' }) })
  pass('no session -> 401', r.status === 401, `got ${r.status}`)

  r = await fetch(`${BASE}/api/redeem`, { method: 'POST', headers: J(u.cookie),
    body: JSON.stringify({ code: 'NOPE-99' }) })
  pass('unknown code -> 404', r.status === 404, `got ${r.status}`)

  console.log('\nTRIAL: $1, 14 DAYS, THEN LAPSE')
  const sess = `cs_trial_${Date.now()}`
  const st = await send('checkout.session.completed', {
    id: sess, object: 'checkout.session', mode: 'payment', payment_status: 'paid',
    client_reference_id: u.id, customer: `cus_trial_${Date.now()}`,
    metadata: { userId: u.id, plan: 'trial' } })
  pass('trial webhook accepted', st === 200, `got ${st}`)

  const [row] = await sql`select status, price_id, current_period_end, cancel_at_period_end,
                                 stripe_subscription_id from public.subscriptions where user_id=${u.id}::uuid`
  pass('recorded as trialing', row?.status === 'trialing', row?.status)
  pass('no Stripe subscription behind it (cannot auto-charge)', row?.stripe_subscription_id === null)
  pass('marked as not renewing', row?.cancel_at_period_end === true)
  const days = Math.round((new Date(row.current_period_end).getTime() - Date.now()) / 86400_000)
  pass(`expires in ${TRIAL_DAYS} days`, days === TRIAL_DAYS, `${days} days`)

  const [item] = await sql`select id from public.content_items where slug='demo-listen'`
  await sql`update public.content_items set access_tier='subscriber' where id=${item.id}::uuid`
  r = await fetch(`${BASE}/api/content/${item.id}/url`, { headers: { cookie: u.cookie } })
  pass('trial grants full access -> 200', r.status === 200, `got ${r.status}`)

  console.log('\nONE TRIAL PER ACCOUNT')
  r = await fetch(`${BASE}/api/redeem`, { method: 'POST', headers: J(u.cookie),
    body: JSON.stringify({ code: 'trial.1' }) })
  pass('cannot redeem the trial twice -> 409', r.status === 409, `got ${r.status}`)

  console.log('\nWHEN IT EXPIRES')
  await sql`update public.subscriptions set current_period_end = now() - interval '1 day'
            where user_id=${u.id}::uuid`
  r = await fetch(`${BASE}/api/content/${item.id}/url`, { headers: { cookie: u.cookie } })
  pass('access ends -> 402', r.status === 402, `got ${r.status}`)
  pass('and nothing was charged (no subscription object)', row?.stripe_subscription_id === null)

  r = await fetch(`${BASE}/api/redeem`, { method: 'POST', headers: J(u.cookie),
    body: JSON.stringify({ code: 'TRIAL-1' }) })
  const body = await r.json()
  pass('expired trial still cannot be re-redeemed -> 409', r.status === 409, `got ${r.status}`)
  pass('and it points them at FOUNDER-50', String(body.error).includes('FOUNDER-50'), body.error)

  await sql`update public.content_items set access_tier='free' where id=${item.id}::uuid`
} catch (e) {
  console.error('\nERROR:', (e as Error).message); process.exitCode = 1
} finally {
  for (const id of users) {
    await sql`delete from public.subscriptions where user_id=${id}::uuid`
    await admin.auth.admin.deleteUser(id)
  }
  await sql`delete from public.processed_events where id like 'evt_c_%'`
  console.log(`\n  cleaned up ${users.length} users`)
  await sql.end()
}
