'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { 
  Boxes, 
  ChevronDown, 
  ChevronUp, 
  Loader2, 
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Lightbulb,
  Eye,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface StructuralHypothesisCardProps {
  predictionId: string
}

interface StructuralRunData {
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  winning_candidate_type: string | null
  primary_reason: string | null
  gross_delta: number | null
  net_delta: number | null
  candidates_generated: number
  candidates_evaluated: number
  created_at: string
  completed_at: string | null
  topology_summary: {
    left_tine_count: number
    right_tine_count: number
    has_drop_tines: boolean
    beam_curvature: string
  } | null
  winning_candidate: {
    candidate_type: string
    final_score: number
    geometry_score: number
    cross_view_score: number
    plausibility_score: number
    measurements: {
      gross_score: number
      net_score: number
      spread: number
      left_beam: number
      right_beam: number
    }
  } | null
  top_candidates: Array<{
    candidate_type: string
    final_score: number
    measurements: {
      gross_score: number
      net_score: number
    }
  }>
}

// Fetcher that gracefully handles 401 (unauthenticated) responses
const fetcher = async (url: string) => {
  const res = await fetch(url)
  // If unauthorized, return empty data instead of throwing
  if (res.status === 401) {
    return { run: null, error: 'unauthorized' }
  }
  if (!res.ok) {
    return { run: null, error: res.statusText }
  }
  return res.json()
}

export function StructuralHypothesisCard({ predictionId }: StructuralHypothesisCardProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [isStarting, setIsStarting] = useState(false)

  // Check for existing structural runs
  const { data: runData, error, mutate } = useSWR<{ run: StructuralRunData | null }>(
    `/api/structural/predictions/${predictionId}/solve`,
    fetcher,
    { revalidateOnFocus: false }
  )

  const run = runData?.run
  const isLoading = !runData && !error
  const hasRun = !!run
  const isRunning = run?.status === 'running' || run?.status === 'pending'
  const isCompleted = run?.status === 'completed'
  const hasFailed = run?.status === 'failed'
  const hasImprovement = (run?.gross_delta ?? 0) > 0.5 || (run?.net_delta ?? 0) > 0.5

  const handleStartSolving = async () => {
    setIsStarting(true)
    try {
      const response = await fetch(`/api/structural/predictions/${predictionId}/solve`, {
        method: 'POST',
      })
      if (response.ok) {
        await mutate()
      }
    } catch (err) {
      console.error('Failed to start structural solving:', err)
    } finally {
      setIsStarting(false)
    }
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Boxes className="h-4 w-4" />
            Structural Analysis
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Boxes className="h-4 w-4" />
                Structural Analysis
              </CardTitle>
              {isCompleted && hasImprovement && (
                <Badge variant="default" className="bg-green-600">
                  Improved
                </Badge>
              )}
              {isCompleted && !hasImprovement && (
                <Badge variant="secondary">No Change</Badge>
              )}
              {isRunning && (
                <Badge variant="outline" className="gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Running
                </Badge>
              )}
              {hasFailed && (
                <Badge variant="destructive">Failed</Badge>
              )}
            </div>
            {hasRun && (
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm">
                  {isOpen ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </Button>
              </CollapsibleTrigger>
            )}
          </div>
          <CardDescription>
            {!hasRun && 'Test alternative rack structures to improve accuracy'}
            {isRunning && 'Evaluating structural hypotheses...'}
            {isCompleted && run?.primary_reason}
            {hasFailed && 'Structural analysis failed'}
          </CardDescription>
        </CardHeader>

        <CardContent>
          {!hasRun && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Structural hypothesis solving tests alternative tine configurations, 
                beam interpretations, and symmetry assumptions to find the most 
                accurate measurement.
              </p>
              <Button 
                onClick={handleStartSolving} 
                disabled={isStarting}
                className="w-full"
              >
                {isStarting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Starting...
                  </>
                ) : (
                  <>
                    <Lightbulb className="mr-2 h-4 w-4" />
                    Run Structural Analysis
                  </>
                )}
              </Button>
            </div>
          )}

          {isRunning && (
            <div className="flex items-center gap-3 py-2">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <div>
                <p className="text-sm font-medium">Evaluating structures...</p>
                <p className="text-xs text-muted-foreground">
                  {run?.candidates_generated ?? 0} candidates generated
                </p>
              </div>
            </div>
          )}

          {isCompleted && (
            <CollapsibleContent>
              <div className="space-y-4 pt-2">
                {/* Improvement Summary */}
                {hasImprovement && run?.winning_candidate && (
                  <div className="rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-900 dark:bg-green-950">
                    <div className="flex items-start gap-2">
                      <CheckCircle2 className="h-5 w-5 text-green-600 mt-0.5" />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-green-900 dark:text-green-100">
                          Found Better Structure
                        </p>
                        <p className="text-xs text-green-700 dark:text-green-300 mt-1">
                          {run.winning_candidate.candidate_type.replace(/_/g, ' ')} 
                          {' '}improved gross by {run.gross_delta?.toFixed(1)}&quot;
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Topology Summary */}
                {run?.topology_summary && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-2">
                      Detected Topology
                    </p>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="rounded-md bg-muted p-2">
                        <span className="text-muted-foreground">Left Tines:</span>{' '}
                        <span className="font-medium">{run.topology_summary.left_tine_count}</span>
                      </div>
                      <div className="rounded-md bg-muted p-2">
                        <span className="text-muted-foreground">Right Tines:</span>{' '}
                        <span className="font-medium">{run.topology_summary.right_tine_count}</span>
                      </div>
                      <div className="rounded-md bg-muted p-2">
                        <span className="text-muted-foreground">Drop Tines:</span>{' '}
                        <span className="font-medium">
                          {run.topology_summary.has_drop_tines ? 'Yes' : 'No'}
                        </span>
                      </div>
                      <div className="rounded-md bg-muted p-2">
                        <span className="text-muted-foreground">Beam:</span>{' '}
                        <span className="font-medium capitalize">
                          {run.topology_summary.beam_curvature}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Top Candidates */}
                {run?.top_candidates && run.top_candidates.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-2">
                      Top Candidates ({run.candidates_evaluated} evaluated)
                    </p>
                    <div className="space-y-2">
                      {run.top_candidates.slice(0, 3).map((candidate, index) => (
                        <div 
                          key={index}
                          className={cn(
                            'flex items-center justify-between rounded-md border p-2 text-sm',
                            index === 0 && hasImprovement && 'border-green-300 bg-green-50 dark:border-green-800 dark:bg-green-950'
                          )}
                        >
                          <div className="flex items-center gap-2">
                            {index === 0 && hasImprovement && (
                              <CheckCircle2 className="h-4 w-4 text-green-600" />
                            )}
                            <span className={cn(
                              'capitalize',
                              index === 0 && hasImprovement && 'font-medium'
                            )}>
                              {candidate.candidate_type.replace(/_/g, ' ')}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground">
                            <span>Gross: {candidate.measurements.gross_score.toFixed(1)}&quot;</span>
                            <span>Net: {candidate.measurements.net_score.toFixed(1)}&quot;</span>
                            <Badge variant="outline" className="text-xs">
                              {(candidate.final_score * 100).toFixed(0)}%
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* View Full Report */}
                {run && (
                  <Button variant="outline" size="sm" className="w-full" asChild>
                    <a href={`/admin/structural?run=${run.id}`} target="_blank" rel="noopener">
                      <Eye className="mr-2 h-4 w-4" />
                      View Full Report
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </a>
                  </Button>
                )}
              </div>
            </CollapsibleContent>
          )}

          {hasFailed && (
            <div className="flex items-start gap-2 py-2">
              <AlertTriangle className="h-5 w-5 text-destructive mt-0.5" />
              <div>
                <p className="text-sm font-medium">Analysis Failed</p>
                <p className="text-xs text-muted-foreground">
                  Try again or contact support if the issue persists.
                </p>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="mt-2"
                  onClick={handleStartSolving}
                  disabled={isStarting}
                >
                  Retry
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Collapsible>
    </Card>
  )
}
