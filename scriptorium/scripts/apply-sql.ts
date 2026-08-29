import postgres from 'postgres'
import { readFileSync } from 'node:fs'

const file = process.argv[2]
if (!file) { console.error('usage: apply-sql.ts <file>'); process.exit(1) }

const sql = postgres(process.env.DIRECT_URL!, { prepare: false, max: 1, idle_timeout: 10 })
try {
  await sql.unsafe(readFileSync(file, 'utf8'))
  console.log('applied:', file)
} catch (e) {
  console.error('FAILED:', (e as Error).message)
  process.exit(1)
} finally {
  await sql.end()
}
