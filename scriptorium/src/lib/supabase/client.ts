'use client'
import { createBrowserClient } from '@supabase/ssr'

/** Browser client. Uses the anon key, which is public by design (§11). */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}
