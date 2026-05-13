'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { ChevronLeft, ChevronRight, Eye, AlertTriangle, CheckCircle2, XCircle, Loader2, Copy } from 'lucide-react'
import { toast } from 'sonner'
import type { TrainingExampleWithHealth, HealthReviewDecision, HealthTier } from '@/lib/types'

const fetcher = (url: string) => fetch(url).then(res => res.json())

function HealthTierBadge({ tier }: { tier: HealthTier }) {
  const variants: Record<HealthTier, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; label: string }> = {
    excellent: { variant: 'default', label: 'Excellent' },
    good: { variant: 'default', label: 'Good' },
    fair: { variant: 'secondary', label: 'Fair' },
    poor: { variant: 'outline', label: 'Poor' },
    excluded: { variant: 'destructive', label: 'Excluded' },
    unknown: { variant: 'outline', label: 'Unknown' },
  }
  
  const { variant, label } = variants[tier] || variants.unknown
  return <Badge variant={variant}>{label}</Badge>
}

function ReviewDialog({ 
  example, 
  onReview 
}: { 
  example: TrainingExampleWithHealth
  onReview: () => void 
}) {
  const [open, setOpen] = useState(false)
  const [decision, setDecision] = useState<HealthReviewDecision>('approve_training')
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async () => {
    if (!reason) {
      toast.error('Please provide a reason for your decision')
      return
    }

    setIsSubmitting(true)
    try {
      const res = await fetch('/api/admin/health/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          training_example_id: example.id,
          decision,
          decision_reason: reason,
          decision_notes: notes || undefined,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to submit review')
      }

      toast.success('Review decision recorded')
      setOpen(false)
      onReview()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to submit review')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-8">
          <Eye className="h-4 w-4 mr-1" />
          Review
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Review Training Example</DialogTitle>
          <DialogDescription>
            Health Score: {example.health_score?.toFixed(1) ?? 'N/A'} | Tier: {example.health_tier}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Health factors summary */}
          {example.health_factors && (
            <div className="space-y-2 text-sm">
              {example.health_factors.top_strengths.length > 0 && (
                <div>
                  <Label className="text-primary">Strengths:</Label>
                  <ul className="list-disc pl-5 text-muted-foreground">
                    {example.health_factors.top_strengths.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </div>
              )}
              {example.health_factors.top_weaknesses.length > 0 && (
                <div>
                  <Label className="text-destructive">Weaknesses:</Label>
                  <ul className="list-disc pl-5 text-muted-foreground">
                    {example.health_factors.top_weaknesses.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Decision */}
          <div className="space-y-2">
            <Label>Decision</Label>
            <RadioGroup value={decision} onValueChange={(v) => setDecision(v as HealthReviewDecision)}>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="approve_training" id="approve" />
                <Label htmlFor="approve" className="font-normal">Approve for Training</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="validation_only" id="validation" />
                <Label htmlFor="validation" className="font-normal">Validation Only</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="exclude" id="exclude" />
                <Label htmlFor="exclude" className="font-normal">Exclude Entirely</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="mark_duplicate" id="duplicate" />
                <Label htmlFor="duplicate" className="font-normal">Mark as Duplicate</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="defer" id="defer" />
                <Label htmlFor="defer" className="font-normal">Defer (Keep Flagged)</Label>
              </div>
            </RadioGroup>
          </div>

          {/* Reason */}
          <div className="space-y-2">
            <Label htmlFor="reason">Reason (required)</Label>
            <Textarea
              id="reason"
              placeholder="Why are you making this decision?"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
            />
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">Additional Notes (optional)</Label>
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
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Submit Decision
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function DatasetHealthTable() {
  const [page, setPage] = useState(1)
  const [healthTierFilter, setHealthTierFilter] = useState<string>('all')
  const [needsReviewFilter, setNeedsReviewFilter] = useState<string>('all')
  const limit = 15

  const queryParams = new URLSearchParams({
    limit: String(limit),
    offset: String((page - 1) * limit),
  })
  
  if (healthTierFilter !== 'all') {
    queryParams.set('health_tier', healthTierFilter)
  }
  if (needsReviewFilter !== 'all') {
    queryParams.set('needs_review', needsReviewFilter)
  }

  const { data, error, isLoading, mutate } = useSWR<{
    data: TrainingExampleWithHealth[]
    count: number
  }>(`/api/admin/health/examples?${queryParams}`, fetcher)

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
        Failed to load examples. Please try again.
      </div>
    )
  }

  const totalPages = Math.ceil(data.count / limit)

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <Select value={healthTierFilter} onValueChange={(v) => { setHealthTierFilter(v); setPage(1) }}>
          <SelectTrigger className="w-[160px] min-h-[44px]">
            <SelectValue placeholder="Health Tier" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Tiers</SelectItem>
            <SelectItem value="excellent">Excellent</SelectItem>
            <SelectItem value="good">Good</SelectItem>
            <SelectItem value="fair">Fair</SelectItem>
            <SelectItem value="poor">Poor</SelectItem>
            <SelectItem value="excluded">Excluded</SelectItem>
            <SelectItem value="unknown">Unknown</SelectItem>
          </SelectContent>
        </Select>

        <Select value={needsReviewFilter} onValueChange={(v) => { setNeedsReviewFilter(v); setPage(1) }}>
          <SelectTrigger className="w-[160px] min-h-[44px]">
            <SelectValue placeholder="Review Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="true">Needs Review</SelectItem>
            <SelectItem value="false">Reviewed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="rounded-md border border-border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[80px]">Score</TableHead>
              <TableHead>Tier</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Error</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Flags</TableHead>
              <TableHead className="w-[100px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.data.length > 0 ? (
              data.data.map((ex) => (
                <TableRow key={ex.id}>
                  <TableCell className="font-mono">
                    {ex.health_score?.toFixed(0) ?? '-'}
                  </TableCell>
                  <TableCell>
                    <HealthTierBadge tier={ex.health_tier} />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {ex.usable_for_training && (
                        <Badge variant="outline" className="text-xs">Train</Badge>
                      )}
                      {ex.usable_for_validation && (
                        <Badge variant="outline" className="text-xs">Val</Badge>
                      )}
                      {!ex.usable_for_training && !ex.usable_for_validation && (
                        <span className="text-muted-foreground text-xs">-</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {ex.gross_error !== null ? (
                      <span className={
                        Math.abs(ex.gross_error) <= 5 ? 'text-primary' :
                        Math.abs(ex.gross_error) <= 10 ? 'text-amber-600' :
                        'text-destructive'
                      }>
                        {ex.gross_error > 0 ? '+' : ''}{ex.gross_error.toFixed(1)}
                      </span>
                    ) : '-'}
                  </TableCell>
                  <TableCell className="text-sm">
                    {ex.score_source_strength !== 'unknown' && (
                      <Badge variant="secondary" className="text-xs capitalize">
                        {ex.score_source_strength}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {ex.needs_review && (
                        <AlertTriangle className="h-4 w-4 text-amber-500" title="Needs review" />
                      )}
                      {ex.is_duplicate && (
                        <Copy className="h-4 w-4 text-amber-500" title="Duplicate" />
                      )}
                      {ex.is_outlier && (
                        <AlertTriangle className="h-4 w-4 text-orange-500" title="Outlier" />
                      )}
                      {ex.verified_for_training && (
                        <CheckCircle2 className="h-4 w-4 text-primary" title="Verified" />
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <ReviewDialog example={ex} onReview={() => mutate()} />
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  No examples found matching filters
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Showing {((page - 1) * limit) + 1}-{Math.min(page * limit, data.count)} of {data.count}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
