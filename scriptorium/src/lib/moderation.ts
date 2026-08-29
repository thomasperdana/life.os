/**
 * Automated review moderation — SPEC.3.md §10.2.
 *
 * Pure, so the rules are testable and reviewable in one place. This pass is a
 * spam filter, not a taste filter: it catches links, contact details, and
 * abuse. A review that merely disagrees with you is clean, and §10.3 is the
 * standing reminder of why that matters.
 */

export type Moderation = {
  verdict: 'clean' | 'flagged'
  cleaned: string
  reasons: string[]
}

const SLURS_AND_ABUSE = [
  'fuck', 'shit', 'bitch', 'bastard', 'asshole', 'cunt', 'retard',
  'idiot', 'moron', 'scum',
]

// Built fresh per call: a shared /g regex carries `lastIndex` between .test()
// calls, which makes results depend on call order. That is a debugging trap.
const patterns = () => ({
  email: /\b[\w.+-]+@[\w-]+\.[\w.]{2,}\b/gi,
  url: /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|net|org|io|co|xyz|ru|info)\b\S*/gi,
  phone: /(?:\+?\d[\d\s().-]{7,}\d)/g,
})

export const MIN_BODY_LENGTH = 10
export const MAX_BODY_LENGTH = 4000

export function moderateReview(body: string | null | undefined): Moderation {
  const reasons: string[] = []
  const original = (body ?? '').trim()

  // A rating with no prose is a legitimate review; nothing to moderate.
  if (!original) return { verdict: 'clean', cleaned: '', reasons: [] }

  let cleaned = original
  const re = patterns()

  // Email FIRST. An address contains a domain, so the URL rule would otherwise
  // consume "someone@example.com" as a link and the email rule would never see it.
  if (re.email.test(cleaned)) reasons.push('contains an email address')
  cleaned = cleaned.replace(patterns().email, '[contact removed]')

  if (re.url.test(cleaned)) reasons.push('contains a link')
  cleaned = cleaned.replace(patterns().url, '[link removed]')

  if (re.phone.test(cleaned)) reasons.push('contains a phone number')
  cleaned = cleaned.replace(patterns().phone, '[contact removed]')

  const lower = cleaned.toLowerCase()
  const hit = SLURS_AND_ABUSE.find((w) => new RegExp(`\\b${w}`, 'i').test(lower))
  if (hit) reasons.push('possible abusive language')

  if (cleaned.replace(/\[.*?removed\]/g, '').trim().length < MIN_BODY_LENGTH) {
    reasons.push(`shorter than ${MIN_BODY_LENGTH} characters`)
  }
  if (original.length > MAX_BODY_LENGTH) {
    reasons.push(`longer than ${MAX_BODY_LENGTH} characters`)
    cleaned = cleaned.slice(0, MAX_BODY_LENGTH)
  }

  return {
    verdict: reasons.length ? 'flagged' : 'clean',
    cleaned,
    reasons,
  }
}
