import { notFound, redirect } from 'next/navigation'
import { and, eq } from 'drizzle-orm'
import Link from 'next/link'
import { db, contentItems, progress } from '@/db'
import { createClient } from '@/lib/supabase/server'
import { getEntitlement, canAccess } from '@/lib/entitlement'
import { ListenClient } from './ListenClient'

export const dynamic = 'force-dynamic'

export default async function ListenPage({
  params, searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ t?: string }>
}) {
  const { slug } = await params
  const { t } = await searchParams

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/signin?next=/listen/${slug}`)

  const [item] = await db.select().from(contentItems)
    .where(eq(contentItems.slug, slug)).limit(1)
  if (!item || item.status !== 'published' || item.kind !== 'audio') notFound()

  const entitlement = await getEntitlement(user.id)
  if (!canAccess(entitlement, item.accessTier)) {
    return (
      <main className="mx-auto max-w-lg px-6 py-24 text-center space-y-4">
        <h1 className="text-xl font-semibold">Subscribers only</h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          “{item.title}” is part of the subscriber library.
        </p>
        <Link href="/account" className="inline-block rounded-md bg-foreground text-background px-4 py-2 text-sm font-medium">
          See subscription options
        </Link>
      </main>
    )
  }

  const [saved] = await db.select().from(progress)
    .where(and(eq(progress.userId, user.id), eq(progress.itemId, item.id))).limit(1)

  // Same pattern as the reader (§8.2): the resume decision is made server-side
  // and expressed in the URL, so it is shareable and needs no client state.
  const explicit = t ? Number(t) : undefined
  const startAt = Number.isFinite(explicit) ? explicit : undefined
  const offerResume = !t && saved?.positionSeconds != null && saved.positionSeconds > 30

  return (
    <ListenClient
      itemId={item.id}
      slug={item.slug}
      title={item.title}
      series={item.series}
      durationSeconds={item.durationSeconds}
      startAt={startAt}
      savedPosition={offerResume ? saved!.positionSeconds! : null}
      savedPercent={saved?.percent ?? null}
    />
  )
}
