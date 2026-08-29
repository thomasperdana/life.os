import { desc } from 'drizzle-orm'
import { db, contentItems } from '@/db'
import { PublishToggle } from './PublishToggle'

export const dynamic = 'force-dynamic'

function human(bytes: number | null) {
  if (!bytes) return '—'
  const mb = bytes / 1024 / 1024
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`
}

export default async function AdminContentPage() {
  const items = await db.select().from(contentItems).orderBy(desc(contentItems.createdAt))

  return (
    <section className="space-y-6">
      <h1 className="text-xl font-semibold tracking-tight">Content</h1>

      {items.length === 0 ? (
        <p className="text-sm text-black/60 dark:text-white/60">
          Nothing uploaded yet. Use the Upload tab.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-black/50 dark:text-white/50">
              <tr className="border-b border-black/10 dark:border-white/15">
                <th className="py-2 pr-4 font-medium">Title</th>
                <th className="py-2 pr-4 font-medium">Kind</th>
                <th className="py-2 pr-4 font-medium">Size</th>
                <th className="py-2 pr-4 font-medium">Pages / Length</th>
                <th className="py-2 pr-4 font-medium">Tier</th>
                <th className="py-2 pr-4 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id} className="border-b border-black/5 dark:border-white/10">
                  <td className="py-2.5 pr-4 font-medium">{i.title}</td>
                  <td className="py-2.5 pr-4 uppercase text-xs">{i.kind}</td>
                  <td className="py-2.5 pr-4 tabular-nums">{human(i.byteSize)}</td>
                  <td className="py-2.5 pr-4 tabular-nums">
                    {i.kind === 'pdf'
                      ? i.pageCount ? `${i.pageCount} pp` : '—'
                      : i.durationSeconds ? `${Math.floor(i.durationSeconds / 60)}m ${i.durationSeconds % 60}s` : '—'}
                  </td>
                  <td className="py-2.5 pr-4">{i.accessTier}</td>
                  <td className="py-2.5 pr-4"><PublishToggle id={i.id} status={i.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
