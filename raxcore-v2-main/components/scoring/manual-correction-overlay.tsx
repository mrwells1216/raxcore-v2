'use client'

/**
 * ManualCorrectionOverlay
 *
 * SVG overlay rendered on top of an antler image that shows
 * draggable endpoint handles for a selected measurement field.
 *
 * Coordinates are always stored as normalized values (0-1).
 * All pointer events are handled via SVG to avoid canvas complexity.
 */

import { useCallback, useRef, useState, useEffect } from 'react'
import { cn } from '@/lib/utils'

// ─── Types ─────────────────────────────────────────────────────────────────

export type HandlePoint = { x: number; y: number }

export interface CorrectionHandles {
  start: HandlePoint | null
  end: HandlePoint | null
}

interface ManualCorrectionOverlayProps {
  imageUrl: string
  /** Normalized handle positions (0-1). Null means handle is not yet placed. */
  handles: CorrectionHandles
  /** Called whenever a handle is moved. Coordinates are normalized 0-1. */
  onChange: (handles: CorrectionHandles) => void
  /** Accent color for handles and segment (hex). Defaults to bronze. */
  accentColor?: string
  className?: string
}

// ─── Constants ──────────────────────────────────────────────────────────────

const HANDLE_RADIUS = 10
const ACCENT_DEFAULT = '#b87333' // bronze

// ─── Component ──────────────────────────────────────────────────────────────

export function ManualCorrectionOverlay({
  imageUrl,
  handles,
  onChange,
  accentColor = ACCENT_DEFAULT,
  className,
}: ManualCorrectionOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [imageSize, setImageSize] = useState({ width: 1, height: 1 })
  const [imageLoaded, setImageLoaded] = useState(false)
  const draggingRef = useRef<'start' | 'end' | null>(null)

  // Track natural image dimensions for aspect-ratio-aware hit testing
  const onImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    setImageSize({
      width: e.currentTarget.naturalWidth,
      height: e.currentTarget.naturalHeight,
    })
    setImageLoaded(true)
  }, [])

  // Convert a pointer event's clientX/Y to normalized SVG coordinates (0-1)
  const toNormalized = useCallback(
    (clientX: number, clientY: number): HandlePoint => {
      const svg = svgRef.current
      if (!svg) return { x: 0.5, y: 0.5 }
      const rect = svg.getBoundingClientRect()
      const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      const y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height))
      return { x, y }
    },
    []
  )

  // Pointer down on a handle: begin drag
  const onHandlePointerDown = useCallback(
    (which: 'start' | 'end') => (e: React.PointerEvent) => {
      e.preventDefault()
      e.stopPropagation()
      draggingRef.current = which
      ;(e.target as Element).setPointerCapture(e.pointerId)
    },
    []
  )

  // Pointer move on SVG: update dragged handle
  const onSvgPointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!draggingRef.current) return
      e.preventDefault()
      const pt = toNormalized(e.clientX, e.clientY)
      onChange({
        ...handles,
        [draggingRef.current]: pt,
      })
    },
    [handles, onChange, toNormalized]
  )

  // Pointer up: end drag
  const onSvgPointerUp = useCallback(() => {
    draggingRef.current = null
  }, [])

  // Click on image (not on a handle): place the next unset handle
  const onSvgClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      // Only act if we didn't just finish a drag
      if (draggingRef.current) return
      const pt = toNormalized(e.clientX, e.clientY)
      if (!handles.start) {
        onChange({ ...handles, start: pt })
      } else if (!handles.end) {
        onChange({ ...handles, end: pt })
      }
    },
    [handles, onChange, toNormalized]
  )

  // SVG viewBox dimensions match the image's intrinsic aspect ratio
  const vw = 1000
  const vh = imageSize.width > 0 ? Math.round((imageSize.height / imageSize.width) * 1000) : 1000

  // Convert normalized point to SVG viewBox coordinates
  const toSvg = (pt: HandlePoint) => ({
    x: pt.x * vw,
    y: pt.y * vh,
  })

  const startSvg = handles.start ? toSvg(handles.start) : null
  const endSvg = handles.end ? toSvg(handles.end) : null

  return (
    <div
      ref={containerRef}
      className={cn('relative w-full select-none', className)}
    >
      {/* Base image */}
      <img
        src={imageUrl}
        alt="Antler measurement"
        onLoad={onImageLoad}
        className="w-full block rounded-lg"
        crossOrigin="anonymous"
        draggable={false}
      />

      {/* SVG overlay — absolutely positioned over the image */}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${vw} ${vh}`}
        preserveAspectRatio="none"
        className="absolute inset-0 w-full h-full rounded-lg cursor-crosshair"
        style={{ touchAction: 'none' }}
        onPointerMove={onSvgPointerMove}
        onPointerUp={onSvgPointerUp}
        onPointerLeave={onSvgPointerUp}
        onClick={onSvgClick}
      >
        {/* Segment line between handles */}
        {startSvg && endSvg && (
          <line
            x1={startSvg.x}
            y1={startSvg.y}
            x2={endSvg.x}
            y2={endSvg.y}
            stroke={accentColor}
            strokeWidth={3}
            strokeDasharray="8 4"
            strokeLinecap="round"
            opacity={0.9}
          />
        )}

        {/* Start handle */}
        {startSvg && (
          <g
            onPointerDown={onHandlePointerDown('start')}
            style={{ cursor: 'grab' }}
          >
            <circle
              cx={startSvg.x}
              cy={startSvg.y}
              r={HANDLE_RADIUS + 6}
              fill="transparent"
            />
            <circle
              cx={startSvg.x}
              cy={startSvg.y}
              r={HANDLE_RADIUS}
              fill={accentColor}
              stroke="white"
              strokeWidth={2.5}
              opacity={0.95}
            />
            <text
              x={startSvg.x}
              y={startSvg.y + 4}
              textAnchor="middle"
              fill="white"
              fontSize={11}
              fontWeight="bold"
              style={{ pointerEvents: 'none', userSelect: 'none' }}
            >
              S
            </text>
          </g>
        )}

        {/* End handle */}
        {endSvg && (
          <g
            onPointerDown={onHandlePointerDown('end')}
            style={{ cursor: 'grab' }}
          >
            <circle
              cx={endSvg.x}
              cy={endSvg.y}
              r={HANDLE_RADIUS + 6}
              fill="transparent"
            />
            <circle
              cx={endSvg.x}
              cy={endSvg.y}
              r={HANDLE_RADIUS}
              fill={accentColor}
              stroke="white"
              strokeWidth={2.5}
              opacity={0.95}
            />
            <text
              x={endSvg.x}
              y={endSvg.y + 4}
              textAnchor="middle"
              fill="white"
              fontSize={11}
              fontWeight="bold"
              style={{ pointerEvents: 'none', userSelect: 'none' }}
            >
              E
            </text>
          </g>
        )}

        {/* Instruction when no handles placed yet */}
        {!handles.start && imageLoaded && (
          <text
            x={vw / 2}
            y={vh - 30}
            textAnchor="middle"
            fill="white"
            fontSize={20}
            opacity={0.7}
            style={{ pointerEvents: 'none', userSelect: 'none' }}
          >
            Tap to place start point
          </text>
        )}
        {handles.start && !handles.end && imageLoaded && (
          <text
            x={vw / 2}
            y={vh - 30}
            textAnchor="middle"
            fill="white"
            fontSize={20}
            opacity={0.7}
            style={{ pointerEvents: 'none', userSelect: 'none' }}
          >
            Tap to place end point
          </text>
        )}
      </svg>
    </div>
  )
}
