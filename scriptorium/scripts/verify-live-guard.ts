import { checkStripeKey } from '../src/lib/stripe-key-policy'
const pass = (n: string, ok: boolean, x = '') => console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '  ' + x : ''}`)

console.log('\nLIVE-KEY POLICY (§11)')
pass('live key in development is REFUSED',
  checkStripeKey('sk_live_x', 'development', undefined).ok === false)
pass('live key with no NODE_ENV is REFUSED',
  checkStripeKey('sk_live_x', undefined, undefined).ok === false)
pass('test key in development is allowed',
  checkStripeKey('sk_test_x', 'development', undefined).ok === true)
pass('live key in production is allowed',
  checkStripeKey('sk_live_x', 'production', undefined).ok === true)
pass('explicit override unlocks live in dev',
  checkStripeKey('sk_live_x', 'development', '1').ok === true)
pass('override must be exactly "1"',
  checkStripeKey('sk_live_x', 'development', 'true').ok === false)
pass('missing key is refused',
  checkStripeKey(undefined, 'production', undefined).ok === false)
const v = checkStripeKey('sk_live_x', 'development', undefined)
pass('refusal explains the fix',
  !v.ok && v.reason.includes('sk_test_'))
