'use client'
import { useState } from 'react'
import type { Bookmark, Journal } from './useMarks'

type Props = {
  bookmarks: Bookmark[]
  itemJournal: Journal | null
  journalFor: (bookmarkId: string | null) => Journal | null
  recovery: Map<string, { page: number; approximate: boolean } | null>
  onGoTo: (page: number) => void
  onRemove: (id: string) => void
  onSaveJournal: (bookmarkId: string | null, body: string) => void
  onClose: () => void
}

export function MarksPanel({
  bookmarks, itemJournal, journalFor, recovery, onGoTo, onRemove, onSaveJournal, onClose,
}: Props) {
  const [tab, setTab] = useState<'marks' | 'journal'>('marks')
  const [openNote, setOpenNote] = useState<string | null>(null)

  return (
    <aside className="fixed right-0 top-0 z-30 h-dvh w-full max-w-sm border-l border-black/10 dark:border-white/15 bg-background flex flex-col">
      <div className="flex items-center gap-2 border-b border-black/10 dark:border-white/15 px-4 py-2.5">
        <button onClick={() => setTab('marks')}
          className={`text-sm px-2 py-1 rounded ${tab === 'marks' ? 'font-medium bg-black/5 dark:bg-white/10' : 'text-black/60 dark:text-white/60'}`}>
          Bookmarks {bookmarks.length > 0 && `(${bookmarks.length})`}
        </button>
        <button onClick={() => setTab('journal')}
          className={`text-sm px-2 py-1 rounded ${tab === 'journal' ? 'font-medium bg-black/5 dark:bg-white/10' : 'text-black/60 dark:text-white/60'}`}>
          Journal
        </button>
        <button onClick={onClose} aria-label="Close panel"
          className="ml-auto text-black/50 dark:text-white/50 px-2 py-1 rounded hover:bg-black/5 dark:hover:bg-white/10">✕</button>
      </div>

      {tab === 'marks' ? (
        <div className="flex-1 overflow-auto p-3 space-y-2">
          {bookmarks.length === 0 && (
            <p className="text-sm text-black/50 dark:text-white/50 p-3">
              Select text in the document to highlight it, or use the bookmark button to mark a page.
            </p>
          )}
          {bookmarks.map((b) => {
            const rec = recovery.get(b.id)
            const note = journalFor(b.id)
            const page = rec?.page ?? b.page ?? 1
            return (
              <div key={b.id} className="rounded-lg border border-black/10 dark:border-white/15 p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <button onClick={() => onGoTo(page)}
                    className="flex-1 text-left space-y-1">
                    <span className="text-xs text-black/50 dark:text-white/50">
                      Page {page}
                      {rec?.approximate && (
                        <span title="The document changed; this was relocated by matching its text."
                          className="ml-1.5 text-amber-700 dark:text-amber-400">· position approximate</span>
                      )}
                      {rec === null && (
                        <span className="ml-1.5 text-red-700 dark:text-red-400">· text not found</span>
                      )}
                    </span>
                    {b.textAnchor?.quotedText && (
                      <p className="text-sm leading-snug line-clamp-3 border-l-2 border-amber-400 pl-2">
                        {b.textAnchor.quotedText}
                      </p>
                    )}
                  </button>
                  <button onClick={() => onRemove(b.id)} aria-label="Delete bookmark"
                    className="text-black/30 dark:text-white/30 hover:text-red-600 text-sm px-1">✕</button>
                </div>

                <button onClick={() => setOpenNote(openNote === b.id ? null : b.id)}
                  className="text-xs text-black/50 dark:text-white/50 hover:underline">
                  {note?.bodyMd ? 'Edit note' : 'Add note'}
                </button>

                {openNote === b.id && (
                  <textarea
                    defaultValue={note?.bodyMd ?? ''}
                    onChange={(e) => onSaveJournal(b.id, e.target.value)}
                    placeholder="A thought, beside the sentence that caused it…"
                    rows={4}
                    className="w-full rounded border border-black/15 dark:border-white/20 bg-transparent p-2 text-sm"
                  />
                )}
                {note?.bodyMd && openNote !== b.id && (
                  <p className="text-xs text-black/60 dark:text-white/60 line-clamp-2 whitespace-pre-wrap">{note.bodyMd}</p>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-3">
          <label htmlFor="item-journal" className="block text-xs text-black/50 dark:text-white/50 mb-2">
            Your response to the whole document. Markdown, private, autosaved.
          </label>
          <textarea
            id="item-journal"
            defaultValue={itemJournal?.bodyMd ?? ''}
            onChange={(e) => onSaveJournal(null, e.target.value)}
            placeholder="What is this saying, and what does it ask of me?"
            className="w-full h-[70vh] rounded border border-black/15 dark:border-white/20 bg-transparent p-3 text-sm leading-relaxed"
          />
        </div>
      )}
    </aside>
  )
}
