import 'server-only'
import { PDFDocument } from 'pdf-lib'
import { parseBuffer } from 'music-metadata'
import type { ContentKind } from '@/lib/content-format'
import { readPrefix, readWhole, validateSignature } from '@/lib/storage'

/** Above this, parse a bounded prefix rather than pulling the whole object. */
const WHOLE_FILE_LIMIT = 25 * 1024 * 1024

export type IngestResult = {
  byteSize: number
  checksum: string
  pageCount: number | null
  durationSeconds: number | null
  durationApproximate: boolean
  rangeHonoured: boolean
}

export class InvalidUploadError extends Error {}

/**
 * Validates a freshly uploaded object and extracts its metadata — §7.2.
 *
 * Ingest is a rare admin action, so pulling the whole file here is acceptable;
 * the "never proxy a file through a function" rule governs SERVING, not ingest.
 * Large audio still takes the prefix path to stay inside function limits.
 */
export async function ingestObject(path: string, kind: ContentKind): Promise<IngestResult> {
  const prefix = await readPrefix(path, kind)

  const sig = validateSignature(prefix.buffer, kind)
  if (!sig.ok) {
    throw new InvalidUploadError(
      `File is not a valid ${kind}. Expected signature: ${sig.expected}.`,
    )
  }

  const size = prefix.totalSize
  const small = size > 0 && size <= WHOLE_FILE_LIMIT
  const whole = small ? await readWhole(path, kind) : null
  const bytes = whole ?? prefix.buffer

  let pageCount: number | null = null
  let durationSeconds: number | null = null
  let durationApproximate = false

  if (kind === 'pdf') {
    if (!whole) throw new InvalidUploadError('PDF exceeds the ingest size limit.')
    pageCount = (await PDFDocument.load(whole, { updateMetadata: false })).getPageCount()
  } else {
    const meta = await parseBuffer(bytes, { mimeType: 'audio/mpeg' }, { duration: true })
    const parsed = meta.format.duration ?? null
    if (parsed != null && whole) {
      durationSeconds = Math.round(parsed)
    } else if (meta.format.bitrate && size > 0) {
      // Prefix-only: estimate from bitrate. Honest, and flagged as such.
      durationSeconds = Math.round((size * 8) / meta.format.bitrate)
      durationApproximate = true
    }
  }

  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer)
  const checksum = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0')).join('')

  return {
    byteSize: size || bytes.byteLength,
    checksum: whole ? checksum : `prefix:${checksum}`,
    pageCount,
    durationSeconds,
    durationApproximate,
    rangeHonoured: prefix.rangeHonoured,
  }
}
