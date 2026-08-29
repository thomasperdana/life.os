'use client'

import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
} from 'react'
import Link from 'next/link'

export type Track = {
  itemId: string
  slug: string
  title: string
  series?: string | null
  durationSeconds?: number | null
  startAt?: number
}

type Ctx = {
  track: Track | null
  playing: boolean
  position: number
  duration: number
  rate: number
  sleepMinutes: number | null
  load: (t: Track) => void
  toggle: () => void
  seek: (s: number) => void
  skip: (delta: number) => void
  setRate: (r: number) => void
  setSleep: (m: number | null) => void
  close: () => void
}

const PlayerContext = createContext<Ctx | null>(null)
export const usePlayer = () => {
  const c = useContext(PlayerContext)
  if (!c) throw new Error('usePlayer must be used inside PlayerProvider')
  return c
}

const SAVE_EVERY_MS = 10_000

/**
 * The audio element lives here, in the ROOT layout — SPEC.3.md §8.6.
 *
 * That is the whole point: navigating from /listen/x to /library must not
 * restart or stop playback. A player mounted inside a route component would be
 * unmounted on navigation, which is exactly the bug this design avoids.
 */
export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [track, setTrack] = useState<Track | null>(null)
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)
  const [rate, setRateState] = useState(1)
  const [sleepMinutes, setSleepMinutes] = useState<number | null>(null)

  const lastSaved = useRef(0)
  const sleepAt = useRef<number | null>(null)
  const urlExpires = useRef<number>(0)

  /** Signed URLs expire (4h for audio); fetch a fresh one on demand. */
  const freshUrl = useCallback(async (itemId: string) => {
    const res = await fetch(`/api/content/${itemId}/url?purpose=read`)
    if (!res.ok) throw new Error(`could not get media url (${res.status})`)
    const data = await res.json()
    urlExpires.current = new Date(data.expiresAt).getTime()
    return data.url as string
  }, [])

  const save = useCallback((force = false) => {
    const a = audioRef.current
    if (!a || !track) return
    const now = Date.now()
    if (!force && now - lastSaved.current < SAVE_EVERY_MS) return
    lastSaved.current = now
    const body = JSON.stringify({
      itemId: track.itemId, kind: 'listening',
      positionSeconds: a.currentTime,
      percent: a.duration ? Math.min(100, (a.currentTime / a.duration) * 100) : 0,
    })
    if (force && navigator.sendBeacon) {
      navigator.sendBeacon('/api/progress', new Blob([body], { type: 'text/plain' }))
    } else {
      fetch('/api/progress', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body, keepalive: true,
      }).catch(() => {})
    }
  }, [track])

  const load = useCallback(async (t: Track) => {
    setTrack(t)
    const a = audioRef.current
    if (!a) return
    try {
      a.src = await freshUrl(t.itemId)
      a.load()
      if (t.startAt && t.startAt > 0) {
        const onMeta = () => { a.currentTime = t.startAt!; a.removeEventListener('loadedmetadata', onMeta) }
        a.addEventListener('loadedmetadata', onMeta)
      }
      await a.play().catch(() => { /* autoplay policy; the user will press play */ })
    } catch { /* surfaced by the audio element's error handler */ }
  }, [freshUrl])

  const toggle = useCallback(() => {
    const a = audioRef.current
    if (!a) return
    if (a.paused) void a.play().catch(() => {})
    else a.pause()
  }, [])

  const seek = useCallback(async (s: number) => {
    const a = audioRef.current
    if (!a || !track) return
    // A signed URL that lapsed mid-session makes seeking fail; refresh first.
    if (Date.now() > urlExpires.current - 30_000) {
      const at = a.currentTime
      a.src = await freshUrl(track.itemId)
      a.load()
      a.addEventListener('loadedmetadata', () => { a.currentTime = s || at }, { once: true })
      return
    }
    a.currentTime = Math.max(0, Math.min(a.duration || Infinity, s))
  }, [track, freshUrl])

  const skip = useCallback((delta: number) => {
    const a = audioRef.current
    if (a) void seek(a.currentTime + delta)
  }, [seek])

  const setRate = useCallback((r: number) => {
    setRateState(r)
    if (audioRef.current) audioRef.current.playbackRate = r
  }, [])

  const setSleep = useCallback((m: number | null) => {
    setSleepMinutes(m)
    sleepAt.current = m ? Date.now() + m * 60_000 : null
  }, [])

  const close = useCallback(() => {
    save(true)
    audioRef.current?.pause()
    setTrack(null)
    setPlaying(false)
  }, [save])

  // ── element events ──────────────────────────────────────────────────────
  useEffect(() => {
    const a = audioRef.current
    if (!a) return
    const onPlay = () => setPlaying(true)
    const onPause = () => { setPlaying(false); save(true) }
    const onTime = () => {
      setPosition(a.currentTime)
      save()
      if (sleepAt.current && Date.now() >= sleepAt.current) {
        a.pause(); sleepAt.current = null; setSleepMinutes(null)
      }
    }
    const onMeta = () => setDuration(a.duration || 0)
    const onEnded = () => { save(true); setPlaying(false) }

    a.addEventListener('play', onPlay)
    a.addEventListener('pause', onPause)
    a.addEventListener('timeupdate', onTime)
    a.addEventListener('loadedmetadata', onMeta)
    a.addEventListener('ended', onEnded)
    return () => {
      a.removeEventListener('play', onPlay)
      a.removeEventListener('pause', onPause)
      a.removeEventListener('timeupdate', onTime)
      a.removeEventListener('loadedmetadata', onMeta)
      a.removeEventListener('ended', onEnded)
    }
  }, [save])

  // Flush on tab close / hide.
  useEffect(() => {
    const flush = () => save(true)
    const onHide = () => { if (document.visibilityState === 'hidden') flush() }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onHide)
    }
  }, [save])

  // ── Media Session: lock screen + headphone controls (§8.6) ──────────────
  useEffect(() => {
    if (!('mediaSession' in navigator) || !track) return
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.series ?? 'Scriptorium',
      album: 'Scriptorium',
    })
    const handlers: Array<[MediaSessionAction, () => void]> = [
      ['play', () => audioRef.current?.play()],
      ['pause', () => audioRef.current?.pause()],
      ['seekbackward', () => skip(-15)],
      ['seekforward', () => skip(15)],
    ]
    for (const [action, fn] of handlers) {
      try { navigator.mediaSession.setActionHandler(action, fn) } catch { /* unsupported */ }
    }
    return () => {
      for (const [action] of handlers) {
        try { navigator.mediaSession.setActionHandler(action, null) } catch { /* noop */ }
      }
    }
  }, [track, skip])

  useEffect(() => {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = playing ? 'playing' : 'paused'
    }
  }, [playing])

  return (
    <PlayerContext.Provider value={{
      track, playing, position, duration, rate, sleepMinutes,
      load, toggle, seek, skip, setRate, setSleep, close,
    }}>
      {children}
      {/* Single element, root-mounted, never unmounted by navigation. */}
      <audio ref={audioRef} preload="metadata" data-testid="player-audio" />
      {track && <PlayerDock />}
    </PlayerContext.Provider>
  )
}

const fmt = (s: number) => {
  if (!Number.isFinite(s) || s < 0) return '0:00'
  const m = Math.floor(s / 60)
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

function PlayerDock() {
  const p = usePlayer()
  if (!p.track) return null

  return (
    <div data-testid="player-dock"
      className="fixed bottom-0 inset-x-0 z-40 border-t border-black/10 dark:border-white/15 bg-background/95 backdrop-blur">
      <input
        type="range" min={0} max={p.duration || 0} value={p.position} step={1}
        aria-label="Seek"
        onChange={(e) => p.seek(Number(e.target.value))}
        className="w-full h-1 accent-current cursor-pointer"
      />
      <div className="mx-auto max-w-5xl px-4 py-2.5 flex items-center gap-3">
        <button onClick={p.toggle} aria-label={p.playing ? 'Pause' : 'Play'}
          className="h-9 w-9 rounded-full bg-foreground text-background text-sm shrink-0">
          {p.playing ? '❚❚' : '▶'}
        </button>
        <button onClick={() => p.skip(-15)} aria-label="Back 15 seconds"
          className="text-xs px-1.5 py-1 rounded hover:bg-black/5 dark:hover:bg-white/10">−15</button>
        <button onClick={() => p.skip(15)} aria-label="Forward 15 seconds"
          className="text-xs px-1.5 py-1 rounded hover:bg-black/5 dark:hover:bg-white/10">+15</button>

        <div className="min-w-0 flex-1">
          <Link href={`/listen/${p.track.slug}`} className="block truncate text-sm font-medium hover:underline">
            {p.track.title}
          </Link>
          <p className="text-xs tabular-nums text-black/50 dark:text-white/50"
            data-testid="player-time">
            {fmt(p.position)} / {fmt(p.duration)}
          </p>
        </div>

        <select value={p.rate} onChange={(e) => p.setRate(Number(e.target.value))}
          aria-label="Playback speed"
          className="text-xs bg-transparent border border-black/15 dark:border-white/20 rounded px-1 py-0.5">
          {[0.75, 1, 1.25, 1.5, 1.75, 2].map((r) => <option key={r} value={r}>{r}×</option>)}
        </select>

        <select value={p.sleepMinutes ?? ''} onChange={(e) => p.setSleep(e.target.value ? Number(e.target.value) : null)}
          aria-label="Sleep timer"
          className="hidden sm:block text-xs bg-transparent border border-black/15 dark:border-white/20 rounded px-1 py-0.5">
          <option value="">No timer</option>
          {[5, 15, 30, 45, 60].map((m) => <option key={m} value={m}>{m}m</option>)}
        </select>

        <button onClick={p.close} aria-label="Close player"
          className="text-black/40 dark:text-white/40 px-1">✕</button>
      </div>
    </div>
  )
}
