import 'server-only'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL is not set. See .env.example.')

/**
 * Supabase's transaction pooler (port 6543) does not support prepared
 * statements, so `prepare: false` is mandatory. Using the session pooler or a
 * direct connection instead? This flag is harmless there.
 */
const client = postgres(connectionString, { prepare: false })

export const db = drizzle(client, { schema })
export * from './schema'
