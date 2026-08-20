import {
  flattenOfficialScoreData,
  formatInchesAsEighths,
} from '@/lib/training/official-measurements'

/**
 * Renders a stored official sheet the way a B&C chart reads — a row per
 * measurement with Left / Right / Difference, then the totals — instead of a
 * raw JSON dump. Values are shown in eighths because that is how they were
 * measured and entered; making the operator convert decimals in their head is
 * how transcription errors get missed.
 */

const ROWS: Array<{ key: string; label: string }> = [
  { key: 'main_beam', label: 'Main Beam' },
  { key: 'g1', label: 'G1 (brow)' },
  { key: 'g2', label: 'G2' },
  { key: 'g3', label: 'G3' },
  { key: 'g4', label: 'G4' },
  { key: 'g5', label: 'G5' },
  { key: 'h1', label: 'H1 (base)' },
  { key: 'h2', label: 'H2' },
  { key: 'h3', label: 'H3' },
  { key: 'h4', label: 'H4' },
]

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

export function OfficialScoreSheetView({ scoreData }: { scoreData: unknown }) {
  const data = (scoreData ?? {}) as Record<string, unknown>
  const flat = flattenOfficialScoreData(scoreData)

  const spread = num(data.inside_spread)
  const abnormal = num(data.abnormal_points)
  const gross = num(data.calculated_gross)
  const net = num(data.calculated_net)
  const deductions = num(data.calculated_deductions)
  const system = typeof data.scoring_system === 'string' ? data.scoring_system : null

  // Spread credit may equal but not exceed the longer beam (§3.54).
  const beams = [num(flat.main_beam_left), num(flat.main_beam_right)]
    .filter((v): v is number => v != null && v > 0)
  const spreadCredit = spread == null
    ? null
    : beams.length > 0 ? Math.min(spread, Math.max(...beams)) : spread
  const spreadCapped = spread != null && spreadCredit != null && spreadCredit < spread

  let diffTotal = 0
  const rows = ROWS.map(r => {
    const left = num(flat[`${r.key}_left`])
    const right = num(flat[`${r.key}_right`])
    const diff = left != null && right != null ? Math.abs(left - right) : null
    if (diff != null) diffTotal += diff
    return { ...r, left, right, diff }
  })

  return (
    <div className="space-y-4">
      {system && (
        <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
          {system.replace(/_/g, ' ')}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-border/40">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/50 bg-secondary/20 text-xs text-muted-foreground">
              <th className="py-2 pl-3 pr-2 text-left font-medium">Measurement</th>
              <th className="px-2 py-2 text-right font-medium">Left</th>
              <th className="px-2 py-2 text-right font-medium">Right</th>
              <th className="py-2 pl-2 pr-3 text-right font-medium">Diff</th>
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums">
            {rows.map(r => {
              const empty = r.left == null && r.right == null
              return (
                <tr
                  key={r.key}
                  className={`border-b border-border/30 last:border-0 ${empty ? 'opacity-40' : ''}`}
                >
                  <td className="py-1.5 pl-3 pr-2 font-sans text-muted-foreground">{r.label}</td>
                  <td className="px-2 py-1.5 text-right">{formatInchesAsEighths(r.left)}</td>
                  <td className="px-2 py-1.5 text-right">{formatInchesAsEighths(r.right)}</td>
                  <td className="py-1.5 pl-2 pr-3 text-right text-muted-foreground">
                    {r.diff != null && r.diff > 0 ? formatInchesAsEighths(r.diff) : '—'}
                  </td>
                </tr>
              )
            })}
            <tr className="border-t border-border/50 bg-secondary/10">
              <td className="py-1.5 pl-3 pr-2 font-sans text-muted-foreground">
                Inside Spread
                {spreadCapped && (
                  <span className="ml-1 text-[10px] text-amber-600 dark:text-amber-400">
                    capped at longer beam
                  </span>
                )}
              </td>
              <td className="px-2 py-1.5 text-right" colSpan={2}>
                {formatInchesAsEighths(spreadCredit)}
                {spreadCapped && (
                  <span className="ml-1 text-xs text-muted-foreground line-through">
                    {formatInchesAsEighths(spread)}
                  </span>
                )}
              </td>
              <td className="py-1.5 pl-2 pr-3 text-right text-muted-foreground">—</td>
            </tr>
            <tr className="bg-secondary/10">
              <td className="py-1.5 pl-3 pr-2 font-sans text-muted-foreground">Abnormal Points</td>
              <td className="px-2 py-1.5 text-right font-mono" colSpan={2}>
                {formatInchesAsEighths(abnormal)}
              </td>
              <td className="py-1.5 pl-2 pr-3 text-right text-muted-foreground">—</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Total label="Gross" value={gross} />
        <Total
          label="Deductions"
          value={deductions}
          hint={diffTotal > 0 ? `asymmetry ${formatInchesAsEighths(diffTotal)}` : undefined}
          tone="warn"
        />
        <Total label="Net" value={net} tone="good" />
      </div>
    </div>
  )
}

function Total({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: number | null
  hint?: string
  tone?: 'good' | 'warn'
}) {
  const color =
    tone === 'good' ? 'text-emerald-600 dark:text-emerald-400'
    : tone === 'warn' ? 'text-amber-600 dark:text-amber-400'
    : ''
  return (
    <div className="min-w-0 rounded-lg border border-border/40 bg-secondary/20 p-3 text-center">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`font-mono text-base font-bold leading-tight break-words sm:text-lg ${color}`}>
        {formatInchesAsEighths(value)}
      </div>
      {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  )
}
