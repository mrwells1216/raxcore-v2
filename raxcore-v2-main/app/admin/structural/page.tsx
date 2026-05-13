'use client'

import useSWR from 'swr'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { useState } from 'react'
import { Loader2, Layers, ChevronRight, GitBranch, TrendingUp, TrendingDown } from 'lucide-react'
import { cn } from '@/lib/utils'

const fetcher = (url: string) => fetch(url).then(r => r.json())

interface StructuralRun {
  id: string
  prediction_id: string
  buck_id: string | null
  reverse_run_id: string | null
  status: string
  analysis_mode: string
  winning_candidate_id: string | null
  structural_change_reasons: string[] | null
  primary_structural_reason: string | null
  baseline_gross: number | null
  baseline_net: number | null
  final_gross: number | null
  final_net: number | null
  gross_delta: number | null
  net_delta: number | null
  processing_time_ms: number | null
  created_at: string
  completed_at: string | null
}

interface Candidate {
  id: string
  candidate_type: string
  candidate_rank: number
  structural_params: Record<string, unknown>
  affected_families: string[] | null
  generation_reason: string | null
}

interface Evaluation {
  total_score: number
  is_winning_candidate: boolean
  geometry_consistency_score: number | null
  cross_view_consistency_score: number | null
  predicted_gross: number | null
  predicted_net: number | null
  views_supporting: number | null
  views_contradicting: number | null
  reason_summary: string | null
}

interface TopologySnapshot {
  snapshot_type: string
  beam_continuity_score: number | null
  tine_ordering_confidence: number | null
  spread_anchor_confidence: number | null
  asymmetry_cause: string | null
  asymmetry_magnitude: number | null
}

export default function StructuralAdminPage() {
  const [selected, setSelected] = useState<string | null>(null)

  const { data, error, isLoading } = useSWR<{ runs: StructuralRun[] }>(
    '/api/admin/structural/runs', 
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

  const deltaIcon = (delta: number | null) => {
    if (delta === null || delta === 0) return null
    if (delta > 0) return <TrendingUp className="h-3 w-3 text-green-600" />
    return <TrendingDown className="h-3 w-3 text-red-600" />
  }

  return (
    <div className="container py-8 space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <Layers className="h-6 w-6 text-muted-foreground" />
          <h1 className="text-3xl font-bold tracking-tight">Structural Hypothesis Solving</h1>
        </div>
        <p className="text-muted-foreground mt-1">
          Landmark-level and topology-level rack structure analysis (Phase 51).
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Structural Runs</CardTitle>
            <CardDescription>Structural hypothesis solving executions</CardDescription>
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
                No structural solving runs yet.
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
                      <TableHead>Primary Reason</TableHead>
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
                        <TableCell className="text-sm">{r.analysis_mode}</TableCell>
                        <TableCell className="font-mono text-xs">
                          {r.prediction_id.slice(0, 8)}...
                        </TableCell>
                        <TableCell className="text-sm">
                          {r.final_gross !== null ? (
                            <span className="flex items-center gap-1">
                              {r.final_gross?.toFixed(1)}
                              {r.gross_delta !== null && r.gross_delta !== 0 && (
                                <>
                                  {deltaIcon(r.gross_delta)}
                                  <span className={cn(
                                    'text-xs',
                                    r.gross_delta > 0 ? 'text-green-600' : 'text-red-600'
                                  )}>
                                    {r.gross_delta > 0 ? '+' : ''}{r.gross_delta.toFixed(1)}
                                  </span>
                                </>
                              )}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">
                          {r.primary_structural_reason ? (
                            <span className="text-muted-foreground">
                              {r.primary_structural_reason.replace(/_/g, ' ').slice(0, 35)}...
                            </span>
                          ) : (
                            <span className="text-muted-foreground">baseline</span>
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
              <StructuralRunDetail runId={selected} />
            ) : (
              <div className="text-sm text-muted-foreground py-4 text-center">
                No run selected.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Stats overview */}
      <div className="grid gap-4 sm:grid-cols-5">
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
          label="Structure Changed" 
          value={runs.filter(r => r.primary_structural_reason && r.primary_structural_reason !== 'baseline_structure').length}
          variant="info" 
        />
        <StatsCard 
          label="Failed" 
          value={runs.filter(r => r.status === 'failed').length}
          variant="error" 
        />
        <StatsCard 
          label="Avg Delta" 
          value={calculateAvgDelta(runs)}
          suffix={'"'}
          variant="info" 
        />
      </div>
    </div>
  )
}

function calculateAvgDelta(runs: StructuralRun[]): string {
  const completedWithDelta = runs.filter(r => r.status === 'completed' && r.gross_delta !== null && r.gross_delta !== 0)
  if (completedWithDelta.length === 0) return '0.0'
  const avgDelta = completedWithDelta.reduce((sum, r) => sum + Math.abs(r.gross_delta!), 0) / completedWithDelta.length
  return avgDelta.toFixed(1)
}

function StatsCard({ 
  label, 
  value,
  suffix = '',
  variant = 'default' 
}: { 
  label: string
  value: number | string
  suffix?: string
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
          {value}{suffix}
        </div>
      </CardContent>
    </Card>
  )
}

function StructuralRunDetail({ runId }: { runId: string }) {
  const { data, error, isLoading } = useSWR<{
    run: StructuralRun
    candidates: Candidate[]
    evaluations: Record<string, Evaluation>
    baselineTopology: TopologySnapshot | null
    winningTopology: TopologySnapshot | null
  }>(`/api/structural/runs/${runId}`, fetcher)

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

  const { run, candidates, evaluations, baselineTopology, winningTopology } = data

  const winningCandidate = candidates.find(c => c.id === run.winning_candidate_id)
  const winningEval = winningCandidate ? evaluations[winningCandidate.id] : null

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

      {/* Winning structure */}
      {winningCandidate && (
        <div>
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
            Winning Structure
          </div>
          <div className="text-sm font-medium">
            {winningCandidate.candidate_type.replace(/_/g, ' ')}
          </div>
          {winningEval && (
            <div className="text-xs text-muted-foreground mt-0.5">
              Score: {(winningEval.total_score * 100).toFixed(0)}% | 
              Views: {winningEval.views_supporting ?? 0} supporting, {winningEval.views_contradicting ?? 0} contradicting
            </div>
          )}
        </div>
      )}

      {/* Score delta */}
      {run.gross_delta !== null && (
        <div>
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
            Score Impact
          </div>
          <div className="text-sm flex items-center gap-2">
            <span className="font-medium">{run.baseline_gross?.toFixed(1)}</span>
            <span className="text-muted-foreground">→</span>
            <span className="font-medium">{run.final_gross?.toFixed(1)}</span>
            <span className={cn(
              'text-xs font-medium',
              run.gross_delta > 0 ? 'text-green-600' : run.gross_delta < 0 ? 'text-red-600' : 'text-muted-foreground'
            )}>
              ({run.gross_delta > 0 ? '+' : ''}{run.gross_delta.toFixed(1)})
            </span>
          </div>
        </div>
      )}

      {/* Structural change reasons */}
      {run.structural_change_reasons && run.structural_change_reasons.length > 0 && (
        <div>
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
            Change Reasons
          </div>
          <div className="flex flex-wrap gap-1">
            {run.structural_change_reasons.map((reason, i) => (
              <Badge key={i} variant="outline" className="text-xs">
                {reason.replace(/_/g, ' ').slice(0, 30)}...
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Topology comparison */}
      {winningTopology && (
        <div>
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
            Topology Quality
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-muted-foreground">Beam continuity:</span>{' '}
              {((winningTopology.beam_continuity_score ?? 0) * 100).toFixed(0)}%
            </div>
            <div>
              <span className="text-muted-foreground">Tine ordering:</span>{' '}
              {((winningTopology.tine_ordering_confidence ?? 0) * 100).toFixed(0)}%
            </div>
            <div>
              <span className="text-muted-foreground">Spread anchor:</span>{' '}
              {((winningTopology.spread_anchor_confidence ?? 0) * 100).toFixed(0)}%
            </div>
            <div>
              <span className="text-muted-foreground">Asymmetry:</span>{' '}
              {winningTopology.asymmetry_cause?.replace(/_/g, ' ') ?? 'unknown'}
            </div>
          </div>
        </div>
      )}

      {/* Candidates list */}
      {candidates.length > 0 && (
        <div>
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
            All Candidates ({candidates.length})
          </div>
          <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
            {candidates.map((c) => {
              const e = evaluations[c.id]
              const isWinner = c.id === run.winning_candidate_id
              return (
                <div 
                  key={c.id} 
                  className={cn(
                    'text-xs flex items-center justify-between border rounded px-2 py-1.5',
                    isWinner && 'border-primary bg-primary/5'
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground w-4">{c.candidate_rank + 1}</span>
                    <GitBranch className="h-3 w-3 text-muted-foreground" />
                    <span className="font-mono">{c.candidate_type.replace(/_/g, ' ')}</span>
                  </div>
                  <div className="flex items-center gap-3 text-muted-foreground">
                    <span>{((e?.total_score ?? 0) * 100).toFixed(0)}%</span>
                    {e?.predicted_gross && (
                      <span>{e.predicted_gross.toFixed(1)}</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Processing time */}
      {run.processing_time_ms && (
        <div className="text-xs text-muted-foreground border-t pt-2">
          Processing time: {(run.processing_time_ms / 1000).toFixed(1)}s
        </div>
      )}

      {/* Timing */}
      {run.completed_at && (
        <div className="text-xs text-muted-foreground">
          Completed: {new Date(run.completed_at).toLocaleString()}
        </div>
      )}
    </div>
  )
}
