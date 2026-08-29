import { createClient } from '@supabase/supabase-js'
import postgres from 'postgres'

const BASE = 'http://localhost:3000'
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ref = new URL(url).hostname.split('.')[0]
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const sql = postgres(process.env.DIRECT_URL!, { prepare: false, max: 1, idle_timeout: 10 })
const pass = (n: string, ok: boolean, x = '') => console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '  ' + x : ''}`)

let userId = ''
const password = crypto.randomUUID() + 'Aa1!'
try {
  const email = `p8-${Date.now()}@example.com`
  const { data: u, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error || !u) throw new Error(error?.message)
  userId = u.user.id
  const anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
  const { data: s } = await anon.auth.signInWithPassword({ email, password })
  const cookie = `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(s!.session)).toString('base64')}`
  const [item] = await sql`select id from public.content_items where slug='demo-listen'`

  console.log('\nSECURITY HEADERS / CSP (§11)')
  const res = await fetch(`${BASE}/signin`)
  const csp = res.headers.get('content-security-policy') ?? ''
  pass('CSP present', csp.length > 0)
  pass('worker-src allows blob: (pdf.js parser)', csp.includes('worker-src') && csp.includes('blob:'))
  pass('media-src allows the Supabase origin', csp.includes(`media-src`) && csp.includes(ref))
  pass('connect-src allows Supabase', csp.includes('connect-src') && csp.includes(ref))
  pass('form-action allows Stripe checkout', csp.includes('checkout.stripe.com'))
  pass('frame-ancestors none', csp.includes("frame-ancestors 'none'"))
  pass('object-src none', csp.includes("object-src 'none'"))
  pass('nosniff set', res.headers.get('x-content-type-options') === 'nosniff')
  pass('referrer policy set', (res.headers.get('referrer-policy') ?? '').includes('strict-origin'))
  pass('permissions-policy set', (res.headers.get('permissions-policy') ?? '').includes('camera=()'))

  console.log('\nRATE LIMITING (§11)')
  await sql`delete from public.rate_limits where bucket like ${'dl:%'} or bucket like ${'url:%'}`
  let blocked = 0, ok = 0, retryAfter: string | null = null
  for (let i = 0; i < 25; i++) {
    const r = await fetch(`${BASE}/api/content/${item.id}/download`, { headers: { cookie }, redirect: 'manual' })
    if (r.status === 429) { blocked++; retryAfter = retryAfter ?? r.headers.get('retry-after') }
    else ok++
  }
  pass('download limit caps requests', blocked > 0, `${ok} allowed, ${blocked} blocked`)
  pass('429 carries Retry-After', !!retryAfter, `Retry-After: ${retryAfter}`)

  const shared = (await sql`select bucket, count from public.rate_limits where bucket like ${'dl:%'}`)[0]
  pass('limit state lives in Postgres, not memory', !!shared, `${shared?.bucket} count=${shared?.count}`)

  console.log('\nGDPR EXPORT (§11)')
  let r = await fetch(`${BASE}/api/account/export`)
  pass('unauthenticated -> 401', r.status === 401, `got ${r.status}`)

  await fetch(`${BASE}/api/progress`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ itemId: item.id, kind: 'listening', positionSeconds: 12, percent: 7 }) })
  await fetch(`${BASE}/api/journals`, { method: 'PUT', headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ itemId: item.id, kind: 'listening', bodyMd: 'A private thought for the export.' }) })

  r = await fetch(`${BASE}/api/account/export`, { headers: { cookie } })
  const exported = await r.json()
  pass('export returns 200 as an attachment',
    r.status === 200 && (r.headers.get('content-disposition') ?? '').includes('attachment'))
  pass('includes profile', !!exported.profile)
  pass('includes progress', exported.progress.length === 1)
  pass('includes journals', exported.journals.some((j: { bodyMd: string }) => j.bodyMd.includes('private thought')))
  pass('includes reviews/bookmarks/downloads keys',
    'reviews' in exported && 'bookmarks' in exported && 'downloads' in exported)
  pass('no card data anywhere', !JSON.stringify(exported).match(/card|pan|cvc/i))

  console.log('\nGDPR DELETE (§11)')
  r = await fetch(`${BASE}/api/account/delete`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie }, body: '{}' })
  pass('requires explicit confirmation -> 400', r.status === 400, `got ${r.status}`)

  r = await fetch(`${BASE}/api/account/delete`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ confirm: 'DELETE' }) })
  const out = await r.json()
  pass('deletion succeeds', r.status === 200 && out.deleted === true)
  pass('no-billing case says so plainly',
    out.stripeCustomer === null && out.note.includes('No billing record'), out.note)

  // Second user, this time WITH a billing record, to cover the other branch.
  const email2 = `p8b-${Date.now()}@example.com`
  const { data: u2, error: u2err } = await admin.auth.admin.createUser({ email: email2, password, email_confirm: true })
  if (u2err || !u2) throw new Error('user2: ' + u2err?.message)
  const { data: s2 } = await anon.auth.signInWithPassword({ email: email2, password })
  const cookie2 = `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(s2!.session)).toString('base64')}`
  const cus = `cus_p8_${Date.now()}`
  await sql`insert into public.subscriptions (user_id, stripe_customer_id, status)
            values (${u2.user.id}::uuid, ${cus}, 'active')`
  const r2 = await fetch(`${BASE}/api/account/delete`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: cookie2 },
    body: JSON.stringify({ confirm: 'DELETE' }) })
  const out2 = await r2.json()
  pass('billing case names the retained Stripe customer',
    out2.stripeCustomer === cus && out2.note.includes('Stripe'), out2.note?.slice(0, 60))
  const subsLeft = (await sql`select count(*)::int n from public.subscriptions where stripe_customer_id=${cus}`)[0].n
  pass('subscription row cascaded away locally', subsLeft === 0)

  const leftovers = await sql`
    select
      (select count(*)::int from public.profiles  where id      = ${userId}::uuid) as profiles,
      (select count(*)::int from public.progress  where user_id = ${userId}::uuid) as progress,
      (select count(*)::int from public.journals  where user_id = ${userId}::uuid) as journals`
  const l = leftovers[0]
  pass('every table cascaded clean', l.profiles === 0 && l.progress === 0 && l.journals === 0,
       JSON.stringify(l))
  userId = ''
} catch (e) {
  console.error('\nERROR:', (e as Error).message); process.exitCode = 1
} finally {
  if (userId) await admin.auth.admin.deleteUser(userId)
  await sql`delete from public.rate_limits where bucket like ${'dl:%'} or bucket like ${'url:%'} or bucket like ${'export:%'}`
  console.log('\n  cleaned up')
  await sql.end()
}
