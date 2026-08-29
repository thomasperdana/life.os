'use client'
import dynamic from 'next/dynamic'

/**
 * pdf.js needs browser globals (DOMMatrix, Path2D) that do not exist during
 * SSR. `ssr: false` is only legal inside a Client Component, which is the only
 * reason this wrapper exists.
 */
export const PdfReaderClient = dynamic(
  () => import('./PdfReader').then((m) => m.PdfReader),
  {
    ssr: false,
    loading: () => (
      <p className="text-center text-sm text-black/50 dark:text-white/50 py-24">Loading reader…</p>
    ),
  },
)
