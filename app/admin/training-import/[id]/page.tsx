import { createClient } from '@/lib/supabase/server'
import { getServiceSupabase } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { OfficialVsAiTable } from '@/components/admin/official-vs-ai-table'
import { OfficialScoreSheetView } from '@/components/admin/official-score-sheet-view'
import {
  humanizeTag,
  IMAGE_CONTEXT_LABELS,
  officialImageTypeToAngle,
} from '@/lib/training/official-measurements'
import { PerAngleAccuracy, type PerAngleReport } from '@/components/admin/per-angle-accuracy'
import { SheetDetailClient } from './sheet-detail-client'

export default async function TrainingImportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const db = await createClient()
  const { data: { user } } = await db.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await db.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) redirect('/score')

  const adminDb = await getServiceSupabase()
  const { data: sheet } = await adminDb
    .from('official_score_sheets')
    .select('*')
    .eq('id', id)
    .single()

  if (!sheet) redirect('/admin/training-import')

  const { data: images } = await adminDb
    .from('official_score_images')
    .select('*')
    .eq('sheet_id', id)
    .order('uploaded_at', { ascending: true })

  const aiRunResult = sheet.ai_run_result as {
    run_at?: string
    ai_gross?: number | null
    official_gross?: number | null
    gross_delta?: number | null
    fields?: Array<{ field: string; official: number | null; ai: number | null; delta: number | null; percent_off: number | null }>
    ai_confidence_percent?: number | null
  } | null

  const perAngle = (sheet.ai_run_per_angle as PerAngleReport | null) ?? null

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold">
            {sheet.buck_name ?? `Sheet ${id.slice(0, 8)}`}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {sheet.scoring_system ?? 'B&C'} · {sheet.year_taken ?? '—'} · {sheet.state ?? '—'}
          </p>
        </div>
        {sheet.is_benchmark && (
          <span className="px-2 py-1 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-600 border border-emerald-500/30">
            Gold Standard
          </span>
        )}
      </div>

      {/* Images */}
      {images && images.length > 0 && (() => {
        type Img = { id: string; image_url: string; image_type?: string; image_context?: string }
        const all = images as Img[]
        // Group by hemisphere so a 9+ photo set reads as a set, not a wall.
        const groups: Array<{ title: string; items: Img[] }> = [
          { title: 'Front', items: all.filter(i => officialImageTypeToAngle(i.image_type) !== 'back' && i.image_type !== 'irregular_points') },
          { title: 'Back', items: all.filter(i => officialImageTypeToAngle(i.image_type) === 'back') },
          { title: 'Other', items: all.filter(i => i.image_type === 'irregular_points') },
        ].filter(g => g.items.length > 0)

        return (
          <section className="space-y-4">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Buck Gallery <span className="ml-1 font-normal normal-case">({all.length} photos)</span>
            </h2>
            {groups.map(group => (
              <div key={group.title} className="space-y-2">
                <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                  {group.title} · {group.items.length}
                </p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {group.items.map((img) => (
                    <div key={img.id} className="min-w-0 overflow-hidden rounded-lg border border-border/40">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={img.image_url}
                        alt={humanizeTag(img.image_type)}
                        className="aspect-square w-full object-cover"
                      />
                      <div className="space-y-0.5 bg-secondary/30 px-2 py-1.5">
                        <div className="text-[11px] font-medium leading-tight break-words">
                          {humanizeTag(img.image_type)}
                        </div>
                        {img.image_context && (
                          <div className="text-[10px] leading-tight text-muted-foreground">
                            {IMAGE_CONTEXT_LABELS[img.image_context] ?? humanizeTag(img.image_context)}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </section>
        )
      })()}

      {/* Official measurements */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Official Measurements</h2>
        <OfficialScoreSheetView scoreData={sheet.score_data} />
      </section>

      {/* AI comparison */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">AI vs Official</h2>
        {aiRunResult?.fields ? (
          <>
            <p className="text-xs text-muted-foreground">
              Run at {aiRunResult.run_at ? new Date(aiRunResult.run_at).toLocaleString() : '—'}
            </p>
            <OfficialVsAiTable
              fields={aiRunResult.fields}
              officialGross={aiRunResult.official_gross}
              aiGross={aiRunResult.ai_gross}
              grossDelta={aiRunResult.gross_delta}
              aiConfidencePercent={aiRunResult.ai_confidence_percent}
            />
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            No AI run yet. Click "Run AI" to generate a comparison.
          </p>
        )}
      </section>

      {/* Per-angle accuracy — each image scored on its own vs the same truth */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Accuracy by Angle
        </h2>
        <PerAngleAccuracy
          sheetId={id}
          report={perAngle}
          imageCount={images?.length ?? 0}
        />
      </section>

      {/* Client actions: Run AI + Promote */}
      <SheetDetailClient
        sheetId={id}
        isAlreadyBenchmark={sheet.is_benchmark ?? false}
        hasAiRun={!!aiRunResult}
      />
    </div>
  )
}
