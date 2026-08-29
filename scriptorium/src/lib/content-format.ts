// Pure format registry: no secrets, no I/O. Safe on either side of the wire,
// which is also what makes it directly testable.
/**
 * Accepted upload formats — SPEC.3.md §7.2.
 *
 * Extension and Content-Type both come from the browser and both are trivially
 * forged. Validation is by magic bytes, read back from the stored object.
 */
export type ContentKind = 'pdf' | 'audio'

export const FORMATS = {
  pdf: {
    extension: '.pdf',
    mimeType: 'application/pdf',
    folder: 'pdf',
    /** "%PDF" */
    matches: (b: Uint8Array) =>
      b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46,
    describe: '%PDF',
  },
  audio: {
    extension: '.mp3',
    mimeType: 'audio/mpeg',
    folder: 'audio',
    /** "ID3" tag, or an MPEG frame sync (0xFF 0xEx/0xFx) */
    matches: (b: Uint8Array) =>
      (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) ||
      (b[0] === 0xff && (b[1] & 0xe0) === 0xe0),
    describe: 'ID3 or MPEG frame sync',
  },
} as const satisfies Record<ContentKind, {
  extension: string; mimeType: string; folder: string
  matches: (b: Uint8Array) => boolean; describe: string
}>

export function isContentKind(v: unknown): v is ContentKind {
  return v === 'pdf' || v === 'audio'
}

/** Storage path for an item. Slug is already validated as URL-safe. */
export function storagePathFor(kind: ContentKind, slug: string) {
  return `${FORMATS[kind].folder}/${slug}${FORMATS[kind].extension}`
}

export function slugify(filename: string) {
  return filename
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80) || 'untitled'
}
