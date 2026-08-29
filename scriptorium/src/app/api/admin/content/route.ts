import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db, contentItems } from '@/db'
import { assertAdmin, adminErrorResponse } from '@/lib/admin'
import { ingestObject, InvalidUploadError } from '@/lib/ingest'
import { removeObject } from '@/lib/storage'
import { isContentKind, FORMATS } from '@/lib/content-format'

export const runtime = 'nodejs'
export const maxDuration = 60

const Body = z.object({
  path: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  kind: z.string().refine(isContentKind),
  title: z.string().min(1).max(300),
  description: z.string().max(4000).optional(),
  series: z.string().max(200).optional(),
  sortOrder: z.number().int().default(0),
  accessTier: z.enum(['free', 'subscriber']).default('subscriber'),
})

/** Ingest: validate the stored bytes, extract metadata, insert as draft (§7.2). */
export async function POST(req: Request) {
  try {
    await assertAdmin()
  } catch (e) {
    const r = adminErrorResponse(e); if (r) return r; throw e
  }

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }
  const b = parsed.data
  if (!isContentKind(b.kind)) return Response.json({ error: 'bad kind' }, { status: 400 })

  let meta
  try {
    meta = await ingestObject(b.path, b.kind)
  } catch (e) {
    // A file that fails validation must not be left sitting in the bucket.
    await removeObject(b.path).catch(() => {})
    if (e instanceof InvalidUploadError) {
      return Response.json({ error: e.message }, { status: 422 })
    }
    return Response.json({ error: 'Ingest failed.' }, { status: 500 })
  }

  const [row] = await db.insert(contentItems).values({
    slug: b.slug,
    kind: b.kind,
    title: b.title,
    description: b.description,
    series: b.series,
    sortOrder: b.sortOrder,
    storageBucket: 'content',
    storagePath: b.path,
    byteSize: meta.byteSize,
    checksum: meta.checksum,
    mimeType: FORMATS[b.kind].mimeType,
    pageCount: meta.pageCount,
    durationSeconds: meta.durationSeconds,
    accessTier: b.accessTier,
    status: 'draft',
  }).onConflictDoUpdate({
    target: contentItems.slug,
    set: {
      title: b.title, description: b.description, series: b.series,
      storagePath: b.path, byteSize: meta.byteSize, checksum: meta.checksum,
      pageCount: meta.pageCount, durationSeconds: meta.durationSeconds,
      updatedAt: new Date(),
    },
  }).returning()

  return Response.json({
    item: row,
    durationApproximate: meta.durationApproximate,
    rangeHonoured: meta.rangeHonoured,
  }, { status: 201 })
}

/** Publish / archive. */
export async function PATCH(req: Request) {
  try {
    await assertAdmin()
  } catch (e) {
    const r = adminErrorResponse(e); if (r) return r; throw e
  }
  const Patch = z.object({ id: z.uuid(), status: z.enum(['draft', 'published', 'archived']) })
  const parsed = Patch.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: 'bad request' }, { status: 400 })

  const [row] = await db.update(contentItems)
    .set({
      status: parsed.data.status,
      publishedAt: parsed.data.status === 'published' ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(contentItems.id, parsed.data.id))
    .returning()

  if (!row) return Response.json({ error: 'not found' }, { status: 404 })
  return Response.json({ item: row })
}
