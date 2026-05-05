'use client'

import { useRef, useEffect, useCallback, useState } from 'react'
import dynamic from 'next/dynamic'
import type Konva from 'konva'
import {
  useMeasureStore,
  FIELD_DEFS,
  type FieldId,
  type Point2D,
} from './measure-store'

// Konva components must be loaded client-side only (no SSR)
const Stage   = dynamic(() => import('react-konva').then(m => m.Stage),   { ssr: false })
const Layer   = dynamic(() => import('react-konva').then(m => m.Layer),   { ssr: false })
const KImage  = dynamic(() => import('react-konva').then(m => m.Image),   { ssr: false })
const Line    = dynamic(() => import('react-konva').then(m => m.Line),    { ssr: false })
const Circle  = dynamic(() => import('react-konva').then(m => m.Circle),  { ssr: false })
const Text    = dynamic(() => import('react-konva').then(m => m.Text),    { ssr: false })
const Rect    = dynamic(() => import('react-konva').then(m => m.Rect),    { ssr: false })

const SNAP_RADIUS = 12   // px — snap distance for guided / existing points
const MAX_SCALE = 12
const MIN_SCALE = 0.1

// ─── Filter helpers ───────────────────────────────────────────────────────────

function applyFilterToImage(
  imgEl: HTMLImageElement,
  filter: string,
): HTMLImageElement | HTMLCanvasElement {
  if (filter === 'none') return imgEl

  const canvas = document.createElement('canvas')
  canvas.width  = imgEl.naturalWidth
  canvas.height = imgEl.naturalHeight
  const ctx = canvas.getContext('2d')!

  if (filter === 'thermal') {
    ctx.drawImage(imgEl, 0, 0)
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const d = imageData.data
    for (let i = 0; i < d.length; i += 4) {
      const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
      const t = lum / 255
      // Cool (blue) → warm (red) thermal ramp
      d[i]     = Math.floor(255 * Math.min(1, t * 2))
      d[i + 1] = Math.floor(255 * Math.max(0, 1 - Math.abs(t - 0.5) * 2))
      d[i + 2] = Math.floor(255 * Math.max(0, 1 - t * 2))
      d[i + 3] = 255
    }
    ctx.putImageData(imageData, 0, 0)
    return canvas
  }

  let cssFilter = ''
  if (filter === 'brighten') cssFilter = 'brightness(1.5) contrast(1.1)'
  if (filter === 'contrast') cssFilter = 'contrast(1.8) brightness(0.9)'
  if (filter === 'sharpen')  cssFilter = 'contrast(1.4) saturate(0)'

  ctx.filter = cssFilter
  ctx.drawImage(imgEl, 0, 0)
  return canvas
}

// ─── Distance helper ──────────────────────────────────────────────────────────

function dist(a: Point2D, b: Point2D): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2)
}

/** Snap point to nearest existing point within SNAP_RADIUS, else return raw */
function snapPoint(
  raw: Point2D,
  existingPoints: Point2D[],
  scale: number,
): Point2D {
  const threshold = SNAP_RADIUS / scale
  let best: Point2D | null = null
  let bestDist = Infinity
  for (const p of existingPoints) {
    const d = dist(raw, p)
    if (d < threshold && d < bestDist) {
      bestDist = d
      best = p
    }
  }
  return best ?? raw
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PhotoCanvas() {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerSize, setContainerSize] = useState({ w: 800, h: 600 })
  const [htmlImage, setHtmlImage] = useState<HTMLImageElement | null>(null)
  const [filteredEl, setFilteredEl] = useState<HTMLImageElement | HTMLCanvasElement | null>(null)
  const [dblClickTimer, setDblClickTimer] = useState<ReturnType<typeof setTimeout> | null>(null)

  const {
    photoDataUrl, photoFilter,
    mode, activeField, calibration,
    stageScale, stagePos, setStageViewport,
    measurements2D,
    addPoint2D, undoPoint2D, movePoint2D, finalizeField2D,
    setCalibrationPoint, finalizeCalibration,
    setMode,
  } = useMeasureStore()

  // ── Observe container size ──────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const obs = new ResizeObserver(entries => {
      for (const e of entries) {
        setContainerSize({ w: e.contentRect.width, h: e.contentRect.height })
      }
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  // ── Load image ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!photoDataUrl) { setHtmlImage(null); setFilteredEl(null); return }
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => setHtmlImage(img)
    img.src = photoDataUrl
  }, [photoDataUrl])

  // ── Apply filter & fit stage when image + container ready ──────────────────
  useEffect(() => {
    if (!htmlImage) return
    setFilteredEl(applyFilterToImage(htmlImage, photoFilter))
  }, [htmlImage, photoFilter])

  // Auto-fit image when first loaded
  useEffect(() => {
    if (!htmlImage) return
    const scale = Math.min(
      containerSize.w  / htmlImage.naturalWidth,
      containerSize.h / htmlImage.naturalHeight,
      1,
    )
    const x = (containerSize.w  - htmlImage.naturalWidth  * scale) / 2
    const y = (containerSize.h - htmlImage.naturalHeight * scale) / 2
    setStageViewport(scale, { x, y })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [htmlImage, containerSize.w, containerSize.h])

  // ── Keyboard shortcuts ──────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Backspace' || e.key === 'Delete') {
        if (activeField) undoPoint2D(activeField)
      }
      if (e.key === 'Enter') {
        if (activeField) finalizeField2D(activeField)
      }
      if (e.key === 'Escape') {
        setMode('view')
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [activeField, undoPoint2D, finalizeField2D, setMode])

  // ── Wheel zoom ──────────────────────────────────────────────────────────────
  const handleWheel = useCallback((e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault()
    const stage = e.target.getStage()
    if (!stage) return

    const oldScale = stage.scaleX()
    const pointer = stage.getPointerPosition()
    if (!pointer) return

    const scaleBy = 1.08
    const newScale = e.evt.deltaY < 0
      ? Math.min(oldScale * scaleBy, MAX_SCALE)
      : Math.max(oldScale / scaleBy, MIN_SCALE)

    const mousePointTo = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale,
    }
    const newPos = {
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    }
    setStageViewport(newScale, newPos)
  }, [setStageViewport])

  // ── Click handler ───────────────────────────────────────────────────────────
  const handleStageClick = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    if (e.evt.button !== 0) return                    // left-click only
    const stage = e.target.getStage()
    if (!stage) return

    // Only add points when clicking on the background or image layer
    if (e.target !== stage && e.target.name() !== 'bg-image') return

    const pointer = stage.getPointerPosition()
    if (!pointer) return

    // Convert to image coordinates
    const raw: Point2D = {
      x: (pointer.x - stagePos.x) / stageScale,
      y: (pointer.y - stagePos.y) / stageScale,
    }

    if (mode === 'calibrate') {
      setCalibrationPoint(raw)
      return
    }

    if (mode === 'measure' && activeField) {
      // Collect all existing points for snapping
      const allExisting: Point2D[] = []
      for (const fd of FIELD_DEFS) {
        allExisting.push(...measurements2D[fd.id].points)
      }
      const snapped = snapPoint(raw, allExisting, stageScale)

      // Double-click detection: if we got a click very close in time, finalize
      if (dblClickTimer) {
        clearTimeout(dblClickTimer)
        setDblClickTimer(null)
        finalizeField2D(activeField)
        return
      }
      addPoint2D(activeField, snapped)
      const timer = setTimeout(() => setDblClickTimer(null), 300)
      setDblClickTimer(timer)
    }
  }, [
    mode, activeField, stageScale, stagePos, measurements2D,
    addPoint2D, finalizeField2D, setCalibrationPoint, dblClickTimer,
  ])

  // ── Drag end on a point circle ──────────────────────────────────────────────
  const handlePointDragEnd = useCallback((
    fieldId: FieldId,
    index: number,
    e: Konva.KonvaEventObject<DragEvent>,
  ) => {
    const node = e.target
    const raw: Point2D = { x: node.x(), y: node.y() }
    movePoint2D(fieldId, index, raw)
  }, [movePoint2D])

  // ── Helpers ─────────────────────────────────────────────────────────────────
  const fmt = (inches: number) => `${inches.toFixed(2)}"`

  const activeFieldDef = activeField ? FIELD_DEFS.find(f => f.id === activeField) : null

  // Cursor style
  const cursor = mode === 'calibrate' ? 'crosshair'
    : mode === 'measure' ? 'crosshair'
    : 'grab'

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden select-none"
      style={{ cursor, background: '#0a0907' }}
    >
      {/* Empty state */}
      {!photoDataUrl && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 pointer-events-none">
          <p className="text-muted-foreground text-sm">Upload a photo to begin</p>
        </div>
      )}

      {/* Konva stage */}
      {filteredEl && (
        // @ts-expect-error — dynamic import types
        <Stage
          width={containerSize.w}
          height={containerSize.h}
          scaleX={stageScale}
          scaleY={stageScale}
          x={stagePos.x}
          y={stagePos.y}
          onWheel={handleWheel}
          onClick={handleStageClick}
          draggable={mode === 'view'}
          onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) => {
            const s = e.target.getStage()
            if (s) setStageViewport(s.scaleX(), { x: s.x(), y: s.y() })
          }}
        >
          {/* @ts-expect-error dynamic import */}
          <Layer>
            {/* Background image */}
            {/* @ts-expect-error dynamic import */}
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
                {/* @ts-expect-error dynamic import */}
                <Line
                  points={[
                    calibration.linePoints[0].x, calibration.linePoints[0].y,
                    calibration.linePoints[1].x, calibration.linePoints[1].y,
                  ]}
                  stroke="#ffffff"
                  strokeWidth={1.5 / stageScale}
                  dash={[6 / stageScale, 4 / stageScale]}
                />
                {/* @ts-expect-error dynamic import */}
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
              /* @ts-expect-error dynamic import */
              <Circle
                x={calibration.linePoints[0].x}
                y={calibration.linePoints[0].y}
                radius={5 / stageScale}
                fill="#ffffff"
              />
            )}

            {/* Measurement polylines + points */}
            {FIELD_DEFS.map(fd => {
              const m = measurements2D[fd.id]
              if (m.points.length === 0) return null
              const isActive = fd.id === activeField
              const pts = m.points.flatMap(p => [p.x, p.y])

              // Segment-length labels
              const segLabels: Array<{ x: number; y: number; text: string }> = []
              if (m.finalized || isActive) {
                for (let i = 1; i < m.points.length; i++) {
                  const a = m.points[i - 1]
                  const b = m.points[i]
                  const pixLen = Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2)
                  const ppi = calibration.pixelsPerInch
                  if (ppi > 0) {
                    segLabels.push({
                      x: (a.x + b.x) / 2 + 4 / stageScale,
                      y: (a.y + b.y) / 2 - 12 / stageScale,
                      text: fmt(pixLen / ppi),
                    })
                  }
                }
              }

              return (
                <React.Fragment key={fd.id}>
                  {/* Polyline */}
                  {/* @ts-expect-error dynamic import */}
                  <Line
                    points={pts}
                    stroke={fd.color}
                    strokeWidth={(isActive ? 2.5 : 1.8) / stageScale}
                    tension={0}
                    opacity={m.finalized ? 0.85 : 1}
                  />

                  {/* Segment labels for finalized */}
                  {segLabels.map((sl, i) => (
                    /* @ts-expect-error dynamic import */
                    <Text
                      key={i}
                      x={sl.x}
                      y={sl.y}
                      text={sl.text}
                      fill={fd.color}
                      fontSize={10 / stageScale}
                      fontStyle="bold"
                    />
                  ))}

                  {/* Running total near last point */}
                  {isActive && m.points.length > 0 && m.inchLength > 0 && (
                    /* @ts-expect-error dynamic import */
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

                  {/* Segment warning: segment > 3 inches means add more points */}
                  {isActive && m.points.length >= 2 && calibration.pixelsPerInch > 0 && (() => {
                    const lastTwo = m.points.slice(-2)
                    const segPx = dist(lastTwo[0], lastTwo[1])
                    const segIn = segPx / calibration.pixelsPerInch
                    if (segIn > 3) {
                      const mx = (lastTwo[0].x + lastTwo[1].x) / 2
                      const my = (lastTwo[0].y + lastTwo[1].y) / 2
                      return (
                        /* @ts-expect-error dynamic import */
                        <Text
                          x={mx}
                          y={my + 6 / stageScale}
                          text="Add more points"
                          fill="#fbbf24"
                          fontSize={9 / stageScale}
                        />
                      )
                    }
                    return null
                  })()}

                  {/* Draggable point handles */}
                  {(isActive || m.finalized) && m.points.map((p, i) => (
                    /* @ts-expect-error dynamic import */
                    <Circle
                      key={i}
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
                        if (!m.finalized) {
                          useMeasureStore.getState().removePoint2D(fd.id, i)
                        }
                      }}
                    />
                  ))}
                </React.Fragment>
              )
            })}
          {/* @ts-expect-error dynamic import */}
          </Layer>
        {/* @ts-expect-error dynamic import */}
        </Stage>
      )}

      {/* Active field label overlay */}
      {activeFieldDef && (
        <div
          className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded text-xs font-bold tracking-wider pointer-events-none"
          style={{
            background: 'rgba(0,0,0,0.7)',
            border: `1px solid ${activeFieldDef.color}`,
            color: activeFieldDef.color,
          }}
        >
          Measuring: {activeFieldDef.label} — Double-click or Enter to finish
        </div>
      )}

      {/* Calibration mode overlay */}
      {mode === 'calibrate' && (
        <div
          className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded text-xs font-bold tracking-wider pointer-events-none"
          style={{ background: 'rgba(0,0,0,0.7)', border: '1px solid #ffffff', color: '#ffffff' }}
        >
          {calibration.linePoints.length === 0
            ? 'Click the start of the reference object'
            : calibration.linePoints.length === 1
            ? 'Click the end of the reference object'
            : 'Reference line set — adjust length and confirm below'}
        </div>
      )}
    </div>
  )
}

// Lazy import React for JSX Fragment inside dynamic components
import React from 'react'
