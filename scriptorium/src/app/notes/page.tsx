import Link from 'next/link'
import { redirect } from 'next/navigation'
import { sql } from 'drizzle-orm'
import { db } from '@/db'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

type Row = {
  kind: 'bookmark' | 'journal'
  id: string
  itemSlug: string
  itemTitle: string
  itemKind: 'pdf' | 'audio'
  markKind: 'reading' | 'listening'
  page: number | null
  positionSeconds: number | null
  body: string
  at: Date
}

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

export default async function NotesPage({
  searchParams,
}: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/signin?next=/notes')

  const query = (q ?? '').trim()

  /**
   * One list, both halves of the library, both kinds of mark (§12).
   *
   * `websearch_to_tsquery` is used rather than `plainto_tsquery` so quoted
   * phrases and -exclusions behave the way anyone who has used a search box
   * expects.
   */
  const rows = await db.execute<Row>(sql`
    with b as (
      select 'bookmark'::text as kind, bm.id::text as id,
             ci.slug as "itemSlug", ci.title as "itemTitle", ci.kind as "itemKind",
             bm.kind::text as "markKind", bm.page, bm.position_seconds as "positionSeconds",
             coalesce(bm.text_anchor ->> 'quotedText', bm.label, '') as body,
             bm.created_at as at,
             to_tsvector('english', coalesce(bm.text_anchor ->> 'quotedText','') || ' ' || coalesce(bm.label,'')) as tsv
      from public.bookmarks bm
      join public.content_items ci on ci.id = bm.item_id
      where bm.user_id = ${user.id}
    ),
    j as (
      select 'journal'::text as kind, jr.id::text as id,
             ci.slug as "itemSlug", ci.title as "itemTitle", ci.kind as "itemKind",
             jr.kind::text as "markKind", null::int as page, null::real as "positionSeconds",
             jr.body_md as body, jr.updated_at as at,
             to_tsvector('english', jr.body_md) as tsv
      from public.journals jr
      join public.content_items ci on ci.id = jr.item_id
      where jr.user_id = ${user.id}
    ),
    all_rows as (select * from b union all select * from j)
    select kind, id, "itemSlug", "itemTitle", "itemKind", "markKind", page, "positionSeconds", body, at
    from all_rows
    where ${query ? sql`tsv @@ websearch_to_tsquery('english', ${query})` : sql`true`}
    order by at desc
    limit 200
  `)

  const results = rows as unknown as Row[]

  return (
    <main className="mx-auto max-w-3xl px-6 py-12 pb-32 space-y-8">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Notes</h1>
        <Link href="/library" className="text-sm text-black/60 dark:text-white/60 hover:underline">Library →</Link>
      </div>

      <form className="flex gap-2">
        <input
          name="q" defaultValue={query} placeholder="Search your bookmarks and journals…"
          aria-label="Search notes"
          className="flex-1 rounded-md border border-black/15 dark:border-white/20 bg-transparent px-3 py-2 text-sm"
        />
        <button className="rounded-md bg-foreground text-background px-4 py-2 text-sm font-medium">Search</button>
        {query && (
          <Link href="/notes" className="rounded-md border border-black/20 dark:border-white/25 px-4 py-2 text-sm">
            Clear
          </Link>
        )}
      </form>

      <p className="text-sm text-black/50 dark:text-white/50" data-testid="notes-count">
        {results.length} {results.length === 1 ? 'note' : 'notes'}
        {query ? ` matching “${query}”` : ' across your library'}
      </p>

      <ul className="space-y-3">
        {results.map((r) => {
          const href = r.itemKind === 'pdf'
            ? `/read/${r.itemSlug}${r.page ? `?page=${r.page}` : ''}`
            : `/listen/${r.itemSlug}${r.positionSeconds != null ? `?t=${Math.floor(r.positionSeconds)}` : ''}`
          const anchor = r.itemKind === 'pdf'
            ? (r.page ? `Page ${r.page}` : null)
            : (r.positionSeconds != null ? fmtTime(r.positionSeconds) : null)
          return (
            <li key={`${r.kind}-${r.id}`}>
              <Link href={href}
                className="block rounded-lg border border-black/10 dark:border-white/15 p-4 space-y-1.5 hover:border-black/30 dark:hover:border-white/40 transition-colors">
                <p className="text-xs uppercase tracking-wide text-black/50 dark:text-white/50">
                  {r.kind} · {r.itemTitle}{anchor ? ` · ${anchor}` : ''}
                </p>
                <p className={`text-sm whitespace-pre-wrap line-clamp-4 ${
                  r.kind === 'bookmark' ? 'border-l-2 border-amber-400 pl-2' : ''}`}>
                  {r.body}
                </p>
              </Link>
            </li>
          )
        })}
      </ul>

      {results.length === 0 && (
        <p className="text-sm text-black/50 dark:text-white/50">
          {query ? 'Nothing matched. Try fewer words.' : 'Bookmarks and journals you make will collect here.'}
        </p>
      )}
    </main>
  )
}
