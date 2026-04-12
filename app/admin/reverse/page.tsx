'use client'

import useSWR from 'swr'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useState } from 'react'
import {
  Loader2,
  RotateCcw,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  TrendingUp,
  TrendingDown,
  Minus,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

// ─── Types ───────────────────────────────────────────────────────────────────

interface ReverseRun {
  id: string
  prediction_id: string
  buck_id: string | null
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  mode: string
  best_hypothesis_id: string | null
  best_summary: {
    predicted_gross?: number
    predicted_net?: number
    delta_gross?: number
    delta_net?: number
    hypothesis_type?: string
    hypothesis_rank?: number
    geometry_score?: number
    flags?: Record<string, unknown>
  } | null
  failure_reason: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
  failed_at: string | null
}

interface Candidate {
  id: string
  hypothesis_type: string
  hypothesis_rank: number
  params: Record<string, unknown>
}

interface Evaluation {
  total_score: number
  geometry_score: number
  change_penalty: number
  plausibility_penalty: number
  predicted_gross: number | null
  predicted_net: number | null
  delta_gross: number | null
  delta_net: number | null
  flags: Record<string, unknown> | null
}

interface Decomposition {
  causes: Array<{ cause: string; weight: number; evidence: string[] }>
  primary_cause: string | null
}

interface RunDetail {
  run: ReverseRun
  candidates: Candidate[]
  evaluations: Record<string, Evaluation>
  decomposition: Decomposition | null
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  completed: {
    icon: CheckCircle2,
    label: 'completed',
    class: 'text-green-600',
    variant: 'default' as const,
  },
  failed: {
    icon: XCircle,
    label: 'failed',
    class: 'text-destructive',
    variant: 'destructive' as const,
  },
  running: {
    icon: Loader2,
    label: 'running',
    class: 'text-blue-500 animate-spin',
    variant: 'secondary' as const,
  },
  queued: {
    icon: Clock,
    label: 'queued',
    class: 'text-muted-foreground',
    variant: 'outline' as const,
  },
  cancelled: {
    icon: AlertCircle,
    label: 'cancelled',
    class: 'text-muted-foreground',
    variant: 'outline' as const,
  },
}

function deltaColor(delta: number | null | undefined): string {
  if (delta == null) return 'text-muted-foreground'
  if (delta > 0.5) return 'text-green-600'
  if (delta < -0.5) return 'text-red-500'
  return 'text-muted-foreground'
}

function fmtDelta(delta: number | null | undefined): string {
  if (delta == null) return '—'
  const sign = delta >= 0 ? '+' : ''
  return `${sign}${delta.toFixed(1)}`
}

function fmtNum(n: number | null | undefined, decimals = 1): string {
  if (n == null) return '—'
  return n.toFixed(decimals)
}

function shortId(id: string): string {
  return id.slice(0, 8) + '…'
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function ReverseAdminPage() {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<string | null>(null)

  const { data, error, isLoading, mutate } = useSWR<{ runs: ReverseRun[] }>(
    '/api/admin/reverse/runs',
    fetcher,
    { refreshInterval: 15000 }
  )

  const allRuns = data?.runs ?? []

  const counts = {
    total: allRuns.length,
    completed: allRuns.filter((r) => r.status === 'completed').length,
    failed: allRuns.filter((r) => r.status === 'failed').length,
    active: allRuns.filter((r) => r.status === 'running' || r.status === 'queued').length,
  }

  // Avg delta gross among completed runs that improved
  const completedWithDelta = allRuns.filter(
    (r) => r.status === 'completed' && r.best_summary?.delta_gross != null
  )
  const avgDeltaGross =
    completedWithDelta.length > 0
      ? completedWithDelta.reduce(
          (sum, r) => sum + (r.best_summary!.delta_gross ?? 0),
          0
        ) / completedWithDelta.length
      : null

  const filtered = statusFilter
    ? allRuns.filter((r) => r.status === statusFilter)
    : allRuns

  const selectedRun = allRuns.find((r) => r.id === selectedRunId) ?? null

  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto space-y-5">
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <RotateCcw className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-xl font-semibold">Reverse Engineering</h1>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            Phase 50 precision pass — multi-hypothesis evaluation, error decomposition, HITL review
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => mutate()}
          className="shrink-0"
        >
          <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
          Refresh
        </Button>
      </div>

      {/* ── Stats Row ── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: 'Total', value: counts.total, filter: null },
          { label: 'Completed', value: counts.completed, filter: 'completed' },
          { label: 'Failed', value: counts.failed, filter: 'failed' },
          { label: 'Active', value: counts.active, filter: 'running' },
          {
            label: 'Avg delta',
            value: avgDeltaGross != null ? fmtDelta(avgDeltaGross) : '—',
            filter: null,
            raw: true,
          },
        ].map(({ label, value, filter, raw }) => (
          <button
            key={label}
            onClick={() => filter !== undefined && setStatusFilter(statusFilter === filter ? null : filter)}
            className={cn(
              'rounded-lg border p-3 text-left transition-colors',
              filter && statusFilter === filter
                ? 'border-primary bg-accent'
                : 'bg-card hover:bg-accent/50',
              filter ? 'cursor-pointer' : 'cursor-default'
            )}
          >
            <div
              className={cn(
                'text-2xl font-bold tabular-nums',
                raw && avgDeltaGross != null ? deltaColor(avgDeltaGross) : ''
              )}
            >
              {raw ? value : value}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
          </button>
        ))}
      </div>

      {/* ── Gating reference ── */}
      <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground flex flex-wrap gap-x-6 gap-y-1">
        <span><strong className="text-foreground">maxCandidates</strong> 28</span>
        <span><strong className="text-foreground">auto-apply Δgross</strong> ≤2″ @conf≥85% · else ≤4″</span>
        <span><strong className="text-foreground">minGeomGain</strong> 2%</span>
        <span><strong className="text-foreground">minSamples</strong> 30</span>
        <span><strong className="text-foreground">shadow rollout</strong> 10% → 25% → 100%</span>
      </div>

      {/* ── Error state ── */}
      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error?.message?.includes?.('reverse_runs') ||
          String(error).includes('reverse_runs')
            ? 'The reverse_runs table does not exist yet. Run migration 096_reverse_engineering_tables.sql.'
            : 'Failed to load reverse runs.'}
        </div>
      )}

      {/* ── Main grid ── */}
      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        {/* ── Runs table ── */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Precision Pass Runs</CardTitle>
                <CardDescription>
                  {statusFilter ? `Showing ${statusFilter} runs` : 'All runs'} · {filtered.length} total
                </CardDescription>
              </div>
              {statusFilter && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setStatusFilter(null)}
                  className="text-xs h-7"
                >
                  Clear filter
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading && (
              <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading runs…
              </div>
            )}

            {!isLoading && filtered.length === 0 && (
              <div className="p-8 text-center text-sm text-muted-foreground">
                {statusFilter
                  ? `No ${statusFilter} runs found.`
                  : 'No precision pass runs yet. Runs are enqueued automatically at 10% shadow rollout.'}
              </div>
            )}

            {filtered.length > 0 && (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="text-xs">
                      <TableHead className="w-8 pl-4" />
                      <TableHead>Status</TableHead>
                      <TableHead>Prediction</TableHead>
                      <TableHead>Hypothesis</TableHead>
                      <TableHead className="text-right">Gross</TableHead>
                      <TableHead className="text-right pr-1">Δgross</TableHead>
                      <TableHead className="hidden md:table-cell">Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((r) => {
                      const cfg =
                        STATUS_CONFIG[r.status] ?? STATUS_CONFIG.queued
                      const Icon = cfg.icon
                      const isActive = selectedRunId === r.id
                      const delta = r.best_summary?.delta_gross

                      return (
                        <TableRow
                          key={r.id}
                          className={cn(
                            'cursor-pointer text-sm transition-colors',
                            isActive ? 'bg-accent' : 'hover:bg-muted/40'
                          )}
                          onClick={() =>
                            setSelectedRunId(isActive ? null : r.id)
                          }
                        >
                          <TableCell className="pl-4 w-8">
                            {isActive ? (
                              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              <Icon className={cn('h-3.5 w-3.5 shrink-0', cfg.class)} />
                              <Badge variant={cfg.variant} className="text-xs h-5 px-1.5">
                                {cfg.label}
                              </Badge>
                            </div>
                          </TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {shortId(r.prediction_id)}
                          </TableCell>
                          <TableCell className="text-xs">
                            {r.best_summary?.hypothesis_type ? (
                              <span className={cn(
                                r.best_summary.hypothesis_type === 'noop'
                                  ? 'text-muted-foreground'
                                  : 'text-foreground font-medium'
                              )}>
                                {r.best_summary.hypothesis_type.replace(/_/g, ' ')}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {fmtNum(r.best_summary?.predicted_gross)}
                          </TableCell>
                          <TableCell
                            className={cn(
                              'text-right tabular-nums pr-4 font-medium',
                              deltaColor(delta)
                            )}
                          >
                            <div className="flex items-center justify-end gap-0.5">
                              {delta != null && delta > 0.5 && (
                                <TrendingUp className="h-3 w-3" />
                              )}
                              {delta != null && delta < -0.5 && (
                                <TrendingDown className="h-3 w-3" />
                              )}
                              {(delta == null || Math.abs(delta) <= 0.5) && (
                                <Minus className="h-3 w-3" />
                              )}
                              {fmtDelta(delta)}
                            </div>
                          </TableCell>
                          <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                            {new Date(r.created_at).toLocaleString(undefined, {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Inspection panel ── */}
        <Card className="self-start sticky top-4">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Run Inspection</CardTitle>
            <CardDescription>
              {selectedRun
                ? shortId(selectedRun.id)
                : 'Select a run to inspect'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!selectedRunId && (
              <div className="py-8 text-center text-sm text-muted-foreground">
                Click any row to inspect hypotheses, scores, and error decomposition.
              </div>
            )}
            {selectedRunId && <RunInspection runId={selectedRunId} run={selectedRun} />}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

// ─── Run Inspection Panel ─────────────────────────────────────────────────────

function RunInspection({
  runId,
  run,
}: {
  runId: string
  run: ReverseRun | null
}) {
  const { data, error, isLoading } = useSWR<RunDetail>(
    `/api/reverse/runs/${runId}`,
    fetcher
  )

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading details…
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="text-sm text-destructive py-4">
        Failed to load run details.
      </div>
    )
  }

  const { candidates, evaluations, decomposition } = data
  const currentRun = run ?? data.run

  const statusCfg = STATUS_CONFIG[currentRun.status] ?? STATUS_CONFIG.queued

  return (
    <div className="space-y-5 text-sm">
      {/* Status + timing */}
      <div className="flex items-center justify-between">
        <Badge variant={statusCfg.variant} className="gap-1">
          <statusCfg.icon className={cn('h-3 w-3', currentRun.status === 'running' && 'animate-spin')} />
          {currentRun.status}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {currentRun.completed_at
            ? new Date(currentRun.completed_at).toLocaleString(undefined, {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })
            : currentRun.started_at
            ? 'Running…'
            : 'Queued'}
        </span>
      </div>

      {/* Failure reason */}
      {currentRun.status === 'failed' && currentRun.failure_reason && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive font-mono leading-relaxed break-all">
          {currentRun.failure_reason}
        </div>
      )}

      {/* Best result summary */}
      {currentRun.best_summary && (
        <div className="rounded-md border bg-muted/30 p-3 space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Best Result
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            <div>
              <div className="text-xs text-muted-foreground">Gross</div>
              <div className="font-semibold tabular-nums">
                {fmtNum(currentRun.best_summary.predicted_gross)}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Net</div>
              <div className="font-semibold tabular-nums">
                {fmtNum(currentRun.best_summary.predicted_net)}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Δgross</div>
              <div
                className={cn(
                  'font-semibold tabular-nums',
                  deltaColor(currentRun.best_summary.delta_gross)
                )}
              >
                {fmtDelta(currentRun.best_summary.delta_gross)}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Geom score</div>
              <div className="font-semibold tabular-nums">
                {fmtNum(currentRun.best_summary.geometry_score)}
              </div>
            </div>
          </div>
          {currentRun.best_summary.hypothesis_type &&
            currentRun.best_summary.hypothesis_type !== 'noop' && (
              <div className="text-xs pt-1 border-t">
                <span className="text-muted-foreground">Winning hypothesis: </span>
                <span className="font-medium">
                  {currentRun.best_summary.hypothesis_type.replace(/_/g, ' ')}
                </span>
                {currentRun.best_summary.hypothesis_rank != null && (
                  <span className="text-muted-foreground">
                    {' '}(rank {currentRun.best_summary.hypothesis_rank})
                  </span>
                )}
              </div>
            )}
        </div>
      )}

      {/* Error decomposition */}
      {decomposition && decomposition.causes.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Error Decomposition
          </div>
          {decomposition.primary_cause && (
            <div className="text-xs text-muted-foreground">
              Primary:{' '}
              <span className="text-foreground font-medium">
                {decomposition.primary_cause.replace(/_/g, ' ')}
              </span>
            </div>
          )}
          <div className="space-y-1.5">
            {decomposition.causes.slice(0, 6).map((c) => (
              <div key={c.cause}>
                <div className="flex items-center justify-between text-xs mb-0.5">
                  <span>{c.cause.replace(/_/g, ' ')}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {Math.round(c.weight * 100)}%
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary/60"
                    style={{ width: `${Math.round(c.weight * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Hypothesis candidates table */}
      {candidates.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Hypotheses ({candidates.length})
          </div>
          <div className="rounded-md border overflow-hidden">
            <div className="overflow-y-auto max-h-72">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>
                    <th className="text-left px-2 py-1.5 font-medium text-muted-foreground w-6">#</th>
                    <th className="text-left px-2 py-1.5 font-medium text-muted-foreground">Type</th>
                    <th className="text-right px-2 py-1.5 font-medium text-muted-foreground">Score</th>
                    <th className="text-right px-2 py-1.5 font-medium text-muted-foreground pr-2">Δg</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {candidates.map((c) => {
                    const e = evaluations[c.id]
                    const isBest = c.id === currentRun.best_hypothesis_id
                    return (
                      <tr
                        key={c.id}
                        className={cn(
                          'transition-colors',
                          isBest
                            ? 'bg-primary/8 font-medium'
                            : 'hover:bg-muted/30'
                        )}
                      >
                        <td className="px-2 py-1.5 text-muted-foreground tabular-nums">
                          {c.hypothesis_rank}
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="flex items-center gap-1">
                            {isBest && (
                              <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                            )}
                            <span>{c.hypothesis_type.replace(/_/g, ' ')}</span>
                          </div>
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {fmtNum(e?.total_score)}
                        </td>
                        <td
                          className={cn(
                            'px-2 py-1.5 pr-2 text-right tabular-nums font-medium',
                            deltaColor(e?.delta_gross)
                          )}
                        >
                          {fmtDelta(e?.delta_gross)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* IDs */}
      <div className="border-t pt-3 space-y-1 text-xs text-muted-foreground">
        <div>
          <span className="text-foreground/60">Run ID</span>{' '}
          <span className="font-mono">{shortId(currentRun.id)}</span>
        </div>
        <div>
          <span className="text-foreground/60">Prediction</span>{' '}
          <span className="font-mono">{shortId(currentRun.prediction_id)}</span>
        </div>
        {currentRun.buck_id && (
          <div>
            <span className="text-foreground/60">Buck</span>{' '}
            <span className="font-mono">{shortId(currentRun.buck_id)}</span>
          </div>
        )}
      </div>
    </div>
  )
}
