'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { TrainingPackItem, TrainingPackArtifactSummary } from '@/lib/types'

interface TrainingPackItemViewerProps {
  item: TrainingPackItem & {
    prediction?: {
      prediction_id: string
      predicted_gross: number | null
      predicted_net: number | null
      official_score: number | null
    }
  }
  onClose?: () => void
}

export function TrainingPackItemViewer({ item, onClose }: TrainingPackItemViewerProps) {
  const summary = item.artifact_summary_json as TrainingPackArtifactSummary

  const errorGross = summary.error_gross
  const hasIntervallMiss = summary.actual_gross !== undefined && 
    item.prediction?.predicted_gross !== undefined

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Training Pack Item</CardTitle>
        <CardDescription className="flex items-center gap-2">
          <code className="text-xs">{item.id}</code>
          <Badge variant={item.split_assignment === 'train' ? 'default' : 'secondary'}>
            {item.split_assignment}
          </Badge>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Score Summary */}
        <div className="grid grid-cols-3 gap-4">
          <div>
            <p className="text-sm text-muted-foreground">Predicted</p>
            <p className="text-lg font-semibold">
              {summary.predicted_gross?.toFixed(2)}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Actual</p>
            <p className="text-lg font-semibold">
              {summary.actual_gross?.toFixed(2)}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Error</p>
            <p className={`text-lg font-semibold ${errorGross && errorGross > 5 ? 'text-red-600' : ''}`}>
              {errorGross?.toFixed(2)}
            </p>
          </div>
        </div>

        {/* Artifacts */}
        <div className="space-y-2">
          <h4 className="font-semibold text-sm">Artifacts</h4>
          <div className="space-y-2">
            {summary.supervision_event_count > 0 && (
              <div className="flex justify-between items-center text-sm p-2 bg-muted rounded">
                <span>Supervision Events</span>
                <Badge>{summary.supervision_event_count}</Badge>
              </div>
            )}
            {summary.reverse_run_exists && (
              <div className="flex justify-between items-center text-sm p-2 bg-muted rounded">
                <span>Reverse Pass</span>
                <Badge>{summary.reverse_hypothesis_type}</Badge>
              </div>
            )}
            {summary.structural_run_exists && (
              <div className="flex justify-between items-center text-sm p-2 bg-muted rounded">
                <span>Structural Run</span>
                <Badge variant={summary.structural_topology_changed ? 'default' : 'secondary'}>
                  {summary.structural_topology_changed ? 'Changed' : 'No Change'}
                </Badge>
              </div>
            )}
            {summary.hard_case_pattern_ids.length > 0 && (
              <div className="flex justify-between items-center text-sm p-2 bg-muted rounded">
                <span>Hard-Case Patterns</span>
                <Badge>{summary.hard_case_pattern_ids.length}</Badge>
              </div>
            )}
          </div>
        </div>

        {/* Supervision Types */}
        {summary.supervision_types.length > 0 && (
          <div className="space-y-2">
            <h4 className="font-semibold text-sm">Supervision Types</h4>
            <div className="flex flex-wrap gap-1">
              {summary.supervision_types.map((type) => (
                <Badge key={type} variant="outline" className="text-xs">
                  {type}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Labels */}
        {summary.supervision_labels.length > 0 && (
          <div className="space-y-2">
            <h4 className="font-semibold text-sm">Labels</h4>
            <div className="flex flex-wrap gap-1">
              {summary.supervision_labels.map((label) => (
                <Badge key={label} variant="secondary" className="text-xs">
                  {label}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Quality */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-sm text-muted-foreground">Confidence</p>
            <p className="text-lg font-semibold">{(item.confidence_score ?? 0).toFixed(2)}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Quality</p>
            <p className="text-lg font-semibold">{(item.item_quality_score ?? 0).toFixed(2)}</p>
          </div>
        </div>

        {onClose && (
          <Button onClick={onClose} variant="outline" className="w-full">
            Close
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
