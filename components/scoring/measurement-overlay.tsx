'use client'

/**
 * Measurement Overlay Component
 * 
 * Displays visual overlays on scored images showing:
 * - Landmark points
 * - Measurement segments (beams, tines, spread)
 * - Color-coded by confidence level
 */

import { useEffect, useRef, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { DetailedLandmarks } from '@/lib/types'
import type { MeasuredField } from '@/lib/rules-engine/types'
import { buildOverlayFeatures, type OverlayFeature, summarizeFeatureConfidence } from '@/lib/scoring/measurement-overlay-mapping'

interface MeasurementOverlayProps {
  imageUrl: string
  landmarks?: DetailedLandmarks | null
  measurements?: Record<string, any> | null
  provenance?: Record<string, MeasuredField> | null
  className?: string
  showLegend?: boolean
  showSummary?: boolean
}

export function MeasurementOverlay({
  imageUrl,
  landmarks,
  measurements,
  provenance,
  className = '',
  showLegend = true,
  showSummary = false,
}: MeasurementOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 })
  const [features, setFeatures] = useState<OverlayFeature[]>([])
  const [hasLandmarks, setHasLandmarks] = useState(false)

  // Load image and get dimensions
  useEffect(() => {
    if (!imageUrl) return

    const img = new Image()
    img.crossOrigin = 'anonymous' // Enable CORS if needed
    img.src = imageUrl

    img.onload = () => {
      setImageDimensions({ width: img.width, height: img.height })
      if (imageRef.current) {
        imageRef.current.src = imageUrl
      }
    }
  }, [imageUrl])

  // Build overlay features when landmarks/provenance change
  useEffect(() => {
    if (!landmarks || imageDimensions.width === 0) {
      setFeatures([])
      setHasLandmarks(false)
      return
    }

    const overlayFeatures = buildOverlayFeatures({
      landmarks,
      measurements,
      provenance,
      imageWidth: imageDimensions.width,
      imageHeight: imageDimensions.height,
    })

    setFeatures(overlayFeatures)
    setHasLandmarks(overlayFeatures.length > 0)
  }, [landmarks, measurements, provenance, imageDimensions])

  // Draw overlay on canvas
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || features.length === 0 || imageDimensions.width === 0) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Set canvas size to match image
    canvas.width = imageDimensions.width
    canvas.height = imageDimensions.height

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // Draw each feature
    features.forEach(feature => {
      if (feature.kind === 'point') {
        // Draw point marker
        const point = feature.points[0]
        ctx.fillStyle = feature.color
        ctx.strokeStyle = '#000000'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(point.x, point.y, 6, 0, 2 * Math.PI)
        ctx.fill()
        ctx.stroke()

        // Draw label
        ctx.fillStyle = '#ffffff'
        ctx.strokeStyle = '#000000'
        ctx.lineWidth = 3
        ctx.font = 'bold 12px sans-serif'
        ctx.textAlign = 'center'
        ctx.strokeText(feature.label, point.x, point.y - 12)
        ctx.fillText(feature.label, point.x, point.y - 12)
      } else if (feature.kind === 'segment') {
        // Draw line segment
        const [start, end] = feature.points
        ctx.strokeStyle = feature.color
        ctx.lineWidth = 3
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(start.x, start.y)
        ctx.lineTo(end.x, end.y)
        ctx.stroke()

        // Draw endpoint markers
        ctx.fillStyle = feature.color
        ctx.beginPath()
        ctx.arc(start.x, start.y, 4, 0, 2 * Math.PI)
        ctx.fill()
        ctx.beginPath()
        ctx.arc(end.x, end.y, 4, 0, 2 * Math.PI)
        ctx.fill()

        // Draw label at midpoint
        const midX = (start.x + end.x) / 2
        const midY = (start.y + end.y) / 2
        ctx.fillStyle = '#ffffff'
        ctx.strokeStyle = '#000000'
        ctx.lineWidth = 3
        ctx.font = 'bold 11px sans-serif'
        ctx.textAlign = 'center'
        const labelText = feature.measurementValue 
          ? `${feature.label} (${feature.measurementValue.toFixed(1)}")`
          : feature.label
        ctx.strokeText(labelText, midX, midY - 8)
        ctx.fillText(labelText, midX, midY - 8)
      } else if (feature.kind === 'polyline') {
        // Draw connected line segments
        if (feature.points.length < 2) return
        ctx.strokeStyle = feature.color
        ctx.lineWidth = 3
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(feature.points[0].x, feature.points[0].y)
        for (let i = 1; i < feature.points.length; i++) {
          ctx.lineTo(feature.points[i].x, feature.points[i].y)
        }
        ctx.stroke()
      }
    })
  }, [features, imageDimensions])

  const summary = features.length > 0 ? summarizeFeatureConfidence(features) : null

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Measurement Overlay</CardTitle>
        <CardDescription>
          Visual confidence map showing measured features
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Image with overlay */}
        <div className="relative w-full bg-black/5 dark:bg-white/5 rounded-lg overflow-hidden">
          <img
            ref={imageRef}
            src={imageUrl}
            alt="Scored buck"
            className="w-full h-auto"
          />
          {hasLandmarks && (
            <canvas
              ref={canvasRef}
              className="absolute inset-0 w-full h-full pointer-events-none"
              style={{ mixBlendMode: 'screen' }}
            />
          )}
        </div>

        {/* Empty state */}
        {!hasLandmarks && (
          <div className="text-center py-8 text-sm text-muted-foreground">
            Detailed landmark overlay unavailable for this score
          </div>
        )}

        {/* Legend */}
        {showLegend && hasLandmarks && (
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 mr-1.5" />
              High Confidence
            </Badge>
            <Badge variant="outline" className="bg-amber-500/10 text-amber-300 border-amber-500/30">
              <span className="inline-block w-2 h-2 rounded-full bg-amber-500 mr-1.5" />
              Medium Confidence
            </Badge>
            <Badge variant="outline" className="bg-red-500/10 text-red-300 border-red-500/30">
              <span className="inline-block w-2 h-2 rounded-full bg-red-500 mr-1.5" />
              Low Confidence
            </Badge>
          </div>
        )}

        {/* Summary */}
        {showSummary && summary && (summary.strongest.length > 0 || summary.weakest.length > 0) && (
          <div className="rounded-lg border border-border/50 p-3 space-y-2 text-xs">
            {summary.strongest.length > 0 && (
              <div>
                <span className="font-medium text-emerald-400">Strongest features:</span>
                <span className="ml-2 text-muted-foreground">
                  {summary.strongest.join(', ')}
                </span>
              </div>
            )}
            {summary.weakest.length > 0 && (
              <div>
                <span className="font-medium text-red-300">Weakest features:</span>
                <span className="ml-2 text-muted-foreground">
                  {summary.weakest.join(', ')}
                </span>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
