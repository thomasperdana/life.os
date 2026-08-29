import { createClient } from '@supabase/supabase-js'
import postgres from 'postgres'
import { PDFDocument, StandardFonts } from 'pdf-lib'

const BASE = 'http://localhost:3000'
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ref = new URL(url).hostname.split('.')[0]
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const sql = postgres(process.env.DIRECT_URL!, { prepare: false, max: 1, idle_timeout: 10 })
const pass = (n: string, ok: boolean, x = '') => console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '  ' + x : ''}`)

async function cookieFor(email: string, password: string) {
  const anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
  const { data, error } = await anon.auth.signInWithPassword({ email, password })
  if (error || !data.session) throw new Error('signIn: ' + error?.message)
  return `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(data.session)).toString('base64')}`
}

const users: string[] = []
let itemId: string | undefined, path: string | undefined
const password = crypto.randomUUID() + 'Aa1!'
const slug = `p2-reader-${Date.now()}`

try {
  const email = `p2-${Date.now()}@example.com`
  const { data: u, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw new Error(error.message)
  users.push(u.user.id)
  const cookie = await cookieFor(email, password)

  // A real 12-page PDF, published free-tier.
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let i = 1; i <= 12; i++) {
    doc.addPage([420, 560]).drawText(`Chapter page ${i}`, { x: 40, y: 500, size: 18, font })
  }
  path = `pdf/${slug}.pdf`
  await admin.storage.from('content').upload(path, (await doc.save()) as unknown as ArrayBuffer,
    { contentType: 'application/pdf', upsert: true })

  const [row] = await sql`
    insert into public.content_items
      (slug, kind, title, storage_path, page_count, access_tier, status, published_at)
    values (${slug},'pdf','P2 Reader Fixture',${path},12,'free','published',now())
    returning id`
  itemId = row.id as string
  const id = itemId

  console.log('\nREADER ROUTE')
  let r = await fetch(`${BASE}/read/${slug}`)
  pass('unauthenticated redirects to signin', r.redirected && r.url.includes('/signin'), r.status.toString())

  r = await fetch(`${BASE}/read/${slug}`, { headers: { cookie } })
  const html = await r.text()
  pass('authenticated renders 200', r.status === 200)
  pass('page title present', html.includes('P2 Reader Fixture'))
  pass('no resume prompt on first open', !html.includes('Continue from page'))

  console.log('\nSIGNED URL TTL BY PURPOSE (§7.3)')
  const rd = await (await fetch(`${BASE}/api/content/${id}/url?purpose=read`, { headers: { cookie } })).json()
  const dl = await (await fetch(`${BASE}/api/content/${id}/url?purpose=download`, { headers: { cookie } })).json()
  pass('read TTL = 2h',      rd.ttl === 7200, `${rd.ttl}s`)
  pass('download TTL = 5min', dl.ttl === 300,  `${dl.ttl}s`)
  pass('read URL is range-capable',
    (await fetch(rd.url, { headers: { Range: 'bytes=0-31' } })).status === 206)

  console.log('\nPROGRESS PERSISTENCE (§8.2)')
  r = await fetch(`${BASE}/api/progress`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemId: id, kind: 'reading', page: 7, percent: 58.3 }) })
  pass('POST without session -> 401', r.status === 401, `got ${r.status}`)

  r = await fetch(`${BASE}/api/progress`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ itemId: id, kind: 'reading', page: 7, percent: 58.3 }) })
  pass('POST with session -> 204', r.status === 204, `got ${r.status}`)

  const [saved] = await sql`select page, percent, kind from public.progress where item_id=${id}::uuid`
  pass('row written to progress', saved?.page === 7, `page=${saved?.page} pct=${saved?.percent}`)

  // Upsert, not duplicate insert
  await fetch(`${BASE}/api/progress`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ itemId: id, kind: 'reading', page: 9, percent: 75 }) })
  const rows = await sql`select page from public.progress where item_id=${id}::uuid`
  pass('upsert keeps one row', rows.length === 1 && rows[0].page === 9, `${rows.length} row(s), page=${rows[0]?.page}`)

  // sendBeacon posts text/plain — must still parse
  r = await fetch(`${BASE}/api/progress`, { method: 'POST', headers: { 'Content-Type': 'text/plain', cookie },
    body: JSON.stringify({ itemId: id, kind: 'reading', page: 11, percent: 91 }) })
  pass('sendBeacon text/plain accepted', r.status === 204, `got ${r.status}`)

  console.log('\nRESUME ACROSS SESSIONS')
  r = await fetch(`${BASE}/read/${slug}`, { headers: { cookie } })
  const html2 = (await r.text()).replaceAll('<!-- -->', '')
  pass('resume prompt now rendered', html2.includes('Continue from page 11'),
       html2.includes('Continue from page') ? 'found' : 'missing')
  pass('resume links to ?page=11', html2.includes(`/read/${slug}?page=11`))

  console.log('\nEXPLICIT ?page= SUPPRESSES THE PROMPT')
  const htmlP = (await (await fetch(`${BASE}/read/${slug}?page=4`, { headers: { cookie } })).text())
    .replaceAll('<!-- -->', '')
  pass('no prompt when page is explicit', !htmlP.includes('Continue from page'))

  const got = await (await fetch(`${BASE}/api/progress?itemId=${id}`, { headers: { cookie } })).json()
  pass('GET returns saved position', got.progress?.page === 11, `page=${got.progress?.page}`)

  console.log('\nCROSS-USER ISOLATION')
  const e2 = `p2b-${Date.now()}@example.com`
  const { data: u2, error: e2err } = await admin.auth.admin.createUser({ email: e2, password, email_confirm: true })
  if (e2err || !u2) throw new Error('createUser 2: ' + e2err?.message)
  users.push(u2.user.id)
  const cookie2 = await cookieFor(e2, password)
  const other = await (await fetch(`${BASE}/api/progress?itemId=${id}`, { headers: { cookie: cookie2 } })).json()
  pass('second user sees no progress', other.progress === null)

  const html3 = (await (await fetch(`${BASE}/read/${slug}`, { headers: { cookie: cookie2 } })).text())
    .replaceAll('<!-- -->', '')
  pass('second user gets no resume prompt', !html3.includes('Continue from page'))
} catch (e) {
  console.error('\nERROR:', (e as Error).message); process.exitCode = 1
} finally {
  if (itemId) {
    await sql`delete from public.progress where item_id=${itemId}::uuid`
    await sql`delete from public.content_items where id=${itemId}::uuid`
  }
  if (path) await admin.storage.from('content').remove([path])
  for (const id of users) await admin.auth.admin.deleteUser(id)
  console.log(`\n  cleaned up ${users.length} user(s), 1 item, 1 object`)
  await sql.end()
}
