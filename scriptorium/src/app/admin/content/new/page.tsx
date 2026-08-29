import { Uploader } from './Uploader'

export default function NewContentPage() {
  return (
    <section className="space-y-6 max-w-lg">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Upload</h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          PDF or MP3. The file goes straight to storage; the server validates its
          bytes and reads the page count or duration.
        </p>
      </div>
      <Uploader />
    </section>
  )
}
