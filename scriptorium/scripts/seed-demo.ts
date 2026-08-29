import { createClient } from '@supabase/supabase-js'
import postgres from 'postgres'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const sql = postgres(process.env.DIRECT_URL!, { prepare: false, max: 1, idle_timeout: 10 })

const email = 'demo@scriptorium.test'
const password = 'DemoPassword123!'
const slug = 'demo-reader'

// idempotent teardown
await sql`delete from public.progress where item_id in (select id from public.content_items where slug=${slug})`
await sql`delete from public.content_items where slug=${slug}`
const { data: list } = await admin.auth.admin.listUsers()
for (const u of list.users) if (u.email === email) await admin.auth.admin.deleteUser(u.id)

const { data: u, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
if (error) throw new Error(error.message)

const doc = await PDFDocument.create()
const font = await doc.embedFont(StandardFonts.HelveticaBold)
const body = await doc.embedFont(StandardFonts.Helvetica)
for (let i = 1; i <= 8; i++) {
  const p = doc.addPage([595, 842])
  p.drawText(`Chapter ${i}`, { x: 60, y: 740, size: 30, font, color: rgb(0.1, 0.1, 0.15) })
  p.drawText('The quick brown fox jumps over the lazy dog.', { x: 60, y: 690, size: 13, font: body })
  p.drawText(`This is page ${i} of 8 — selectable text proves the text layer is live.`,
    { x: 60, y: 664, size: 13, font: body })
}
const path = `pdf/${slug}.pdf`
await admin.storage.from('content').upload(path, (await doc.save()) as unknown as ArrayBuffer,
  { contentType: 'application/pdf', upsert: true })

await sql`
  insert into public.content_items (slug, kind, title, series, storage_path, page_count, byte_size, mime_type, access_tier, status, published_at)
  values (${slug},'pdf','Demo: The Quick Brown Fox','Demo',${path},8,0,'application/pdf','free','published',now())`

console.log(`seeded: ${email} / ${password}  ->  /read/${slug}`)
await sql.end()
