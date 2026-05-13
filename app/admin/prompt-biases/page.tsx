export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getBiasReport } from '@/lib/scoring/prompt-bias-correction'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { TrendingDown, TrendingUp, Minus } from 'lucide-react'

export default async function PromptBiasesPage() {
  const db = await createClient()
  const { data: { user } } = await db.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await db.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) redirect('/score')

  const report = await getBiasReport()

  const active = report.fields.filter(f => Math.abs(f.correctionApplied) > 0)
  const inactive = report.fields.filter(f => f.correctionApplied === 0)

  return (
    <div className="p-4 lg:p-6 space-y-8 max-w-4xl">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">Prompt Bias Corrections</h1>
        <p className="text-muted-foreground">
          Systematic per-field over/under-scoring detected from user correction events. Fields with
          ≥10 samples and |mean delta| ≥ 0.5&quot; have corrections applied automatically before scoring.
        </p>
        {report.generatedAt && (
          <p className="text-xs text-muted-foreground">
            Generated at {new Date(report.generatedAt).toLocaleString()}
          </p>
        )}
      </div>

      {report.fields.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground text-sm">
            No correction events recorded yet. Corrections accumulate as users edit AI scores.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Active corrections */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Active Corrections ({active.length})
            </h2>
            {active.length === 0 ? (
              <p className="text-sm text-muted-foreground">No fields have crossed the correction threshold yet.</p>
            ) : (
              <div className="rounded-lg border border-border/40 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/40 bg-secondary/20">
                      <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Field</th>
                      <th className="px-3 py-2 text-right font-semibold text-muted-foreground">Samples</th>
                      <th className="px-3 py-2 text-right font-semibold text-muted-foreground">Mean Delta</th>
                      <th className="px-3 py-2 text-right font-semibold text-muted-foreground">Correction Applied</th>
                      <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Direction</th>
                    </tr>
                  </thead>
                  <tbody>
                    {active.map(f => (
                      <tr key={f.fieldKey} className="border-b border-border/20 last:border-0">
                        <td className="px-3 py-2 font-mono text-xs">{f.fieldKey}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{f.sampleCount}</td>
                        <td className={`px-3 py-2 text-right tabular-nums font-medium ${
                          f.meanDelta > 0 ? 'text-amber-600' : 'text-blue-600'
                        }`}>
                          {f.meanDelta >= 0 ? '+' : ''}{f.meanDelta.toFixed(3)}&quot;
                        </td>
                        <td className={`px-3 py-2 text-right tabular-nums font-semibold ${
                          f.correctionApplied > 0 ? 'text-emerald-600' : 'text-red-500'
                        }`}>
                          {f.correctionApplied >= 0 ? '+' : ''}{f.correctionApplied.toFixed(3)}&quot;
                        </td>
                        <td className="px-3 py-2">
                          {f.meanDelta > 0 ? (
                            <span className="flex items-center gap-1 text-amber-600 text-xs">
                              <TrendingDown className="h-3.5 w-3.5" />AI under-estimated
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-blue-600 text-xs">
                              <TrendingUp className="h-3.5 w-3.5" />AI over-estimated
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Inactive / below threshold */}
          {inactive.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                Below Threshold ({inactive.length})
              </h2>
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-medium">Fields not yet corrected</CardTitle>
                  <CardDescription className="text-xs">
                    Need ≥10 samples and |mean delta| ≥ 0.5&quot; to trigger correction
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="rounded-lg border border-border/40 overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border/40 bg-secondary/20">
                          <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Field</th>
                          <th className="px-3 py-2 text-right font-semibold text-muted-foreground">Samples</th>
                          <th className="px-3 py-2 text-right font-semibold text-muted-foreground">Mean Delta</th>
                          <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {inactive.map(f => (
                          <tr key={f.fieldKey} className="border-b border-border/20 last:border-0">
                            <td className="px-3 py-1.5 font-mono">{f.fieldKey}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{f.sampleCount}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                              {f.meanDelta >= 0 ? '+' : ''}{f.meanDelta.toFixed(3)}&quot;
                            </td>
                            <td className="px-3 py-1.5 text-muted-foreground flex items-center gap-1">
                              <Minus className="h-3 w-3" />
                              {f.sampleCount < 10
                                ? `Needs ${10 - f.sampleCount} more samples`
                                : `|mean| < 0.5" threshold`}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </section>
          )}
        </>
      )}
    </div>
  )
}
