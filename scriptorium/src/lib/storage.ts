import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { FORMATS, type ContentKind } from '@/lib/content-format'

export const CONTENT_BUCKET = 'content'

/** Signed-URL TTLs — SPEC.3.md §7.3, §8.6. */
export const TTL_SECONDS = {
  /** Fetched once, immediately. A leaked URL dies within a coffee break. */
  pdf: 5 * 60,
  /** A long listen must not expire mid-session. */
  audio: 4 * 60 * 60,
} as const satisfies Record<ContentKind, number>

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
  opts?: { download?: string },
) {
  const supabase = createAdminClient()
  const { data, error } = await supabase.storage
    .from(CONTENT_BUCKET)
    .createSignedUrl(path, TTL_SECONDS[kind], opts)
  if (error) throw new Error(`createSignedUrl: ${error.message}`)
  return { url: data.signedUrl, expiresAt: new Date(Date.now() + TTL_SECONDS[kind] * 1000) }
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
  const { url } = await createDownloadUrl(path, kind)
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
  const { url } = await createDownloadUrl(path, kind)
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
