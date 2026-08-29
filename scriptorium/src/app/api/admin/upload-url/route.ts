import { z } from 'zod'
import { assertAdmin, adminErrorResponse } from '@/lib/admin'
import { createUploadTicket } from '@/lib/storage'
import { isContentKind, slugify, storagePathFor, FORMATS } from '@/lib/content-format'

export const runtime = 'nodejs'

/** Supabase Pro ceiling is far higher; this is our own sanity bound (§7.2). */
const MAX_BYTES = 500 * 1024 * 1024

const Body = z.object({
  filename: z.string().min(1).max(255),
  kind: z.string().refine(isContentKind, 'kind must be pdf or audio'),
  size: z.number().int().positive(),
  slug: z.string().regex(/^[a-z0-9-]+$/).optional(),
})

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
  const { filename, kind, size } = parsed.data
  if (!isContentKind(kind)) return Response.json({ error: 'bad kind' }, { status: 400 })

  // Reject oversize BEFORE minting a ticket, so failure arrives in a second
  // rather than after a long upload (§7.2).
  if (size > MAX_BYTES) {
    return Response.json(
      { error: `File exceeds ${Math.round(MAX_BYTES / 1024 / 1024)} MB.` },
      { status: 413 },
    )
  }
  if (!filename.toLowerCase().endsWith(FORMATS[kind].extension)) {
    return Response.json(
      { error: `Expected a ${FORMATS[kind].extension} file for kind "${kind}".` },
      { status: 400 },
    )
  }

  const slug = parsed.data.slug ?? slugify(filename)
  const path = storagePathFor(kind, slug)
  const ticket = await createUploadTicket(path)

  return Response.json({ ...ticket, slug, kind, bucket: 'content' })
}
