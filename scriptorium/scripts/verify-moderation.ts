import { moderateReview } from '../src/lib/moderation'
const pass = (n: string, ok: boolean, x = '') => console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '  ' + x : ''}`)

console.log('\nCLEAN REVIEWS PASS THROUGH')
let m = moderateReview('A careful and genuinely useful study. I came back to it twice.')
pass('ordinary praise is clean', m.verdict === 'clean' && m.reasons.length === 0)

m = moderateReview('')
pass('rating with no prose is clean', m.verdict === 'clean')

console.log('\nDISAGREEMENT IS NOT ABUSE (§10.3)')
m = moderateReview('I think this reading of the passage is simply wrong, and here is why.')
pass('strong disagreement is clean', m.verdict === 'clean', m.reasons.join(', '))
m = moderateReview('Disappointing. It promised depth and delivered a summary.')
pass('a negative review is clean', m.verdict === 'clean', m.reasons.join(', '))

console.log('\nSPAM IS CAUGHT AND STRIPPED')
m = moderateReview('Great study! Check out my site at https://spam.example.com for more')
pass('link flagged', m.reasons.includes('contains a link'))
pass('link stripped from the text', m.cleaned.includes('[link removed]') && !m.cleaned.includes('spam.example'))

m = moderateReview('Email me at someone@example.com to discuss this study further please')
pass('email flagged and stripped',
  m.reasons.includes('contains an email address') && m.cleaned.includes('[contact removed]'))

m = moderateReview('Call me on +1 555 123 4567 and we can talk about this study')
pass('phone flagged and stripped',
  m.reasons.includes('contains a phone number') && m.cleaned.includes('[contact removed]'))

m = moderateReview('Visit www.buy-things.example now for a great deal on everything')
pass('bare www link caught', m.reasons.includes('contains a link'))

console.log('\nABUSE')
m = moderateReview('This is absolute shit and the author is a moron who wasted my time')
pass('abusive language flagged', m.reasons.includes('possible abusive language'))
pass('flagged, not silently deleted', m.verdict === 'flagged' && m.cleaned.length > 0)

console.log('\nLENGTH')
m = moderateReview('meh')
pass('too short is flagged', m.reasons.some(r => r.includes('shorter than')))
m = moderateReview('x'.repeat(5000))
pass('too long is flagged and truncated',
  m.reasons.some(r => r.includes('longer than')) && m.cleaned.length <= 4000)

console.log('\nCOMBINED')
m = moderateReview('shit study, email me at a@b.com or see https://x.example')
pass('all three reasons reported', m.reasons.length >= 3, m.reasons.join(' | '))
