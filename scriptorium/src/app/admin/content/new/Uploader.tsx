'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type Stage = 'idle' | 'ticket' | 'uploading' | 'ingesting' | 'done' | 'error'

export function Uploader() {
  const router = useRouter()
  const [stage, setStage] = useState<Stage>('idle')
  const [message, setMessage] = useState<string>('')

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const file = fd.get('file') as File | null
    if (!file || file.size === 0) { setStage('error'); setMessage('Choose a file.'); return }

    const kind = file.name.toLowerCase().endsWith('.pdf') ? 'pdf' : 'audio'

    try {
      // 1. Ticket
      setStage('ticket'); setMessage('Requesting upload ticket…')
      const tRes = await fetch('/api/admin/upload-url', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, kind, size: file.size }),
      })
      const ticket = await tRes.json()
      if (!tRes.ok) throw new Error(ticket.error ?? 'Could not get an upload ticket.')

      // 2. Bytes go browser-direct to Supabase, never through Vercel (§7.2)
      setStage('uploading'); setMessage(`Uploading ${(file.size / 1024 / 1024).toFixed(1)} MB…`)
      const supabase = createClient()
      const { error: upErr } = await supabase.storage
        .from(ticket.bucket)
        .uploadToSignedUrl(ticket.path, ticket.token, file)
      if (upErr) throw new Error(upErr.message)

      // 3. Server validates the stored bytes and extracts metadata
      setStage('ingesting'); setMessage('Validating and reading metadata…')
      const iRes = await fetch('/api/admin/content', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: ticket.path, slug: ticket.slug, kind,
          title: (fd.get('title') as string) || file.name,
          series: (fd.get('series') as string) || undefined,
          accessTier: fd.get('accessTier') as 'free' | 'subscriber',
        }),
      })
      const ingest = await iRes.json()
      if (!iRes.ok) throw new Error(ingest.error ?? 'Ingest failed.')

      setStage('done')
      setMessage(
        kind === 'pdf'
          ? `Uploaded as draft · ${ingest.item.pageCount} pages`
          : `Uploaded as draft · ${Math.round((ingest.item.durationSeconds ?? 0) / 60)} min` +
            (ingest.durationApproximate ? ' (approx)' : ''),
      )
      router.refresh()
    } catch (err) {
      setStage('error'); setMessage((err as Error).message)
    }
  }

  const busy = ['ticket', 'uploading', 'ingesting'].includes(stage)

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="file" className="block text-sm font-medium">File</label>
        <input id="file" name="file" type="file" accept=".pdf,.mp3" required
          className="w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-foreground file:text-background file:px-3 file:py-1.5 file:text-sm" />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="title" className="block text-sm font-medium">Title</label>
        <input id="title" name="title"
          className="w-full rounded-md border border-black/15 dark:border-white/20 bg-transparent px-3 py-2 text-sm" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label htmlFor="series" className="block text-sm font-medium">Series</label>
          <input id="series" name="series"
            className="w-full rounded-md border border-black/15 dark:border-white/20 bg-transparent px-3 py-2 text-sm" />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="accessTier" className="block text-sm font-medium">Access</label>
          <select id="accessTier" name="accessTier" defaultValue="subscriber"
            className="w-full rounded-md border border-black/15 dark:border-white/20 bg-transparent px-3 py-2 text-sm">
            <option value="subscriber">Subscribers</option>
            <option value="free">Free</option>
          </select>
        </div>
      </div>

      <button type="submit" disabled={busy}
        className="rounded-md bg-foreground text-background px-4 py-2 text-sm font-medium disabled:opacity-50">
        {busy ? 'Working…' : 'Upload'}
      </button>

      {message && (
        <p role="status" className={`text-sm ${stage === 'error' ? 'text-red-600 dark:text-red-400' : 'text-black/70 dark:text-white/70'}`}>
          {message}
        </p>
      )}
    </form>
  )
}
