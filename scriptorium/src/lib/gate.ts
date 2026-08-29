import 'server-only'
import { eq } from 'drizzle-orm'
import { db, contentItems } from '@/db'
import { createClient } from '@/lib/supabase/server'
import { getEntitlement, canAccess } from '@/lib/entitlement'

type Gate =
  | { ok: true; userId: string; item: typeof contentItems.$inferSelect }
  | { ok: false; status: 401 | 402 | 404 }

/**
 * The serving gate — SPEC.3.md §7.3, §8.1, §8.6.
 *
 * Order matters. A draft item 404s for everyone, including a subscriber, so the
 * response never reveals that unpublished content exists.
 */
export async function gateContent(itemId: string): Promise<Gate> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, status: 401 }

  const [item] = await db.select().from(contentItems)
    .where(eq(contentItems.id, itemId)).limit(1)

  if (!item || item.status !== 'published') return { ok: false, status: 404 }

  const entitlement = await getEntitlement(user.id)
  if (!canAccess(entitlement, item.accessTier)) return { ok: false, status: 402 }

  return { ok: true, userId: user.id, item }
}
