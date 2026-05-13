'use client'

import { useState, useEffect } from 'react'
import useSWR from 'swr'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Loader2, RefreshCw, Play, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import type { DatasetHealthSummary, DatasetHealthTotals } from '@/lib/types'

const fetcher = (url: string) => fetch(url).then(res => res.json())

export function DatasetHealthOverview() {
  const { data, error, isLoading, mutate } = useSWR<{
    summary: DatasetHealthSummary[]
    totals: DatasetHealthTotals
  }>('/api/admin/health/summary', fetcher)

  const [isComputing, setIsComputing] = useState(false)

  const runComputation = async () => {
    setIsComputing(true)
    try {
      const res = await fetch('/api/admin/health/compute', { method: 'POST' })
      const result = await res.json()
      
      if (!res.ok) throw new Error(result.error)
      
      toast.success(`Health computation complete. Processed ${result.run?.examples_processed || 0} examples.`)
      mutate()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to compute health scores')
    } finally {
      setIsComputing(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        Failed to load health summary. Please try again.
      </div>
    )
  }

  const { summary, totals } = data
  const healthyPercent = totals.total_examples > 0 
    ? Math.round((totals.healthy_examples / totals.total_examples) * 100)
    : 0

  return (
    <div className="space-y-6">
      {/* Action Bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant={healthyPercent >= 70 ? 'default' : healthyPercent >= 50 ? 'secondary' : 'destructive'}>
            {healthyPercent}% Healthy
          </Badge>
          {totals.uncomputed > 0 && (
            <Badge variant="outline">{totals.uncomputed} unscored</Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => mutate()} disabled={isLoading}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button size="sm" onClick={runComputation} disabled={isComputing}>
            {isComputing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Computing...
              </>
            ) : (
              <>
                <Play className="h-4 w-4 mr-2" />
                Compute Health
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Examples</CardDescription>
            <CardTitle className="text-2xl">{totals.total_examples}</CardTitle>
          </CardHeader>
          <CardContent>
            <Progress value={100} className="h-2" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Training Eligible</CardDescription>
            <CardTitle className="text-2xl text-primary">{totals.training_eligible}</CardTitle>
          </CardHeader>
          <CardContent>
            <Progress 
              value={totals.total_examples > 0 ? (totals.training_eligible / totals.total_examples) * 100 : 0} 
              className="h-2" 
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Needs Review</CardDescription>
            <CardTitle className="text-2xl text-amber-600">{totals.needs_review}</CardTitle>
          </CardHeader>
          <CardContent>
            <Progress 
              value={totals.total_examples > 0 ? (totals.needs_review / totals.total_examples) * 100 : 0} 
              className="h-2 [&>div]:bg-amber-600" 
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Avg Health Score</CardDescription>
            <CardTitle className="text-2xl">{totals.avg_health_score?.toFixed(1) ?? 'N/A'}</CardTitle>
          </CardHeader>
          <CardContent>
            <Progress 
              value={totals.avg_health_score ?? 0} 
              className="h-2" 
            />
          </CardContent>
        </Card>
      </div>

      {/* Health Tier Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Health Tier Distribution</CardTitle>
          <CardDescription>Examples grouped by their computed health tier</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {summary.map(tier => {
              const percent = totals.total_examples > 0 
                ? Math.round((tier.example_count / totals.total_examples) * 100)
                : 0
              
              return (
                <div key={tier.health_tier} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      {tier.health_tier === 'excellent' && <CheckCircle2 className="h-4 w-4 text-primary" />}
                      {tier.health_tier === 'good' && <CheckCircle2 className="h-4 w-4 text-primary/70" />}
                      {tier.health_tier === 'fair' && <AlertTriangle className="h-4 w-4 text-amber-500" />}
                      {tier.health_tier === 'poor' && <AlertTriangle className="h-4 w-4 text-orange-500" />}
                      {tier.health_tier === 'excluded' && <XCircle className="h-4 w-4 text-destructive" />}
                      {tier.health_tier === 'unknown' && <span className="h-4 w-4" />}
                      <span className="font-medium capitalize">{tier.health_tier}</span>
                    </div>
                    <div className="flex items-center gap-4 text-muted-foreground">
                      <span>{tier.example_count} examples</span>
                      <span className="w-12 text-right">{percent}%</span>
                    </div>
                  </div>
                  <Progress 
                    value={percent} 
                    className={`h-2 ${
                      tier.health_tier === 'excellent' ? '' :
                      tier.health_tier === 'good' ? '[&>div]:bg-primary/70' :
                      tier.health_tier === 'fair' ? '[&>div]:bg-amber-500' :
                      tier.health_tier === 'poor' ? '[&>div]:bg-orange-500' :
                      tier.health_tier === 'excluded' ? '[&>div]:bg-destructive' :
                      '[&>div]:bg-muted-foreground'
                    }`}
                  />
                  <div className="flex gap-4 text-xs text-muted-foreground pl-6">
                    <span>Avg: {tier.avg_health_score?.toFixed(1) ?? 'N/A'}</span>
                    <span>Training: {tier.training_eligible}</span>
                    <span>Validation: {tier.validation_eligible}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Issues Summary */}
      <div className="grid md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-amber-500" />
              Duplicates Detected
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{totals.duplicates}</p>
            <p className="text-sm text-muted-foreground">
              Potential duplicate or near-duplicate examples
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-orange-500" />
              Outliers Flagged
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{totals.outliers}</p>
            <p className="text-sm text-muted-foreground">
              Statistical outliers that may affect training
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-destructive" />
              Not Scored
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{totals.uncomputed}</p>
            <p className="text-sm text-muted-foreground">
              Examples without health scores yet
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
