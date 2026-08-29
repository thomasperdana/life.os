import { gateContent } from '@/lib/gate'
import { createDownloadUrl } from '@/lib/storage'
import type { ContentKind } from '@/lib/content-format'

export const runtime = 'nodejs'

/** Mints a signed streaming/reading URL. Never proxies bytes (§7.3). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const gate = await gateContent(id)
  if (!gate.ok) return Response.json({ error: gate.status }, { status: gate.status })

  const { url, expiresAt } = await createDownloadUrl(
    gate.item.storagePath,
    gate.item.kind as ContentKind,
  )
  return Response.json({ url, expiresAt: expiresAt.toISOString(), kind: gate.item.kind })
}
