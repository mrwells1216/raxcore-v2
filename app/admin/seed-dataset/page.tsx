export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { getServiceSupabase } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Database, ImageIcon } from 'lucide-react'

export default async function SeedDatasetPage() {
  const db = await createClient()
  const { data: { user } } = await db.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await db.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) redirect('/score')

  const adminDb = await getServiceSupabase()

  // Summary by source
  const { data: sourceCounts } = await adminDb
    .from('seed_training_images')
    .select('source')
    .limit(5000)

  const bySource: Record<string, number> = {}
  for (const row of (sourceCounts ?? [])) {
    bySource[row.source] = (bySource[row.source] ?? 0) + 1
  }

  // Class distribution
  const { data: classCounts } = await adminDb
    .from('seed_training_images')
    .select('class_name')
    .not('class_name', 'is', null)
    .limit(5000)

  const byClass: Record<string, number> = {}
  for (const row of (classCounts ?? [])) {
    if (row.class_name) byClass[row.class_name] = (byClass[row.class_name] ?? 0) + 1
  }

  // Recent entries
  const { data: recent } = await adminDb
    .from('seed_training_images')
    .select('id, source, image_url, class_name, bbox, created_at')
    .order('created_at', { ascending: false })
    .limit(20)

  const totalRows = Object.values(bySource).reduce((a, b) => a + b, 0)

  return (
    <div className="p-4 lg:p-6 space-y-8 max-w-5xl">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">Seed Dataset</h1>
        <p className="text-muted-foreground">
          Detection-labeled images from Roboflow and other external sources. These provide bounding-box ground truth
          for admission-control benchmarking but do not contain B&C scores.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-5 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Database className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{totalRows.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">Total Rows</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <ImageIcon className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{Object.keys(bySource).length}</p>
              <p className="text-xs text-muted-foreground">Sources</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Database className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{Object.keys(byClass).length}</p>
              <p className="text-xs text-muted-foreground">Classes</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Source breakdown */}
      {Object.keys(bySource).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">By Source</CardTitle>
            <CardDescription>Import more via <code className="text-xs bg-secondary/50 px-1 py-0.5 rounded">pnpm tsx scripts/seed-roboflow-dataset.ts</code></CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {Object.entries(bySource).sort((a, b) => b[1] - a[1]).map(([src, count]) => (
                <div key={src} className="flex items-center justify-between text-sm">
                  <span className="font-mono text-xs text-muted-foreground truncate max-w-xs">{src}</span>
                  <span className="font-medium tabular-nums">{count.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Class breakdown */}
      {Object.keys(byClass).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Class Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {Object.entries(byClass).sort((a, b) => b[1] - a[1]).map(([cls, count]) => (
                <div key={cls} className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-secondary/30 border border-border/40 text-xs">
                  <span className="font-medium">{cls}</span>
                  <span className="text-muted-foreground">{count}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent rows */}
      {totalRows === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground text-sm">
            <p>No seed images yet.</p>
            <p className="mt-2 font-mono text-xs bg-secondary/30 rounded p-2 inline-block">
              pnpm tsx scripts/seed-roboflow-dataset.ts
            </p>
          </CardContent>
        </Card>
      ) : recent && recent.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Recent Entries</h2>
          <div className="rounded-lg border border-border/40 overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/40 bg-secondary/20">
                  <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Source</th>
                  <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Class</th>
                  <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Has BBox</th>
                  <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Added</th>
                </tr>
              </thead>
              <tbody>
                {(recent as Array<{ id: string; source: string; class_name: string | null; bbox: unknown; created_at: string }>).map(row => (
                  <tr key={row.id} className="border-b border-border/20 last:border-0">
                    <td className="px-3 py-1.5 font-mono text-muted-foreground truncate max-w-[220px]">{row.source}</td>
                    <td className="px-3 py-1.5">{row.class_name ?? '—'}</td>
                    <td className="px-3 py-1.5">{row.bbox ? 'Yes' : 'No'}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{new Date(row.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
