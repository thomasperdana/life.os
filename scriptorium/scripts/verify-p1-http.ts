import { createClient } from '@supabase/supabase-js'
import postgres from 'postgres'

const BASE = 'http://localhost:3000'
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ref = new URL(url).hostname.split('.')[0]
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const sql = postgres(process.env.DIRECT_URL!, { prepare: false, max: 1, idle_timeout: 10 })
const pass = (n: string, ok: boolean, x = '') => console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '  ' + x : ''}`)

/** Build the cookie @supabase/ssr expects, so requests carry a real session. */
async function cookieFor(email: string, password: string) {
  const anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
  const { data, error } = await anon.auth.signInWithPassword({ email, password })
  if (error || !data.session) throw new Error('signIn: ' + error?.message)
  const b64 = Buffer.from(JSON.stringify(data.session)).toString('base64')
  return `sb-${ref}-auth-token=base64-${b64}`
}

const users: string[] = []
let itemId: string | undefined
let fixturePath: string | undefined
const password = crypto.randomUUID() + 'Aa1!'

try {
  // Two users: one plain member, one admin.
  const mk = async (tag: string, role: 'member' | 'admin') => {
    const email = `p1-${tag}-${Date.now()}@example.com`
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
    if (error) throw new Error(error.message)
    users.push(data.user.id)
    if (role === 'admin') await sql`update public.profiles set role='admin' where id=${data.user.id}::uuid`
    return { email, id: data.user.id }
  }
  const member = await mk('member', 'member')
  const adminUser = await mk('admin', 'admin')
  const memberCookie = await cookieFor(member.email, password)
  const adminCookie = await cookieFor(adminUser.email, password)

  console.log('\nADMIN GATE (§7.5) — every /api/admin/* route re-checks')
  const body = JSON.stringify({ filename: 'x.pdf', kind: 'pdf', size: 1024 })
  const j = { 'Content-Type': 'application/json' }

  let r = await fetch(`${BASE}/api/admin/upload-url`, { method: 'POST', headers: j, body })
  pass('upload-url  no session   -> 401', r.status === 401, `got ${r.status}`)

  r = await fetch(`${BASE}/api/admin/upload-url`, { method: 'POST', headers: { ...j, cookie: memberCookie }, body })
  pass('upload-url  member       -> 403', r.status === 403, `got ${r.status}`)

  r = await fetch(`${BASE}/api/admin/upload-url`, { method: 'POST', headers: { ...j, cookie: adminCookie }, body })
  pass('upload-url  admin        -> 200', r.status === 200, `got ${r.status}`)
  const ticket = r.ok ? await r.json() : null
  pass('ticket carries signed url + token', !!ticket?.token && !!ticket?.signedUrl)

  r = await fetch(`${BASE}/api/admin/content`, { method: 'PATCH', headers: { ...j, cookie: memberCookie },
    body: JSON.stringify({ id: crypto.randomUUID(), status: 'published' }) })
  pass('content PATCH member     -> 403', r.status === 403, `got ${r.status}`)

  console.log('\nUPLOAD SIZE + EXTENSION GUARDS (§7.2)')
  r = await fetch(`${BASE}/api/admin/upload-url`, { method: 'POST', headers: { ...j, cookie: adminCookie },
    body: JSON.stringify({ filename: 'huge.mp3', kind: 'audio', size: 900 * 1024 * 1024 }) })
  pass('oversize refused before ticket -> 413', r.status === 413, `got ${r.status}`)

  r = await fetch(`${BASE}/api/admin/upload-url`, { method: 'POST', headers: { ...j, cookie: adminCookie },
    body: JSON.stringify({ filename: 'song.mp3', kind: 'pdf', size: 1024 }) })
  pass('extension/kind mismatch  -> 400', r.status === 400, `got ${r.status}`)

  console.log('\nSERVING GATE (§7.3) — order matters')
  // A real stored object, so signed-URL minting is exercised for real.
  const { PDFDocument } = await import('pdf-lib')
  const doc = await PDFDocument.create(); doc.addPage([200, 200])
  fixturePath = `pdf/p1-gate-${Date.now()}.pdf`
  const { error: upErr } = await admin.storage.from('content')
    .upload(fixturePath, (await doc.save()) as unknown as ArrayBuffer,
            { contentType: 'application/pdf', upsert: true })
  if (upErr) throw new Error('fixture upload: ' + upErr.message)

  const [row] = await sql`
    insert into public.content_items (slug, kind, title, storage_path, access_tier, status)
    values (${'p1-gate-' + Date.now()}, 'pdf', 'Gate fixture', ${fixturePath}, 'subscriber', 'draft')
    returning id`
  itemId = row.id as string
  const id = itemId  // narrowed for the queries below

  r = await fetch(`${BASE}/api/content/${itemId}/url`)
  pass('no session               -> 401', r.status === 401, `got ${r.status}`)

  r = await fetch(`${BASE}/api/content/${itemId}/url`, { headers: { cookie: memberCookie } })
  pass('draft item, any user     -> 404', r.status === 404, `got ${r.status}`)

  await sql`update public.content_items set status='published' where id=${id}::uuid`
  r = await fetch(`${BASE}/api/content/${itemId}/url`, { headers: { cookie: memberCookie } })
  pass('published, free user     -> 402', r.status === 402, `got ${r.status}`)

  await sql`update public.content_items set access_tier='free' where id=${id}::uuid`
  r = await fetch(`${BASE}/api/content/${itemId}/url`, { headers: { cookie: memberCookie } })
  const signed = r.ok ? await r.json() : null
  pass('free-tier item, member   -> 200 + signed url', r.status === 200 && !!signed?.url, `got ${r.status}`)
  pass('5-minute TTL for pdf', !!signed?.expiresAt &&
    Math.abs(new Date(signed.expiresAt).getTime() - Date.now() - 300_000) < 20_000,
    signed?.expiresAt ?? '')
} catch (e) {
  console.error('\nERROR:', (e as Error).message); process.exitCode = 1
} finally {
  if (itemId) await sql`delete from public.content_items where id=${itemId}::uuid`
  if (fixturePath) await admin.storage.from('content').remove([fixturePath])
  for (const id of users) await admin.auth.admin.deleteUser(id)
  console.log(`\n  cleaned up ${users.length} user(s), ${itemId ? 1 : 0} item(s)`)
  await sql.end()
}
