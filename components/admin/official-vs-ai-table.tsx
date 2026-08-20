'use client'

interface ComparisonField {
  field: string
  official: number | null
  ai: number | null
  delta: number | null
  percent_off: number | null
}

interface OfficialVsAiTableProps {
  fields: ComparisonField[]
  officialGross?: number | null
  aiGross?: number | null
  grossDelta?: number | null
  aiConfidencePercent?: number | null
}

export function OfficialVsAiTable({
  fields,
  officialGross,
  aiGross,
  grossDelta,
  aiConfidencePercent,
}: OfficialVsAiTableProps) {
  const mae = fields.length > 0
    ? fields.reduce((sum, f) => sum + Math.abs(f.delta ?? 0), 0) / fields.filter(f => f.delta != null).length
    : null

  const within3Pct = fields.filter(f => f.percent_off != null && Math.abs(f.percent_off) <= 3).length
  const pctWithin3 = fields.length > 0 ? Math.round((within3Pct / fields.length) * 100) : null

  function rowColor(pct: number | null) {
    if (pct == null) return ''
    if (Math.abs(pct) > 10) return 'bg-red-500/10 border-red-500/20'
    if (Math.abs(pct) > 5) return 'bg-amber-500/10 border-amber-500/20'
    return ''
  }

  return (
    <div className="space-y-4">
      {/* Gross score summary */}
      {officialGross != null && (
        <div className="grid grid-cols-3 gap-3 text-sm">
          <div className="rounded-lg border border-border/40 bg-card p-3 text-center">
            <div className="text-xs text-muted-foreground mb-1">Official Gross</div>
            <div className="text-xl font-bold">{officialGross.toFixed(1)}"</div>
          </div>
          <div className="rounded-lg border border-border/40 bg-card p-3 text-center">
            <div className="text-xs text-muted-foreground mb-1">AI Gross</div>
            <div className="text-xl font-bold">{aiGross?.toFixed(1) ?? '—'}"</div>
            {aiConfidencePercent != null && (
              <div className="text-xs text-muted-foreground mt-0.5">{aiConfidencePercent}% confidence</div>
            )}
          </div>
          <div className="rounded-lg border border-border/40 bg-card p-3 text-center">
            <div className="text-xs text-muted-foreground mb-1">Gross Delta</div>
            <div className={`text-xl font-bold ${grossDelta != null && Math.abs(grossDelta) > 5 ? 'text-red-500' : grossDelta != null && Math.abs(grossDelta) > 2 ? 'text-amber-500' : ''}`}>
              {grossDelta != null ? `${grossDelta >= 0 ? '+' : ''}${grossDelta.toFixed(1)}"` : '—'}
            </div>
          </div>
        </div>
      )}

      {/* Per-field table */}
      <div className="overflow-x-auto rounded-lg border border-border/40">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border/40 bg-secondary/20">
              <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Field</th>
              <th className="px-3 py-2 text-right font-semibold text-muted-foreground">Official</th>
              <th className="px-3 py-2 text-right font-semibold text-muted-foreground">AI</th>
              <th className="px-3 py-2 text-right font-semibold text-muted-foreground">Delta</th>
              <th className="hidden px-3 py-2 text-right font-semibold text-muted-foreground sm:table-cell">% Off</th>
            </tr>
          </thead>
          <tbody>
            {fields.map((f) => (
              <tr
                key={f.field}
                className={`border-b border-border/20 last:border-0 ${rowColor(f.percent_off)}`}
              >
                <td className="px-3 py-1.5 font-mono text-foreground">{f.field}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">
                  {f.official != null ? f.official.toFixed(3) + '"' : '—'}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                  {f.ai != null ? f.ai.toFixed(3) + '"' : '—'}
                </td>
                <td className={`px-3 py-1.5 text-right tabular-nums ${f.delta != null && Math.abs(f.delta) > 2 ? 'text-amber-500' : ''}`}>
                  {f.delta != null ? `${f.delta >= 0 ? '+' : ''}${f.delta.toFixed(3)}"` : '—'}
                </td>
                <td className={`hidden px-3 py-1.5 text-right tabular-nums font-medium sm:table-cell ${f.percent_off != null && Math.abs(f.percent_off) > 10 ? 'text-red-500' : f.percent_off != null && Math.abs(f.percent_off) > 5 ? 'text-amber-500' : ''}`}>
                  {f.percent_off != null ? `${f.percent_off >= 0 ? '+' : ''}${f.percent_off.toFixed(1)}%` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Aggregate stats footer */}
      {mae != null && (
        <div className="flex gap-6 text-xs text-muted-foreground">
          <span>MAE: <span className="text-foreground font-medium">{mae.toFixed(3)}"</span></span>
          {pctWithin3 != null && (
            <span>Within 3%: <span className="text-foreground font-medium">{pctWithin3}%</span></span>
          )}
        </div>
      )}
    </div>
  )
}
