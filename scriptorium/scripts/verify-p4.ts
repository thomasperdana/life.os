import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'
import postgres from 'postgres'

const BASE = 'http://localhost:3000'
const WEBHOOK = `${BASE}/api/stripe/webhook`
const SECRET = process.env.STRIPE_WEBHOOK_SECRET!
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const sql = postgres(process.env.DIRECT_URL!, { prepare: false, max: 1, idle_timeout: 10 })
const pass = (n: string, ok: boolean, x = '') => console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '  ' + x : ''}`)

const stripe = new Stripe('sk_test_dummy_key_for_signing_only')
const DAY = 86400
const now = Math.floor(Date.now() / 1000)

let userId = ''
const CUSTOMER = `cus_p4_${Date.now()}`
const SUB = `sub_p4_${Date.now()}`
let seq = 0

/** A correctly signed webhook, exactly as Stripe would send it. */
async function send(type: string, object: unknown, createdAt = now, idOverride?: string) {
  const event = {
    id: idOverride ?? `evt_p4_${Date.now()}_${seq++}`,
    object: 'event', api_version: '2024-06-20', created: createdAt,
    type, livemode: false, pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
    data: { object },
  }
  const payload = JSON.stringify(event)
  const header = await stripe.webhooks.generateTestHeaderStringAsync({ payload, secret: SECRET })
  const res = await fetch(WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'stripe-signature': header },
    body: payload,
  })
  return { status: res.status, body: await res.text(), eventId: event.id }
}

const subObject = (status: string, periodEnd: number, cancelAtPeriodEnd = false) => ({
  id: SUB, object: 'subscription', customer: CUSTOMER, status,
  cancel_at_period_end: cancelAtPeriodEnd,
  metadata: { userId },
  items: { object: 'list', data: [{ id: 'si_1', object: 'subscription_item',
    price: { id: 'price_monthly_test', object: 'price' },
    current_period_end: periodEnd }] },
})

const readSub = async () =>
  (await sql`select status, price_id, current_period_end, cancel_at_period_end, stripe_subscription_id
             from public.subscriptions where user_id=${userId}::uuid`)[0]

const entitlement = async () => {
  const r = await readSub()
  if (!r) return 'free'
  const paid = r.current_period_end && new Date(r.current_period_end) > new Date()
  return ['active','trialing','past_due','canceled'].includes(r.status) && paid ? 'subscriber' : 'free'
}

try {
  const email = `p4-${Date.now()}@example.com`
  const { data: u, error } = await admin.auth.admin.createUser({
    email, password: crypto.randomUUID() + 'Aa1!', email_confirm: true })
  if (error) throw new Error(error.message)
  userId = u.user.id

  console.log('\nSIGNATURE VERIFICATION (§9.3 rule 3)')
  let r = await fetch(WEBHOOK, { method: 'POST', body: '{}' })
  pass('no signature -> 400', r.status === 400, `got ${r.status}`)

  r = await fetch(WEBHOOK, { method: 'POST',
    headers: { 'stripe-signature': 't=1,v1=deadbeef' }, body: '{"id":"evt_x"}' })
  pass('bad signature -> 400', r.status === 400, `got ${r.status}`)

  const good = JSON.stringify({ id: 'evt_tamper', type: 'invoice.paid', created: now, data: { object: {} } })
  const hdr = await stripe.webhooks.generateTestHeaderStringAsync({ payload: good, secret: SECRET })
  r = await fetch(WEBHOOK, { method: 'POST',
    headers: { 'stripe-signature': hdr }, body: good.replace('evt_tamper', 'evt_TAMPERED') })
  pass('tampered body -> 400', r.status === 400, `got ${r.status}`)

  console.log('\nSUBSCRIBE')
  let res = await send('checkout.session.completed', {
    id: 'cs_1', object: 'checkout.session', customer: CUSTOMER,
    client_reference_id: userId, mode: 'subscription' })
  pass('checkout.session.completed -> 200', res.status === 200, `got ${res.status}`)

  res = await send('customer.subscription.created', subObject('active', now + 30 * DAY))
  pass('subscription.created -> 200', res.status === 200)
  let row = await readSub()
  pass('status active', row?.status === 'active', row?.status)
  pass('price recorded', row?.price_id === 'price_monthly_test', row?.price_id)
  pass('subscription id recorded', row?.stripe_subscription_id === SUB)
  pass('ENTITLEMENT = subscriber', (await entitlement()) === 'subscriber')

  console.log('\nIDEMPOTENCY (§9.3 rule 2)')
  const dupId = `evt_dup_${Date.now()}`
  await send('customer.subscription.updated', subObject('past_due', now + 30 * DAY), now + 10, dupId)
  const afterFirst = (await readSub())?.status
  const dup = await send('customer.subscription.updated', subObject('active', now + 99 * DAY), now + 10, dupId)
  const afterDup = await readSub()
  pass('replayed event is a no-op', afterDup?.status === afterFirst, `${afterFirst} -> ${afterDup?.status}`)
  pass('duplicate acknowledged 200', dup.status === 200 && dup.body.includes('duplicate'))

  console.log('\nOUT-OF-ORDER DELIVERY (§13)')
  await send('customer.subscription.updated', subObject('active', now + 60 * DAY), now + 100)
  const newer = await readSub()
  const stale = await send('customer.subscription.updated', subObject('canceled', now - 5 * DAY), now + 20)
  const afterStale = await readSub()
  pass('stale event accepted but ignored', stale.status === 200 && afterStale?.status === newer?.status,
       `${newer?.status} stayed ${afterStale?.status}`)
  pass('ENTITLEMENT still subscriber', (await entitlement()) === 'subscriber')

  console.log('\nPAYMENT FAILURE')
  await send('invoice.payment_failed', { id: 'in_1', object: 'invoice', customer: CUSTOMER }, now + 200)
  pass('active -> past_due', (await readSub())?.status === 'past_due', (await readSub())?.status)
  pass('past_due keeps access through the grace window',
       (await entitlement()) === 'subscriber')

  console.log('\nCANCEL AT PERIOD END')
  await send('customer.subscription.updated',
    subObject('active', now + 45 * DAY, true), now + 300)
  row = await readSub()
  pass('cancel_at_period_end recorded', row?.cancel_at_period_end === true)
  pass('still a subscriber until the period ends', (await entitlement()) === 'subscriber')

  console.log('\nLAPSE')
  await send('customer.subscription.deleted', subObject('canceled', now - DAY), now + 400)
  row = await readSub()
  pass('status canceled', row?.status === 'canceled', row?.status)
  pass('ENTITLEMENT = free once the paid period has passed', (await entitlement()) === 'free')

  console.log('\nCONVERGENCE — same events, shuffled, must land in the same state')
  await sql`delete from public.processed_events where id like 'evt_conv%'`
  await sql`delete from public.subscriptions where user_id=${userId}::uuid`
  const script: Array<[string, unknown, number]> = [
    ['checkout.session.completed', { id: 'cs_2', object: 'checkout.session', customer: CUSTOMER, client_reference_id: userId }, now + 1000],
    ['customer.subscription.created', subObject('active', now + 30 * DAY), now + 1001],
    ['customer.subscription.updated', subObject('active', now + 60 * DAY), now + 1002],
  ]
  for (const [t, o, c] of [...script].reverse()) {
    await send(t, o, c, `evt_conv_rev_${t}_${c}`)
  }
  const shuffled = await readSub()
  pass('reverse-order delivery converges to the newest period',
    shuffled?.status === 'active' &&
    new Date(shuffled.current_period_end).getTime() > (now + 59 * DAY) * 1000,
    `${shuffled?.status} until ${shuffled?.current_period_end}`)
  pass('ENTITLEMENT = subscriber', (await entitlement()) === 'subscriber')

  console.log('\nUNHANDLED EVENTS')
  res = await send('customer.updated', { id: CUSTOMER, object: 'customer' })
  pass('unknown type acknowledged, not errored', res.status === 200, `got ${res.status}`)
} catch (e) {
  console.error('\nERROR:', (e as Error).message); process.exitCode = 1
} finally {
  if (userId) {
    await sql`delete from public.subscriptions where user_id=${userId}::uuid`
    await admin.auth.admin.deleteUser(userId)
  }
  await sql`delete from public.processed_events where id like 'evt_p4%' or id like 'evt_dup%' or id like 'evt_conv%'`
  console.log('\n  cleaned up test user, subscription, and event log')
  await sql.end()
}
