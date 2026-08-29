/**
 * Checkout/Portal guard paths ONLY.
 *
 * Every assertion here returns before any Stripe API call is made, so this is
 * safe to run even with a live key present. It does NOT close the Checkout or
 * Portal criteria — that needs sk_test_ keys and price ids.
 */
import { createClient } from '@supabase/supabase-js'
import postgres from 'postgres'

const BASE = 'http://localhost:3000'
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ref = new URL(url).hostname.split('.')[0]
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const sql = postgres(process.env.DIRECT_URL!, { prepare: false, max: 1, idle_timeout: 10 })
const pass = (n: string, ok: boolean, x = '') => console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '  ' + x : ''}`)

let userId = ''
try {
  const email = `p4g-${Date.now()}@example.com`
  const password = crypto.randomUUID() + 'Aa1!'
  const { data: u, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw new Error(error.message)
  userId = u.user.id
  const anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
  const { data: s } = await anon.auth.signInWithPassword({ email, password })
  const cookie = `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(s!.session)).toString('base64')}`
  const J = { 'Content-Type': 'application/json', cookie }

  console.log('\nCHECKOUT GUARDS (no Stripe call reached)')
  let r = await fetch(`${BASE}/api/stripe/checkout`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: '{}' })
  pass('no session -> 401', r.status === 401, `got ${r.status}`)

  r = await fetch(`${BASE}/api/stripe/checkout`, { method: 'POST', headers: J,
    body: JSON.stringify({ plan: 'weekly' }) })
  pass('invalid plan -> 400', r.status === 400, `got ${r.status}`)

  r = await fetch(`${BASE}/api/stripe/checkout`, { method: 'POST', headers: J,
    body: JSON.stringify({ plan: 'monthly' }) })
  const body = await r.json()
  pass('price ids unset -> 503, before any Stripe call',
    r.status === 503 && body.error === 'price not configured', `got ${r.status} ${body.error ?? ''}`)

  console.log('\nPORTAL GUARDS (no Stripe call reached)')
  r = await fetch(`${BASE}/api/stripe/portal`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: '{}' })
  pass('no session -> 401', r.status === 401, `got ${r.status}`)

  r = await fetch(`${BASE}/api/stripe/portal`, { method: 'POST', headers: J, body: '{}' })
  const pb = await r.json()
  pass('no customer -> 404, before any Stripe call',
    r.status === 404 && pb.error === 'no customer', `got ${r.status} ${pb.error ?? ''}`)

  console.log('\nACCOUNT PAGE REFLECTS UNCONFIGURED BILLING')
  const html = (await (await fetch(`${BASE}/account`, { headers: { cookie } })).text()).replaceAll('<!-- -->', '')
  pass('subscribe buttons still shown (secret+webhook set)', html.includes('Subscribe monthly'))
} catch (e) {
  console.error('\nERROR:', (e as Error).message); process.exitCode = 1
} finally {
  if (userId) await admin.auth.admin.deleteUser(userId)
  console.log('\n  cleaned up. No Stripe API call was made.')
  await sql.end()
}
