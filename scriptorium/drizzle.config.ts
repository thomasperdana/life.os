import 'dotenv/config'
import { config as loadEnv } from 'dotenv'
import type { Config } from 'drizzle-kit'

// drizzle-kit runs its own loader and does not see Next.js/bun env files.
loadEnv({ path: '.env.local', override: true })

export default {
  schema: './src/db/schema.ts',
  out: './supabase/migrations',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL! },
  // auth.users is Supabase's, not ours. Never generate migrations for it.
  schemaFilter: ['public'],
} satisfies Config
