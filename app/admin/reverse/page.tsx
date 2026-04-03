'use client'

import useSWR from 'swr'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { useState } from 'react'
import { Loader2, Target, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

const fetcher = (url: string) => fetch(url).then(r => r.json())

interface ReverseRun {
  id: string
  prediction_id: string
  buck_id: string | null
  status: string
  mode: string
  best_hypothesis_id: string | null
  best_summary: {
    predicted_gross?: number
    delta_gross?: number
    hypothesis_type?: string
  } | null
  created_at: string
  completed_at: string | null
}

interface Candidate {
  id: string
  hypothesis_type: string
  hypothesis_rank: number
  params: Record<string, unknown>
}

interface Evaluation {
  total_score: number
  delta_gross: number
  geometry_score: number
}

interface Decomposition {
  causes: Array<{ cause: string; weight: number; evidence: string[] }>
  primary_cause: string | null
}

export default function ReverseAdminPage() {
  const [selected, setSelected] = useState<string | null>(null)

  const { data, error, isLoading } = useSWR<{ runs: ReverseRun[] }>(
    '/api/admin/reverse/runs', 
    fetcher,
    { refreshInterval: 10000 }
  )
  const runs = data?.runs ?? []

  const statusVariant = (status: string) => {
    switch (status) {
      case 'completed': return 'default'
      case 'failed': return 'destructive'
      case 'running': return 'secondary'
      default: return 'outline'
    }
  }

  return (
    <div className="container py-8 space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <Target className="h-6 w-6 text-muted-foreground" />
          <h1 className="text-3xl font-bold tracking-tight">Reverse Engineering</h1>
        </div>
        <p className="text-muted-foreground mt-1">
          Precision Pass runs, hypotheses, and failure-mode review.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Reverse Runs</CardTitle>
            <CardDescription>Latest precision-pass executions</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading && (
              <div className="flex items-center gap-2 py-6 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading runs...
              </div>
            )}
            
            {error && (
              <div className="py-6 text-destructive">Failed to load runs.</div>
            )}

            {!isLoading && !error && runs.length === 0 && (
              <div className="py-6 text-muted-foreground text-center">
                No precision pass runs yet.
              </div>
            )}

            {runs.length > 0 && (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8"></TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Mode</TableHead>
                      <TableHead>Prediction</TableHead>
                      <TableHead>Result</TableHead>
                      <TableHead>Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {runs.map((r) => (
                      <TableRow
                        key={r.id}
                        className={cn(
                          'cursor-pointer transition-colors',
                          selected === r.id ? 'bg-muted/50' : 'hover:bg-muted/30'
                        )}
                        onClick={() => setSelected(r.id)}
                      >
                        <TableCell>
                          <ChevronRight className={cn(
                            'h-4 w-4 text-muted-foreground transition-transform',
                            selected === r.id && 'rotate-90'
                          )} />
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(r.status)}>{r.status}</Badge>
                        </TableCell>
                        <TableCell className="text-sm">{r.mode}</TableCell>
                        <TableCell className="font-mono text-xs">
                          {r.prediction_id.slice(0, 8)}...
                        </TableCell>
                        <TableCell className="text-sm">
                          {r.best_summary ? (
                            <span>
                              {r.best_summary.predicted_gross?.toFixed(1)}
                              <span className="text-muted-foreground ml-1">
                                ({Number(r.best_summary.delta_gross) >= 0 ? '+' : ''}
                                {r.best_summary.delta_gross?.toFixed(1)})
                              </span>
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(r.created_at).toLocaleString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Inspection</CardTitle>
            <CardDescription>Click a run to view details</CardDescription>
          </CardHeader>
          <CardContent>
            {selected ? (
              <ReverseRunDetail runId={selected} />
            ) : (
              <div className="text-sm text-muted-foreground py-4 text-center">
                No run selected.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Stats overview */}
      <div className="grid gap-4 sm:grid-cols-4">
        <StatsCard 
          label="Total Runs" 
          value={runs.length} 
        />
        <StatsCard 
          label="Completed" 
          value={runs.filter(r => r.status === 'completed').length}
          variant="success" 
        />
        <StatsCard 
          label="Failed" 
          value={runs.filter(r => r.status === 'failed').length}
          variant="error" 
        />
        <StatsCard 
          label="Running" 
          value={runs.filter(r => r.status === 'running' || r.status === 'queued').length}
          variant="info" 
        />
      </div>
    </div>
  )
}

function StatsCard({ 
  label, 
  value,
  variant = 'default' 
}: { 
  label: string
  value: number
  variant?: 'default' | 'success' | 'error' | 'info'
}) {
  const variantClasses = {
    default: 'text-foreground',
    success: 'text-green-600',
    error: 'text-red-600',
    info: 'text-blue-600',
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>
        <div className={cn('text-2xl font-bold mt-1', variantClasses[variant])}>
          {value}
        </div>
      </CardContent>
    </Card>
  )
}

function ReverseRunDetail({ runId }: { runId: string }) {
  const { data, error, isLoading } = useSWR<{
    run: ReverseRun
    candidates: Candidate[]
    evaluations: Record<string, Evaluation>
    decomposition: Decomposition | null
  }>(`/api/reverse/runs/${runId}`, fetcher)

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading...
      </div>
    )
  }
  
  if (error || !data) {
    return <div className="text-sm text-destructive">Failed to load run details.</div>
  }

  const { run, decomposition, candidates, evaluations } = data

  return (
    <div className="space-y-4">
      {/* Status */}
      <div>
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
          Status
        </div>
        <Badge variant={run.status === 'completed' ? 'default' : run.status === 'failed' ? 'destructive' : 'secondary'}>
          {run.status}
        </Badge>
      </div>

      {/* Best result */}
      {run.best_summary && (
        <div>
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
            Best Estimate
          </div>
          <div className="text-sm">
            <span className="font-medium">{run.best_summary.predicted_gross}</span>
            <span className="text-muted-foreground ml-1">
              ({Number(run.best_summary.delta_gross) >= 0 ? '+' : ''}{run.best_summary.delta_gross})
            </span>
          </div>
          {run.best_summary.hypothesis_type && run.best_summary.hypothesis_type !== 'noop' && (
            <div className="text-xs text-muted-foreground mt-0.5">
              Via: {String(run.best_summary.hypothesis_type).replace(/_/g, ' ')}
            </div>
          )}
        </div>
      )}

      {/* Error decomposition */}
      {decomposition && decomposition.causes.length > 0 && (
        <div>
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
            Likely Causes
          </div>
          <div className="flex flex-wrap gap-1">
            {decomposition.causes.slice(0, 5).map((c) => (
              <Badge key={c.cause} variant="outline" className="text-xs">
                {c.cause.replace(/_/g, ' ')} ({Math.round(c.weight * 100)}%)
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Top hypotheses */}
      {candidates.length > 0 && (
        <div>
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
            Top Hypotheses
          </div>
          <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
            {candidates.slice(0, 10).map((c) => {
              const e = evaluations[c.id]
              const isBest = c.id === run.best_hypothesis_id
              return (
                <div 
                  key={c.id} 
                  className={cn(
                    'text-xs flex items-center justify-between border rounded px-2 py-1.5',
                    isBest && 'border-primary bg-primary/5'
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground w-4">{c.hypothesis_rank}</span>
                    <span className="font-mono">{c.hypothesis_type.replace(/_/g, ' ')}</span>
                  </div>
                  <div className="flex items-center gap-3 text-muted-foreground">
                    <span>score={e?.total_score?.toFixed?.(1) ?? '—'}</span>
                    <span>Δg={e?.delta_gross?.toFixed?.(1) ?? '—'}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Timing */}
      {run.completed_at && (
        <div className="text-xs text-muted-foreground border-t pt-2">
          Completed: {new Date(run.completed_at).toLocaleString()}
        </div>
      )}
    </div>
  )
}
