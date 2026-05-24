'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Check, X, ArrowUpRight, ArrowDownRight, RotateCcw } from 'lucide-react'
import {
  EXPERIMENT_FEATURE_KEYS,
  FEATURE_LABELS,
  type ExperimentFeatureKey,
} from '@/lib/scoring/experiment-config'

export interface ClassroomScoreResponse {
  buckId?: string
  estimatedScore?: number | null
  netScore?: number | null
  rawEstimatedScore?: number | null
  scoreRange?: { low?: number | null; high?: number | null } | null
  confidencePercent?: number | null
  featuresUsed?: Record<string, boolean> | null
  calibrationMeta?: {
    source?: string
    gross_bias?: number
    gross_multiplier?: number
  } | null
  prediction?: { id?: string } | null
}

interface ClassroomResultsProps {
  result: ClassroomScoreResponse
  /** When set, this run is a rescore and we show new-vs-old. */
  oldGross?: number | null
  onReset: () => void
}

function fmt(n: number | null | undefined, digits = 1): string {
  return typeof n === 'number' && Number.isFinite(n) ? n.toFixed(digits) : '—'
}

export function ClassroomResults({ result, oldGross, onReset }: ClassroomResultsProps) {
  const gross = result.estimatedScore ?? null
  const net = result.netScore ?? null
  const raw = result.rawEstimatedScore ?? null
  const featuresUsed = result.featuresUsed ?? null
  const calibMeta = result.calibrationMeta ?? null
  const delta =
    typeof gross === 'number' && typeof oldGross === 'number' ? gross - oldGross : null

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {oldGross != null ? 'Rescore result' : 'Score result'}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-end gap-6">
            <div>
              <p className="text-xs text-muted-foreground">Gross</p>
              <p className="text-3xl font-bold tabular-nums" style={{ color: 'var(--bronze-light)' }}>
                {fmt(gross)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Net</p>
              <p className="text-2xl font-semibold tabular-nums">{fmt(net)}</p>
            </div>
            {result.confidencePercent != null && (
              <div className="ml-auto">
                <Badge variant="secondary">{Math.round(result.confidencePercent)}% confidence</Badge>
              </div>
            )}
          </div>

          {result.scoreRange && (
            <p className="text-xs text-muted-foreground">
              Estimated range {fmt(result.scoreRange.low)}&quot; – {fmt(result.scoreRange.high)}&quot;
            </p>
          )}

          {oldGross != null && (
            <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
              <span className="text-muted-foreground">Previous: {fmt(oldGross)}</span>
              <span className="text-muted-foreground">→</span>
              <span className="font-semibold">New: {fmt(gross)}</span>
              {delta != null && (
                <span
                  className={`ml-auto inline-flex items-center gap-1 font-medium ${
                    delta >= 0 ? 'text-green-600' : 'text-amber-600'
                  }`}
                >
                  {delta >= 0 ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
                  {delta >= 0 ? '+' : ''}
                  {fmt(delta)}&quot;
                </span>
              )}
            </div>
          )}

          {calibMeta && (
            <p className="text-xs text-muted-foreground">
              Calibration: <span className="font-medium">{calibMeta.source ?? 'default'}</span>
              {typeof raw === 'number' && typeof gross === 'number' && raw !== gross && (
                <> · raw AI {fmt(raw)} {gross - raw >= 0 ? '+' : ''}{fmt(gross - raw)}&quot; applied</>
              )}
              {calibMeta.source === 'default' && ' (estimated — seeded, not yet learned)'}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Features used</CardTitle>
        </CardHeader>
        <CardContent>
          {featuresUsed ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              {EXPERIMENT_FEATURE_KEYS.map((key: ExperimentFeatureKey) => {
                const on = featuresUsed[key] !== false
                return (
                  <div key={key} className="flex items-center gap-2 text-sm">
                    {on ? (
                      <Check className="h-3.5 w-3.5 text-green-600 shrink-0" />
                    ) : (
                      <X className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    )}
                    <span className={on ? '' : 'text-muted-foreground line-through'}>
                      {FEATURE_LABELS[key]}
                    </span>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              All features ran (default configuration).
            </p>
          )}
        </CardContent>
      </Card>

      <Button variant="outline" onClick={onReset} className="w-full">
        <RotateCcw className="mr-2 h-4 w-4" />
        Run another
      </Button>
    </div>
  )
}
