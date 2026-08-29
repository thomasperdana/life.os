import { createClient } from '@supabase/supabase-js'
import postgres from 'postgres'
import { PDFDocument, StandardFonts } from 'pdf-lib'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const sql = postgres(process.env.DIRECT_URL!, { prepare: false, max: 1, idle_timeout: 10 })
const pass = (n: string, ok: boolean, extra = '') =>
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`)

// --- fixtures -------------------------------------------------------------
async function makePdf(pages: number) {
  const d = await PDFDocument.create()
  const f = await d.embedFont(StandardFonts.Helvetica)
  for (let i = 0; i < pages; i++) d.addPage([300, 400]).drawText(`p${i + 1}`, { x: 20, y: 20, size: 10, font: f })
  return await d.save()
}
/** Minimal silent MP3: ID3v2 header + a few MPEG frames. */
function makeMp3() {
  const id3 = Uint8Array.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0])
  const frame = new Uint8Array(418); frame[0] = 0xff; frame[1] = 0xfb; frame[2] = 0x90; frame[3] = 0x00
  const frames = new Uint8Array(frame.length * 40)
  for (let i = 0; i < 40; i++) frames.set(frame, i * frame.length)
  const out = new Uint8Array(id3.length + frames.length)
  out.set(id3); out.set(frames, id3.length)
  return out
}

const cleanup: string[] = []
try {
  console.log('\nMAGIC-BYTE VALIDATION (§7.2)')
  const { FORMATS } = await import('../src/lib/content-format')
  const pdfBytes = await makePdf(3), mp3Bytes = makeMp3()
  pass('real PDF accepted as pdf',      FORMATS.pdf.matches(pdfBytes))
  pass('real MP3 accepted as audio',    FORMATS.audio.matches(mp3Bytes))
  pass('PDF bytes REJECTED as audio',   !FORMATS.audio.matches(pdfBytes))
  pass('MP3 bytes REJECTED as pdf',     !FORMATS.pdf.matches(mp3Bytes))
  const zip = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0, 0])
  pass('ZIP renamed .pdf REJECTED',     !FORMATS.pdf.matches(zip))

  console.log('\nSTORAGE ROUND-TRIP (live Supabase)')
  for (const [kind, bytes, ct] of [
    ['pdf', pdfBytes, 'application/pdf'],
    ['audio', mp3Bytes, 'audio/mpeg'],
  ] as const) {
    const path = `${kind === 'pdf' ? 'pdf' : 'audio'}/p1-check-${Date.now()}.${kind === 'pdf' ? 'pdf' : 'mp3'}`
    cleanup.push(path)
    const { error } = await admin.storage.from('content')
      .upload(path, bytes as unknown as ArrayBuffer, { contentType: ct, upsert: true })
    pass(`${kind} uploaded to private bucket`, !error, error?.message ?? '')

    const { data: signed } = await admin.storage.from('content').createSignedUrl(path, 60)
    pass(`${kind} signed URL minted`, !!signed?.signedUrl)

    // §4.4 GATE: does Supabase honour HTTP range requests?
    const r = await fetch(signed!.signedUrl, { headers: { Range: 'bytes=0-15' } })
    const body = new Uint8Array(await r.arrayBuffer())
    pass(`${kind} RANGE request honoured`, r.status === 206,
         `HTTP ${r.status}, ${body.byteLength} bytes, content-range="${r.headers.get('content-range') ?? 'none'}"`)
  }

  console.log('\nUNSIGNED ACCESS MUST FAIL')
  const pub = `${url}/storage/v1/object/public/content/${cleanup[0]}`
  const unsigned = await fetch(pub)
  pass('private bucket refuses unsigned GET', !unsigned.ok, `HTTP ${unsigned.status}`)

  console.log('\nINGEST METADATA')
  const parsed = await PDFDocument.load(pdfBytes)
  pass('pdf page count extracted', parsed.getPageCount() === 3, `${parsed.getPageCount()} pages`)
  const mm = await import('music-metadata')
  const meta = await mm.parseBuffer(mp3Bytes, { mimeType: 'audio/mpeg' }, { duration: true })
  pass('mp3 parsed by music-metadata', !!meta.format.container, `container=${meta.format.container}`)

  console.log('\nDB CHECK CONSTRAINTS (§6)')
  const bad = await sql`
    select count(*)::int n from pg_constraint
    where conname in ('content_kind_fields','bookmark_anchor','review_rating_range')`
  pass('kind/anchor/rating constraints live', bad[0].n === 3, `${bad[0].n}/3`)
} catch (e) {
  console.error('\nERROR:', (e as Error).message)
  process.exitCode = 1
} finally {
  if (cleanup.length) {
    await admin.storage.from('content').remove(cleanup)
    console.log(`\n  cleaned up ${cleanup.length} test object(s)`)
  }
  await sql.end()
}
