import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { FORMATS, type ContentKind } from '@/lib/content-format'

export const CONTENT_BUCKET = 'content'

/**
 * Signed-URL TTLs — SPEC.3.md §7.3, §8.6.
 *
 * TTL is a function of (kind, purpose), not kind alone. The spec's original
 * "PDF = 5 minutes, it's fetched once immediately" holds for DOWNLOAD, but not
 * for READ: pdf.js lazily fetches page ranges across a whole session, so a
 * 5-minute URL dies mid-read on any large document. Reading gets a session-
 * length TTL; downloading keeps the short one.
 */
export type UrlPurpose = 'read' | 'download'

export const TTL_SECONDS: Record<ContentKind, Record<UrlPurpose, number>> = {
  pdf:   { read: 2 * 60 * 60, download: 5 * 60 },
  audio: { read: 4 * 60 * 60, download: 4 * 60 * 60 },
}

export async function createUploadTicket(path: string) {
  const supabase = createAdminClient()
  const { data, error } = await supabase.storage
    .from(CONTENT_BUCKET)
    .createSignedUploadUrl(path, { upsert: true })
  if (error) throw new Error(`createSignedUploadUrl: ${error.message}`)
  return data // { signedUrl, token, path }
}

export async function createDownloadUrl(
  path: string,
  kind: ContentKind,
  opts?: { download?: string; purpose?: UrlPurpose },
) {
  const purpose: UrlPurpose = opts?.purpose ?? (opts?.download ? 'download' : 'read')
  const ttl = TTL_SECONDS[kind][purpose]
  const supabase = createAdminClient()
  const { data, error } = await supabase.storage
    .from(CONTENT_BUCKET)
    .createSignedUrl(path, ttl, opts?.download ? { download: opts.download } : undefined)
  if (error) throw new Error(`createSignedUrl: ${error.message}`)
  return { url: data.signedUrl, expiresAt: new Date(Date.now() + ttl * 1000), ttl }
}

export async function removeObject(path: string) {
  const supabase = createAdminClient()
  await supabase.storage.from(CONTENT_BUCKET).remove([path])
}

/**
 * Reads the first `bytes` of a stored object via an HTTP range request.
 *
 * Doubles as the live probe for the §4.4 range-request gate: a 206 proves
 * Supabase honours Range, which audio seeking depends on entirely.
 */
export async function readPrefix(path: string, kind: ContentKind, bytes = 64 * 1024) {
  const { url } = await createDownloadUrl(path, kind, { purpose: 'read' })
  const res = await fetch(url, { headers: { Range: `bytes=0-${bytes - 1}` } })
  if (!res.ok) throw new Error(`readPrefix: HTTP ${res.status}`)
  return {
    buffer: new Uint8Array(await res.arrayBuffer()),
    rangeHonoured: res.status === 206,
    totalSize: Number(res.headers.get('content-range')?.split('/')[1] ?? res.headers.get('content-length') ?? 0),
  }
}

/** Full object fetch. Ingest only — never on a serving path (§7.3). */
export async function readWhole(path: string, kind: ContentKind) {
  const { url } = await createDownloadUrl(path, kind, { purpose: 'read' })
  const res = await fetch(url)
  if (!res.ok) throw new Error(`readWhole: HTTP ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}

/** Magic-byte check (§7.2). The client's extension and MIME are not evidence. */
export function validateSignature(buffer: Uint8Array, kind: ContentKind) {
  const ok = FORMATS[kind].matches(buffer)
  return ok
    ? { ok: true as const }
    : { ok: false as const, expected: FORMATS[kind].describe }
}
