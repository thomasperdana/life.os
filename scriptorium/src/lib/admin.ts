import 'server-only'
import { eq } from 'drizzle-orm'
import { db, profiles } from '@/db'
import { createClient } from '@/lib/supabase/server'

export class NotAdminError extends Error {
  constructor(public reason: 'unauthenticated' | 'forbidden') {
    super(reason)
  }
}

/**
 * The admin gate — SPEC.3.md §7.5.
 *
 * Reads `profiles.role` from the database on EVERY call. Never a JWT claim,
 * never a cookie, never client state.
 *
 * This is the only thing standing between a signed-in member and the content
 * table: admin writes use the service-role client, which bypasses every RLS
 * policy by design (§5.2). Throws rather than returning a boolean, so a caller
 * cannot forget to check the result.
 */
export async function assertAdmin(): Promise<{ userId: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new NotAdminError('unauthenticated')

  const [profile] = await db
    .select({ role: profiles.role })
    .from(profiles)
    .where(eq(profiles.id, user.id))
    .limit(1)

  if (profile?.role !== 'admin') throw new NotAdminError('forbidden')
  return { userId: user.id }
}

/** Maps the guard's failure onto an HTTP status. 401 vs 403 is not cosmetic. */
export function adminErrorResponse(e: unknown): Response | null {
  if (!(e instanceof NotAdminError)) return null
  return Response.json(
    { error: e.reason },
    { status: e.reason === 'unauthenticated' ? 401 : 403 },
  )
}
