'use client'

/**
 * DPadAdjustmentModal - Step 9: Directional Pad Adjustment
 * 
 * Pro-level feature for precise tine/landmark adjustment.
 * User taps a weak tine on the overlay to open a modal with:
 * - Image zoom centered on the selected point
 * - D-PAD controller for pixel-level nudges (up/down/left/right)
 * - Live score preview with delta indicator
 * - Confirm/Cancel to apply or discard changes
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { 
  X, 
  ChevronUp, 
  ChevronDown, 
  ChevronLeft, 
  ChevronRight,
  RotateCcw,
  Check,
  ZoomIn,
  ZoomOut,
  Crosshair,
  AlertCircle,
  Loader2
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import type { DetailedLandmarks } from '@/lib/types'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface AdjustablePoint {
  id: string
  label: string
  /** Normalized coordinates (0-1) */
  x: number
  y: number
  /** Which measurement family this point affects */
  family: 'tine' | 'beam' | 'spread' | 'circumference'
  /** Specific measurement key, e.g., 'g1_left', 'main_beam_left' */
  measurementKey: string
  /** Original confidence (0-1) */
  confidence: number
  /** Point role: 'tip' or 'base' */
  role: 'tip' | 'base'
}

export interface AdjustmentResult {
  pointId: string
  originalPosition: { x: number; y: number }
  newPosition: { x: number; y: number }
  measurementKey: string
  /** Delta in pixels at native image resolution */
  deltaPixels: { x: number; y: number }
}

interface DPadAdjustmentModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  imageUrl: string
  /** Image dimensions for coordinate conversion */
  imageDimensions: { width: number; height: number }
  /** The point being adjusted */
  point: AdjustablePoint
  /** All points for context display */
  allPoints: AdjustablePoint[]
  /** Current measurements for live preview */
  currentMeasurements: Record<string, number | null>
  /** Callback when adjustment is confirmed */
  onConfirm: (result: AdjustmentResult) => Promise<void>
  /** Callback for live preview updates (debounced) */
  onPreviewUpdate?: (newPosition: { x: number; y: number }) => Promise<{
    newMeasurementValue: number | null
    newScore: number | null
    scoreDelta: number | null
  } | null>
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const NUDGE_STEP_NORMAL = 2  // pixels at 1x zoom
const NUDGE_STEP_FINE = 0.5  // pixels for fine adjustment
const MIN_ZOOM = 1
const MAX_ZOOM = 4
const PREVIEW_DEBOUNCE_MS = 150

const CONFIDENCE_COLORS = {
  high: 'bg-emerald-500',
  medium: 'bg-amber-500', 
  low: 'bg-red-500',
}

function getConfidenceLevel(confidence: number): 'high' | 'medium' | 'low' {
  if (confidence >= 0.8) return 'high'
  if (confidence >= 0.5) return 'medium'
  return 'low'
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function DPadAdjustmentModal({
  open,
  onOpenChange,
  imageUrl,
  imageDimensions,
  point,
  allPoints,
  currentMeasurements,
  onConfirm,
  onPreviewUpdate,
}: DPadAdjustmentModalProps) {
  // State
  const [position, setPosition] = useState({ x: point.x, y: point.y })
  const [zoom, setZoom] = useState(2)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [fineMode, setFineMode] = useState(false)
  const [previewResult, setPreviewResult] = useState<{
    newMeasurementValue: number | null
    newScore: number | null
    scoreDelta: number | null
  } | null>(null)
  const [isPreviewLoading, setIsPreviewLoading] = useState(false)
  
  // Refs
  const containerRef = useRef<HTMLDivElement>(null)
  const previewTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  
  // Reset position when point changes
  useEffect(() => {
    setPosition({ x: point.x, y: point.y })
    setPreviewResult(null)
  }, [point.id, point.x, point.y])

  // Calculate pixel delta from original
  const deltaPixels = useMemo(() => ({
    x: Math.round((position.x - point.x) * imageDimensions.width),
    y: Math.round((position.y - point.y) * imageDimensions.height),
  }), [position, point.x, point.y, imageDimensions])

  const hasChanges = deltaPixels.x !== 0 || deltaPixels.y !== 0

  // Debounced preview update
  useEffect(() => {
    if (!onPreviewUpdate || !hasChanges) {
      setPreviewResult(null)
      return
    }

    if (previewTimeoutRef.current) {
      clearTimeout(previewTimeoutRef.current)
    }

    setIsPreviewLoading(true)
    previewTimeoutRef.current = setTimeout(async () => {
      try {
        const result = await onPreviewUpdate(position)
        setPreviewResult(result)
      } catch (err) {
        console.error('[dpad] preview update failed:', err)
      } finally {
        setIsPreviewLoading(false)
      }
    }, PREVIEW_DEBOUNCE_MS)

    return () => {
      if (previewTimeoutRef.current) {
        clearTimeout(previewTimeoutRef.current)
      }
    }
  }, [position, hasChanges, onPreviewUpdate])

  // Move handler
  const handleMove = useCallback((dx: number, dy: number) => {
    const step = fineMode ? NUDGE_STEP_FINE : NUDGE_STEP_NORMAL
    const normalizedDx = (dx * step) / imageDimensions.width
    const normalizedDy = (dy * step) / imageDimensions.height

    setPosition(prev => ({
      x: Math.max(0, Math.min(1, prev.x + normalizedDx)),
      y: Math.max(0, Math.min(1, prev.y + normalizedDy)),
    }))
  }, [fineMode, imageDimensions])

  // Keyboard support
  useEffect(() => {
    if (!open) return

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault()
          handleMove(0, -1)
          break
        case 'ArrowDown':
          e.preventDefault()
          handleMove(0, 1)
          break
        case 'ArrowLeft':
          e.preventDefault()
          handleMove(-1, 0)
          break
        case 'ArrowRight':
          e.preventDefault()
          handleMove(1, 0)
          break
        case 'Shift':
          setFineMode(true)
          break
        case 'Enter':
          if (hasChanges) {
            handleConfirm()
          }
          break
        case 'Escape':
          handleReset()
          break
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        setFineMode(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [open, handleMove, hasChanges])

  // Reset to original
  const handleReset = useCallback(() => {
    setPosition({ x: point.x, y: point.y })
    setPreviewResult(null)
  }, [point.x, point.y])

  // Confirm adjustment
  const handleConfirm = useCallback(async () => {
    if (!hasChanges) return

    setIsSubmitting(true)
    try {
      await onConfirm({
        pointId: point.id,
        originalPosition: { x: point.x, y: point.y },
        newPosition: position,
        measurementKey: point.measurementKey,
        deltaPixels,
      })
      onOpenChange(false)
    } catch (err) {
      console.error('[dpad] confirm failed:', err)
    } finally {
      setIsSubmitting(false)
    }
  }, [hasChanges, point, position, deltaPixels, onConfirm, onOpenChange])

  // Calculate viewport transform for zooming
  const viewportStyle = useMemo(() => {
    // Center the viewport on the current position
    const centerX = position.x * 100
    const centerY = position.y * 100
    return {
      transform: `scale(${zoom})`,
      transformOrigin: `${centerX}% ${centerY}%`,
    }
  }, [position, zoom])

  const currentMeasurement = currentMeasurements[point.measurementKey]
  const confidenceLevel = getConfidenceLevel(point.confidence)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0 gap-0 bg-zinc-950 border-zinc-800 overflow-hidden">
        {/* Header */}
        <DialogHeader className="px-4 py-3 border-b border-zinc-800 shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="text-base font-semibold text-white">
                Adjust {point.label}
              </DialogTitle>
              <DialogDescription className="text-xs text-zinc-400 mt-0.5">
                {point.role === 'tip' ? 'Tine tip' : 'Base point'} - {point.family}
              </DialogDescription>
            </div>
            <div className="flex items-center gap-2">
              <Badge 
                variant="outline" 
                className={cn(
                  'text-[10px] h-5 px-1.5 border-zinc-700',
                  confidenceLevel === 'low' && 'text-red-400 border-red-500/30',
                  confidenceLevel === 'medium' && 'text-amber-400 border-amber-500/30',
                  confidenceLevel === 'high' && 'text-emerald-400 border-emerald-500/30',
                )}
              >
                {Math.round(point.confidence * 100)}% conf
              </Badge>
            </div>
          </div>
        </DialogHeader>

        {/* Image Viewport */}
        <div 
          ref={containerRef}
          className="relative w-full aspect-square bg-black overflow-hidden"
        >
          {/* Zoomed image container */}
          <div 
            className="absolute inset-0 transition-transform duration-100 ease-out"
            style={viewportStyle}
          >
            <img
              src={imageUrl}
              alt="Antler adjustment"
              className="w-full h-full object-contain"
              draggable={false}
            />

            {/* All points overlay (dimmed) */}
            <svg className="absolute inset-0 w-full h-full pointer-events-none">
              {allPoints.filter(p => p.id !== point.id).map(p => (
                <circle
                  key={p.id}
                  cx={`${p.x * 100}%`}
                  cy={`${p.y * 100}%`}
                  r={4 / zoom}
                  className="fill-zinc-500/50 stroke-zinc-600"
                  strokeWidth={1 / zoom}
                />
              ))}
            </svg>

            {/* Active point - original position (ghost) */}
            {hasChanges && (
              <svg className="absolute inset-0 w-full h-full pointer-events-none">
                <circle
                  cx={`${point.x * 100}%`}
                  cy={`${point.y * 100}%`}
                  r={6 / zoom}
                  className="fill-none stroke-zinc-500"
                  strokeWidth={2 / zoom}
                  strokeDasharray={`${3 / zoom} ${3 / zoom}`}
                />
              </svg>
            )}

            {/* Active point - current position */}
            <svg className="absolute inset-0 w-full h-full pointer-events-none">
              <circle
                cx={`${position.x * 100}%`}
                cy={`${position.y * 100}%`}
                r={8 / zoom}
                className="fill-[#b87333] stroke-white"
                strokeWidth={2 / zoom}
              />
              {/* Crosshair */}
              <line
                x1={`${position.x * 100}%`}
                y1={`${(position.y - 0.02) * 100}%`}
                x2={`${position.x * 100}%`}
                y2={`${(position.y + 0.02) * 100}%`}
                className="stroke-white"
                strokeWidth={1.5 / zoom}
              />
              <line
                x1={`${(position.x - 0.02) * 100}%`}
                y1={`${position.y * 100}%`}
                x2={`${(position.x + 0.02) * 100}%`}
                y2={`${position.y * 100}%`}
                className="stroke-white"
                strokeWidth={1.5 / zoom}
              />
            </svg>
          </div>

          {/* Zoom controls */}
          <div className="absolute top-3 right-3 flex flex-col gap-1">
            <Button
              variant="secondary"
              size="icon"
              className="h-8 w-8 bg-zinc-900/80 hover:bg-zinc-800 border border-zinc-700"
              onClick={() => setZoom(z => Math.min(z + 0.5, MAX_ZOOM))}
              disabled={zoom >= MAX_ZOOM}
            >
              <ZoomIn className="h-4 w-4" />
            </Button>
            <Badge className="bg-zinc-900/80 text-zinc-300 border border-zinc-700 justify-center text-[10px]">
              {zoom}x
            </Badge>
            <Button
              variant="secondary"
              size="icon"
              className="h-8 w-8 bg-zinc-900/80 hover:bg-zinc-800 border border-zinc-700"
              onClick={() => setZoom(z => Math.max(z - 0.5, MIN_ZOOM))}
              disabled={zoom <= MIN_ZOOM}
            >
              <ZoomOut className="h-4 w-4" />
            </Button>
          </div>

          {/* Delta indicator */}
          {hasChanges && (
            <div className="absolute top-3 left-3 px-2 py-1 bg-zinc-900/90 rounded text-xs text-zinc-300 font-mono border border-zinc-700">
              {deltaPixels.x >= 0 ? '+' : ''}{deltaPixels.x}px, {deltaPixels.y >= 0 ? '+' : ''}{deltaPixels.y}px
            </div>
          )}
        </div>

        {/* Live Preview Section */}
        <div className="px-4 py-3 border-t border-zinc-800 bg-zinc-900/50">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-3">
              <div className="text-zinc-500">
                Current: <span className="text-zinc-300 font-mono">{currentMeasurement?.toFixed(2) ?? '—'}&quot;</span>
              </div>
              {previewResult && (
                <>
                  <span className="text-zinc-600">→</span>
                  <div className="text-zinc-300">
                    Preview: <span className="font-mono">{previewResult.newMeasurementValue?.toFixed(2) ?? '—'}&quot;</span>
                  </div>
                </>
              )}
            </div>
            {isPreviewLoading && (
              <Loader2 className="h-3.5 w-3.5 text-zinc-500 animate-spin" />
            )}
            {previewResult?.scoreDelta != null && (
              <Badge 
                variant="outline"
                className={cn(
                  'text-[10px] h-5 px-1.5 font-mono',
                  previewResult.scoreDelta > 0 
                    ? 'text-emerald-400 border-emerald-500/30' 
                    : previewResult.scoreDelta < 0 
                      ? 'text-red-400 border-red-500/30'
                      : 'text-zinc-400 border-zinc-700'
                )}
              >
                Score: {previewResult.scoreDelta >= 0 ? '+' : ''}{previewResult.scoreDelta.toFixed(1)}
              </Badge>
            )}
          </div>
        </div>

        {/* D-PAD Controls */}
        <div className="px-4 py-4 border-t border-zinc-800">
          <div className="flex items-center gap-4">
            {/* D-PAD */}
            <div className="flex-1 flex justify-center">
              <div className="grid grid-cols-3 gap-1">
                <div />
                <Button
                  variant="outline"
                  size="icon"
                  className="h-12 w-12 bg-zinc-900 border-zinc-700 hover:bg-zinc-800 hover:border-zinc-600 active:scale-95 transition-all"
                  onClick={() => handleMove(0, -1)}
                >
                  <ChevronUp className="h-5 w-5" />
                </Button>
                <div />
                <Button
                  variant="outline"
                  size="icon"
                  className="h-12 w-12 bg-zinc-900 border-zinc-700 hover:bg-zinc-800 hover:border-zinc-600 active:scale-95 transition-all"
                  onClick={() => handleMove(-1, 0)}
                >
                  <ChevronLeft className="h-5 w-5" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className={cn(
                    'h-12 w-12 border-zinc-700 transition-all',
                    fineMode 
                      ? 'bg-amber-600/20 border-amber-500/50 text-amber-400' 
                      : 'bg-zinc-900 hover:bg-zinc-800'
                  )}
                  onClick={() => setFineMode(f => !f)}
                >
                  <Crosshair className="h-5 w-5" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-12 w-12 bg-zinc-900 border-zinc-700 hover:bg-zinc-800 hover:border-zinc-600 active:scale-95 transition-all"
                  onClick={() => handleMove(1, 0)}
                >
                  <ChevronRight className="h-5 w-5" />
                </Button>
                <div />
                <Button
                  variant="outline"
                  size="icon"
                  className="h-12 w-12 bg-zinc-900 border-zinc-700 hover:bg-zinc-800 hover:border-zinc-600 active:scale-95 transition-all"
                  onClick={() => handleMove(0, 1)}
                >
                  <ChevronDown className="h-5 w-5" />
                </Button>
                <div />
              </div>
            </div>

            {/* Mode indicator */}
            <div className="text-center space-y-1">
              <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Mode</div>
              <Badge 
                variant="outline" 
                className={cn(
                  'text-xs',
                  fineMode 
                    ? 'bg-amber-600/20 border-amber-500/50 text-amber-400' 
                    : 'border-zinc-700 text-zinc-400'
                )}
              >
                {fineMode ? 'Fine' : 'Normal'}
              </Badge>
              <div className="text-[9px] text-zinc-600">
                {fineMode ? '0.5px steps' : '2px steps'}
              </div>
            </div>
          </div>

          {/* Keyboard hint */}
          <div className="mt-3 text-center text-[10px] text-zinc-600">
            Arrow keys to move • Hold Shift for fine mode • Enter to confirm
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-4 py-3 border-t border-zinc-800 flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleReset}
            disabled={!hasChanges || isSubmitting}
            className="text-zinc-400 hover:text-white h-9 gap-1.5"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </Button>

          <div className="flex-1" />

          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
            className="border-zinc-700 text-zinc-300 hover:bg-zinc-800 h-9"
          >
            Cancel
          </Button>

          <Button
            size="sm"
            onClick={handleConfirm}
            disabled={!hasChanges || isSubmitting}
            className="bg-[#b87333] hover:bg-[#a06020] text-white border-0 h-9 gap-1.5 font-medium min-w-[100px]"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Check className="h-3.5 w-3.5" />
                Confirm
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Tappable Overlay Component for triggering D-PAD
// ─────────────────────────────────────────────────────────────────────────────

interface TappablePointsOverlayProps {
  imageUrl: string
  imageDimensions: { width: number; height: number }
  points: AdjustablePoint[]
  onPointTap: (point: AdjustablePoint) => void
  /** Only show points below this confidence threshold */
  confidenceThreshold?: number
  className?: string
}

export function TappablePointsOverlay({
  imageUrl,
  imageDimensions,
  points,
  onPointTap,
  confidenceThreshold = 0.8,
  className,
}: TappablePointsOverlayProps) {
  // Filter to weak points that need adjustment
  const weakPoints = points.filter(p => p.confidence < confidenceThreshold)

  if (weakPoints.length === 0) return null

  return (
    <div className={cn('relative', className)}>
      <img
        src={imageUrl}
        alt="Antler with adjustable points"
        className="w-full h-auto"
        draggable={false}
      />
      
      {/* Tappable point markers */}
      <svg className="absolute inset-0 w-full h-full">
        {weakPoints.map(point => {
          const confidenceLevel = getConfidenceLevel(point.confidence)
          return (
            <g key={point.id}>
              {/* Tap target (larger invisible circle) */}
              <circle
                cx={`${point.x * 100}%`}
                cy={`${point.y * 100}%`}
                r={20}
                className="fill-transparent cursor-pointer"
                onClick={() => onPointTap(point)}
              />
              {/* Visible marker */}
              <circle
                cx={`${point.x * 100}%`}
                cy={`${point.y * 100}%`}
                r={8}
                className={cn(
                  'stroke-white stroke-2 cursor-pointer transition-transform hover:scale-125',
                  confidenceLevel === 'low' && 'fill-red-500',
                  confidenceLevel === 'medium' && 'fill-amber-500',
                  confidenceLevel === 'high' && 'fill-emerald-500',
                )}
                onClick={() => onPointTap(point)}
              />
              {/* Pulsing ring for low confidence */}
              {confidenceLevel === 'low' && (
                <circle
                  cx={`${point.x * 100}%`}
                  cy={`${point.y * 100}%`}
                  r={12}
                  className="fill-none stroke-red-500/50 animate-ping"
                  strokeWidth={2}
                  style={{ animationDuration: '2s' }}
                />
              )}
            </g>
          )
        })}
      </svg>

      {/* Legend */}
      <div className="absolute bottom-2 left-2 right-2 flex items-center justify-center gap-3 text-[10px] text-white/80 bg-black/60 rounded px-2 py-1">
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full bg-red-500" />
          Tap to adjust
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full bg-amber-500" />
          Review suggested
        </span>
      </div>
    </div>
  )
}
