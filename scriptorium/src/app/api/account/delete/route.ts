import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db, subscriptions } from '@/db'
import { currentUserId } from '@/lib/session'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'

const Body = z.object({ confirm: z.literal('DELETE') })

/**
 * GDPR erasure — SPEC.3.md §11.
 *
 * Deleting the auth user cascades through every table, because every one of
 * them carries `on delete cascade` back to auth.users (§6). What does NOT
 * cascade is Stripe: the customer record lives at Stripe and must be handled
 * there, so the response says so rather than pretending otherwise.
 */
export async function POST(req: Request) {
  const userId = await currentUserId()
  if (!userId) return new Response(null, { status: 401 })

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return Response.json({ error: 'Send {"confirm":"DELETE"} to proceed.' }, { status: 400 })
  }

  const [sub] = await db.select({ customerId: subscriptions.stripeCustomerId })
    .from(subscriptions).where(eq(subscriptions.userId, userId)).limit(1)

  const admin = createAdminClient()
  const { error } = await admin.auth.admin.deleteUser(userId)
  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({
    deleted: true,
    stripeCustomer: sub?.customerId ?? null,
    note: sub?.customerId
      ? 'Local data erased. The Stripe customer record is retained for financial ' +
        'record-keeping and must be deleted in Stripe if required.'
      : 'Local data erased. No billing record existed.',
  })
}
