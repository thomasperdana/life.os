import 'server-only'
import { createClient } from '@/lib/supabase/server'

/** Current user id, or null. Every user-scoped route starts here. */
export async function currentUserId(): Promise<string | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user?.id ?? null
}
