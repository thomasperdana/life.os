import { z } from 'zod'
import { claimUnit } from '@/lib/entitlement'
import { currentUserId } from '@/lib/session'
import { rateLimit, limitResponse } from '@/lib/ratelimit'

export const runtime = 'nodejs'

const MESSAGES: Record<string, { status: number; text: string }> = {
  not_found:     { status: 404, text: 'That study is not available.' },
  free_item:     { status: 400, text: 'That study is already free — no slot needed.' },
  already_owned: { status: 409, text: 'You already own that study.' },
  no_slots:      { status: 402, text: 'No slots left. The Unlimited plan covers everything.' },
  subscription:  { status: 400, text: 'Your subscription already covers everything.' },
}

export async function POST(req: Request) {
  const userId = await currentUserId()
  if (!userId) return new Response(null, { status: 401 })

  const limited = await rateLimit(`claim:${userId}`, 30, 3600)
  if (!limited.allowed) return limitResponse(limited)

  const parsed = z.object({ itemId: z.uuid() }).safeParse(await req.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: 'bad request' }, { status: 400 })

  const result = await claimUnit(userId, parsed.data.itemId)
  if (!result.ok) {
    const m = MESSAGES[result.error]
    return Response.json({ error: m.text }, { status: m.status })
  }
  return Response.json({ unitKey: result.unitKey, remaining: result.remaining })
}
