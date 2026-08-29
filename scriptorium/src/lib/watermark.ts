import 'server-only'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

/**
 * Per-user PDF stamping — SPEC.3.md §8.1.
 *
 * Not DRM and not claimed to be. It makes casual redistribution traceable back
 * to a download_events row and costs the honest reader nothing.
 */
export async function watermarkPdf(
  bytes: Uint8Array,
  meta: { userId: string; itemId: string; downloadedAt: Date },
) {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false })
  const font = await pdf.embedFont(StandardFonts.Helvetica)

  const token = `${meta.userId.slice(0, 8)}-${meta.itemId.slice(0, 8)}`
  const label = `Licensed copy · ${token} · ${meta.downloadedAt.toISOString().slice(0, 10)}`

  for (const page of pdf.getPages()) {
    const { width } = page.getSize()
    page.drawText(label, {
      x: 24, y: 14, size: 7, font,
      color: rgb(0.55, 0.55, 0.55), opacity: 0.75,
      maxWidth: width - 48,
    })
  }
  return await pdf.save()
}
