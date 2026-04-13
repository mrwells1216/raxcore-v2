'use client'

/**
 * DPadAdjustmentPanel - Integration wrapper for D-PAD functionality
 * 
 * This panel integrates into the scoring results page to allow users
 * to tap weak points and make precise adjustments using the D-PAD modal.
 */

import { useState, useCallback, useEffect } from 'react'
import useSWR from 'swr'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { AlertCircle, Crosshair, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { 
  DPadAdjustmentModal, 
  TappablePointsOverlay,
  type AdjustablePoint,
  type AdjustmentResult,
} from './dpad-adjustment-modal'
import { cn } from '@/lib/utils'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface DPadAdjustmentPanelProps {
  predictionId: string
  onScoreUpdate?: (newScore: number, delta: number) => void
  className?: string
}

interface AdjustmentData {
  predictionId: string
  buckId: string
  imageUrl: string
  imageDimensions: { width: number; height: number }
  points: AdjustablePoint[]
  measurements: Record<string, number | null>
  currentScore: number | null
  scalingFactor: number
  imageCount: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Fetcher
// ─────────────────────────────────────────────────────────────────────────────

const fetcher = (url: string) => fetch(url).then(res => {
  if (!res.ok) throw new Error('Failed to fetch adjustment data')
  return res.json()
})

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function DPadAdjustmentPanel({
  predictionId,
  onScoreUpdate,
  className,
}: DPadAdjustmentPanelProps) {
  const [selectedPoint, setSelectedPoint] = useState<AdjustablePoint | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [imageIndex, setImageIndex] = useState(0)

  // Fetch adjustment data
  const { data, error, isLoading, mutate } = useSWR<AdjustmentData>(
    predictionId 
      ? `/api/scoring/dpad-adjust?predictionId=${predictionId}&imageIndex=${imageIndex}` 
      : null,
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 5000,
    }
  )

  // Handle point tap
  const handlePointTap = useCallback((point: AdjustablePoint) => {
    setSelectedPoint(point)
    setIsModalOpen(true)
  }, [])

  // Handle preview update
  const handlePreviewUpdate = useCallback(async (newPosition: { x: number; y: number }) => {
    if (!data || !selectedPoint) return null

    try {
      const response = await fetch('/api/scoring/dpad-adjust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'preview',
          predictionId: data.predictionId,
          pointId: selectedPoint.id,
          newPosition,
          allPoints: data.points,
          scalingFactor: data.scalingFactor,
          imageDimensions: data.imageDimensions,
          currentMeasurements: data.measurements,
        }),
      })

      if (!response.ok) throw new Error('Preview failed')

      const result = await response.json()
      return {
        newMeasurementValue: result.preview.newMeasurementValue,
        newScore: result.preview.newScore,
        scoreDelta: result.preview.scoreDelta,
      }
    } catch (err) {
      console.error('[dpad] preview error:', err)
      return null
    }
  }, [data, selectedPoint])

  // Handle confirm
  const handleConfirm = useCallback(async (result: AdjustmentResult) => {
    if (!data) return

    try {
      const response = await fetch('/api/scoring/dpad-adjust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'confirm',
          predictionId: data.predictionId,
          buckId: data.buckId,
          imageIndex,
          adjustment: result,
          allPoints: data.points,
          scalingFactor: data.scalingFactor,
          imageDimensions: data.imageDimensions,
          originalMeasurements: data.measurements,
        }),
      })

      if (!response.ok) throw new Error('Confirm failed')

      const confirmResult = await response.json()

      // Update UI
      toast.success(`${result.measurementKey} adjusted: ${confirmResult.result.newValue?.toFixed(2)}"`)

      // Notify parent
      if (onScoreUpdate && confirmResult.result.newScore != null) {
        onScoreUpdate(confirmResult.result.newScore, confirmResult.result.scoreDelta)
      }

      // Refresh data
      mutate()
    } catch (err) {
      console.error('[dpad] confirm error:', err)
      toast.error('Failed to save adjustment')
      throw err
    }
  }, [data, imageIndex, onScoreUpdate, mutate])

  // Count weak points
  const weakPointCount = data?.points.filter(p => p.confidence < 0.8).length ?? 0

  // Loading state
  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader className="pb-3">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-48 mt-1" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-48 w-full rounded-lg" />
        </CardContent>
      </Card>
    )
  }

  // Error state
  if (error || !data) {
    return (
      <Card className={className}>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Crosshair className="h-4 w-4" />
            Fine-Tune Measurements
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <AlertCircle className="h-4 w-4" />
            Unable to load adjustment data
          </div>
        </CardContent>
      </Card>
    )
  }

  // No weak points
  if (weakPointCount === 0) {
    return (
      <Card className={className}>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Crosshair className="h-4 w-4" />
            Fine-Tune Measurements
          </CardTitle>
          <CardDescription>
            All landmark points have high confidence - no adjustments needed
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
            All measurements are confident
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      <Card className={className}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Crosshair className="h-4 w-4" />
                Fine-Tune Measurements
              </CardTitle>
              <CardDescription>
                Tap low-confidence points to adjust their positions
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {weakPointCount > 0 && (
                <Badge variant="outline" className="text-amber-400 border-amber-500/30">
                  {weakPointCount} weak {weakPointCount === 1 ? 'point' : 'points'}
                </Badge>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => mutate()}
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-3">
          {/* Image selector for multi-image predictions */}
          {data.imageCount > 1 && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Image:</span>
              <div className="flex gap-1">
                {Array.from({ length: data.imageCount }, (_, i) => (
                  <Button
                    key={i}
                    variant={imageIndex === i ? 'default' : 'outline'}
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={() => setImageIndex(i)}
                  >
                    {i + 1}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {/* Tappable overlay */}
          <TappablePointsOverlay
            imageUrl={data.imageUrl}
            imageDimensions={data.imageDimensions}
            points={data.points}
            onPointTap={handlePointTap}
            confidenceThreshold={0.8}
            className="rounded-lg overflow-hidden border"
          />

          {/* Current score display */}
          {data.currentScore != null && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Current Score:</span>
              <span className="font-mono font-medium">{data.currentScore.toFixed(1)}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* D-PAD Modal */}
      {selectedPoint && (
        <DPadAdjustmentModal
          open={isModalOpen}
          onOpenChange={setIsModalOpen}
          imageUrl={data.imageUrl}
          imageDimensions={data.imageDimensions}
          point={selectedPoint}
          allPoints={data.points}
          currentMeasurements={data.measurements}
          onConfirm={handleConfirm}
          onPreviewUpdate={handlePreviewUpdate}
        />
      )}
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Compact variant for embedding in other panels
// ─────────────────────────────────────────────────────────────────────────────

interface CompactDPadTriggerProps {
  predictionId: string
  onOpen?: () => void
  className?: string
}

export function CompactDPadTrigger({
  predictionId,
  onOpen,
  className,
}: CompactDPadTriggerProps) {
  const { data } = useSWR<AdjustmentData>(
    predictionId 
      ? `/api/scoring/dpad-adjust?predictionId=${predictionId}` 
      : null,
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 10000,
    }
  )

  const weakPointCount = data?.points.filter(p => p.confidence < 0.8).length ?? 0

  if (weakPointCount === 0) return null

  return (
    <Button
      variant="outline"
      size="sm"
      className={cn('gap-1.5 h-8 text-xs', className)}
      onClick={onOpen}
    >
      <Crosshair className="h-3.5 w-3.5" />
      Fine-tune ({weakPointCount})
    </Button>
  )
}
