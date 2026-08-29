import Link from 'next/link'
import { redirect } from 'next/navigation'
import { assertAdmin, NotAdminError } from '@/lib/admin'

/** Server-side gate on the whole admin tree. Each API route re-checks (§7.5 rule 2). */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  try {
    await assertAdmin()
  } catch (e) {
    if (e instanceof NotAdminError) {
      redirect(e.reason === 'unauthenticated' ? '/signin?next=/admin/content' : '/library')
    }
    throw e
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-10 space-y-8">
      <nav className="flex gap-6 text-sm border-b border-black/10 dark:border-white/15 pb-3">
        <Link href="/admin/content" className="font-medium">Content</Link>
        <Link href="/admin/content/new">Upload</Link>
        <Link href="/library" className="ml-auto text-black/50 dark:text-white/50">Library</Link>
      </nav>
      {children}
    </div>
  )
}
