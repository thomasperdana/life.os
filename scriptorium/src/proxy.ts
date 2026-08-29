import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const SUPABASE_ORIGIN = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://localhost').origin

/**
 * Content Security Policy — SPEC.3.md §11.
 *
 * Two entries are load-bearing and non-obvious:
 *  - `worker-src blob:` — pdf.js runs its parser in a worker created from a
 *    blob URL. Without it the reader silently renders nothing.
 *  - `media-src`/`img-src` must include the Supabase origin, because signed
 *    URLs point there, and `blob:` for canvas-rendered pages.
 */
function securityHeaders(isDev: boolean): Record<string, string> {
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    `img-src 'self' data: blob: ${SUPABASE_ORIGIN}`,
    `media-src 'self' blob: ${SUPABASE_ORIGIN}`,
    `connect-src 'self' ${SUPABASE_ORIGIN}${isDev ? ' ws: http://localhost:*' : ''}`,
    "font-src 'self' data:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self' https://checkout.stripe.com https://billing.stripe.com",
    "object-src 'none'",
  ].join('; ')

  return {
    'Content-Security-Policy': csp,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'geolocation=(), camera=(), microphone=(), payment=()',
    ...(process.env.NODE_ENV === 'production'
      ? { 'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload' }
      : {}),
  }
}

const PROTECTED = ['/library', '/notes', '/account', '/read', '/listen', '/admin']

/**
 * Refreshes the Supabase session on every request and guards protected routes.
 * Server Components cannot write cookies, so token refresh must happen here.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          toSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
        },
      },
    },
  )

  // getUser() revalidates against Supabase. Never trust getSession() here.
  const { data: { user } } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl
  if (!user && PROTECTED.some((p) => pathname.startsWith(p))) {
    const url = request.nextUrl.clone()
    url.pathname = '/signin'
    url.searchParams.set('next', pathname)
    const redirect = NextResponse.redirect(url)
    for (const [k, v] of Object.entries(securityHeaders(process.env.NODE_ENV !== 'production'))) {
      redirect.headers.set(k, v)
    }
    return redirect
  }

  for (const [k, v] of Object.entries(securityHeaders(process.env.NODE_ENV !== 'production'))) {
    response.headers.set(k, v)
  }
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
