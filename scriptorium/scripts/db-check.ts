import postgres from 'postgres'

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL
if (!url) { console.error('no DIRECT_URL/DATABASE_URL'); process.exit(1) }

const sql = postgres(url, { prepare: false, idle_timeout: 5, max: 1 })
try {
  const [v] = await sql`select version()`
  console.log('connected:', String(v.version).split(',')[0])

  const schemas = await sql`
    select nspname from pg_namespace
    where nspname in ('public','auth','storage') order by nspname`
  console.log('schemas present:', schemas.map(s => s.nspname).join(', '))

  const tables = await sql`
    select tablename from pg_tables where schemaname='public' order by tablename`
  console.log('public tables:', tables.length ? tables.map(t => t.tablename).join(', ') : '(none)')
} catch (e) {
  console.error('FAILED:', (e as Error).message)
  process.exit(1)
} finally {
  await sql.end()
}
