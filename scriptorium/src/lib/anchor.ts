/**
 * Highlight anchoring and recovery — SPEC.3.md §8.3.
 *
 * A highlight stores BOTH geometry (quads, fast and exact) and the quoted text
 * (slow but durable). Geometry is meaningless the moment a PDF is re-uploaded
 * with different pagination; the quoted text is what survives. This module is
 * the recovery half, kept pure so it can be tested without a browser.
 */

export type Quad = { x: number; y: number; w: number; h: number }

export type TextAnchor = {
  /** Page-relative rectangles, in unscaled PDF units. */
  quads: Quad[]
  /** The exact text the reader selected. The durable half of the anchor. */
  quotedText: string
  /** Checksum of the PDF this anchor was captured against. */
  sourceChecksum: string
}

export type Recovery =
  | { status: 'exact'; page: number }
  | { status: 'relocated'; page: number; score: number }
  | { status: 'lost' }

/** Collapse the whitespace noise pdf.js text extraction produces. */
export function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Dice coefficient over character bigrams. Cheap, and good enough for prose. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1
  if (a.length < 2 || b.length < 2) return 0
  const bigrams = (s: string) => {
    const m = new Map<string, number>()
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2)
      m.set(g, (m.get(g) ?? 0) + 1)
    }
    return m
  }
  const A = bigrams(a), B = bigrams(b)
  let hits = 0
  for (const [g, n] of A) hits += Math.min(n, B.get(g) ?? 0)
  return (2 * hits) / (a.length - 1 + b.length - 1)
}

/**
 * Find where a quoted passage now lives.
 *
 * @param quotedText what the reader originally selected
 * @param pagesText  full text of each page, index 0 = page 1
 * @param originalPage the page it used to be on, used only to break ties
 */
export function recoverAnchor(
  quotedText: string,
  pagesText: string[],
  originalPage?: number,
): Recovery {
  const needle = normalizeForMatch(quotedText)
  if (!needle || pagesText.length === 0) return { status: 'lost' }

  // 1. Exact substring. Ties broken by proximity to the original page, because
  //    a repeated phrase should resolve to the nearest occurrence, not page 1.
  const exact: number[] = []
  pagesText.forEach((text, i) => {
    if (normalizeForMatch(text).includes(needle)) exact.push(i + 1)
  })
  if (exact.length === 1) return { status: 'exact', page: exact[0] }
  if (exact.length > 1) {
    const page = originalPage
      ? exact.reduce((best, p) =>
          Math.abs(p - originalPage) < Math.abs(best - originalPage) ? p : best)
      : exact[0]
    return { status: 'exact', page }
  }

  // 2. No exact hit: the text was edited, re-flowed, or split across pages.
  //    Score each page by the best similarity over a sliding window the size
  //    of the needle.
  let bestPage = 0
  let bestScore = 0
  pagesText.forEach((text, i) => {
    const hay = normalizeForMatch(text)
    if (!hay) return
    const win = needle.length
    const step = Math.max(1, Math.floor(win / 4))
    let local = 0
    for (let start = 0; start <= Math.max(0, hay.length - win); start += step) {
      local = Math.max(local, similarity(needle, hay.slice(start, start + win)))
      if (local > 0.95) break
    }
    if (hay.length < win) local = Math.max(local, similarity(needle, hay))
    if (local > bestScore) { bestScore = local; bestPage = i + 1 }
  })

  // Below this, a "match" is noise and claiming recovery would be a lie.
  if (bestScore >= 0.6 && bestPage > 0) {
    return { status: 'relocated', page: bestPage, score: Number(bestScore.toFixed(3)) }
  }
  return { status: 'lost' }
}

/** Does this anchor still describe the file we are looking at? */
export function anchorIsCurrent(anchor: TextAnchor | null, itemChecksum: string | null) {
  return Boolean(anchor && itemChecksum && anchor.sourceChecksum === itemChecksum)
}
