import 'server-only'
import { createClient } from '@supabase/supabase-js'

/**
 * Service-role client. BYPASSES EVERY RLS POLICY (§5.2, §11).
 *
 * Use only where there is legitimately no user session: Stripe webhooks,
 * admin actions, moderation. Never import this into a Client Component, never
 * expose the key to the browser, never log it.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set.')
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
