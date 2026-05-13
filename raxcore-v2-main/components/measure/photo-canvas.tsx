'use client'

import React, { useRef, useEffect, useCallback, useState } from 'react'
import {
  Stage,
  Layer,
  Image as KImage,
  Line,
  Circle,
  Text,
} from 'react-konva'
import type Konva from 'konva'
import {
  useMeasureStore,
  FIELD_DEFS,
  type FieldId,
  type Point2D,
} from './measure-store'
import { curveAccuracyWarning } from '@/lib/advanced-scoring/geometry'

const SNAP_RADIUS = 12
const MAX_SCALE   = 12
const MIN_SCALE   = 0.1
// Two clicks within this many ms triggers finalize (double-click equivalent)
const DBL_CLICK_MS = 280

// ─── Filter helpers ───────────────────────────────────────────────────────────

function applyFilter(
  imgEl: HTMLImageElement,
  filter: string,
): HTMLImageElement | HTMLCanvasElement {
  if (filter === 'none') return imgEl
  const canvas  = document.createElement('canvas')
  canvas.width  = imgEl.naturalWidth
  canvas.height = imgEl.naturalHeight
  const ctx     = canvas.getContext('2d')!

  if (filter === 'thermal') {
    ctx.drawImage(imgEl, 0, 0)
    const d  = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const px = d.data
    for (let i = 0; i < px.length; i += 4) {
      const t    = (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) / 255
      px[i]      = Math.floor(255 * Math.min(1, t * 2))
      px[i + 1]  = Math.floor(255 * Math.max(0, 1 - Math.abs(t - 0.5) * 2))
      px[i + 2]  = Math.floor(255 * Math.max(0, 1 - t * 2))
      px[i + 3]  = 255
    }
    ctx.putImageData(d, 0, 0)
    return canvas
  }

  let f = ''
  if (filter === 'brighten') f = 'brightness(1.5) contrast(1.1)'
  if (filter === 'contrast') f = 'contrast(1.8) brightness(0.9)'
  if (filter === 'sharpen')  f = 'contrast(1.4) saturate(0)'
  ctx.filter = f
  ctx.drawImage(imgEl, 0, 0)
  return canvas
}

function dist(a: Point2D, b: Point2D) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2)
}

function snapPoint(raw: Point2D, existing: Point2D[], scale: number): Point2D {
  const threshold = SNAP_RADIUS / scale
  let best: Point2D | null = null; let bestD = Infinity
  for (const p of existing) {
    const d = dist(raw, p)
    if (d < threshold && d < bestD) { bestD = d; best = p }
  }
  return best ?? raw
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PhotoCanvas() {
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 800, h: 600 })
  const [htmlImage, setHtmlImage] = useState<HTMLImageElement | null>(null)
  const [filteredEl, setFilteredEl] = useState<HTMLImageElement | HTMLCanvasElement | null>(null)
  const [hoverPulseOpacity, setHoverPulseOpacity] = useState(0.65)

  // Use a ref (not state) for the double-click timer to avoid stale-closure issues
  // and prevent unnecessary re-renders on each click.
  const dblTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const {
    photoDataUrl, photoFilter,
    mode, activeField, calibration,
    stageScale, stagePos, setStageViewport,
    measurements2D,
    addPoint2D, undoPoint2D, movePoint2D, finalizeField2D, removePoint2D,
    setCalibrationPoint,
    setMode, setMeasurementWarning2D,
    hoveredZoneId, showZones,
  } = useMeasureStore()

  // Container resize
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const obs = new ResizeObserver(entries => {
      for (const e of entries) setSize({ w: e.contentRect.width, h: e.contentRect.height })
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  // Load image
  useEffect(() => {
    if (!photoDataUrl) { setHtmlImage(null); setFilteredEl(null); return }
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => setHtmlImage(img)
    img.src = photoDataUrl
  }, [photoDataUrl])

  // Apply filter
  useEffect(() => {
    if (!htmlImage) return
    setFilteredEl(applyFilter(htmlImage, photoFilter))
  }, [htmlImage, photoFilter])

  // Auto-fit on load
  useEffect(() => {
    if (!htmlImage) return
    const scale = Math.min(size.w / htmlImage.naturalWidth, size.h / htmlImage.naturalHeight, 1)
    const x = (size.w - htmlImage.naturalWidth  * scale) / 2
    const y = (size.h - htmlImage.naturalHeight * scale) / 2
    setStageViewport(scale, { x, y })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [htmlImage, size.w, size.h])

  // Zone hover pulse animation
  useEffect(() => {
    if (!hoveredZoneId) return
    const id = setInterval(() => {
      setHoverPulseOpacity(prev => prev > 0.75 ? 0.45 : 0.85)
    }, 150)
    return () => clearInterval(id)
  }, [hoveredZoneId])

  // Curve accuracy warning: recompute whenever points change for active field
  useEffect(() => {
    if (!activeField) return
    const m = measurements2D[activeField]
    if (!m || m.points.length < 2) return
    if (!calibration.finalized) {
      setMeasurementWarning2D(activeField, null)
      return
    }
    const warn = curveAccuracyWarning(m.points, calibration.pixelsPerInch, 3)
    setMeasurementWarning2D(activeField, warn)
  }, [activeField, measurements2D, calibration.finalized, calibration.pixelsPerInch, setMeasurementWarning2D])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.key === 'Backspace' || e.key === 'Delete') && activeField) {
        undoPoint2D(activeField)
      }
      if (e.key === 'Enter' && activeField) {
        finalizeField2D(activeField)
        if (dblTimerRef.current) { clearTimeout(dblTimerRef.current); dblTimerRef.current = null }
      }
      if (e.key === 'Escape') setMode('view')
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [activeField, undoPoint2D, finalizeField2D, setMode])

  // Wheel zoom — does NOT interfere with point placement
  const handleWheel = useCallback((e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault()
    const stage = e.target.getStage()
    if (!stage) return
    const old = stage.scaleX()
    const ptr = stage.getPointerPosition()
    if (!ptr) return
    const by   = 1.08
    const next = e.evt.deltaY < 0 ? Math.min(old * by, MAX_SCALE) : Math.max(old / by, MIN_SCALE)
    const mpt  = { x: (ptr.x - stage.x()) / old, y: (ptr.y - stage.y()) / old }
    setStageViewport(next, { x: ptr.x - mpt.x * next, y: ptr.y - mpt.y * next })
  }, [setStageViewport])

  // Stage click — stable via refs to avoid stale captures
  const stageScaleRef = useRef(stageScale)
  const stagePosRef   = useRef(stagePos)
  stageScaleRef.current = stageScale
  stagePosRef.current   = stagePos

  const handleClick = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    if (e.evt.button !== 0) return
    const stage = e.target.getStage()
    if (!stage) return
    // Only fire on background clicks
    if (e.target !== stage && e.target.name() !== 'bg-image') return
    const ptr = stage.getPointerPosition()
    if (!ptr) return

    const sc = stageScaleRef.current
    const pos = stagePosRef.current
    const raw: Point2D = { x: (ptr.x - pos.x) / sc, y: (ptr.y - pos.y) / sc }

    if (useMeasureStore.getState().mode === 'calibrate') {
      setCalibrationPoint(raw)
      return
    }

    const currentField = useMeasureStore.getState().activeField
    if (useMeasureStore.getState().mode === 'measure' && currentField) {
      // Double-click detection via ref: no re-render on timer
      if (dblTimerRef.current) {
        clearTimeout(dblTimerRef.current)
        dblTimerRef.current = null
        // Double-click: finalize
        finalizeField2D(currentField)
        return
      }

      // Snap to existing points across all fields
      const all: Point2D[] = []
      const state = useMeasureStore.getState()
      for (const fd of FIELD_DEFS) all.push(...state.measurements2D[fd.id].points)
      const snapped = snapPoint(raw, all, sc)
      addPoint2D(currentField, snapped)

      dblTimerRef.current = setTimeout(() => {
        dblTimerRef.current = null
      }, DBL_CLICK_MS)
    }
  }, [addPoint2D, finalizeField2D, setCalibrationPoint])

  const handlePointDragEnd = useCallback((fieldId: FieldId, index: number, e: Konva.KonvaEventObject<DragEvent>) => {
    movePoint2D(fieldId, index, { x: e.target.x(), y: e.target.y() })
  }, [movePoint2D])

  // Drag end for stage pan
  const handleStageDragEnd = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    const s = e.target.getStage()
    if (s) setStageViewport(s.scaleX(), { x: s.x(), y: s.y() })
  }, [setStageViewport])

  const fmt    = (v: number) => `${v.toFixed(2)}"`
  const afd    = activeField ? FIELD_DEFS.find(f => f.id === activeField) : null

  // Pan is only allowed when not actively placing points
  const panEnabled = mode === 'view'
  const cursor     = mode !== 'view' ? 'crosshair' : 'grab'

  if (!filteredEl) {
    return (
      <div ref={containerRef} className="relative w-full h-full flex items-center justify-center" style={{ background: '#0a0907' }}>
        <p className="text-sm" style={{ color: 'rgba(200,169,110,0.4)' }}>Upload a photo to begin</p>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="relative w-full h-full overflow-hidden select-none" style={{ cursor, background: '#0a0907' }}>
      {/* Calibration warning banner */}
      {mode === 'measure' && !calibration.finalized && (
        <div
          className="absolute top-0 inset-x-0 z-20 px-3 py-1.5 text-xs font-medium text-center"
          style={{ background: 'rgba(251,191,36,0.15)', color: '#fbbf24', borderBottom: '1px solid rgba(251,191,36,0.3)' }}
        >
          No calibration set - inch values are withheld until a physical scale is set.
        </div>
      )}

      <Stage
        width={size.w}
        height={size.h}
        scaleX={stageScale}
        scaleY={stageScale}
        x={stagePos.x}
        y={stagePos.y}
        onWheel={handleWheel}
        onClick={handleClick}
        draggable={panEnabled}
        onDragEnd={handleStageDragEnd}
      >
        <Layer>
          <KImage
            name="bg-image"
            image={filteredEl}
            x={0}
            y={0}
            width={htmlImage?.naturalWidth ?? 0}
            height={htmlImage?.naturalHeight ?? 0}
          />

          {/* Calibration line */}
          {calibration.linePoints.length >= 2 && (
            <>
              <Line
                points={[
                  calibration.linePoints[0].x, calibration.linePoints[0].y,
                  calibration.linePoints[1].x, calibration.linePoints[1].y,
                ]}
                stroke="#ffffff"
                strokeWidth={1.5 / stageScale}
                dash={[6 / stageScale, 4 / stageScale]}
              />
              <Text
                x={(calibration.linePoints[0].x + calibration.linePoints[1].x) / 2 + 4 / stageScale}
                y={(calibration.linePoints[0].y + calibration.linePoints[1].y) / 2 - 16 / stageScale}
                text={`${calibration.realInches}"`}
                fill="#ffffff"
                fontSize={13 / stageScale}
                fontStyle="bold"
              />
            </>
          )}
          {calibration.linePoints.length === 1 && (
            <Circle x={calibration.linePoints[0].x} y={calibration.linePoints[0].y} radius={5 / stageScale} fill="#ffffff" />
          )}

          {/* Polylines */}
          {FIELD_DEFS.map(fd => {
            const m = measurements2D[fd.id]
            if (m.points.length === 0) return null
            const isActive = fd.id === activeField
            const pts = m.points.flatMap(p => [p.x, p.y])

            return (
              <React.Fragment key={fd.id}>
                <Line
                  points={pts}
                  stroke={fd.color}
                  strokeWidth={(isActive ? 2.5 : 1.8) / stageScale}
                  tension={0}
                  opacity={m.finalized ? 0.85 : 1}
                />

                {/* Segment labels when finalized */}
                {m.finalized && calibration.finalized && calibration.pixelsPerInch > 0 && m.points.map((p, i) => {
                  if (i === 0) return null
                  const a = m.points[i - 1]
                  const b = p
                  const len = dist(a, b) / calibration.pixelsPerInch
                  return (
                    <Text
                      key={`seg-${i}`}
                      x={(a.x + b.x) / 2 + 4 / stageScale}
                      y={(a.y + b.y) / 2 - 12 / stageScale}
                      text={fmt(len)}
                      fill={fd.color}
                      fontSize={10 / stageScale}
                      fontStyle="bold"
                    />
                  )
                })}

                {/* Running total */}
                {isActive && m.points.length > 0 && m.inchLength > 0 && (
                  <Text
                    x={m.points[m.points.length - 1].x + 8 / stageScale}
                    y={m.points[m.points.length - 1].y - 20 / stageScale}
                    text={fmt(m.inchLength)}
                    fill="#ffffff"
                    fontSize={13 / stageScale}
                    fontStyle="bold"
                    shadowColor="#000000"
                    shadowBlur={3}
                    shadowOpacity={0.8}
                  />
                )}

                {/* Segment-too-long / curve accuracy warning */}
                {isActive && m.warnings.length > 0 && m.points.length >= 2 && (() => {
                  const last = m.points.slice(-2)
                  const mx = (last[0].x + last[1].x) / 2
                  const my = (last[0].y + last[1].y) / 2
                  return (
                    <Text
                      key="warn"
                      x={mx}
                      y={my + 6 / stageScale}
                      text={m.warnings[0]}
                      fill="#fbbf24"
                      fontSize={9 / stageScale}
                    />
                  )
                })()}

                {/* Draggable handles */}
                {(isActive || m.finalized) && m.points.map((p, i) => (
                  <Circle
                    key={`pt-${i}`}
                    x={p.x}
                    y={p.y}
                    radius={(isActive ? 5 : 3.5) / stageScale}
                    fill={fd.color}
                    stroke="#ffffff"
                    strokeWidth={1 / stageScale}
                    draggable={!m.finalized && isActive}
                    onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) => handlePointDragEnd(fd.id, i, e)}
                    onContextMenu={(e: Konva.KonvaEventObject<MouseEvent>) => {
                      e.evt.preventDefault()
                      if (!m.finalized) removePoint2D(fd.id, i)
                    }}
                  />
                ))}
              </React.Fragment>
            )
          })}
        </Layer>

        {/* Zone hover pulse layer */}
        {(showZones || hoveredZoneId) && (
          <Layer listening={false}>
            {FIELD_DEFS.map(fd => {
              const m = measurements2D[fd.id]
              const isHovered = hoveredZoneId === fd.id
              if (!m || m.points.length < 2) return null
              if (!showZones && !isHovered) return null
              const pts = m.points.flatMap(p => [p.x, p.y])
              return (
                <Line
                  key={`zone-${fd.id}`}
                  points={pts}
                  stroke={fd.color}
                  strokeWidth={(isHovered ? 3 : 1.5) / stageScale}
                  opacity={isHovered ? hoverPulseOpacity : 0.4}
                  lineCap="round"
                  lineJoin="round"
                  listening={false}
                />
              )
            })}
          </Layer>
        )}
      </Stage>

      {/* Overlays */}
      {afd && (
        <div
          className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded text-xs font-bold tracking-wider pointer-events-none"
          style={{ background: 'rgba(0,0,0,0.7)', border: `1px solid ${afd.color}`, color: afd.color }}
        >
          Measuring: {afd.label} — Double-click or Enter to finish
        </div>
      )}
      {mode === 'calibrate' && (
        <div
          className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded text-xs font-bold tracking-wider pointer-events-none"
          style={{ background: 'rgba(0,0,0,0.7)', border: '1px solid #ffffff', color: '#ffffff' }}
        >
          {calibration.linePoints.length === 0 ? 'Click start of reference' :
           calibration.linePoints.length === 1 ? 'Click end of reference' :
           'Set reference length below and click Set Scale'}
        </div>
      )}

      {/* Zoom indicator */}
      <div
        className="absolute bottom-3 right-3 px-2 py-1 rounded text-xs font-mono pointer-events-none"
        style={{ background: 'rgba(0,0,0,0.5)', color: 'rgba(200,169,110,0.6)' }}
      >
        {Math.round(stageScale * 100)}%
      </div>
    </div>
  )
}
