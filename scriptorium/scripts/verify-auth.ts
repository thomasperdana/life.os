import { createClient } from '@supabase/supabase-js'
import postgres from 'postgres'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const sql = postgres(process.env.DIRECT_URL!, { prepare: false, max: 1, idle_timeout: 10 })

const email = `p0-check-${Date.now()}@example.com`
const password = crypto.randomUUID() + 'Aa1!'
let userId: string | undefined

try {
  // 1. Sign up
  const { data: created, error: e1 } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
  })
  if (e1) throw new Error('createUser: ' + e1.message)
  userId = created.user.id
  console.log('1. user created                  PASS')

  // 2. Trigger must have made a profile
  const prof = await sql`select id, role from public.profiles where id = ${userId}::uuid`
  console.log(`2. profile auto-created         ${prof.length ? 'PASS' : 'FAIL'} (role=${prof[0]?.role})`)

  // 3. Sign in with the anon key, exactly as the browser does
  const anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
  const { data: session, error: e2 } = await anon.auth.signInWithPassword({ email, password })
  if (e2) throw new Error('signIn: ' + e2.message)
  console.log(`3. password sign-in             ${session.session ? 'PASS' : 'FAIL'}`)

  // 4. Entitlement with no subscription row must be 'free'
  const subs = await sql`select 1 from public.subscriptions where user_id = ${userId}::uuid`
  console.log(`4. entitlement = free           ${subs.length === 0 ? 'PASS' : 'FAIL'}`)

  // 5. RLS: this user must not see anyone else's profile
  const { data: others } = await anon.from('profiles').select('id')
  const onlySelf = (others ?? []).every((r: { id: string }) => r.id === userId)
  console.log(`5. RLS isolates profiles        ${onlySelf ? 'PASS' : 'FAIL'} (rows=${others?.length ?? 0})`)

  // 6. RLS: writing a bookmark as another user must be refused
  const { error: e3 } = await anon.from('bookmarks').insert({
    user_id: '00000000-0000-0000-0000-000000000000',
    item_id: '00000000-0000-0000-0000-000000000000',
    kind: 'reading', page: 1,
  })
  console.log(`6. RLS blocks cross-user write  ${e3 ? 'PASS' : 'FAIL'}`)
} catch (err) {
  console.error('ERROR:', (err as Error).message)
  process.exitCode = 1
} finally {
  if (userId) {
    await admin.auth.admin.deleteUser(userId)
    const left = await sql`select 1 from public.profiles where id = ${userId}::uuid`
    console.log(`7. cleanup + cascade delete     ${left.length === 0 ? 'PASS' : 'FAIL'}`)
  }
  await sql.end()
}
