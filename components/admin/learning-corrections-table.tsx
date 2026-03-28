'use client'

import { useState, useEffect } from 'react'
import useSWR from 'swr'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import {
  ChevronDown,
  ChevronUp,
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  Info,
} from 'lucide-react'
import type { LearningCorrectionLog, InfluentialExampleDetail } from '@/lib/types'

const fetcher = (url: string) => fetch(url).then(res => res.json())

export function LearningCorrectionsTable() {
  const { data, error, isLoading } = useSWR<{ corrections: LearningCorrectionLog[] }>(
    '/api/admin/influence/corrections?limit=50',
    fetcher,
    { refreshInterval: 30000 }
  )
  
  const [selectedCorrection, setSelectedCorrection] = useState<LearningCorrectionLog | null>(null)
  const [showDetails, setShowDetails] = useState(false)
  
  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    )
  }
  
  if (error) {
    return (
      <div className="flex items-center gap-2 text-destructive">
        <AlertTriangle className="h-4 w-4" />
        <span>Error loading corrections</span>
      </div>
    )
  }
  
  const corrections = data?.corrections || []
  
  if (corrections.length === 0) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
        <Info className="h-4 w-4" />
        <span>No learning corrections recorded yet</span>
      </div>
    )
  }
  
  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Time</TableHead>
            <TableHead>Direction</TableHead>
            <TableHead className="text-right">Gross Corr.</TableHead>
            <TableHead className="text-right">Examples</TableHead>
            <TableHead className="text-right">Avg Similarity</TableHead>
            <TableHead className="text-right">Total Weight</TableHead>
            <TableHead>Method</TableHead>
            <TableHead>Capped</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {corrections.map((correction) => (
            <TableRow key={correction.id}>
              <TableCell className="text-sm text-muted-foreground">
                {new Date(correction.created_at).toLocaleString()}
              </TableCell>
              <TableCell>
                <DirectionBadge direction={correction.correction_direction} />
              </TableCell>
              <TableCell className="text-right font-mono">
                <CorrectionValue value={correction.gross_correction} />
              </TableCell>
              <TableCell className="text-right">
                {correction.contributing_examples_count}
                {correction.highly_similar_count && correction.highly_similar_count > 0 && (
                  <span className="text-xs text-muted-foreground ml-1">
                    ({correction.highly_similar_count} high)
                  </span>
                )}
              </TableCell>
              <TableCell className="text-right font-mono">
                {correction.avg_similarity !== null 
                  ? `${(correction.avg_similarity * 100).toFixed(0)}%` 
                  : '-'}
              </TableCell>
              <TableCell className="text-right font-mono">
                {correction.total_influence_weight?.toFixed(2) || '-'}
              </TableCell>
              <TableCell>
                <Badge variant="outline" className="text-xs">
                  {correction.aggregation_method}
                </Badge>
              </TableCell>
              <TableCell>
                {correction.cap_applied ? (
                  <Badge variant="secondary" className="text-xs">
                    Capped
                  </Badge>
                ) : (
                  <span className="text-muted-foreground">-</span>
                )}
              </TableCell>
              <TableCell>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSelectedCorrection(correction)
                    setShowDetails(true)
                  }}
                >
                  Details
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      
      <CorrectionDetailsDialog
        correction={selectedCorrection}
        open={showDetails}
        onOpenChange={setShowDetails}
      />
    </>
  )
}

function DirectionBadge({ direction }: { direction: string }) {
  switch (direction) {
    case 'increase':
      return (
        <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400">
          <TrendingUp className="h-3 w-3 mr-1" />
          Up
        </Badge>
      )
    case 'decrease':
      return (
        <Badge className="bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400">
          <TrendingDown className="h-3 w-3 mr-1" />
          Down
        </Badge>
      )
    case 'mixed':
      return (
        <Badge variant="secondary">
          <Minus className="h-3 w-3 mr-1" />
          Mixed
        </Badge>
      )
    default:
      return (
        <Badge variant="outline">
          <Minus className="h-3 w-3 mr-1" />
          None
        </Badge>
      )
  }
}

function CorrectionValue({ value }: { value: number }) {
  const absValue = Math.abs(value)
  const sign = value >= 0 ? '+' : ''
  const colorClass = value > 0 
    ? 'text-emerald-600 dark:text-emerald-400' 
    : value < 0 
    ? 'text-rose-600 dark:text-rose-400' 
    : 'text-muted-foreground'
  
  return (
    <span className={colorClass}>
      {sign}{value.toFixed(1)}&quot;
    </span>
  )
}

function CorrectionDetailsDialog({
  correction,
  open,
  onOpenChange,
}: {
  correction: LearningCorrectionLog | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  if (!correction) return null
  
  const examples = correction.influential_examples as InfluentialExampleDetail[] | null
  const context = correction.scenario_context as Record<string, unknown> | null
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Correction Details</DialogTitle>
          <DialogDescription>
            Applied on {new Date(correction.created_at).toLocaleString()}
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-6">
          {/* Summary Stats */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-muted/50 rounded-lg p-3">
              <div className="text-xs text-muted-foreground">Gross Correction</div>
              <div className="text-lg font-bold">
                <CorrectionValue value={correction.gross_correction} />
              </div>
              {correction.cap_applied && (
                <div className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                  {correction.cap_reason}
                </div>
              )}
            </div>
            <div className="bg-muted/50 rounded-lg p-3">
              <div className="text-xs text-muted-foreground">Examples Used</div>
              <div className="text-lg font-bold">{correction.contributing_examples_count}</div>
              <div className="text-xs text-muted-foreground">
                {correction.highly_similar_count || 0} highly similar
              </div>
            </div>
            <div className="bg-muted/50 rounded-lg p-3">
              <div className="text-xs text-muted-foreground">Total Weight</div>
              <div className="text-lg font-bold">
                {correction.total_influence_weight?.toFixed(2) || '-'}
              </div>
              <div className="text-xs text-muted-foreground">
                Method: {correction.aggregation_method}
              </div>
            </div>
          </div>
          
          {/* Scenario Context */}
          {context && (
            <div>
              <h4 className="font-medium mb-2">Scoring Context</h4>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>State: <span className="font-medium">{context.state as string}</span></div>
                <div>Rack: <span className="font-medium">{context.rack_type as string}</span></div>
                <div>Source: <span className="font-medium">{(context.source_type as string) || '-'}</span></div>
                <div>Images: <span className="font-medium">{context.image_count as number}</span></div>
                <div>Angle Diversity: <span className="font-medium">{((context.angle_diversity as number) * 100).toFixed(0)}%</span></div>
                <div>Base Confidence: <span className="font-medium">{(context.base_vision_confidence as number)?.toFixed(0)}%</span></div>
              </div>
            </div>
          )}
          
          {/* Contributing Examples */}
          {examples && examples.length > 0 && (
            <div>
              <h4 className="font-medium mb-2">Contributing Examples</h4>
              <div className="space-y-2">
                {examples.map((ex, i) => (
                  <div 
                    key={ex.example_id} 
                    className="bg-muted/30 rounded-lg p-3 text-sm"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="font-medium">Example #{i + 1}</div>
                      <div className="flex gap-2">
                        <Badge variant="outline">
                          Sim: {(ex.similarity_score * 100).toFixed(0)}%
                        </Badge>
                        <Badge variant="outline">
                          Wt: {ex.effective_weight.toFixed(2)}
                        </Badge>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                      <div>Ground Truth: <span className="font-mono">{ex.ground_truth_score}&quot;</span></div>
                      <div>Predicted: <span className="font-mono">{ex.predicted_score.toFixed(1)}&quot;</span></div>
                      <div>Error: <CorrectionValue value={ex.error_contribution} /></div>
                      <div>Contribution: <CorrectionValue value={ex.weighted_contribution} /></div>
                    </div>
                    {ex.matching_features.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {ex.matching_features.slice(0, 5).map((feature) => (
                          <Badge key={feature} variant="secondary" className="text-xs">
                            {feature}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {/* Measurement Corrections */}
          {correction.measurement_corrections && Object.keys(correction.measurement_corrections).length > 0 && (
            <div>
              <h4 className="font-medium mb-2">Measurement Corrections</h4>
              <div className="grid grid-cols-2 gap-2 text-sm">
                {Object.entries(correction.measurement_corrections).map(([field, value]) => (
                  <div key={field} className="flex justify-between">
                    <span className="text-muted-foreground">{field.replace(/_/g, ' ')}:</span>
                    <CorrectionValue value={value as number} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
