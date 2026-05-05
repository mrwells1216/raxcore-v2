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

const SNAP_RADIUS = 12
const MAX_SCALE   = 12
const MIN_SCALE   = 0.1

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
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const px = d.data
    for (let i = 0; i < px.length; i += 4) {
      const t = (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) / 255
      px[i]     = Math.floor(255 * Math.min(1, t * 2))
      px[i + 1] = Math.floor(255 * Math.max(0, 1 - Math.abs(t - 0.5) * 2))
      px[i + 2] = Math.floor(255 * Math.max(0, 1 - t * 2))
      px[i + 3] = 255
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
  let best: Point2D | null = null, bestD = Infinity
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
  const [dblTimer, setDblTimer] = useState<ReturnType<typeof setTimeout> | null>(null)

  const {
    photoDataUrl, photoFilter,
    mode, activeField, calibration,
    stageScale, stagePos, setStageViewport,
    measurements2D,
    addPoint2D, undoPoint2D, movePoint2D, finalizeField2D,
    setCalibrationPoint, finalizeCalibration,
    setMode,
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

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Backspace' || e.key === 'Delete') { if (activeField) undoPoint2D(activeField) }
      if (e.key === 'Enter')  { if (activeField) finalizeField2D(activeField) }
      if (e.key === 'Escape') setMode('view')
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [activeField, undoPoint2D, finalizeField2D, setMode])

  // Wheel zoom
  const handleWheel = useCallback((e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault()
    const stage = e.target.getStage()
    if (!stage) return
    const old = stage.scaleX()
    const ptr = stage.getPointerPosition()
    if (!ptr) return
    const by = 1.08
    const next = e.evt.deltaY < 0 ? Math.min(old * by, MAX_SCALE) : Math.max(old / by, MIN_SCALE)
    const mpt  = { x: (ptr.x - stage.x()) / old, y: (ptr.y - stage.y()) / old }
    setStageViewport(next, { x: ptr.x - mpt.x * next, y: ptr.y - mpt.y * next })
  }, [setStageViewport])

  // Stage click
  const handleClick = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    if (e.evt.button !== 0) return
    const stage = e.target.getStage()
    if (!stage) return
    if (e.target !== stage && e.target.name() !== 'bg-image') return
    const ptr = stage.getPointerPosition()
    if (!ptr) return
    const raw: Point2D = { x: (ptr.x - stagePos.x) / stageScale, y: (ptr.y - stagePos.y) / stageScale }

    if (mode === 'calibrate') { setCalibrationPoint(raw); return }
    if (mode === 'measure' && activeField) {
      const all: Point2D[] = []
      for (const fd of FIELD_DEFS) all.push(...measurements2D[fd.id].points)
      const snapped = snapPoint(raw, all, stageScale)
      if (dblTimer) {
        clearTimeout(dblTimer); setDblTimer(null); finalizeField2D(activeField); return
      }
      addPoint2D(activeField, snapped)
      const t = setTimeout(() => setDblTimer(null), 300)
      setDblTimer(t)
    }
  }, [mode, activeField, stageScale, stagePos, measurements2D, addPoint2D, finalizeField2D, setCalibrationPoint, dblTimer])

  const handlePointDragEnd = useCallback((fieldId: FieldId, index: number, e: Konva.KonvaEventObject<DragEvent>) => {
    movePoint2D(fieldId, index, { x: e.target.x(), y: e.target.y() })
  }, [movePoint2D])

  const fmt   = (v: number) => `${v.toFixed(2)}"`
  const afd   = activeField ? FIELD_DEFS.find(f => f.id === activeField) : null
  const cursor = mode !== 'view' ? 'crosshair' : 'grab'

  if (!filteredEl) {
    return (
      <div ref={containerRef} className="relative w-full h-full flex items-center justify-center" style={{ background: '#0a0907' }}>
        <p className="text-sm" style={{ color: 'rgba(200,169,110,0.4)' }}>Upload a photo to begin</p>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="relative w-full h-full overflow-hidden select-none" style={{ cursor, background: '#0a0907' }}>
      <Stage
        width={size.w}
        height={size.h}
        scaleX={stageScale}
        scaleY={stageScale}
        x={stagePos.x}
        y={stagePos.y}
        onWheel={handleWheel}
        onClick={handleClick}
        draggable={mode === 'view'}
        onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) => {
          const s = e.target.getStage()
          if (s) setStageViewport(s.scaleX(), { x: s.x(), y: s.y() })
        }}
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
                {m.finalized && calibration.pixelsPerInch > 0 && m.points.map((p, i) => {
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

                {/* Segment-too-long warning */}
                {isActive && m.points.length >= 2 && calibration.pixelsPerInch > 0 && (() => {
                  const last = m.points.slice(-2)
                  const segIn = dist(last[0], last[1]) / calibration.pixelsPerInch
                  if (segIn > 3) {
                    const mx = (last[0].x + last[1].x) / 2
                    const my = (last[0].y + last[1].y) / 2
                    return (
                      <Text
                        key="warn"
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
                      if (!m.finalized) useMeasureStore.getState().removePoint2D(fd.id, i)
                    }}
                  />
                ))}
              </React.Fragment>
            )
          })}
        </Layer>
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
    </div>
  )
}
