import { gateContent } from '@/lib/gate'
import { rateLimit, limitResponse } from '@/lib/ratelimit'
import { currentUserId } from '@/lib/session'
import { createDownloadUrl } from '@/lib/storage'
import type { ContentKind } from '@/lib/content-format'
import type { UrlPurpose } from '@/lib/storage'

export const runtime = 'nodejs'

/** Mints a signed streaming/reading URL. Never proxies bytes (§7.3). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const q = new URL(req.url).searchParams.get('purpose')
  const purpose: UrlPurpose = q === 'download' ? 'download' : 'read'
  const limited = await rateLimit(`url:${id}:${(await currentUserId()) ?? 'anon'}`, 120, 60)
  if (!limited.allowed) return limitResponse(limited)

  const gate = await gateContent(id)
  if (!gate.ok) return Response.json({ error: gate.status }, { status: gate.status })

  const { url, expiresAt, ttl } = await createDownloadUrl(
    gate.item.storagePath,
    gate.item.kind as ContentKind,
    { purpose },
  )
  return Response.json({ url, expiresAt: expiresAt.toISOString(), ttl, kind: gate.item.kind })
}
