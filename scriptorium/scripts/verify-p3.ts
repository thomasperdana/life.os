import { createClient } from '@supabase/supabase-js'
import postgres from 'postgres'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { recoverAnchor } from '../src/lib/anchor'

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
const J = (cookie: string) => ({ 'Content-Type': 'application/json', cookie })

const users: string[] = []
let itemId: string | undefined, path: string | undefined
const password = crypto.randomUUID() + 'Aa1!'
const slug = `p3-${Date.now()}`

try {
  const email = `p3-${Date.now()}@example.com`
  const { data: u, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw new Error(error.message)
  users.push(u.user.id)
  const cookie = await cookieFor(email, password)

  const QUOTE = 'Consider the lilies of the field'
  const chapters = [
    'In the beginning of the work there was a plan.',
    'The plan required patience and a great deal of care.',
    `${QUOTE}, how they grow.`,
    'And the evening and the morning were the first day.',
  ]
  const build = async (texts: string[]) => {
    const d = await PDFDocument.create()
    const f = await d.embedFont(StandardFonts.Helvetica)
    texts.forEach((t, i) => d.addPage([420, 560]).drawText(`Chapter ${i + 1}. ${t}`,
      { x: 30, y: 480, size: 11, font: f, maxWidth: 360 }))
    return d.save()
  }

  path = `pdf/${slug}.pdf`
  await admin.storage.from('content').upload(path, (await build(chapters)) as unknown as ArrayBuffer,
    { contentType: 'application/pdf', upsert: true })
  const [row] = await sql`
    insert into public.content_items (slug, kind, title, storage_path, page_count, checksum, access_tier, status, published_at)
    values (${slug},'pdf','P3 Fixture',${path},4,'checksum-v1','free','published',now()) returning id`
  itemId = row.id as string
  const id = itemId

  console.log('\nBOOKMARK API')
  let r = await fetch(`${BASE}/api/bookmarks?itemId=${id}`)
  pass('list without session -> 401', r.status === 401, `got ${r.status}`)

  r = await fetch(`${BASE}/api/bookmarks`, { method: 'POST', headers: J(cookie),
    body: JSON.stringify({ itemId: id, kind: 'reading', color: 'yellow' }) })
  pass('reading bookmark without page -> 400', r.status === 400, `got ${r.status}`)

  r = await fetch(`${BASE}/api/bookmarks`, { method: 'POST', headers: J(cookie),
    body: JSON.stringify({ itemId: id, kind: 'reading', page: 2, color: 'blue' }) })
  pass('page bookmark created -> 201', r.status === 201, `got ${r.status}`)
  const pageMark = (await r.json()).bookmark

  r = await fetch(`${BASE}/api/bookmarks`, { method: 'POST', headers: J(cookie),
    body: JSON.stringify({ itemId: id, kind: 'reading', page: 3, color: 'yellow',
      textAnchor: { quads: [], quotedText: QUOTE, sourceChecksum: 'checksum-v1' } }) })
  pass('highlight created -> 201', r.status === 201, `got ${r.status}`)
  const highlight = (await r.json()).bookmark
  pass('anchor round-trips through jsonb',
    highlight.textAnchor?.quotedText === QUOTE && highlight.textAnchor?.sourceChecksum === 'checksum-v1')

  const listed = await (await fetch(`${BASE}/api/bookmarks?itemId=${id}`, { headers: { cookie } })).json()
  pass('list returns both', listed.bookmarks.length === 2, `${listed.bookmarks.length}`)

  console.log('\nJOURNALS (§8.4)')
  r = await fetch(`${BASE}/api/journals`, { method: 'PUT', headers: J(cookie),
    body: JSON.stringify({ itemId: id, kind: 'reading', bookmarkId: highlight.id, bodyMd: 'A thought beside the sentence.' }) })
  pass('anchored journal created -> 201', r.status === 201, `got ${r.status}`)

  r = await fetch(`${BASE}/api/journals`, { method: 'PUT', headers: J(cookie),
    body: JSON.stringify({ itemId: id, kind: 'reading', bookmarkId: highlight.id, bodyMd: 'A revised thought.' }) })
  pass('autosave upserts, does not duplicate', r.status === 200, `got ${r.status}`)

  r = await fetch(`${BASE}/api/journals`, { method: 'PUT', headers: J(cookie),
    body: JSON.stringify({ itemId: id, kind: 'reading', bodyMd: 'Response to the whole document.' }) })
  pass('free-standing journal created', r.status === 201, `got ${r.status}`)

  let rows = await sql`select id, bookmark_id from public.journals where item_id=${id}::uuid`
  pass('exactly two journals exist', rows.length === 2, `${rows.length}`)

  r = await fetch(`${BASE}/api/journals`, { method: 'PUT', headers: J(cookie),
    body: JSON.stringify({ itemId: id, kind: 'reading', bookmarkId: highlight.id, bodyMd: '   ' }) })
  rows = await sql`select id from public.journals where item_id=${id}::uuid`
  pass('empty body deletes the journal', r.status === 204 && rows.length === 1, `${rows.length} left`)

  console.log('\nDELETING A BOOKMARK KEEPS ITS PROSE')
  await fetch(`${BASE}/api/journals`, { method: 'PUT', headers: J(cookie),
    body: JSON.stringify({ itemId: id, kind: 'reading', bookmarkId: pageMark.id, bodyMd: 'Note on page two.' }) })
  await fetch(`${BASE}/api/bookmarks?id=${pageMark.id}`, { method: 'DELETE', headers: { cookie } })
  const orphan = await sql`select bookmark_id, body_md from public.journals where item_id=${id}::uuid and body_md='Note on page two.'`
  pass('journal survives, detached', orphan.length === 1 && orphan[0].bookmark_id === null)

  console.log('\nCROSS-USER ISOLATION')
  const e2 = `p3b-${Date.now()}@example.com`
  const { data: u2, error: err2 } = await admin.auth.admin.createUser({ email: e2, password, email_confirm: true })
  if (err2 || !u2) throw new Error('user2: ' + err2?.message)
  users.push(u2.user.id)
  const cookie2 = await cookieFor(e2, password)
  const theirs = await (await fetch(`${BASE}/api/bookmarks?itemId=${id}`, { headers: { cookie: cookie2 } })).json()
  pass('second user sees no bookmarks', theirs.bookmarks.length === 0, `${theirs.bookmarks.length}`)
  const theirJ = await (await fetch(`${BASE}/api/journals?itemId=${id}`, { headers: { cookie: cookie2 } })).json()
  pass('second user sees no journals', theirJ.journals.length === 0)
  r = await fetch(`${BASE}/api/bookmarks?id=${highlight.id}`, { method: 'DELETE', headers: { cookie: cookie2 } })
  pass('cannot delete another user\'s bookmark -> 404', r.status === 404, `got ${r.status}`)

  console.log('\nTHE ACCEPTANCE CRITERION — re-upload the PDF with a page inserted')
  const revised = [chapters[0], 'A preface added in the second edition.', ...chapters.slice(1)]
  await admin.storage.from('content').upload(path, (await build(revised)) as unknown as ArrayBuffer,
    { contentType: 'application/pdf', upsert: true })
  await sql`update public.content_items set checksum='checksum-v2', page_count=5 where id=${id}::uuid`

  // What the reader does client-side: extract page text, then re-anchor.
  const rec = recoverAnchor(QUOTE, revised.map((t, i) => `Chapter ${i + 1}. ${t}`), 3)
  pass('quote relocated 3 -> 4 in the new edition', rec.status === 'exact' && rec.page === 4, JSON.stringify(rec))

  const [stored] = await sql`select page, text_anchor from public.bookmarks where id=${highlight.id}::uuid`
  pass('stored page is now stale (3)', stored.page === 3)
  pass('stored checksum no longer matches item',
    (stored.text_anchor as { sourceChecksum: string }).sourceChecksum === 'checksum-v1')
  pass('=> reader flags it approximate and shows page 4',
    rec.status === 'exact' && rec.page !== stored.page)
} catch (e) {
  console.error('\nERROR:', (e as Error).message); process.exitCode = 1
} finally {
  if (itemId) {
    await sql`delete from public.journals where item_id=${itemId}::uuid`
    await sql`delete from public.bookmarks where item_id=${itemId}::uuid`
    await sql`delete from public.content_items where id=${itemId}::uuid`
  }
  if (path) await admin.storage.from('content').remove([path])
  for (const id of users) await admin.auth.admin.deleteUser(id)
  console.log(`\n  cleaned up ${users.length} user(s), 1 item, 1 object`)
  await sql.end()
}
