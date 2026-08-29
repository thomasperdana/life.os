import Link from 'next/link'
import { redirect } from 'next/navigation'
import { and, asc, eq } from 'drizzle-orm'
import { db, contentItems } from '@/db'
import { createClient } from '@/lib/supabase/server'
import { getEntitlement } from '@/lib/entitlement'
import { signOut } from '../(auth)/actions'

export default async function LibraryPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/signin?next=/library')

  // Fence one (§5.2): entitlement is decided here, on the server, every time.
  const entitlement = await getEntitlement(user.id)

  const items = await db
    .select()
    .from(contentItems)
    .where(eq(contentItems.status, 'published'))
    .orderBy(asc(contentItems.series), asc(contentItems.sortOrder))

  return (
    <main className="mx-auto max-w-5xl px-6 py-12 space-y-10">
      <header className="flex items-start justify-between gap-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Library</h1>
          <p className="text-sm text-black/60 dark:text-white/60">
            {user.email} · {entitlement === 'subscriber' ? 'Subscriber' : 'Free account'}
          </p>
        </div>
        <form action={signOut}>
          <button className="text-sm underline underline-offset-4 text-black/60 dark:text-white/60">
            Sign out
          </button>
        </form>
      </header>

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-black/15 dark:border-white/20 px-6 py-16 text-center space-y-2">
          <p className="font-medium">Nothing published yet</p>
          <p className="text-sm text-black/60 dark:text-white/60">
            Upload a PDF or an MP3 from the admin area, then publish it. It shows up here.
          </p>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => {
            const locked = item.accessTier === 'subscriber' && entitlement === 'free'
            const href = item.kind === 'pdf' ? `/read/${item.slug}` : `/listen/${item.slug}`
            const body = (
              <>
                <p className="text-xs uppercase tracking-wide text-black/50 dark:text-white/50">
                  {item.kind} {item.series ? `· ${item.series}` : ''}
                </p>
                <h2 className="font-medium leading-snug">{item.title}</h2>
                <p className="text-xs text-black/50 dark:text-white/50 tabular-nums">
                  {item.kind === 'pdf'
                    ? item.pageCount ? `${item.pageCount} pages` : ''
                    : item.durationSeconds ? `${Math.round(item.durationSeconds / 60)} min` : ''}
                </p>
                {locked && <p className="text-xs text-amber-700 dark:text-amber-400">Subscribers only</p>}
              </>
            )
            return (
              <li key={item.id}>
                {locked ? (
                  <div className="rounded-lg border border-black/10 dark:border-white/15 p-4 space-y-2 opacity-70">
                    {body}
                  </div>
                ) : (
                  <Link href={href}
                    className="block rounded-lg border border-black/10 dark:border-white/15 p-4 space-y-2 hover:border-black/30 dark:hover:border-white/40 transition-colors">
                    {body}
                  </Link>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </main>
  )
}
