import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { db, progress, contentItems } from '@/db'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const Body = z.object({
  itemId: z.uuid(),
  kind: z.enum(['reading', 'listening']),
  page: z.number().int().positive().optional(),
  positionSeconds: z.number().nonnegative().optional(),
  percent: z.number().min(0).max(100),
})

/**
 * Upsert reading/listening position — SPEC.3.md §8.2, §8.6.
 *
 * Called on a ~3s debounce and again via sendBeacon on unload, so it must be
 * cheap and idempotent. RLS also constrains this to the caller's own row, but
 * the session check here is the primary gate.
 */
export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response(null, { status: 401 })

  // sendBeacon posts as text/plain, so never rely on the content type.
  const raw = await req.text()
  const parsed = Body.safeParse(JSON.parse(raw || '{}'))
  if (!parsed.success) return new Response(null, { status: 400 })
  const b = parsed.data

  const [item] = await db.select({ id: contentItems.id, status: contentItems.status })
    .from(contentItems).where(eq(contentItems.id, b.itemId)).limit(1)
  if (!item || item.status !== 'published') return new Response(null, { status: 404 })

  await db.insert(progress).values({
    userId: user.id, itemId: b.itemId, kind: b.kind,
    page: b.page ?? null, positionSeconds: b.positionSeconds ?? null,
    percent: b.percent, updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: [progress.userId, progress.itemId],
    set: {
      kind: b.kind, page: b.page ?? null,
      positionSeconds: b.positionSeconds ?? null,
      percent: b.percent, updatedAt: new Date(),
    },
  })

  return new Response(null, { status: 204 })
}

/** Current position for one item. */
export async function GET(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response(null, { status: 401 })

  const itemId = new URL(req.url).searchParams.get('itemId')
  if (!itemId) return new Response(null, { status: 400 })

  const [row] = await db.select().from(progress)
    .where(and(eq(progress.userId, user.id), eq(progress.itemId, itemId))).limit(1)

  return Response.json({ progress: row ?? null })
}
