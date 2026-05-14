export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getServiceSupabase } from '@/lib/supabase/admin'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { TrainingImportForm } from '@/components/admin/training-import-form'
import Link from 'next/link'
import { Star, ChevronRight } from 'lucide-react'

export default async function AdminTrainingImportPage() {
  const db = await createClient()
  const { data: { user } } = await db.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await db.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) redirect('/score')

  // Load pending sheets (not yet promoted)
  const adminDb = await getServiceSupabase()
  const { data: pendingSheets } = await adminDb
    .from('official_score_sheets')
    .select('id, scoring_system, buck_name, year_taken, created_at, is_benchmark, ai_run_result')
    .eq('is_benchmark', false)
    .order('created_at', { ascending: false })
    .limit(20)

  const { data: goldSheets } = await adminDb
    .from('official_score_sheets')
    .select('id, scoring_system, buck_name, year_taken, promoted_at')
    .eq('is_benchmark', true)
    .order('promoted_at', { ascending: false })
    .limit(10)

  return (
    <div className="p-4 lg:p-6 space-y-8 max-w-5xl">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">Import Training Data</h1>
        <p className="text-muted-foreground">
          Upload official B&C / P&Y score sheets. Run AI scoring for comparison. Promote to gold standard.
        </p>
      </div>

      {/* Import form */}
      <Card>
        <CardHeader>
          <CardTitle>New Official Score Import</CardTitle>
          <CardDescription>
            Import a Boone & Crockett or Pope & Young score sheet with associated images.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TrainingImportForm />
        </CardContent>
      </Card>

      {/* Pending sheets */}
      {pendingSheets && pendingSheets.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Pending Sheets</h2>
          <div className="space-y-2">
            {(pendingSheets as Array<{
              id: string
              scoring_system: string | null
              buck_name: string | null
              year_taken: number | null
              created_at: string
              is_benchmark: boolean
              ai_run_result: unknown
            }>).map((sheet) => (
              <Link
                key={sheet.id}
                href={`/admin/training-import/${sheet.id}`}
                className="flex items-center justify-between px-4 py-3 rounded-lg border border-border/40 bg-card hover:bg-secondary/20 transition-colors"
              >
                <div>
                  <span className="font-medium text-sm">{sheet.buck_name ?? `Sheet ${sheet.id.slice(0, 8)}`}</span>
                  <span className="ml-3 text-xs text-muted-foreground">
                    {sheet.scoring_system ?? 'B&C'} · {sheet.year_taken ?? '—'} · imported {new Date(sheet.created_at).toLocaleDateString()}
                  </span>
                  {Boolean(sheet.ai_run_result) && (
                    <span className="ml-2 text-xs text-emerald-600">AI run ✓</span>
                  )}
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Gold standard sheets */}
      {goldSheets && goldSheets.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
            <Star className="h-3.5 w-3.5 text-amber-500" />
            Gold Standard
          </h2>
          <div className="space-y-2">
            {(goldSheets as Array<{
              id: string
              scoring_system: string | null
              buck_name: string | null
              year_taken: number | null
              promoted_at: string | null
            }>).map((sheet) => (
              <Link
                key={sheet.id}
                href={`/admin/training-import/${sheet.id}`}
                className="flex items-center justify-between px-4 py-3 rounded-lg border border-amber-500/20 bg-amber-500/5 hover:bg-amber-500/10 transition-colors"
              >
                <div>
                  <span className="font-medium text-sm">{sheet.buck_name ?? `Sheet ${sheet.id.slice(0, 8)}`}</span>
                  <span className="ml-3 text-xs text-muted-foreground">
                    {sheet.scoring_system ?? 'B&C'} · {sheet.year_taken ?? '—'}
                    {sheet.promoted_at && ` · promoted ${new Date(sheet.promoted_at).toLocaleDateString()}`}
                  </span>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
