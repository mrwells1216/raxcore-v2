'use client'

import { useState, useEffect } from 'react'
import useSWR from 'swr'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Loader2, Target, CheckCircle, AlertCircle, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { describeHypothesis } from '@/lib/reverse-engineering/hypotheses'
import type { HypothesisType, HypothesisParams } from '@/lib/reverse-engineering/types'

const fetcher = (url: string) => fetch(url).then(r => r.json())

interface PrecisionPassCardProps {
  predictionId: string
  className?: string
  onPrecisionPassComplete?: (payload: {
    grossScore: number | null
    netScore: number | null
    scoreSheet: any | null
    provenance: any | null
    runId: string
  }) => void
}

export function PrecisionPassCard({
  predictionId,
  className,
  onPrecisionPassComplete,
}: PrecisionPassCardProps) {
  const [runId, setRunId] = useState<string | null>(null)
  const [initialStatus, setInitialStatus] = useState<string | null>(null)
  const [isStarting, setIsStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)

  // Stop polling once completed or failed — no need to keep hitting the API
  const shouldPoll = runId && initialStatus !== 'completed' && initialStatus !== 'failed'

  const { data } = useSWR(
    shouldPoll ? `/api/reverse/runs/${runId}` : runId ? `/api/reverse/runs/${runId}` : null,
    fetcher,
    { refreshInterval: shouldPoll ? 1500 : 0, revalidateOnFocus: false }
  )

  const status = data?.run?.status as string | undefined
  const best = data?.run?.best_summary as Record<string, unknown> | undefined
  const decomposition = data?.decomposition as { causes?: Array<{ cause: string; weight: number }> } | undefined
  const candidates = (data?.candidates ?? []) as Array<{
    id: string
    hypothesis_type: HypothesisType
    hypothesis_rank: number
    params?: HypothesisParams
  }>
  const evaluations = (data?.evaluations ?? {}) as Record<string, {
    total_score: number
    delta_gross: number
  }>

  const isComplete = status === 'completed'
  const isFailed = status === 'failed'
  const isRunning = status === 'running' || status === 'queued'

  useEffect(() => {
    if (!runId || !isComplete || !best || !onPrecisionPassComplete) return

    const normalizedScoreSheet =
      (best as any)?.scoreSheet ??
      (best as any)?.score_sheet ??
      null

    const normalizedProvenance =
      (best as any)?.provenance ??
      (best as any)?.field_provenance ??
      null

    const gross =
      typeof best.predicted_gross === 'number'
        ? best.predicted_gross
        : Number(best.predicted_gross ?? null)

    const net =
      typeof best.predicted_net === 'number'
        ? best.predicted_net
        : Number(best.predicted_net ?? null)

    console.log('[precision-pass] normalized payload', {
      runId,
      hasScoreSheet: !!normalizedScoreSheet,
      hasProvenance: !!normalizedProvenance,
      gross,
      net,
    })

    if (!normalizedScoreSheet && !normalizedProvenance && gross == null && net == null) {
      console.warn('[precision-pass] skipping empty UI payload', { runId })
      return
    }

    onPrecisionPassComplete({
      grossScore: gross,
      netScore: net,
      scoreSheet: normalizedScoreSheet,
      provenance: normalizedProvenance,
      runId,
    })
  }, [runId, isComplete, best, onPrecisionPassComplete])

  async function start() {
    setIsStarting(true)
    setError(null)
    
    if (process.env.NODE_ENV === 'development') {
      console.log('[v0] Starting precision pass for prediction:', predictionId)
    }
    
    try {
      const res = await fetch(`/api/reverse/predictions/${predictionId}/precision-pass`, { 
        method: 'POST' 
      })
      const json = await res.json()
      
      if (process.env.NODE_ENV === 'development') {
        console.log('[v0] Precision pass response:', { ok: res.ok, status: res.status, json })
      }
      
      if (!res.ok) {
        throw new Error(json.error || 'Failed to start')
      }
      
      if (json.runId) {
        setRunId(json.runId)
        // Seed initial status from route response — in dev, route returns 'completed' immediately
        if (json.status) setInitialStatus(json.status)
      }
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : 'Failed to start precision pass'
      console.error('[v0] Precision pass error:', errorMsg)
      setError(errorMsg)
    } finally {
      setIsStarting(false)
    }
  }

  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Precision Pass</CardTitle>
          </div>
          {status && (
            <Badge 
              variant={isComplete ? 'default' : isFailed ? 'destructive' : 'secondary'}
              className="text-xs"
            >
              {status}
            </Badge>
          )}
        </div>
        <CardDescription className="text-xs">
          Optional reverse-engineering pass to cross-check scale/asymmetry and tighten accuracy.
        </CardDescription>
      </CardHeader>
      
      <CardContent className="space-y-3">
        {error && (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" />
            {error}
          </div>
        )}

        {!runId ? (
          <Button 
            onClick={start} 
            disabled={isStarting}
            className="w-full"
            variant="outline"
          >
            {isStarting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Starting...
              </>
            ) : (
              'Run Precision Pass'
            )}
          </Button>
        ) : (
          <div className="space-y-3">
            {isRunning && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Analyzing hypotheses...
              </div>
            )}

            {isComplete && best && (
              <>
                <div className="flex items-start gap-2">
                  <CheckCircle className="h-4 w-4 text-green-600 mt-0.5" />
                  <div className="space-y-1">
                    <div className="text-sm font-medium">
                      Best estimate: {String(best.predicted_gross)} gross
                      <span className="text-muted-foreground ml-1">
                        ({Number(best.delta_gross) >= 0 ? '+' : ''}{String(best.delta_gross)}&quot;)
                      </span>
                    </div>
              {best.hypothesis_type !== 'noop' && (
                <div className="text-xs text-muted-foreground">
                  Applied: {describeHypothesis(
                    best.hypothesis_type as HypothesisType,
                    (best.params as HypothesisParams) ?? {}
                  )}
                </div>
              )}
                  </div>
                </div>

                <button
                  onClick={() => setExpanded(!expanded)}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ChevronDown className={cn(
                    'h-3 w-3 transition-transform',
                    expanded && 'rotate-180'
                  )} />
                  {expanded ? 'Hide details' : 'Show details'}
                </button>

                {expanded && (
                  <div className="space-y-3 pt-2 border-t">
                    {decomposition?.causes && decomposition.causes.length > 0 && (
                      <div className="space-y-1">
                        <div className="text-xs font-medium text-muted-foreground">
                          Identified factors
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {decomposition.causes.slice(0, 4).map((c) => (
                            <Badge key={c.cause} variant="outline" className="text-xs">
                              {c.cause.replace(/_/g, ' ')} ({Math.round(c.weight * 100)}%)
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {candidates.length > 0 && (
                      <div className="space-y-1">
                        <div className="text-xs font-medium text-muted-foreground">
                          Top hypotheses tested
                        </div>
                        <div className="space-y-1 max-h-32 overflow-y-auto">
                          {candidates.slice(0, 6).map((c) => {
                            const e = evaluations[c.id]
                            const isBest = c.id === data?.run?.best_hypothesis_id
                            return (
                              <div 
                                key={c.id} 
                                className={cn(
                                  'text-xs flex items-center justify-between px-2 py-1 rounded',
                                  isBest ? 'bg-primary/10 border border-primary/20' : 'bg-muted/50'
                                )}
                              >
              <span className="font-mono">
                {describeHypothesis(c.hypothesis_type, c.params ?? {})}
              </span>
                                <span className="text-muted-foreground">
                                  {e?.total_score?.toFixed?.(1) ?? '—'} pts
                                </span>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    <p className="text-xs text-muted-foreground">
                      This is a model-based refinement for reference only; not an official score.
                    </p>
                  </div>
                )}
              </>
            )}

            {isFailed && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" />
                Precision pass failed. Try again later.
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
