'use client'

/**
 * Per-angle accuracy report for an official (guide buck) score sheet.
 *
 * Each row is one image scored ON ITS OWN against the same certified
 * measurements, so the table answers "which camera angles does the scorer
 * handle well?" — something the all-images-together run cannot show.
 *
 * This is measurement only. Nothing here feeds live scoring, and a single
 * buck must not be used to set global constants.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'

export interface PerAngleEntry {
  imageType: string | null
  imageUrl: string
  angleType: string
  gross: number | null
  net: number | null
  grossDelta: number | null
  netDelta: number | null
  error?: string
}

export interface PerAngleReport {
  run_at?: string
  image_count?: number
  scored_count?: number
  official_gross?: number | null
  official_net?: number | null
  mae_gross?: number | null
  best_angle?: string | null
  worst_angle?: string | null
  angles?: PerAngleEntry[]
}

function deltaClass(delta: number | null): string {
  if (delta == null) return 'text-muted-foreground'
  const a = Math.abs(delta)
  if (a <= 3) return 'text-emerald-600 dark:text-emerald-400'
  if (a <= 8) return 'text-amber-600 dark:text-amber-400'
  return 'text-red-600 dark:text-red-400'
}

function fmt(v: number | null | undefined, digits = 1): string {
  return typeof v === 'number' && Number.isFinite(v) ? v.toFixed(digits) : '—'
}

function signed(v: number | null | undefined): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—'
  return `${v > 0 ? '+' : ''}${v.toFixed(1)}`
}

export function PerAngleAccuracy({
  sheetId,
  report,
  imageCount,
}: {
  sheetId: string
  report: PerAngleReport | null
  imageCount: number
}) {
  const router = useRouter()
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    setRunning(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/training-import/${sheetId}/run-ai-per-angle`, {
        method: 'POST',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? 'Per-angle run failed')
      if (data?.ok === false) throw new Error(data?.message ?? 'Per-angle run could not be saved')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Per-angle run failed')
    } finally {
      setRunning(false)
    }
  }

  const rows = report?.angles ?? []
  const sorted = [...rows].sort((a, b) => {
    const av = a.grossDelta == null ? Infinity : Math.abs(a.grossDelta)
    const bv = b.grossDelta == null ? Infinity : Math.abs(b.grossDelta)
    return av - bv
  })

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {report?.run_at
            ? `Run at ${new Date(report.run_at).toLocaleString()} · ${report.scored_count ?? 0}/${report.image_count ?? 0} angles scored`
            : `Scores each image separately (${imageCount} AI runs — slow and costs roughly ${imageCount}× one score).`}
        </p>
        <button
          type="button"
          onClick={run}
          disabled={running || imageCount === 0}
          className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs font-semibold hover:bg-secondary/50 disabled:opacity-50"
        >
          {running && <Loader2 className="h-3 w-3 animate-spin" />}
          {running ? 'Scoring each angle…' : report?.run_at ? 'Re-run per angle' : 'Run per angle'}
        </button>
      </div>

      {error && (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      )}

      {report?.run_at && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Mean gross error" value={`${fmt(report.mae_gross, 2)}"`} />
          <Stat label="Official gross" value={fmt(report.official_gross)} />
          <Stat label="Best angle" value={report.best_angle ?? '—'} />
          <Stat label="Worst angle" value={report.worst_angle ?? '—'} />
        </div>
      )}

      {sorted.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/50 text-muted-foreground">
                <th className="py-2 pr-3 text-left font-medium">Angle</th>
                <th className="py-2 px-2 text-right font-medium">Gross</th>
                <th className="py-2 px-2 text-right font-medium">Δ Gross</th>
                <th className="py-2 px-2 text-right font-medium">Net</th>
                <th className="py-2 pl-2 text-right font-medium">Δ Net</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.imageUrl} className="border-b border-border/30 last:border-0">
                  <td className="py-2 pr-3">
                    <span className="font-medium">{r.imageType ?? 'untagged'}</span>
                    {r.error && (
                      <span className="block text-[10px] text-red-600 dark:text-red-400">{r.error}</span>
                    )}
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums">{fmt(r.gross)}</td>
                  <td className={`py-2 px-2 text-right tabular-nums font-semibold ${deltaClass(r.grossDelta)}`}>
                    {signed(r.grossDelta)}
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums">{fmt(r.net)}</td>
                  <td className={`py-2 pl-2 text-right tabular-nums ${deltaClass(r.netDelta)}`}>
                    {signed(r.netDelta)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {report?.run_at && (
        <p className="text-[10px] text-muted-foreground">
          Sorted most accurate first. One buck shows which angles the scorer reads
          best; it is not enough on its own to set any global correction.
        </p>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/40 bg-secondary/20 p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold tabular-nums truncate">{value}</div>
    </div>
  )
}
