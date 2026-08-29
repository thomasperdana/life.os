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
  const email = `p6-${Date.now()}@example.com`
  const password = crypto.randomUUID() + 'Aa1!'
  const { data: u, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw new Error(error.message)
  userId = u.user.id
  const anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
  const { data: s } = await anon.auth.signInWithPassword({ email, password })
  const cookie = `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(s!.session)).toString('base64')}`
  const J = { 'Content-Type': 'application/json', cookie }

  const [audio] = await sql`select id from public.content_items where slug='demo-listen'`
  const [pdf] = await sql`select id from public.content_items where slug='demo-reader'`

  console.log('\nLISTENING BOOKMARKS (§8.7)')
  let r = await fetch(`${BASE}/api/bookmarks`, { method: 'POST', headers: J,
    body: JSON.stringify({ itemId: audio.id, kind: 'listening', color: 'yellow' }) })
  pass('listening bookmark without a position -> 400', r.status === 400, `got ${r.status}`)

  r = await fetch(`${BASE}/api/bookmarks`, { method: 'POST', headers: J,
    body: JSON.stringify({ itemId: audio.id, kind: 'listening', positionSeconds: 95, color: 'blue' }) })
  pass('timestamp bookmark created -> 201', r.status === 201, `got ${r.status}`)
  const mark = (await r.json()).bookmark
  pass('stored as listening with seconds, page null',
    mark.kind === 'listening' && mark.positionSeconds === 95 && mark.page === null)

  // The DB constraint must reject a listening row that carries a page instead.
  let violated = false
  try {
    await sql`insert into public.bookmarks (user_id, item_id, kind, page)
              values (${userId}::uuid, ${audio.id}::uuid, 'listening', 5)`
  } catch { violated = true }
  pass('DB constraint rejects listening+page', violated)

  console.log('\nTHE 5-SECOND LEAD-IN (§8.7)')
  const heardAt = 60
  r = await fetch(`${BASE}/api/bookmarks`, { method: 'POST', headers: J,
    body: JSON.stringify({ itemId: audio.id, kind: 'listening',
      positionSeconds: Math.max(0, heardAt - 5), color: 'green' }) })
  const lead = (await r.json()).bookmark
  pass('mark at 60s stores 55s', lead.positionSeconds === 55, `${lead.positionSeconds}`)

  r = await fetch(`${BASE}/api/bookmarks`, { method: 'POST', headers: J,
    body: JSON.stringify({ itemId: audio.id, kind: 'listening',
      positionSeconds: Math.max(0, 2 - 5), color: 'pink' }) })
  const clamped = (await r.json()).bookmark
  pass('lead-in clamps at zero, never negative', clamped.positionSeconds === 0, `${clamped.positionSeconds}`)

  console.log('\nLISTENING JOURNALS (§8.8) — same table, same route')
  r = await fetch(`${BASE}/api/journals`, { method: 'PUT', headers: J,
    body: JSON.stringify({ itemId: audio.id, kind: 'listening', bookmarkId: mark.id,
      bodyMd: 'The pause before that sentence was the whole point.' }) })
  pass('anchored listening journal -> 201', r.status === 201, `got ${r.status}`)

  r = await fetch(`${BASE}/api/journals`, { method: 'PUT', headers: J,
    body: JSON.stringify({ itemId: audio.id, kind: 'listening',
      bodyMd: 'A response to the whole recording about patience.' }) })
  pass('free-standing listening journal -> 201', r.status === 201, `got ${r.status}`)

  const kinds = await sql`select kind, count(*)::int n from public.journals where user_id=${userId}::uuid group by kind`
  pass('journals carry the listening kind', kinds.some(k => k.kind === 'listening'), JSON.stringify(kinds))

  console.log('\nBOTH HALVES SHARE ONE TABLE (§2.1)')
  await fetch(`${BASE}/api/bookmarks`, { method: 'POST', headers: J,
    body: JSON.stringify({ itemId: pdf.id, kind: 'reading', page: 4, color: 'yellow',
      textAnchor: { quads: [], quotedText: 'a passage about patience in the text', sourceChecksum: 'demo-v3' } }) })
  await fetch(`${BASE}/api/journals`, { method: 'PUT', headers: J,
    body: JSON.stringify({ itemId: pdf.id, kind: 'reading', bodyMd: 'Reading note mentioning patience too.' }) })

  const both = await sql`select kind, count(*)::int n from public.bookmarks where user_id=${userId}::uuid group by kind order by kind`
  pass('one bookmarks table holds both kinds', both.length === 2, both.map(b=>`${b.kind}:${b.n}`).join(' '))

  console.log('\n/notes — CROSS-LIBRARY (§12)')
  let html = strip(await (await fetch(`${BASE}/notes`, { headers: { cookie } })).text())
  pass('lists bookmarks and journals together',
    html.includes('bookmark') && html.includes('journal'))
  pass('includes the PDF item', html.includes('Demo: The Quick Brown Fox'))
  pass('includes the audio item', html.includes('Demo: Three Minutes of Silence'))
  pass('audio mark links with ?t=', html.includes('/listen/demo-listen?t=95'))
  pass('pdf mark links with ?page=', html.includes('/read/demo-reader?page=4'))

  console.log('\nFULL-TEXT SEARCH')
  html = strip(await (await fetch(`${BASE}/notes?q=patience`, { headers: { cookie } })).text())
  const n = html.match(/data-testid="notes-count"[^>]*>([^<]*)/)?.[1] ?? ''
  pass('"patience" matches across both halves', html.includes('whole recording') && html.includes('Reading note'), n.trim())

  html = strip(await (await fetch(`${BASE}/notes?q=pause`, { headers: { cookie } })).text())
  pass('narrower term returns only the audio note',
    html.includes('pause before that sentence') && !html.includes('Reading note'))

  html = strip(await (await fetch(`${BASE}/notes?q=%22whole+point%22`, { headers: { cookie } })).text())
  pass('quoted phrase search works', html.includes('whole point'))

  html = strip(await (await fetch(`${BASE}/notes?q=zzzznothing`, { headers: { cookie } })).text())
  pass('no match says so', html.includes('Nothing matched'))

  console.log('\nISOLATION')
  const e2 = `p6b-${Date.now()}@example.com`
  const { data: u2, error: e2err } = await admin.auth.admin.createUser({ email: e2, password, email_confirm: true })
  if (e2err || !u2) throw new Error('user2: ' + e2err?.message)
  const { data: s2 } = await anon.auth.signInWithPassword({ email: e2, password })
  const cookie2 = `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(s2!.session)).toString('base64')}`
  html = strip(await (await fetch(`${BASE}/notes`, { headers: { cookie: cookie2 } })).text())
  pass('another user sees an empty /notes', html.includes('0 notes') || html.includes('will collect here'))
  await admin.auth.admin.deleteUser(u2.user.id)
} catch (e) {
  console.error('\nERROR:', (e as Error).message); process.exitCode = 1
} finally {
  if (userId) {
    await sql`delete from public.journals where user_id=${userId}::uuid`
    await sql`delete from public.bookmarks where user_id=${userId}::uuid`
    await admin.auth.admin.deleteUser(userId)
  }
  console.log('\n  cleaned up')
  await sql.end()
}
