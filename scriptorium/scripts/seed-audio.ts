import { createClient } from '@supabase/supabase-js'
import postgres from 'postgres'
import { parseBuffer } from 'music-metadata'
import { makeSilentMp3 } from '../src/lib/mp3-fixture'

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } })
const sql = postgres(process.env.DIRECT_URL!, { prepare: false, max: 1, idle_timeout: 10 })

const slug = 'demo-listen'
const { bytes, frames, durationSeconds } = makeSilentMp3(180) // 3 minutes

// Confirm the fixture is a real MPEG file before it goes anywhere near the app.
const meta = await parseBuffer(bytes, { mimeType: 'audio/mpeg' }, { duration: true })
console.log(`fixture: ${frames} frames, ${bytes.byteLength} bytes, ` +
  `container=${meta.format.container}, codec=${meta.format.codec}, ` +
  `bitrate=${meta.format.bitrate}, parsedDuration=${meta.format.duration?.toFixed(1)}s`)

const path = `audio/${slug}.mp3`
await admin.storage.from('content').upload(path, bytes as unknown as ArrayBuffer,
  { contentType: 'audio/mpeg', upsert: true })

await sql`delete from public.progress where item_id in (select id from public.content_items where slug=${slug})`
await sql`delete from public.content_items where slug=${slug}`
await sql`
  insert into public.content_items
    (slug, kind, title, series, storage_path, duration_seconds, byte_size, mime_type, checksum, access_tier, status, published_at)
  values (${slug},'audio','Demo: Three Minutes of Silence','Demo',${path},
          ${Math.round(durationSeconds)}, ${bytes.byteLength}, 'audio/mpeg', 'audio-v1', 'free','published', now())`

console.log(`seeded /listen/${slug}  (${Math.round(durationSeconds)}s)`)
await sql.end()
