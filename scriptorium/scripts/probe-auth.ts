import postgres from 'postgres'
const sql = postgres(process.env.DIRECT_URL!, { prepare: false, max: 1, idle_timeout: 5 })
const cols = await sql`
  select column_name, data_type from information_schema.columns
  where table_schema='auth' and table_name='users' and column_name='id'`
console.log('auth.users.id type:', cols[0]?.data_type ?? '(not found)')
await sql.end()
