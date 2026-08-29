'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePlayer } from '@/app/player/PlayerProvider'
import { useMarks } from '@/app/marks/useMarks'
import { MarksPanel } from '@/app/marks/MarksPanel'

/**
 * You always realise a passage mattered slightly AFTER it started, so a mark
 * captures a few seconds before the button was pressed (SPEC.3.md §8.7).
 */
const LEAD_IN_SECONDS = 5

const fmt = (s: number) => {
  const m = Math.floor(s / 60)
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

export function ListenClient(props: {
  itemId: string; slug: string; title: string; series: string | null
  durationSeconds: number | null; startAt?: number
  savedPosition: number | null; savedPercent: number | null
}) {
  const player = usePlayer()
  const loaded = useRef(false)
  const marks = useMarks(props.itemId, 'listening')
  const [panelOpen, setPanelOpen] = useState(false)

  // Listening marks anchor to a timestamp, so there is nothing to recover.
  const recovery = useMemo(() => new Map<string, { page: number; approximate: boolean } | null>(), [])

  // Load once. If this track is already playing (the listener navigated away
  // and came back), leave it alone rather than restarting it.
  useEffect(() => {
    if (loaded.current) return
    if (player.track?.itemId === props.itemId) { loaded.current = true; return }
    loaded.current = true
    player.load({
      itemId: props.itemId, slug: props.slug, title: props.title,
      series: props.series, durationSeconds: props.durationSeconds,
      startAt: props.startAt,
    })
  }, [player, props])

  const isCurrent = player.track?.itemId === props.itemId

  return (
    <main className="mx-auto max-w-2xl px-6 py-12 pb-32 space-y-8">
      <Link href="/library" className="text-sm text-black/60 dark:text-white/60 hover:underline">← Library</Link>

      <header className="space-y-2">
        {props.series && (
          <p className="text-xs uppercase tracking-wide text-black/50 dark:text-white/50">{props.series}</p>
        )}
        <h1 className="text-2xl font-semibold tracking-tight">{props.title}</h1>
        <p className="text-sm text-black/50 dark:text-white/50 tabular-nums">
          {props.durationSeconds ? `${Math.round(props.durationSeconds / 60)} min` : ''}
        </p>
      </header>

      {props.savedPosition != null && (
        <div role="status"
          className="flex w-fit items-center gap-3 rounded-lg border border-black/15 dark:border-white/20 px-4 py-2.5 text-sm">
          <span>
            Continue from {fmt(props.savedPosition)}
            {props.savedPercent ? ` (${Math.round(props.savedPercent)}%)` : ''}?
          </span>
          <Link href={`/listen/${props.slug}?t=${Math.floor(props.savedPosition)}`}
            className="rounded bg-foreground text-background px-3 py-1 text-xs font-medium">Resume</Link>
          <Link href={`/listen/${props.slug}?t=0`}
            className="text-xs text-black/50 dark:text-white/50 hover:underline">Start over</Link>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          data-testid="mark-moment"
          onClick={() => marks.addBookmark({
            positionSeconds: Math.max(0, player.position - LEAD_IN_SECONDS),
            color: 'yellow',
          })}
          disabled={!isCurrent}
          className="rounded-md bg-foreground text-background px-4 py-2 text-sm font-medium disabled:opacity-40">
          Mark this moment
        </button>
        <button onClick={() => setPanelOpen((o) => !o)}
          aria-label="Toggle bookmarks and journal"
          className="rounded-md border border-black/20 dark:border-white/25 px-4 py-2 text-sm">
          Notes{marks.bookmarks.length ? ` (${marks.bookmarks.length})` : ''}
        </button>
        <Link href="/notes" className="text-sm text-black/50 dark:text-white/50 hover:underline">
          All notes →
        </Link>
      </div>

      {panelOpen && (
        <MarksPanel
          kind="listening"
          bookmarks={marks.bookmarks}
          itemJournal={marks.journalFor(null)}
          journalFor={marks.journalFor}
          recovery={recovery}
          onGoTo={(seconds) => player.seek(seconds)}
          onRemove={marks.removeBookmark}
          onSaveJournal={marks.saveJournal}
          onClose={() => setPanelOpen(false)}
        />
      )}

      <p className="text-sm text-black/60 dark:text-white/60" data-testid="listen-state">
        {isCurrent
          ? player.playing ? 'Playing — the player stays with you as you browse.' : 'Paused.'
          : 'Loading…'}
      </p>
    </main>
  )
}
