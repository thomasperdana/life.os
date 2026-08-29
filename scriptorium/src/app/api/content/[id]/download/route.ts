import { createHash } from 'node:crypto'
import { db, downloadEvents } from '@/db'
import { gateContent } from '@/lib/gate'
import { rateLimit, limitResponse } from '@/lib/ratelimit'
import { currentUserId } from '@/lib/session'
import { createDownloadUrl, readWhole } from '@/lib/storage'
import { watermarkPdf } from '@/lib/watermark'
import type { ContentKind } from '@/lib/content-format'

export const runtime = 'nodejs'
export const maxDuration = 60

const WATERMARK_PDFS = process.env.WATERMARK_PDFS !== 'false'

/**
 * Gated file download — §8.1 (PDF) and §8.6 (MP3).
 *
 * Audio ALWAYS redirects. PDFs redirect too, unless watermarking is on, which
 * is the one case where modifying bytes per user justifies proxying (§8.1).
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const limited = await rateLimit(`dl:${id}:${(await currentUserId()) ?? 'anon'}`, 20, 3600)
  if (!limited.allowed) return limitResponse(limited)

  const gate = await gateContent(id)
  if (!gate.ok) return Response.json({ error: gate.status }, { status: gate.status })

  const { item, userId } = gate
  const kind = item.kind as ContentKind

  const ipHash = createHash('sha256')
    .update(req.headers.get('x-forwarded-for') ?? 'unknown')
    .digest('hex').slice(0, 32)

  await db.insert(downloadEvents).values({
    userId, itemId: item.id, ipHash,
    userAgent: req.headers.get('user-agent')?.slice(0, 500) ?? null,
  })

  const filename = `${item.slug}${kind === 'pdf' ? '.pdf' : '.mp3'}`

  if (kind === 'pdf' && WATERMARK_PDFS) {
    const bytes = await readWhole(item.storagePath, kind)
    const stamped = await watermarkPdf(bytes, {
      userId, itemId: item.id, downloadedAt: new Date(),
    })
    return new Response(stamped as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, no-store',
      },
    })
  }

  const { url } = await createDownloadUrl(item.storagePath, kind, { download: filename })
  return Response.redirect(url, 302)
}
