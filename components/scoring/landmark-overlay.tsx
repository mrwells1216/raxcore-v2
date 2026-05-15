'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { LandmarkDetection, AntlerLandmarkId } from '@/lib/scoring/landmark-detection'
import { LANDMARK_ZONE_COLORS, getLandmarkZone } from '@/lib/scoring/landmark-detection'
import type { LandmarkMeasurement } from '@/lib/scoring/landmark-geometry'

interface LandmarkOverlayProps {
  landmarks: LandmarkDetection[]
  measurements: LandmarkMeasurement[]
  imageWidth: number
  imageHeight: number
  /** Display width of the image container in CSS pixels */
  containerWidth: number
  containerHeight: number
  onLandmarkCorrected?: (id: AntlerLandmarkId, px: number, py: number) => void
}

const CIRCLE_RADIUS = 8
const LINE_WIDTH = 2

// Pairs to draw lines between
const LINE_PAIRS: Array<[AntlerLandmarkId, AntlerLandmarkId]> = [
  ['burr_left', 'beam_tip_left'],
  ['burr_right', 'beam_tip_right'],
  ['spread_anchor_left', 'spread_anchor_right'],
  ['g1_base_left', 'g1_tip_left'], ['g2_base_left', 'g2_tip_left'],
  ['g3_base_left', 'g3_tip_left'], ['g4_base_left', 'g4_tip_left'],
  ['g5_base_left', 'g5_tip_left'],
  ['g1_base_right', 'g1_tip_right'], ['g2_base_right', 'g2_tip_right'],
  ['g3_base_right', 'g3_tip_right'], ['g4_base_right', 'g4_tip_right'],
  ['g5_base_right', 'g5_tip_right'],
]

export function LandmarkOverlay({
  landmarks,
  measurements,
  imageWidth,
  imageHeight,
  containerWidth,
  containerHeight,
  onLandmarkCorrected,
}: LandmarkOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [localLandmarks, setLocalLandmarks] = useState<LandmarkDetection[]>(landmarks)
  const [dragging, setDragging] = useState<AntlerLandmarkId | null>(null)
  const [tooltip, setTooltip] = useState<{
    id: string
    x: number
    y: number
    text: string
  } | null>(null)

  const scaleX = containerWidth / imageWidth
  const scaleY = containerHeight / imageHeight

  // Sync landmarks if parent updates them
  useEffect(() => {
    setLocalLandmarks(landmarks)
  }, [landmarks])

  const measurementByField = new Map(measurements.map((m) => [m.fieldKey, m]))

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, canvas.width, canvas.height)

    const byId = new Map(localLandmarks.map((lm) => [lm.id, lm]))

    // Draw connector lines
    for (const [fromId, toId] of LINE_PAIRS) {
      const from = byId.get(fromId)
      const to = byId.get(toId)
      if (!from || !to) continue
      if (from.px == null || from.py == null || to.px == null || to.py == null) continue
      if (from.visibility === 'not_visible' || to.visibility === 'not_visible') continue

      const zone = getLandmarkZone(fromId)
      const color = LANDMARK_ZONE_COLORS[zone] ?? '#ffffff'

      ctx.beginPath()
      ctx.moveTo(from.px * scaleX, from.py * scaleY)
      ctx.lineTo(to.px * scaleX, to.py * scaleY)
      ctx.strokeStyle = color
      ctx.globalAlpha = 0.6
      ctx.lineWidth = LINE_WIDTH
      ctx.setLineDash([4, 3])
      ctx.stroke()
      ctx.setLineDash([])
      ctx.globalAlpha = 1
    }

    // Draw landmark circles
    for (const lm of localLandmarks) {
      if (lm.px == null || lm.py == null || lm.visibility === 'not_visible') continue

      const zone = getLandmarkZone(lm.id)
      const color = LANDMARK_ZONE_COLORS[zone] ?? '#ffffff'
      const opacity = 0.3 + 0.7 * lm.confidence
      const cx = lm.px * scaleX
      const cy = lm.py * scaleY

      ctx.globalAlpha = opacity
      ctx.beginPath()
      ctx.arc(cx, cy, CIRCLE_RADIUS, 0, Math.PI * 2)
      ctx.fillStyle = color + '55'
      ctx.fill()
      ctx.strokeStyle = color
      ctx.lineWidth = LINE_WIDTH
      ctx.stroke()
      ctx.globalAlpha = 1

      // Dot for human-corrected
      if (lm.source === 'human') {
        ctx.beginPath()
        ctx.arc(cx, cy, 3, 0, Math.PI * 2)
        ctx.fillStyle = '#ffffff'
        ctx.fill()
      }
    }
  }, [localLandmarks, scaleX, scaleY])

  useEffect(() => {
    draw()
  }, [draw])

  const getLandmarkAtPos = (x: number, y: number): AntlerLandmarkId | null => {
    for (const lm of localLandmarks) {
      if (lm.px == null || lm.py == null || lm.visibility === 'not_visible') continue
      const cx = lm.px * scaleX
      const cy = lm.py * scaleY
      if (Math.hypot(x - cx, y - cy) <= CIRCLE_RADIUS + 4) return lm.id
    }
    return null
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    if (dragging) {
      setLocalLandmarks((prev) =>
        prev.map((lm) =>
          lm.id === dragging
            ? { ...lm, px: Math.round(x / scaleX), py: Math.round(y / scaleY), source: 'human' }
            : lm,
        ),
      )
      return
    }

    const hit = getLandmarkAtPos(x, y)
    if (hit) {
      const lm = localLandmarks.find((l) => l.id === hit)
      if (lm) {
        const fieldKey = hit.replace(/_base_|_tip_/, '_').replace(/_left$/, '_left').replace(/_right$/, '_right')
        const measure = measurementByField.get(fieldKey)
        const inchText = measure?.valueInches != null ? ` — ${measure.valueInches.toFixed(1)}"` : ''
        setTooltip({
          id: hit,
          x,
          y,
          text: `${hit} (conf: ${(lm.confidence * 100).toFixed(0)}%)${inchText}`,
        })
      }
    } else {
      setTooltip(null)
    }
  }

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const hit = getLandmarkAtPos(x, y)
    if (hit) setDragging(hit)
  }

  const handleMouseUp = () => {
    if (dragging) {
      const lm = localLandmarks.find((l) => l.id === dragging)
      if (lm && lm.px != null && lm.py != null && onLandmarkCorrected) {
        onLandmarkCorrected(lm.id, lm.px, lm.py)
      }
    }
    setDragging(null)
  }

  return (
    <div style={{ position: 'relative', width: containerWidth, height: containerHeight }}>
      <canvas
        ref={canvasRef}
        width={containerWidth}
        height={containerHeight}
        style={{ position: 'absolute', inset: 0, cursor: dragging ? 'grabbing' : 'crosshair' }}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      />
      {tooltip && (
        <div
          style={{
            position: 'absolute',
            left: tooltip.x + 12,
            top: tooltip.y - 8,
            background: 'rgba(0,0,0,0.8)',
            color: '#fff',
            fontSize: 11,
            padding: '3px 8px',
            borderRadius: 4,
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            zIndex: 10,
          }}
        >
          {tooltip.text}
        </div>
      )}

      {/* Zone legend */}
      <div
        style={{
          position: 'absolute',
          bottom: 8,
          right: 8,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          background: 'rgba(0,0,0,0.65)',
          borderRadius: 6,
          padding: '4px 8px',
          fontSize: 10,
          color: '#fff',
        }}
      >
        {Object.entries(LANDMARK_ZONE_COLORS).map(([zone, color]) => (
          <div key={zone} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: color, flexShrink: 0 }} />
            {zone}
          </div>
        ))}
      </div>
    </div>
  )
}
