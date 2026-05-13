'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { CheckCircle, XCircle, AlertTriangle, Loader2, TrendingUp, TrendingDown, Minus, ArrowRight } from 'lucide-react'
import type { PromotionReadinessSummary, PromotionDecisionType } from '@/lib/types'

interface PromotionReadinessPanelProps {
  readiness: PromotionReadinessSummary
  benchmarkRunId: string
}

export function PromotionReadinessPanel({ readiness, benchmarkRunId }: PromotionReadinessPanelProps) {
  const router = useRouter()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [decision, setDecision] = useState<PromotionDecisionType>('promote')
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const getRecommendationBadge = () => {
    switch (readiness.recommendation) {
      case 'ready_to_promote':
        return (
          <Badge variant="secondary" className="bg-green-500/10 text-green-600 gap-1">
            <CheckCircle className="h-3 w-3" />
            Ready to Promote
          </Badge>
        )
      case 'needs_review':
        return (
          <Badge variant="secondary" className="bg-yellow-500/10 text-yellow-600 gap-1">
            <AlertTriangle className="h-3 w-3" />
            Needs Review
          </Badge>
        )
      case 'not_recommended':
        return (
          <Badge variant="destructive" className="gap-1">
            <XCircle className="h-3 w-3" />
            Not Recommended
          </Badge>
        )
      default:
        return (
          <Badge variant="outline" className="gap-1">
            Insufficient Data
          </Badge>
        )
    }
  }

  const getDiffIndicator = (value: number | null, inverse = false) => {
    if (value === null) return <Minus className="h-4 w-4 text-muted-foreground" />
    const improved = inverse ? value > 0 : value < 0
    const worsened = inverse ? value < 0 : value > 0
    
    if (improved) return <TrendingDown className="h-4 w-4 text-green-600" />
    if (worsened) return <TrendingUp className="h-4 w-4 text-destructive" />
    return <Minus className="h-4 w-4 text-muted-foreground" />
  }

  const formatDiff = (value: number | null, suffix = '') => {
    if (value === null) return '-'
    const sign = value >= 0 ? '+' : ''
    return `${sign}${value.toFixed(2)}${suffix}`
  }

  const handleSubmitDecision = async () => {
    if (!reason.trim()) return

    setSubmitting(true)
    try {
      const res = await fetch('/api/admin/benchmarks/promotions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          benchmark_run_id: benchmarkRunId,
          decision,
          decision_reason: reason.trim(),
          decision_notes: notes.trim() || undefined,
          candidate_model_version_id: readiness.candidate_model.id,
          active_model_version_id: readiness.active_model?.id,
          guardrail_results: readiness.guardrail_evaluation,
          metrics_snapshot: readiness.comparison ? {
            active_model: readiness.active_model ? {
              model_version_id: readiness.active_model.id,
              model_name: readiness.active_model.name,
              avg_gross_error: readiness.active_model.metrics.avg_gross_error,
              avg_net_error: readiness.active_model.metrics.avg_net_error,
              within_5_inches_percent: readiness.active_model.metrics.within_5_inches_percent,
              within_10_inches_percent: readiness.active_model.metrics.within_10_inches_percent,
              sample_count: readiness.active_model.metrics.sample_count,
            } : null,
            candidate_model: {
              model_version_id: readiness.candidate_model.id,
              model_name: readiness.candidate_model.name,
              avg_gross_error: readiness.candidate_model.metrics.avg_gross_error,
              avg_net_error: readiness.candidate_model.metrics.avg_net_error,
              within_5_inches_percent: readiness.candidate_model.metrics.within_5_inches_percent,
              within_10_inches_percent: readiness.candidate_model.metrics.within_10_inches_percent,
              sample_count: readiness.candidate_model.metrics.sample_count,
            },
            comparison: readiness.comparison,
          } : undefined,
        }),
      })

      if (res.ok) {
        setDialogOpen(false)
        router.push('/admin/benchmarks?tab=decisions')
        router.refresh()
      } else {
        const data = await res.json()
        alert(data.error || 'Failed to record decision')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Promotion Readiness</span>
          {getRecommendationBadge()}
        </CardTitle>
        <CardDescription>
          {readiness.recommendation_reasons.map((r, i) => (
            <span key={i} className="block">{r}</span>
          ))}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Model Comparison */}
        {readiness.active_model && readiness.comparison && (
          <div className="grid md:grid-cols-3 gap-4">
            {/* Active Model */}
            <div className="p-4 bg-muted/50 rounded-lg">
              <p className="text-xs text-muted-foreground uppercase mb-2">Active (Baseline)</p>
              <p className="font-medium mb-3">{readiness.active_model.name}</p>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Avg Error</span>
                  <span>{readiness.active_model.metrics.avg_gross_error.toFixed(2)}"</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Within 5"</span>
                  <span>{readiness.active_model.metrics.within_5_inches_percent.toFixed(1)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Within 10"</span>
                  <span>{readiness.active_model.metrics.within_10_inches_percent.toFixed(1)}%</span>
                </div>
              </div>
            </div>

            {/* Comparison */}
            <div className="p-4 bg-muted/50 rounded-lg flex flex-col items-center justify-center">
              <ArrowRight className="h-6 w-6 text-muted-foreground mb-2" />
              <div className="space-y-2 text-center">
                <div className="flex items-center gap-2 justify-center">
                  {getDiffIndicator(readiness.comparison.gross_error_diff_inches)}
                  <span className={`text-sm font-medium ${
                    readiness.comparison.gross_error_diff_inches < 0 ? 'text-green-600' : 
                    readiness.comparison.gross_error_diff_inches > 0 ? 'text-destructive' : ''
                  }`}>
                    {formatDiff(readiness.comparison.gross_error_diff_inches, '"')} error
                  </span>
                </div>
                <div className="flex items-center gap-2 justify-center">
                  {getDiffIndicator(readiness.comparison.accuracy_5_inch_diff, true)}
                  <span className={`text-sm font-medium ${
                    readiness.comparison.accuracy_5_inch_diff > 0 ? 'text-green-600' : 
                    readiness.comparison.accuracy_5_inch_diff < 0 ? 'text-destructive' : ''
                  }`}>
                    {formatDiff(readiness.comparison.accuracy_5_inch_diff, '%')} accuracy
                  </span>
                </div>
              </div>
            </div>

            {/* Candidate Model */}
            <div className="p-4 bg-primary/5 border border-primary/20 rounded-lg">
              <p className="text-xs text-primary uppercase mb-2">Candidate</p>
              <p className="font-medium mb-3">{readiness.candidate_model.name}</p>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Avg Error</span>
                  <span>{readiness.candidate_model.metrics.avg_gross_error.toFixed(2)}"</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Within 5"</span>
                  <span>{readiness.candidate_model.metrics.within_5_inches_percent.toFixed(1)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Within 10"</span>
                  <span>{readiness.candidate_model.metrics.within_10_inches_percent.toFixed(1)}%</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Single model view when no comparison */}
        {!readiness.active_model && (
          <div className="p-4 bg-primary/5 border border-primary/20 rounded-lg max-w-sm">
            <p className="text-xs text-primary uppercase mb-2">Model Under Test</p>
            <p className="font-medium mb-3">{readiness.candidate_model.name}</p>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Avg Error</span>
                <span>{readiness.candidate_model.metrics.avg_gross_error.toFixed(2)}"</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Within 5"</span>
                <span>{readiness.candidate_model.metrics.within_5_inches_percent.toFixed(1)}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Within 10"</span>
                <span>{readiness.candidate_model.metrics.within_10_inches_percent.toFixed(1)}%</span>
              </div>
            </div>
          </div>
        )}
      </CardContent>
      <CardFooter className="border-t pt-4 flex gap-3 justify-end">
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button variant="outline">Record Decision</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Record Promotion Decision</DialogTitle>
              <DialogDescription>
                Log your decision about promoting {readiness.candidate_model.name}.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="decision">Decision</Label>
                <Select value={decision} onValueChange={(v) => setDecision(v as PromotionDecisionType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="promote">
                      <span className="flex items-center gap-2">
                        <CheckCircle className="h-4 w-4 text-green-600" />
                        Promote
                      </span>
                    </SelectItem>
                    <SelectItem value="reject">
                      <span className="flex items-center gap-2">
                        <XCircle className="h-4 w-4 text-destructive" />
                        Reject
                      </span>
                    </SelectItem>
                    <SelectItem value="defer">
                      <span className="flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-yellow-600" />
                        Defer
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="reason">Reason *</Label>
                <Textarea
                  id="reason"
                  placeholder="Why are you making this decision?"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="notes">Additional Notes</Label>
                <Textarea
                  id="notes"
                  placeholder="Any additional context..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleSubmitDecision} disabled={!reason.trim() || submitting}>
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Save Decision'
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardFooter>
    </Card>
  )
}
