import postgres from 'postgres'
const sql = postgres(process.env.DIRECT_URL!, { prepare: false, max: 1, idle_timeout: 10 })

const tables = await sql`
  select tablename, rowsecurity from pg_tables
  where schemaname='public' order by tablename`
console.log('TABLES + RLS')
for (const t of tables) console.log(`  ${t.tablename.padEnd(18)} rls=${t.rowsecurity ? 'ON ' : 'OFF'}`)

const pols = await sql`
  select tablename, count(*)::int n from pg_policies
  where schemaname='public' group by tablename order by tablename`
console.log('\nPOLICIES')
for (const p of pols) console.log(`  ${p.tablename.padEnd(18)} ${p.n}`)

const trig = await sql`
  select tgname from pg_trigger where tgname='on_auth_user_created'`
console.log('\nSIGNUP TRIGGER:', trig.length ? 'present' : 'MISSING')

const buckets = await sql`select id, public from storage.buckets order by id`
console.log('\nBUCKETS')
for (const b of buckets) console.log(`  ${String(b.id).padEnd(10)} public=${b.public}`)

const fk = await sql`
  select confrelid::regclass::text as ref from pg_constraint
  where conname='profiles_id_users_id_fk'`
console.log('\nprofiles -> ', fk[0]?.ref ?? 'MISSING')

const checks = await sql`
  select conname from pg_constraint
  where conname in ('bookmark_anchor','content_kind_fields','review_rating_range')
  order by conname`
console.log('CHECK CONSTRAINTS:', checks.map(c => c.conname).join(', ') || 'MISSING')
await sql.end()
