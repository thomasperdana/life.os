import { createClient } from '@supabase/supabase-js'
import postgres from 'postgres'

const BASE = 'http://localhost:3000'
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ref = new URL(url).hostname.split('.')[0]
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const sql = postgres(process.env.DIRECT_URL!, { prepare: false, max: 1, idle_timeout: 10 })
const pass = (n: string, ok: boolean, x = '') => console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '  ' + x : ''}`)
const strip = (h: string) => h.replaceAll('<!-- -->', '')

let userId = ''
const password = crypto.randomUUID() + 'Aa1!'
try {
  const email = `p4ui-${Date.now()}@example.com`
  const { data: u, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw new Error(error.message)
  userId = u.user.id
  const anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
  const { data: s } = await anon.auth.signInWithPassword({ email, password })
  const cookie = `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(s!.session)).toString('base64')}`

  let r = await fetch(`${BASE}/account`)
  pass('unauthenticated redirects to signin', r.redirected && r.url.includes('/signin'))

  let html = strip(await (await fetch(`${BASE}/account`, { headers: { cookie } })).text())
  pass('free account shown', html.includes('Free account'))
  pass('subscribe buttons offered', html.includes('Subscribe monthly'))
  pass('no manage button without a customer', !html.includes('Manage subscription'))

  const future = new Date(Date.now() + 30 * 864e5)
  await sql`insert into public.subscriptions
    (user_id, stripe_customer_id, stripe_subscription_id, status, price_id, current_period_end, cancel_at_period_end)
    values (${userId}::uuid, ${'cus_ui_' + Date.now()}, 'sub_ui', 'active', 'price_x', ${future}, false)`
  html = strip(await (await fetch(`${BASE}/account`, { headers: { cookie } })).text())
  pass('active subscriber shown', html.includes('Subscriber') && !html.includes('Free account'))
  pass('renewal date shown', html.includes(future.toISOString().slice(0, 10)))
  pass('manage button appears', html.includes('Manage subscription'))
  pass('subscribe buttons hidden', !html.includes('Subscribe monthly'))

  await sql`update public.subscriptions set cancel_at_period_end=true where user_id=${userId}::uuid`
  html = strip(await (await fetch(`${BASE}/account`, { headers: { cookie } })).text())
  pass('cancellation notice shown', html.includes('You keep access until the end'))
  pass('label switches to "Access until"', html.includes('Access until'))

  const pastDate = new Date(Date.now() - 864e5)
  await sql`update public.subscriptions set status='canceled', current_period_end=${pastDate} where user_id=${userId}::uuid`
  html = strip(await (await fetch(`${BASE}/account`, { headers: { cookie } })).text())
  pass('lapsed subscriber shown as free', html.includes('Free account'))

  console.log('\nGATED CONTENT FOLLOWS ENTITLEMENT')
  const [item] = await sql`select id from public.content_items where slug='demo-reader'`
  if (item) {
    await sql`update public.content_items set access_tier='subscriber' where id=${item.id}::uuid`
    r = await fetch(`${BASE}/api/content/${item.id}/url`, { headers: { cookie } })
    pass('lapsed user gets 402 on subscriber content', r.status === 402, `got ${r.status}`)
    await sql`update public.subscriptions set status='active', current_period_end=${future} where user_id=${userId}::uuid`
    r = await fetch(`${BASE}/api/content/${item.id}/url`, { headers: { cookie } })
    pass('reinstated user gets 200', r.status === 200, `got ${r.status}`)
    await sql`update public.content_items set access_tier='free' where id=${item.id}::uuid`
  }
} catch (e) {
  console.error('\nERROR:', (e as Error).message); process.exitCode = 1
} finally {
  if (userId) {
    await sql`delete from public.subscriptions where user_id=${userId}::uuid`
    await admin.auth.admin.deleteUser(userId)
  }
  console.log('\n  cleaned up')
  await sql.end()
}
