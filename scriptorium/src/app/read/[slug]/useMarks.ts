'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { TextAnchor } from '@/lib/anchor'

export type Bookmark = {
  id: string
  page: number | null
  textAnchor: TextAnchor | null
  label: string | null
  color: string | null
  createdAt: string
}
export type Journal = {
  id: string
  bookmarkId: string | null
  bodyMd: string
  updatedAt: string
}

const JOURNAL_DEBOUNCE_MS = 1200

export function useMarks(itemId: string) {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  const [journals, setJournals] = useState<Journal[]>([])
  const [loaded, setLoaded] = useState(false)

  const refresh = useCallback(async () => {
    const [b, j] = await Promise.all([
      fetch(`/api/bookmarks?itemId=${itemId}`).then((r) => (r.ok ? r.json() : { bookmarks: [] })),
      fetch(`/api/journals?itemId=${itemId}`).then((r) => (r.ok ? r.json() : { journals: [] })),
    ])
    setBookmarks(b.bookmarks ?? [])
    setJournals(j.journals ?? [])
    setLoaded(true)
  }, [itemId])

  useEffect(() => { void refresh() }, [refresh])

  const addBookmark = useCallback(async (input: {
    page: number; textAnchor?: TextAnchor | null; label?: string; color?: string
  }) => {
    const res = await fetch('/api/bookmarks', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId, kind: 'reading', ...input }),
    })
    if (res.ok) { const { bookmark } = await res.json(); setBookmarks((p) => [bookmark, ...p]) }
  }, [itemId])

  const removeBookmark = useCallback(async (id: string) => {
    setBookmarks((p) => p.filter((b) => b.id !== id))
    setJournals((p) => p.map((j) => (j.bookmarkId === id ? { ...j, bookmarkId: null } : j)))
    await fetch(`/api/bookmarks?id=${id}`, { method: 'DELETE' })
  }, [])

  // One debounce timer per journal target, so editing two notes cannot make
  // one overwrite the other's pending save.
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const saveJournal = useCallback((bookmarkId: string | null, bodyMd: string) => {
    const key = bookmarkId ?? '__item__'
    const existing = timers.current.get(key)
    if (existing) clearTimeout(existing)
    timers.current.set(key, setTimeout(async () => {
      await fetch('/api/journals', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId, kind: 'reading', bookmarkId, bodyMd }),
        keepalive: true,
      })
      void refresh()
    }, JOURNAL_DEBOUNCE_MS))
  }, [itemId, refresh])

  useEffect(() => {
    const t = timers.current
    return () => { t.forEach(clearTimeout); t.clear() }
  }, [])

  const journalFor = useCallback(
    (bookmarkId: string | null) =>
      journals.find((j) => (bookmarkId ? j.bookmarkId === bookmarkId : j.bookmarkId === null)) ?? null,
    [journals],
  )

  return { bookmarks, journals, loaded, addBookmark, removeBookmark, saveJournal, journalFor, refresh }
}
