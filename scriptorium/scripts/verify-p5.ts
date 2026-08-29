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
try {
  const email = `p5-${Date.now()}@example.com`
  const password = crypto.randomUUID() + 'Aa1!'
  const { data: u, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw new Error(error.message)
  userId = u.user.id
  const anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
  const { data: s } = await anon.auth.signInWithPassword({ email, password })
  const cookie = `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(s!.session)).toString('base64')}`

  const [item] = await sql`select id, duration_seconds, storage_path from public.content_items where slug='demo-listen'`
  const id = item.id as string

  console.log('\nLISTEN ROUTE')
  let r = await fetch(`${BASE}/listen/demo-listen`)
  pass('unauthenticated redirects to signin', r.redirected && r.url.includes('/signin'))

  let html = strip(await (await fetch(`${BASE}/listen/demo-listen`, { headers: { cookie } })).text())
  pass('authenticated renders', html.includes('Demo: Three Minutes of Silence'))
  pass('duration shown', html.includes('3 min'), `duration_seconds=${item.duration_seconds}`)
  pass('no resume prompt on first listen', !html.includes('Continue from'))

  r = await fetch(`${BASE}/listen/demo-reader`, { headers: { cookie } })
  pass('a PDF slug 404s on /listen', r.status === 404, `got ${r.status}`)

  console.log('\nMEDIA URL + RANGE (§4.4, §8.6)')
  const media = await (await fetch(`${BASE}/api/content/${id}/url?purpose=read`, { headers: { cookie } })).json()
  pass('audio read TTL = 4h', media.ttl === 14400, `${media.ttl}s`)

  const head = await fetch(media.url, { headers: { Range: 'bytes=0-1023' } })
  pass('range request -> 206', head.status === 206, `HTTP ${head.status}`)
  pass('content-range reports full size', (head.headers.get('content-range') ?? '').endsWith(`/${2873557}`),
       head.headers.get('content-range') ?? 'none')
  pass('content-type is audio/mpeg', head.headers.get('content-type') === 'audio/mpeg',
       head.headers.get('content-type') ?? 'none')

  // Seeking to the middle is the operation that actually needs range support.
  const mid = await fetch(media.url, { headers: { Range: 'bytes=1400000-1400511' } })
  const midBytes = new Uint8Array(await mid.arrayBuffer())
  pass('mid-file seek returns 206 with 512 bytes',
    mid.status === 206 && midBytes.byteLength === 512, `${mid.status}, ${midBytes.byteLength}b`)

  console.log('\nLISTENING PROGRESS (§8.6)')
  r = await fetch(`${BASE}/api/progress`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ itemId: id, kind: 'listening', positionSeconds: 95.5, percent: 53 }) })
  pass('position saved -> 204', r.status === 204, `got ${r.status}`)

  const [row] = await sql`select kind, position_seconds, page, percent from public.progress where item_id=${id}::uuid`
  pass('stored as listening with seconds', row?.kind === 'listening' && Math.round(row.position_seconds) === 96,
       `kind=${row?.kind} pos=${row?.position_seconds}`)
  pass('page column left null', row?.page === null)

  r = await fetch(`${BASE}/api/progress`, { method: 'POST', headers: { 'Content-Type': 'text/plain', cookie },
    body: JSON.stringify({ itemId: id, kind: 'listening', positionSeconds: 120, percent: 66 }) })
  pass('sendBeacon text/plain accepted', r.status === 204, `got ${r.status}`)

  console.log('\nRESUME')
  html = strip(await (await fetch(`${BASE}/listen/demo-listen`, { headers: { cookie } })).text())
  pass('resume prompt appears', html.includes('Continue from 2:00'), html.includes('Continue from') ? 'found' : 'missing')
  pass('resume links to ?t=120', html.includes('/listen/demo-listen?t=120'))
  const explicit = strip(await (await fetch(`${BASE}/listen/demo-listen?t=30`, { headers: { cookie } })).text())
  pass('explicit ?t= suppresses the prompt', !explicit.includes('Continue from'))

  console.log('\nREADING AND LISTENING SHARE ONE ROW SHAPE (§2.1)')
  const [pdf] = await sql`select id from public.content_items where slug='demo-reader'`
  if (pdf) {
    await fetch(`${BASE}/api/progress`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ itemId: pdf.id, kind: 'reading', page: 4, percent: 40 }) })
    const rows = await sql`select kind, page, position_seconds from public.progress where user_id=${userId}::uuid order by kind`
    pass('both kinds coexist in one table', rows.length === 2, rows.map(r => r.kind).join(', '))
    pass('reading row carries page, not seconds',
      rows.find(r => r.kind === 'reading')?.page === 4 && rows.find(r => r.kind === 'reading')?.position_seconds === null)
    pass('listening row carries seconds, not page',
      rows.find(r => r.kind === 'listening')?.page === null && rows.find(r => r.kind === 'listening')?.position_seconds !== null)
  }

  console.log('\nENTITLEMENT STILL GOVERNS AUDIO')
  await sql`update public.content_items set access_tier='subscriber' where id=${id}::uuid`
  r = await fetch(`${BASE}/api/content/${id}/url?purpose=read`, { headers: { cookie } })
  pass('free user blocked from subscriber audio -> 402', r.status === 402, `got ${r.status}`)
  html = await (await fetch(`${BASE}/listen/demo-listen`, { headers: { cookie } })).text()
  pass('listen page shows the paywall', html.includes('Subscribers only'))
  await sql`update public.content_items set access_tier='free' where id=${id}::uuid`
} catch (e) {
  console.error('\nERROR:', (e as Error).message); process.exitCode = 1
} finally {
  if (userId) {
    await sql`delete from public.progress where user_id=${userId}::uuid`
    await admin.auth.admin.deleteUser(userId)
  }
  console.log('\n  cleaned up')
  await sql.end()
}
