/**
 * Fence two — SPEC.3.md §5.2, §13.
 *
 * Every query here goes through the ANON key as user A, which is the only path
 * RLS governs. The server-side db client uses DATABASE_URL and bypasses RLS by
 * design, so this suite is the ONLY thing that proves a leaked anon key cannot
 * read someone else's journals.
 */
import { createClient } from '@supabase/supabase-js'
import postgres from 'postgres'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const sql = postgres(process.env.DIRECT_URL!, { prepare: false, max: 1, idle_timeout: 10 })
const pass = (n: string, ok: boolean, x = '') => console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '  ' + x : ''}`)

const users: string[] = []
const password = crypto.randomUUID() + 'Aa1!'

async function mk(tag: string) {
  const email = `rls-${tag}-${Date.now()}@example.com`
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error || !data) throw new Error(error?.message)
  users.push(data.user.id)
  const c = createClient(url, ANON)
  const { error: e2 } = await c.auth.signInWithPassword({ email, password })
  if (e2) throw new Error(e2.message)
  return { id: data.user.id, client: c }
}

let itemId = ''
try {
  const [item] = await sql`select id from public.content_items where slug='demo-listen'`
  itemId = item.id as string

  const A = await mk('a')
  const B = await mk('b')

  // Seed B's private data with the service role, bypassing RLS deliberately.
  await sql`insert into public.progress (user_id, item_id, kind, position_seconds, percent)
            values (${B.id}::uuid, ${itemId}::uuid, 'listening', 42, 20)`
  const [bMark] = await sql`insert into public.bookmarks (user_id, item_id, kind, position_seconds, label)
            values (${B.id}::uuid, ${itemId}::uuid, 'listening', 42, ${'B private label'}) returning id`
  await sql`insert into public.journals (user_id, item_id, kind, body_md)
            values (${B.id}::uuid, ${itemId}::uuid, 'listening', ${'B private journal text'})`
  const [bPending] = await sql`insert into public.reviews (user_id, item_id, rating, body, status)
            values (${B.id}::uuid, ${itemId}::uuid, 3, ${'B pending review'}, 'pending') returning id`

  console.log("\nUSER A CANNOT READ USER B'S DATA")
  let { data } = await A.client.from('progress').select('*')
  pass('progress: sees none of B', !(data ?? []).some(r => r.user_id === B.id), `${data?.length ?? 0} rows`)

  ;({ data } = await A.client.from('bookmarks').select('*'))
  pass('bookmarks: sees none of B', !(data ?? []).some(r => r.user_id === B.id), `${data?.length ?? 0} rows`)

  ;({ data } = await A.client.from('journals').select('*'))
  pass('journals: sees none of B', !(data ?? []).some(r => r.user_id === B.id), `${data?.length ?? 0} rows`)

  ;({ data } = await A.client.from('reviews').select('*').eq('id', bPending.id))
  pass("reviews: B's PENDING review is invisible", (data ?? []).length === 0, `${data?.length ?? 0} rows`)

  ;({ data } = await A.client.from('profiles').select('*'))
  pass('profiles: sees only itself', (data ?? []).every(r => r.id === A.id), `${data?.length ?? 0} rows`)

  console.log('\nUSER A CANNOT WRITE AS USER B')
  let res = await A.client.from('bookmarks').insert({
    user_id: B.id, item_id: itemId, kind: 'listening', position_seconds: 9 })
  pass('cannot insert a bookmark owned by B', !!res.error, res.error?.code ?? 'NO ERROR')

  res = await A.client.from('journals').insert({
    user_id: B.id, item_id: itemId, kind: 'listening', body_md: 'injected' })
  pass('cannot insert a journal owned by B', !!res.error, res.error?.code ?? 'NO ERROR')

  res = await A.client.from('bookmarks').update({ label: 'hijacked' }).eq('id', bMark.id)
  const [after] = await sql`select label from public.bookmarks where id=${bMark.id}::uuid`
  pass("cannot update B's bookmark", after.label === 'B private label', after.label)

  res = await A.client.from('bookmarks').delete().eq('id', bMark.id)
  const stillThere = (await sql`select count(*)::int n from public.bookmarks where id=${bMark.id}::uuid`)[0].n
  pass("cannot delete B's bookmark", stillThere === 1)

  res = await A.client.from('profiles').update({ role: 'admin' }).eq('id', A.id)
  const [role] = await sql`select role from public.profiles where id=${A.id}::uuid`
  pass('cannot self-promote to admin', role.role === 'member', role.role)

  console.log('\nBILLING TABLES ARE SERVICE-ROLE ONLY')
  await sql`insert into public.subscriptions (user_id, stripe_customer_id, status)
            values (${B.id}::uuid, ${'cus_rls_' + Date.now()}, 'active')`
  ;({ data } = await A.client.from('subscriptions').select('*'))
  pass('subscriptions unreadable via anon key', (data ?? []).length === 0, `${data?.length ?? 0} rows`)

  res = await A.client.from('subscriptions').insert({
    user_id: A.id, stripe_customer_id: 'cus_forged', status: 'active' })
  pass('cannot forge a subscription', !!res.error, res.error?.code ?? 'NO ERROR')

  ;({ data } = await A.client.from('processed_events').select('*'))
  pass('stripe event log unreadable', (data ?? []).length === 0)

  console.log('\nANONYMOUS (NO SESSION) SEES NOTHING PRIVATE')
  const anonOnly = createClient(url, ANON)
  ;({ data } = await anonOnly.from('journals').select('*'))
  pass('journals unreadable without a session', (data ?? []).length === 0)
  ;({ data } = await anonOnly.from('content_items').select('*'))
  pass('content metadata also requires a session', (data ?? []).length === 0, `${data?.length ?? 0} rows`)

  console.log('\nSTORAGE IS NOT READABLE VIA THE ANON KEY')
  const dl = await A.client.storage.from('content').download('audio/demo-listen.mp3')
  pass('private bucket refuses an anon-key download', !!dl.error, dl.error?.message?.slice(0, 40) ?? 'NO ERROR')
} catch (e) {
  console.error('\nERROR:', (e as Error).message); process.exitCode = 1
} finally {
  for (const id of users) {
    await sql`delete from public.subscriptions where user_id=${id}::uuid`
    await sql`delete from public.reviews where user_id=${id}::uuid`
    await sql`delete from public.journals where user_id=${id}::uuid`
    await sql`delete from public.bookmarks where user_id=${id}::uuid`
    await sql`delete from public.progress where user_id=${id}::uuid`
    await admin.auth.admin.deleteUser(id)
  }
  console.log(`\n  cleaned up ${users.length} users`)
  await sql.end()
}
