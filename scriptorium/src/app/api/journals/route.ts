import { z } from 'zod'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { db, journals, bookmarks, contentItems } from '@/db'
import { currentUserId } from '@/lib/session'

export const runtime = 'nodejs'

const Upsert = z.object({
  itemId: z.uuid(),
  kind: z.enum(['reading', 'listening']),
  /** null/absent = the free-standing journal for the whole item (§8.4). */
  bookmarkId: z.uuid().nullish(),
  bodyMd: z.string().max(100_000),
})

export async function GET(req: Request) {
  const userId = await currentUserId()
  if (!userId) return new Response(null, { status: 401 })

  const itemId = new URL(req.url).searchParams.get('itemId')
  if (!itemId) return Response.json({ error: 'itemId required' }, { status: 400 })

  const rows = await db.select().from(journals)
    .where(and(eq(journals.userId, userId), eq(journals.itemId, itemId)))
    .orderBy(desc(journals.updatedAt))

  return Response.json({ journals: rows })
}

/**
 * Autosave target — one journal per (user, item, bookmark). Called on a
 * debounce while typing, so it upserts rather than creating duplicates.
 *
 * An empty body deletes: a journal the reader has cleared should not linger
 * as an empty row cluttering /notes.
 */
export async function PUT(req: Request) {
  const userId = await currentUserId()
  if (!userId) return new Response(null, { status: 401 })

  const raw = await req.text()
  const parsed = Upsert.safeParse(JSON.parse(raw || '{}'))
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }
  const b = parsed.data

  const [item] = await db.select({ status: contentItems.status })
    .from(contentItems).where(eq(contentItems.id, b.itemId)).limit(1)
  if (!item || item.status !== 'published') return new Response(null, { status: 404 })

  // An anchored journal must point at a bookmark this user owns.
  if (b.bookmarkId) {
    const [bm] = await db.select({ id: bookmarks.id }).from(bookmarks)
      .where(and(eq(bookmarks.id, b.bookmarkId), eq(bookmarks.userId, userId))).limit(1)
    if (!bm) return new Response(null, { status: 404 })
  }

  const where = and(
    eq(journals.userId, userId),
    eq(journals.itemId, b.itemId),
    b.bookmarkId ? eq(journals.bookmarkId, b.bookmarkId) : isNull(journals.bookmarkId),
  )
  const [existing] = await db.select({ id: journals.id }).from(journals).where(where).limit(1)

  if (!b.bodyMd.trim()) {
    if (existing) await db.delete(journals).where(eq(journals.id, existing.id))
    return new Response(null, { status: 204 })
  }

  if (existing) {
    const [row] = await db.update(journals)
      .set({ bodyMd: b.bodyMd, updatedAt: new Date() })
      .where(eq(journals.id, existing.id)).returning()
    return Response.json({ journal: row })
  }

  const [row] = await db.insert(journals).values({
    userId, itemId: b.itemId, kind: b.kind,
    bookmarkId: b.bookmarkId ?? null, bodyMd: b.bodyMd,
  }).returning()
  return Response.json({ journal: row }, { status: 201 })
}
