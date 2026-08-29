'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Document, Page, pdfjs } from 'react-pdf'
import { useMarks } from '@/app/marks/useMarks'
import { MarksPanel } from '@/app/marks/MarksPanel'
import { recoverAnchor, type TextAnchor } from '@/lib/anchor'
import 'react-pdf/dist/Page/TextLayer.css'
import 'react-pdf/dist/Page/AnnotationLayer.css'

// Self-hosted worker. No CDN: the CSP stays tight and the app works offline.
pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'

const SAVE_DEBOUNCE_MS = 3000

type Props = {
  itemId: string
  title: string
  fileUrl: string
  urlExpiresAt: string
  totalPages?: number
  initialPage?: number
  checksum?: string | null
}

export function PdfReader({
  itemId, title, fileUrl, urlExpiresAt, totalPages, initialPage, checksum,
}: Props) {
  const marks = useMarks(itemId, 'reading')
  const [panelOpen, setPanelOpen] = useState(false)
  const [pendingSel, setPendingSel] = useState<{ page: number; text: string } | null>(null)
  const [pagesText, setPagesText] = useState<string[]>([])
  const docRef = useRef<import('pdfjs-dist').PDFDocumentProxy | null>(null)
  const [numPages, setNumPages] = useState(totalPages ?? 0)
  const [page, setPage] = useState(initialPage && initialPage > 0 ? initialPage : 1)
  const [scale, setScale] = useState(1.2)
  const [mode, setMode] = useState<'scroll' | 'single'>('scroll')
  const [docLoaded, setDocLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [expired, setExpired] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSaved = useRef<number>(initialPage ?? 0)
  const jumped = useRef(false)

  // react-pdf re-fetches whenever `file` is a new object identity.
  const file = useMemo(() => ({ url: fileUrl }), [fileUrl])

  // ── progress persistence (§8.2) ─────────────────────────────────────────
  const buildBody = useCallback((p: number) => JSON.stringify({
    itemId, kind: 'reading', page: p,
    percent: numPages ? Math.min(100, (p / numPages) * 100) : 0,
  }), [itemId, numPages])

  const save = useCallback((p: number) => {
    if (p === lastSaved.current) return
    lastSaved.current = p
    fetch('/api/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: buildBody(p),
      keepalive: true,
    }).catch(() => { /* a dropped position is not worth surfacing */ })
  }, [buildBody])

  const scheduleSave = useCallback((p: number) => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => save(p), SAVE_DEBOUNCE_MS)
  }, [save])

  useEffect(() => { if (numPages) scheduleSave(page) }, [page, numPages, scheduleSave])

  // Jump to the resumed page once, after the document reports its length.
  useEffect(() => {
    if (!numPages || jumped.current || !initialPage || initialPage <= 1) return
    jumped.current = true
    requestAnimationFrame(() => {
      pageRefs.current.get(initialPage)?.scrollIntoView({ block: 'start' })
    })
  }, [numPages, initialPage])

  // Flush on unload and on tab-hide. sendBeacon survives the page going away.
  useEffect(() => {
    const flush = () => {
      if (!numPages || page === lastSaved.current) return
      lastSaved.current = page
      navigator.sendBeacon?.('/api/progress', new Blob([buildBody(page)], { type: 'text/plain' }))
    }
    const onHide = () => { if (document.visibilityState === 'hidden') flush() }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onHide)
      if (saveTimer.current) clearTimeout(saveTimer.current)
      flush()
    }
  }, [page, numPages, buildBody])

  // ── signed-URL expiry (§7.3) ────────────────────────────────────────────
  useEffect(() => {
    const ms = new Date(urlExpiresAt).getTime() - Date.now()
    if (ms <= 0) { setExpired(true); return }
    const t = setTimeout(() => setExpired(true), ms)
    return () => clearTimeout(t)
  }, [urlExpiresAt])

  // ── which page am I on? (scroll mode) ───────────────────────────────────
  //
  // Scroll position, not IntersectionObserver. Three reasons, all found by
  // testing rather than by taste:
  //
  // 1. IntersectionObserver does not fire while `document.visibilityState` is
  //    "hidden". That is exactly the moment we most need an accurate page —
  //    the visibilitychange/pagehide flush below saves the final position, and
  //    with IO it would save a stale one.
  // 2. requestAnimationFrame is likewise throttled to a stop in hidden tabs,
  //    so the throttle here is timestamp-based, not rAF-based.
  // 3. Ranking by visible AREA handles a page taller than the viewport, which
  //    can never reach a high intersectionRatio.
  useEffect(() => {
    if (mode !== 'scroll' || !numPages || !docLoaded) return

    let last = 0
    let trailing: ReturnType<typeof setTimeout> | null = null

    const compute = () => {
      const vh = window.innerHeight
      let best = 0
      let bestArea = 0
      pageRefs.current.forEach((el, n) => {
        const r = el.getBoundingClientRect()
        const visible = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0))
        if (visible > bestArea) { bestArea = visible; best = n }
      })
      if (best) setPage(best)
    }

    const onScroll = () => {
      const now = Date.now()
      if (now - last >= 100) { last = now; compute() }
      else {
        if (trailing) clearTimeout(trailing)
        trailing = setTimeout(() => { last = Date.now(); compute() }, 120)
      }
    }

    compute()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (trailing) clearTimeout(trailing)
    }
  }, [mode, numPages, docLoaded])

  const goTo = useCallback((n: number) => {
    const clamped = Math.max(1, Math.min(numPages || 1, n))
    setPage(clamped)
    if (mode === 'scroll') {
      pageRefs.current.get(clamped)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [numPages, mode])

  // ── keyboard (§8.2) ─────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return
      switch (e.key) {
        case 'ArrowRight': case 'ArrowDown': case 'j': goTo(page + 1); break
        case 'ArrowLeft':  case 'ArrowUp':   case 'k': goTo(page - 1); break
        case 'g': { const n = prompt('Go to page'); if (n) goTo(Number(n)); break }
        case '+': case '=': setScale((s) => Math.min(3, s + 0.15)); break
        case '-': setScale((s) => Math.max(0.5, s - 0.15)); break
        default: return
      }
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [page, goTo])

  // ── text extraction + anchor recovery (§8.3) ────────────────────────────
  const onDocumentLoad = useCallback(async (doc: import('pdfjs-dist').PDFDocumentProxy) => {
    docRef.current = doc
    setNumPages(doc.numPages)
    setDocLoaded(true)
    setLoadError(null)

    const texts: string[] = []
    for (let i = 1; i <= doc.numPages; i++) {
      const content = await (await doc.getPage(i)).getTextContent()
      texts.push(content.items.map((it) => ('str' in it ? it.str : '')).join(' '))
    }
    setPagesText(texts)
  }, [])

  /**
   * Where does each bookmark actually live right now?
   *
   * If the PDF has not changed since the highlight was made, its stored page is
   * authoritative. If it HAS changed, the geometry is worthless and the quoted
   * text is the only durable anchor — so we re-find it and mark the result as
   * approximate rather than silently pretending the old page still applies.
   */
  const recovery = useMemo(() => {
    const map = new Map<string, { page: number; approximate: boolean } | null>()
    for (const b of marks.bookmarks) {
      const anchor = b.textAnchor as TextAnchor | null
      if (!anchor?.quotedText) {
        map.set(b.id, b.page ? { page: b.page, approximate: false } : null)
        continue
      }
      if (checksum && anchor.sourceChecksum === checksum) {
        map.set(b.id, { page: b.page ?? 1, approximate: false })
        continue
      }
      if (!pagesText.length) { map.set(b.id, b.page ? { page: b.page, approximate: false } : null); continue }
      const r = recoverAnchor(anchor.quotedText, pagesText, b.page ?? undefined)
      map.set(b.id,
        r.status === 'lost' ? null
        : { page: r.page, approximate: r.status === 'relocated' || r.page !== b.page })
    }
    return map
  }, [marks.bookmarks, pagesText, checksum])

  // ── text selection -> highlight ─────────────────────────────────────────
  useEffect(() => {
    const onUp = () => {
      const sel = window.getSelection()
      const text = sel?.toString().trim() ?? ''
      if (!text || text.length < 2) { setPendingSel(null); return }
      const node = sel!.anchorNode as HTMLElement | null
      const wrapper = (node?.nodeType === 3 ? node.parentElement : node)?.closest('[data-page]')
      const p = wrapper ? Number((wrapper as HTMLElement).dataset.page) : page
      setPendingSel({ page: p || page, text: text.slice(0, 5000) })
    }
    document.addEventListener('mouseup', onUp)
    document.addEventListener('touchend', onUp)
    return () => {
      document.removeEventListener('mouseup', onUp)
      document.removeEventListener('touchend', onUp)
    }
  }, [page])

  const highlightSelection = useCallback(async (color: string) => {
    if (!pendingSel) return
    const anchor: TextAnchor = {
      quads: [], // geometry is a fast path only; quotedText is what survives
      quotedText: pendingSel.text,
      sourceChecksum: checksum ?? '',
    }
    await marks.addBookmark({ page: pendingSel.page, textAnchor: anchor, color })
    window.getSelection()?.removeAllRanges()
    setPendingSel(null)
    setPanelOpen(true)
  }, [pendingSel, marks, checksum])

  const pct = numPages ? Math.round((page / numPages) * 100) : 0

  return (
    <div className="min-h-dvh flex flex-col">
      <header className="sticky top-0 z-20 border-b border-black/10 dark:border-white/15 bg-background/90 backdrop-blur">
        <div className="mx-auto max-w-5xl px-4 py-2.5 flex items-center gap-4">
          <Link href="/library" className="text-sm text-black/60 dark:text-white/60 hover:underline">← Library</Link>
          <h1 className="text-sm font-medium truncate flex-1">{title}</h1>

          <div className="flex items-center gap-1.5 text-sm">
            <button onClick={() => goTo(page - 1)} disabled={page <= 1}
              aria-label="Previous page"
              className="px-2 py-1 rounded disabled:opacity-30 hover:bg-black/5 dark:hover:bg-white/10">‹</button>
            <span className="tabular-nums text-xs text-black/60 dark:text-white/60 min-w-[4.5rem] text-center">
              {page} / {numPages || '—'}
            </span>
            <button onClick={() => goTo(page + 1)} disabled={!numPages || page >= numPages}
              aria-label="Next page"
              className="px-2 py-1 rounded disabled:opacity-30 hover:bg-black/5 dark:hover:bg-white/10">›</button>
          </div>

          <div className="hidden sm:flex items-center gap-1 text-xs">
            <button onClick={() => setScale((s) => Math.max(0.5, s - 0.15))} aria-label="Zoom out"
              className="px-2 py-1 rounded hover:bg-black/5 dark:hover:bg-white/10">−</button>
            <span className="tabular-nums w-10 text-center">{Math.round(scale * 100)}%</span>
            <button onClick={() => setScale((s) => Math.min(3, s + 0.15))} aria-label="Zoom in"
              className="px-2 py-1 rounded hover:bg-black/5 dark:hover:bg-white/10">+</button>
            <button onClick={() => setMode((m) => (m === 'scroll' ? 'single' : 'scroll'))}
              className="ml-2 px-2 py-1 rounded hover:bg-black/5 dark:hover:bg-white/10">
              {mode === 'scroll' ? 'Scroll' : 'Single'}
            </button>
          </div>

          <div className="flex items-center gap-1 text-xs">
            <button onClick={() => marks.addBookmark({ page })} title="Bookmark this page"
              aria-label="Bookmark this page"
              className="px-2 py-1 rounded hover:bg-black/5 dark:hover:bg-white/10">☆</button>
            <button onClick={() => setPanelOpen((o) => !o)}
              aria-label="Toggle bookmarks and journal"
              className="px-2 py-1 rounded hover:bg-black/5 dark:hover:bg-white/10">
              Notes{marks.bookmarks.length ? ` (${marks.bookmarks.length})` : ''}
            </button>
          </div>
        </div>
        <div className="h-0.5 bg-black/5 dark:bg-white/10">
          <div className="h-full bg-foreground/60 transition-all" style={{ width: `${pct}%` }} />
        </div>
      </header>

      {expired && (
        <div role="alert" className="mx-auto mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-sm">
          This reading link has expired.{' '}
          <button onClick={() => location.reload()} className="underline font-medium">Reload</button>
        </div>
      )}

      {pendingSel && (
        <div role="dialog" aria-label="Highlight selection"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 rounded-full border border-black/15 dark:border-white/20 bg-background px-3 py-2 shadow-lg">
          <span className="text-xs text-black/60 dark:text-white/60 max-w-[16rem] truncate">
            “{pendingSel.text}”
          </span>
          {(['yellow', 'green', 'blue', 'pink'] as const).map((c) => (
            <button key={c} onClick={() => highlightSelection(c)}
              aria-label={`Highlight ${c}`}
              className="h-5 w-5 rounded-full border border-black/20 dark:border-white/25"
              style={{ background: { yellow: '#fde68a', green: '#bbf7d0', blue: '#bfdbfe', pink: '#fbcfe8' }[c] }} />
          ))}
          <button onClick={() => { setPendingSel(null); window.getSelection()?.removeAllRanges() }}
            className="text-xs text-black/50 dark:text-white/50 px-1">✕</button>
        </div>
      )}

      {panelOpen && (
        <MarksPanel
          kind="reading"
          bookmarks={marks.bookmarks}
          itemJournal={marks.journalFor(null)}
          journalFor={marks.journalFor}
          recovery={recovery}
          onGoTo={(p) => { goTo(p); }}
          onRemove={marks.removeBookmark}
          onSaveJournal={marks.saveJournal}
          onClose={() => setPanelOpen(false)}
        />
      )}

      <main ref={containerRef} className={`flex-1 px-4 py-6 ${panelOpen ? 'sm:mr-96' : ''}`}>
        {loadError ? (
          <p role="alert" className="text-center text-sm text-red-600 dark:text-red-400">{loadError}</p>
        ) : (
          <Document
            file={file}
            onLoadSuccess={onDocumentLoad}
            onLoadError={(e) => setLoadError(e.message)}
            loading={<p className="text-center text-sm text-black/50 dark:text-white/50 py-16">Loading…</p>}
            className="flex flex-col items-center gap-6"
          >
            {mode === 'single' ? (
              <Page pageNumber={page} scale={scale} renderTextLayer renderAnnotationLayer
                className="shadow-lg" />
            ) : (
              Array.from({ length: numPages }, (_, i) => (
                <div key={i + 1} data-page={i + 1} className="scroll-mt-16"
                  ref={(el) => { if (el) pageRefs.current.set(i + 1, el); else pageRefs.current.delete(i + 1) }}>
                  <Page pageNumber={i + 1} scale={scale} renderTextLayer renderAnnotationLayer
                    className="shadow-lg" />
                </div>
              ))
            )}
          </Document>
        )}
      </main>
    </div>
  )
}
