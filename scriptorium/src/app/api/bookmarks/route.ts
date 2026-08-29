import { z } from 'zod'
import { and, desc, eq } from 'drizzle-orm'
import { db, bookmarks, contentItems, journals } from '@/db'
import { currentUserId } from '@/lib/session'

export const runtime = 'nodejs'

const Quad = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() })
const Anchor = z.object({
  quads: z.array(Quad),
  quotedText: z.string().min(1).max(5000),
  sourceChecksum: z.string(),
})

const Create = z.object({
  itemId: z.uuid(),
  kind: z.enum(['reading', 'listening']),
  page: z.number().int().positive().optional(),
  positionSeconds: z.number().nonnegative().optional(),
  textAnchor: Anchor.nullish(),
  label: z.string().max(300).optional(),
  color: z.enum(['yellow', 'green', 'blue', 'pink']).default('yellow'),
})

/** List this user's bookmarks for one item, newest first. */
export async function GET(req: Request) {
  const userId = await currentUserId()
  if (!userId) return new Response(null, { status: 401 })

  const itemId = new URL(req.url).searchParams.get('itemId')
  if (!itemId) return Response.json({ error: 'itemId required' }, { status: 400 })

  const rows = await db.select().from(bookmarks)
    .where(and(eq(bookmarks.userId, userId), eq(bookmarks.itemId, itemId)))
    .orderBy(desc(bookmarks.createdAt))

  return Response.json({ bookmarks: rows })
}

export async function POST(req: Request) {
  const userId = await currentUserId()
  if (!userId) return new Response(null, { status: 401 })

  const parsed = Create.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }
  const b = parsed.data

  // The DB check constraint enforces this too; failing here gives a real message.
  if (b.kind === 'reading' && b.page == null) {
    return Response.json({ error: 'reading bookmarks require a page' }, { status: 400 })
  }
  if (b.kind === 'listening' && b.positionSeconds == null) {
    return Response.json({ error: 'listening bookmarks require a position' }, { status: 400 })
  }

  const [item] = await db.select({ status: contentItems.status })
    .from(contentItems).where(eq(contentItems.id, b.itemId)).limit(1)
  if (!item || item.status !== 'published') return new Response(null, { status: 404 })

  const [row] = await db.insert(bookmarks).values({
    userId, itemId: b.itemId, kind: b.kind,
    page: b.page ?? null,
    positionSeconds: b.positionSeconds ?? null,
    textAnchor: b.textAnchor ?? null,
    label: b.label ?? null,
    color: b.color,
  }).returning()

  return Response.json({ bookmark: row }, { status: 201 })
}

export async function DELETE(req: Request) {
  const userId = await currentUserId()
  if (!userId) return new Response(null, { status: 401 })

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return Response.json({ error: 'id required' }, { status: 400 })

  // Detach journals first so a deleted bookmark never takes prose with it.
  await db.update(journals).set({ bookmarkId: null })
    .where(and(eq(journals.bookmarkId, id), eq(journals.userId, userId)))

  const deleted = await db.delete(bookmarks)
    .where(and(eq(bookmarks.id, id), eq(bookmarks.userId, userId)))
    .returning({ id: bookmarks.id })

  return deleted.length ? new Response(null, { status: 204 }) : new Response(null, { status: 404 })
}
