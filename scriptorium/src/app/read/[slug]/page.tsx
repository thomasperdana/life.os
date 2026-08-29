import { notFound, redirect } from 'next/navigation'
import { and, eq } from 'drizzle-orm'
import Link from 'next/link'
import { db, contentItems, progress } from '@/db'
import { createClient } from '@/lib/supabase/server'
import { getEntitlement, canAccess } from '@/lib/entitlement'
import { createDownloadUrl } from '@/lib/storage'
import { PdfReaderClient } from './PdfReaderClient'

export const dynamic = 'force-dynamic'

export default async function ReadPage({
  params, searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ page?: string }>
}) {
  const { slug } = await params
  const { page: pageParam } = await searchParams

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/signin?next=/read/${slug}`)

  const [item] = await db.select().from(contentItems)
    .where(eq(contentItems.slug, slug)).limit(1)

  // Draft/archived items 404 for everyone, subscribers included (§7.3).
  if (!item || item.status !== 'published' || item.kind !== 'pdf') notFound()

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

  // Session-length TTL: pdf.js range-fetches across the whole read (§7.3).
  const { url, expiresAt } = await createDownloadUrl(item.storagePath, 'pdf', { purpose: 'read' })

  const [saved] = await db.select().from(progress)
    .where(and(eq(progress.userId, user.id), eq(progress.itemId, item.id))).limit(1)

  // The resume decision is made on the server and expressed as ?page=N, so the
  // banner is server-rendered (no flash, no pdf.js dependency) and a resumed
  // position is a shareable, bookmarkable URL.
  const explicitPage = pageParam ? Number(pageParam) : undefined
  const initialPage = Number.isFinite(explicitPage) && explicitPage! > 0 ? explicitPage : undefined
  const offerResume = !pageParam && saved?.page != null && saved.page > 1

  return (
    <>
      {offerResume && (
        <div role="status"
          className="mx-auto mt-4 flex w-fit items-center gap-3 rounded-lg border border-black/15 dark:border-white/20 px-4 py-2.5 text-sm">
          <span>
            Continue from page {saved!.page}
            {saved!.percent ? ` (${Math.round(saved!.percent)}%)` : ''}?
          </span>
          <Link href={`/read/${slug}?page=${saved!.page}`}
            className="rounded bg-foreground text-background px-3 py-1 text-xs font-medium">Resume</Link>
          <Link href={`/read/${slug}?page=1`}
            className="text-xs text-black/50 dark:text-white/50 hover:underline">Start over</Link>
        </div>
      )}
      <PdfReaderClient
        itemId={item.id}
        title={item.title}
        fileUrl={url}
        urlExpiresAt={expiresAt.toISOString()}
        totalPages={item.pageCount ?? undefined}
        initialPage={initialPage}
      />
    </>
  )
}
