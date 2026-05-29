import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Target } from 'lucide-react'
import type { ModelRunMetrics } from '@/lib/types'

interface BenchmarkHeadlineMetricsProps {
  metrics: ModelRunMetrics
}

function fmt(n: number | null | undefined, suffix = ''): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return `${n.toFixed(1)}${suffix}`
}

function pct(count: number, total: number): string {
  if (!total) return '—'
  return `${Math.round((count / total) * 100)}%`
}

/**
 * The mission-critical readout: "how far off are we, on real gold-standard
 * racks?" Mean/median absolute error vs official sheets, plus the within-band
 * distribution. Numbers are AI-vs-ground-truth, not estimates.
 */
export function BenchmarkHeadlineMetrics({ metrics }: BenchmarkHeadlineMetricsProps) {
  const n = metrics.example_count
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Target className="h-5 w-5" />
          Measured Accuracy
        </CardTitle>
        <CardDescription>
          {metrics.model_version_name || 'Candidate model'} scored against{' '}
          {n} gold-standard {n === 1 ? 'rack' : 'racks'} with official measurements.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <Stat label="MAE Gross" value={fmt(metrics.avg_gross_error, '″')} emphasis />
          <Stat label="Median Gross" value={fmt(metrics.median_gross_error, '″')} />
          <Stat label="MAE Net" value={fmt(metrics.avg_net_error, '″')} />
          <Stat label="Within 5″" value={pct(metrics.within_5_inches, n)} />
          <Stat label="Within 10″" value={pct(metrics.within_10_inches, n)} />
          <Stat
            label="Over / Under"
            value={`${metrics.overestimation_count} / ${metrics.underestimation_count}`}
          />
        </div>
      </CardContent>
    </Card>
  )
}

function Stat({
  label,
  value,
  emphasis = false,
}: {
  label: string
  value: string
  emphasis?: boolean
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={emphasis ? 'text-2xl font-bold' : 'text-xl font-semibold'}>{value}</p>
    </div>
  )
}
