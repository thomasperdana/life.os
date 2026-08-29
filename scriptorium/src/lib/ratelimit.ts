import 'server-only'
import { sql } from 'drizzle-orm'
import { db } from '@/db'

export type Limit = { allowed: boolean; remaining: number; resetAt: Date }

/**
 * Fixed-window rate limit — SPEC.3.md §11.
 *
 * Backed by Postgres rather than memory: serverless runs many instances, so an
 * in-process counter limits nothing. The window is advanced inside a row lock,
 * so concurrent requests cannot both slip past the ceiling.
 */
export async function rateLimit(
  bucket: string, limit: number, windowSeconds: number,
): Promise<Limit> {
  const rows = await db.execute<{ allowed: boolean; remaining: number; reset_at: string }>(
    sql`select * from public.rate_limit_hit(${bucket}, ${limit}, ${windowSeconds})`,
  )
  const r = (rows as unknown as Array<{ allowed: boolean; remaining: number; reset_at: string }>)[0]
  return { allowed: r.allowed, remaining: r.remaining, resetAt: new Date(r.reset_at) }
}

export function limitResponse(l: Limit) {
  return Response.json(
    { error: 'Too many requests.' },
    {
      status: 429,
      headers: {
        'Retry-After': String(Math.max(1, Math.ceil((l.resetAt.getTime() - Date.now()) / 1000))),
        'X-RateLimit-Remaining': '0',
      },
    },
  )
}
