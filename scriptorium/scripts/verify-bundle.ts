import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'
import postgres from 'postgres'

const BASE = 'http://localhost:3000'
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ref = new URL(url).hostname.split('.')[0]
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const sql = postgres(process.env.DIRECT_URL!, { prepare: false, max: 1, idle_timeout: 10 })
const pass = (n: string, ok: boolean, x = '') => console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '  ' + x : ''}`)
const signer = new Stripe('sk_test_dummy_for_signing')
const SECRET = process.env.STRIPE_WEBHOOK_SECRET!
const now = Math.floor(Date.now() / 1000)
let seq = 0

async function send(type: string, object: unknown, id?: string) {
  const event = { id: id ?? `evt_b_${Date.now()}_${seq++}`, object: 'event', created: now,
    type, livemode: false, data: { object } }
  const payload = JSON.stringify(event)
  const header = await signer.webhooks.generateTestHeaderStringAsync({ payload, secret: SECRET })
  const r = await fetch(`${BASE}/api/stripe/webhook`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'stripe-signature': header }, body: payload })
  return { status: r.status, eventId: event.id }
}

const users: string[] = []
const password = crypto.randomUUID() + 'Aa1!'
const anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
async function mk(tag: string) {
  const email = `bundle-${tag}-${Date.now()}@example.com`
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error || !data) throw new Error(error?.message)
  users.push(data.user.id)
  const { data: s } = await anon.auth.signInWithPassword({ email, password })
  return { id: data.user.id,
    cookie: `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(s!.session)).toString('base64')}` }
}
const J = (c: string) => ({ 'Content-Type': 'application/json', cookie: c })

const madeItems: string[] = []
try {
  // Three studies. Study A is a PDF+MP3 PAIR sharing one pair_key.
  const mkItem = async (slug: string, kind: 'pdf'|'audio', pair: string|null, tier='subscriber') => {
    const [r] = await sql`insert into public.content_items
      (slug, kind, title, storage_path, pair_key, access_tier, status, published_at, page_count, duration_seconds)
      values (${slug}, ${kind}, ${'T '+slug}, ${kind==='pdf'?'pdf/demo-reader.pdf':'audio/demo-listen.mp3'}, ${pair}, ${tier}, 'published', now(),
              ${kind==='pdf'?3:null}, ${kind==='audio'?60:null}) returning id`
    madeItems.push(r.id as string); return r.id as string
  }
  const t = Date.now()
  const aPdf   = await mkItem(`b-a-pdf-${t}`,   'pdf',   `pair-a-${t}`)
  const aAudio = await mkItem(`b-a-audio-${t}`, 'audio', `pair-a-${t}`)
  const bPdf   = await mkItem(`b-b-pdf-${t}`,   'pdf',   null)
  const freePdf= await mkItem(`b-free-${t}`,    'pdf',   null, 'free')

  const buyer = await mk('buyer')

  console.log('\nBEFORE PURCHASE')
  let r = await fetch(`${BASE}/api/content/${aPdf}/url`, { headers: { cookie: buyer.cookie } })
  pass('subscriber-tier item locked -> 402', r.status === 402, `got ${r.status}`)
  r = await fetch(`${BASE}/api/content/${freePdf}/url`, { headers: { cookie: buyer.cookie } })
  pass('free item still open -> 200', r.status === 200, `got ${r.status}`)
  r = await fetch(`${BASE}/api/entitlements/claim`, { method: 'POST', headers: J(buyer.cookie),
    body: JSON.stringify({ itemId: aPdf }) })
  pass('claiming with no slots -> 402', r.status === 402, `got ${r.status}`)

  console.log('\nONE-TIME PURCHASE GRANTS SLOTS (mode: payment)')
  const sessionId = `cs_bundle_${t}`
  let res = await send('checkout.session.completed', {
    id: sessionId, object: 'checkout.session', mode: 'payment', payment_status: 'paid',
    client_reference_id: buyer.id, payment_intent: `pi_${t}`, metadata: { userId: buyer.id, plan: 'starter' } })
  pass('webhook accepted -> 200', res.status === 200)
  const [pur] = await sql`select slots from public.purchases where user_id=${buyer.id}::uuid`
  pass('10 slots granted', pur?.slots === 10, `slots=${pur?.slots}`)
  const subs = (await sql`select count(*)::int n from public.subscriptions where user_id=${buyer.id}::uuid`)[0].n
  pass('no subscription row created', subs === 0)

  res = await send('checkout.session.completed', {
    id: sessionId, object: 'checkout.session', mode: 'payment', payment_status: 'paid',
    client_reference_id: buyer.id, payment_intent: `pi_${t}` }, `evt_replay_${t}`)
  const purCount = (await sql`select count(*)::int n from public.purchases where user_id=${buyer.id}::uuid`)[0].n
  pass('replayed session does not double-grant', purCount === 1, `${purCount} purchases`)

  console.log('\nSTILL LOCKED UNTIL A SLOT IS SPENT')
  r = await fetch(`${BASE}/api/content/${aPdf}/url`, { headers: { cookie: buyer.cookie } })
  pass('owning slots is not owning items -> 402', r.status === 402, `got ${r.status}`)

  console.log('\nA PDF AND ITS MP3 COST ONE SLOT (the pairing rule)')
  r = await fetch(`${BASE}/api/entitlements/claim`, { method: 'POST', headers: J(buyer.cookie),
    body: JSON.stringify({ itemId: aPdf }) })
  const claim = await r.json()
  pass('claim succeeds', r.status === 200, `got ${r.status}`)
  pass('9 slots remain', claim.remaining === 9, `remaining=${claim.remaining}`)

  r = await fetch(`${BASE}/api/content/${aPdf}/url`, { headers: { cookie: buyer.cookie } })
  pass('the PDF is now open -> 200', r.status === 200, `got ${r.status}`)
  r = await fetch(`${BASE}/api/content/${aAudio}/url`, { headers: { cookie: buyer.cookie } })
  pass('its MP3 is open too, no extra slot -> 200', r.status === 200, `got ${r.status}`)
  const claimed = (await sql`select count(*)::int n from public.item_entitlements where user_id=${buyer.id}::uuid`)[0].n
  pass('exactly one entitlement row for the pair', claimed === 1, `${claimed} rows`)

  console.log('\nAN UNPAIRED ITEM IS ITS OWN UNIT')
  r = await fetch(`${BASE}/api/content/${bPdf}/url`, { headers: { cookie: buyer.cookie } })
  pass('a different study stays locked -> 402', r.status === 402, `got ${r.status}`)

  console.log('\nCLAIM GUARDS')
  r = await fetch(`${BASE}/api/entitlements/claim`, { method: 'POST', headers: J(buyer.cookie),
    body: JSON.stringify({ itemId: aAudio }) })
  pass('re-claiming the same pair -> 409', r.status === 409, `got ${r.status}`)
  r = await fetch(`${BASE}/api/entitlements/claim`, { method: 'POST', headers: J(buyer.cookie),
    body: JSON.stringify({ itemId: freePdf }) })
  pass('claiming a free item -> 400', r.status === 400, `got ${r.status}`)
  r = await fetch(`${BASE}/api/entitlements/claim`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId: bPdf }) })
  pass('no session -> 401', r.status === 401, `got ${r.status}`)

  console.log('\nSLOT EXHAUSTION')
  await sql`update public.purchases set slots = 2 where user_id=${buyer.id}::uuid`
  r = await fetch(`${BASE}/api/entitlements/claim`, { method: 'POST', headers: J(buyer.cookie),
    body: JSON.stringify({ itemId: bPdf }) })
  pass('second slot spends fine', r.status === 200, `got ${r.status}`)
  const cPdf = await mkItem(`b-c-pdf-${t}`, 'pdf', null)
  r = await fetch(`${BASE}/api/entitlements/claim`, { method: 'POST', headers: J(buyer.cookie),
    body: JSON.stringify({ itemId: cPdf }) })
  pass('third claim refused when slots run out -> 402', r.status === 402, `got ${r.status}`)

  console.log('\nUNLIMITED BEATS EVERYTHING')
  const sub = await mk('sub')
  await sql`insert into public.subscriptions (user_id, stripe_customer_id, status, current_period_end)
            values (${sub.id}::uuid, ${'cus_unl_'+t}, 'active', ${new Date(Date.now()+30*864e5)})`
  r = await fetch(`${BASE}/api/content/${cPdf}/url`, { headers: { cookie: sub.cookie } })
  pass('subscriber opens anything without claiming -> 200', r.status === 200, `got ${r.status}`)
  r = await fetch(`${BASE}/api/entitlements/claim`, { method: 'POST', headers: J(sub.cookie),
    body: JSON.stringify({ itemId: cPdf }) })
  pass('subscriber told claiming is unnecessary -> 400', r.status === 400, `got ${r.status}`)

  console.log('\nOWNERSHIP IS PERMANENT')
  await sql`update public.purchases set created_at = now() - interval '3 years' where user_id=${buyer.id}::uuid`
  r = await fetch(`${BASE}/api/content/${aPdf}/url`, { headers: { cookie: buyer.cookie } })
  pass('a 3-year-old purchase still opens its study -> 200', r.status === 200, `got ${r.status}`)
} catch (e) {
  console.error('\nERROR:', (e as Error).message); process.exitCode = 1
} finally {
  for (const id of users) {
    await sql`delete from public.item_entitlements where user_id=${id}::uuid`
    await sql`delete from public.purchases where user_id=${id}::uuid`
    await sql`delete from public.subscriptions where user_id=${id}::uuid`
    await admin.auth.admin.deleteUser(id)
  }
  for (const i of madeItems) await sql`delete from public.content_items where id=${i}::uuid`
  await sql`delete from public.processed_events where id like 'evt_b_%' or id like 'evt_replay_%'`
  console.log(`\n  cleaned up ${users.length} users, ${madeItems.length} items`)
  await sql.end()
}
