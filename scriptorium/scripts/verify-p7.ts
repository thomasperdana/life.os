import { createClient } from '@supabase/supabase-js'
import postgres from 'postgres'

const BASE = 'http://localhost:3000'
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ref = new URL(url).hostname.split('.')[0]
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const sql = postgres(process.env.DIRECT_URL!, { prepare: false, max: 1, idle_timeout: 10 })
const pass = (n: string, ok: boolean, x = '') => console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '  ' + x : ''}`)

const users: string[] = []
const password = crypto.randomUUID() + 'Aa1!'
const anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)

async function mkUser(tag: string, isAdmin = false) {
  const email = `p7-${tag}-${Date.now()}@example.com`
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error || !data) throw new Error(error?.message)
  users.push(data.user.id)
  if (isAdmin) await sql`update public.profiles set role='admin' where id=${data.user.id}::uuid`
  const { data: s } = await anon.auth.signInWithPassword({ email, password })
  return {
    id: data.user.id,
    cookie: `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(s!.session)).toString('base64')}`,
  }
}
const J = (c: string) => ({ 'Content-Type': 'application/json', cookie: c })

let itemId = ''
try {
  const [item] = await sql`select id from public.content_items where slug='demo-listen'`
  itemId = item.id as string

  const reader = await mkUser('reader')
  const other = await mkUser('other')
  const adminUser = await mkUser('admin', true)

  console.log('\nREVIEW GATE (§10.1)')
  let r = await fetch(`${BASE}/api/reviews`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemId, rating: 5 }) })
  pass('no session -> 401', r.status === 401, `got ${r.status}`)

  r = await fetch(`${BASE}/api/reviews`, { method: 'POST', headers: J(reader.cookie),
    body: JSON.stringify({ itemId, rating: 5, body: 'A thoughtful and useful recording.' }) })
  pass('no progress -> 403 (nobody reviews what they never opened)', r.status === 403, `got ${r.status}`)

  // give both readers some progress
  for (const u of [reader, other]) {
    await fetch(`${BASE}/api/progress`, { method: 'POST', headers: J(u.cookie),
      body: JSON.stringify({ itemId, kind: 'listening', positionSeconds: 40, percent: 22 }) })
  }

  r = await fetch(`${BASE}/api/reviews`, { method: 'POST', headers: J(reader.cookie),
    body: JSON.stringify({ itemId, rating: 6 }) })
  pass('rating outside 1-5 -> 400', r.status === 400, `got ${r.status}`)

  console.log('\nCLEAN REVIEW AUTO-PUBLISHES (§10.2)')
  r = await fetch(`${BASE}/api/reviews`, { method: 'POST', headers: J(reader.cookie),
    body: JSON.stringify({ itemId, rating: 5, body: 'A careful recording that repaid a second listen.' }) })
  const created = await r.json()
  pass('created -> 201', r.status === 201, `got ${r.status}`)
  pass('auto-published', created.review.status === 'published', created.review.status)

  console.log('\nFLAGGED REVIEW GOES TO THE QUEUE')
  r = await fetch(`${BASE}/api/reviews`, { method: 'POST', headers: J(other.cookie),
    body: JSON.stringify({ itemId, rating: 2, body: 'Buy cheap things at https://spam.example.com now' }) })
  const flagged = await r.json()
  pass('held as pending', flagged.review.status === 'pending', flagged.review.status)
  pass('link stripped from the stored text',
    !String(flagged.review.body).includes('spam.example') && String(flagged.review.body).includes('[link removed]'))
  pass('reason reported to the author', flagged.moderation.reasons.includes('contains a link'))

  console.log('\nAGGREGATE + DISTRIBUTION (§10.1)')
  let agg = await (await fetch(`${BASE}/api/reviews?itemId=${itemId}`)).json()
  pass('only published counted', agg.aggregate.count === 1, `count=${agg.aggregate.count}`)
  pass('average is the published one', agg.aggregate.average === 5, `avg=${agg.aggregate.average}`)
  pass('pending review hidden from the public list',
    !agg.reviews.some((x: { body: string }) => String(x.body).includes('[link removed]')))

  console.log('\nONE REVIEW PER USER PER ITEM')
  const before = (await sql`select count(*)::int n from public.reviews where item_id=${itemId}::uuid`)[0].n
  r = await fetch(`${BASE}/api/reviews`, { method: 'POST', headers: J(reader.cookie),
    body: JSON.stringify({ itemId, rating: 4, body: 'On reflection, four stars is fairer here.' }) })
  const after = (await sql`select count(*)::int n from public.reviews where item_id=${itemId}::uuid`)[0].n
  pass('resubmitting rate-limits rather than duplicating', r.status === 429 && after === before,
       `status=${r.status} rows ${before}->${after}`)

  console.log('\nADMIN QUEUE (§7.5 + §10.2)')
  r = await fetch(`${BASE}/api/admin/reviews`, { headers: { cookie: reader.cookie } })
  pass('member cannot read the queue -> 403', r.status === 403, `got ${r.status}`)

  r = await fetch(`${BASE}/api/admin/reviews`, { headers: { cookie: adminUser.cookie } })
  const queue = await r.json()
  pass('admin sees the flagged review', r.status === 200 &&
    queue.queue.some((q: { id: string }) => q.id === flagged.review.id))

  console.log('\nREPORT RETURNS A PUBLISHED REVIEW TO THE QUEUE')
  r = await fetch(`${BASE}/api/reviews/report`, { method: 'POST', headers: J(reader.cookie),
    body: JSON.stringify({ reviewId: created.review.id }) })
  pass('cannot report your own review -> 400', r.status === 400, `got ${r.status}`)

  r = await fetch(`${BASE}/api/reviews/report`, { method: 'POST', headers: J(other.cookie),
    body: JSON.stringify({ reviewId: created.review.id, reason: 'inaccurate' }) })
  pass('report accepted -> 204', r.status === 204, `got ${r.status}`)
  const [reported] = await sql`select status from public.reviews where id=${created.review.id}::uuid`
  pass('published review is back to pending', reported.status === 'pending', reported.status)

  r = await fetch(`${BASE}/api/reviews/report`, { method: 'POST', headers: J(other.cookie),
    body: JSON.stringify({ reviewId: created.review.id }) })
  pass('reporting twice -> 409', r.status === 409, `got ${r.status}`)

  agg = await (await fetch(`${BASE}/api/reviews?itemId=${itemId}`)).json()
  pass('reported review disappears from the public list', agg.aggregate.count === 0, `count=${agg.aggregate.count}`)

  console.log('\nADMIN DECIDES')
  r = await fetch(`${BASE}/api/admin/reviews`, { method: 'PATCH', headers: J(adminUser.cookie),
    body: JSON.stringify({ reviewId: created.review.id, action: 'publish' }) })
  pass('publish restores it', r.status === 200 &&
    (await sql`select status from public.reviews where id=${created.review.id}::uuid`)[0].status === 'published')
  const reportsLeft = (await sql`select count(*)::int n from public.review_reports where review_id=${created.review.id}::uuid`)[0].n
  pass('publishing settles the reports', reportsLeft === 0, `${reportsLeft} left`)

  r = await fetch(`${BASE}/api/admin/reviews`, { method: 'PATCH', headers: J(adminUser.cookie),
    body: JSON.stringify({ reviewId: flagged.review.id, action: 'ban' }) })
  pass('ban rejects the review', r.status === 200 &&
    (await sql`select status from public.reviews where id=${flagged.review.id}::uuid`)[0].status === 'rejected')
  const [banned] = await sql`select banned_at from public.profiles where id=${other.id}::uuid`
  pass('author is banned', banned.banned_at !== null)

  r = await fetch(`${BASE}/api/reviews`, { method: 'POST', headers: J(other.cookie),
    body: JSON.stringify({ itemId, rating: 1, body: 'Trying again after the ban here.' }) })
  pass('banned author cannot post -> 403', r.status === 403, `got ${r.status}`)
} catch (e) {
  console.error('\nERROR:', (e as Error).message); process.exitCode = 1
} finally {
  for (const id of users) {
    await sql`delete from public.review_reports where reporter_id=${id}::uuid`
    await sql`delete from public.reviews where user_id=${id}::uuid`
    await sql`delete from public.progress where user_id=${id}::uuid`
    await admin.auth.admin.deleteUser(id)
  }
  console.log(`\n  cleaned up ${users.length} users`)
  await sql.end()
}
