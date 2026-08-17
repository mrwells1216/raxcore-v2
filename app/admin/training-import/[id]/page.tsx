import { createClient } from '@/lib/supabase/server'
import { getServiceSupabase } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { OfficialVsAiTable } from '@/components/admin/official-vs-ai-table'
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
      {images && images.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Images</h2>
          <div className="grid grid-cols-3 gap-3">
            {(images as Array<{ id: string; image_url: string; image_type?: string }>).map((img) => (
              <div key={img.id} className="rounded-lg overflow-hidden border border-border/40">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.image_url} alt={img.image_type ?? 'image'} className="w-full aspect-square object-cover" />
                {img.image_type && (
                  <div className="px-2 py-1 text-xs text-muted-foreground bg-secondary/30">{img.image_type}</div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Official measurements */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Official Measurements</h2>
        <pre className="text-xs bg-secondary/20 rounded-lg p-4 overflow-auto border border-border/40 whitespace-pre-wrap">
          {JSON.stringify(sheet.score_data, null, 2)}
        </pre>
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
