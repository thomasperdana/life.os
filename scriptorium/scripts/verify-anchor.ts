import { recoverAnchor, normalizeForMatch, similarity } from '../src/lib/anchor'
const pass = (n: string, ok: boolean, x = '') => console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '  ' + x : ''}`)

// An 8-page book, then the "re-uploaded" edition where a new page 2 was
// inserted, shifting everything after it by one.
const original = [
  'Chapter 1. In the beginning of the work there was a plan.',
  'Chapter 2. The plan required patience and a great deal of care.',
  'Chapter 3. Consider the lilies of the field, how they grow.',
  'Chapter 4. And the evening and the morning were the first day.',
]
const reuploaded = [
  'Chapter 1. In the beginning of the work there was a plan.',
  'Preface added in the second edition. Some notes for the reader.',
  'Chapter 2. The plan required patience and a great deal of care.',
  'Chapter 3. Consider the lilies of the field, how they grow.',
  'Chapter 4. And the evening and the morning were the first day.',
]

console.log('\nNORMALIZATION')
pass('collapses whitespace',   normalizeForMatch('a   b\n\nc') === 'a b c')
pass('normalizes smart quotes', normalizeForMatch('“it’s”') === '"it\'s"')

console.log('\nSIMILARITY')
pass('identical = 1', similarity('hello world', 'hello world') === 1)
pass('unrelated is low', similarity('hello world', 'zzz qqq xxx') < 0.2)

console.log('\nEXACT MATCH, UNCHANGED FILE')
let r = recoverAnchor('Consider the lilies of the field', original, 3)
pass('finds original page', r.status === 'exact' && r.page === 3, JSON.stringify(r))

console.log('\nTHE P3 ACCEPTANCE CRITERION — highlight survives a re-upload')
r = recoverAnchor('Consider the lilies of the field', reuploaded, 3)
pass('relocates page 3 -> 4 after insertion', r.status === 'exact' && r.page === 4, JSON.stringify(r))
r = recoverAnchor('the evening and the morning', reuploaded, 4)
pass('relocates page 4 -> 5 after insertion', r.status === 'exact' && r.page === 5, JSON.stringify(r))
r = recoverAnchor('In the beginning of the work', reuploaded, 1)
pass('unmoved text stays on page 1', r.status === 'exact' && r.page === 1, JSON.stringify(r))

console.log('\nEDITED TEXT (fuzzy relocation)')
const edited = [...reuploaded]
edited[3] = 'Chapter 3. Consider well the lilies of the field, and how they grow.'
r = recoverAnchor('Consider the lilies of the field', edited, 3)
pass('recovers lightly edited passage', r.status === 'relocated' && r.page === 4,
     JSON.stringify(r))

console.log('\nHONEST FAILURE')
r = recoverAnchor('a passage that was deleted entirely from the book', edited, 2)
pass('reports lost rather than guessing', r.status === 'lost', JSON.stringify(r))
r = recoverAnchor('anything', [], 1)
pass('empty document -> lost', r.status === 'lost')

console.log('\nREPEATED TEXT — nearest occurrence wins')
const repeated = ['the word', 'filler', 'the word', 'filler', 'the word']
r = recoverAnchor('the word', repeated, 5)
pass('ties break toward the original page', r.status === 'exact' && r.page === 5, JSON.stringify(r))
r = recoverAnchor('the word', repeated, 1)
pass('and toward page 1 when that was the origin', r.status === 'exact' && r.page === 1, JSON.stringify(r))
