'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export interface CropRegion {
  x: number
  y: number
  width: number
  height: number
}

interface AntlerCropBoxProps {
  imageUrl: string
  region: CropRegion | null
  skipped: boolean
  onChange: (region: CropRegion) => void
  onSkip: () => void
  onUnskip?: () => void
  label?: string
}

type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

type DragMode =
  | { kind: 'none' }
  | { kind: 'move'; startX: number; startY: number; origin: CropRegion }
  | { kind: 'resize'; handle: HandleId; origin: CropRegion; startX: number; startY: number }
  | { kind: 'pinch'; initialDist: number; origin: CropRegion; centerX: number; centerY: number }

const DEFAULT_REGION: CropRegion = { x: 0.15, y: 0.15, width: 0.7, height: 0.7 }
const MIN_DIMENSION = 0.1

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function clampRegion(r: CropRegion): CropRegion {
  const width = clamp(Number.isFinite(r.width) ? r.width : DEFAULT_REGION.width, MIN_DIMENSION, 1)
  const height = clamp(Number.isFinite(r.height) ? r.height : DEFAULT_REGION.height, MIN_DIMENSION, 1)
  const x = clamp(Number.isFinite(r.x) ? r.x : DEFAULT_REGION.x, 0, 1 - width)
  const y = clamp(Number.isFinite(r.y) ? r.y : DEFAULT_REGION.y, 0, 1 - height)

  return { x, y, width, height }
}

export function AntlerCropBox({
  imageUrl,
  region,
  skipped,
  onChange,
  onSkip,
  onUnskip,
  label,
}: AntlerCropBoxProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragMode>({ kind: 'none' })
  const latestRegionRef = useRef<CropRegion>(clampRegion(region ?? DEFAULT_REGION))
  const changeRafRef = useRef<number | null>(null)
  const activePointersRef = useRef<Map<number, { x: number; y: number }>>(new Map())

  const [draftRegion, setDraftRegion] = useState<CropRegion>(() => clampRegion(region ?? DEFAULT_REGION))
  const [isDragging, setIsDragging] = useState(false)

  const activeRegion = draftRegion

  const emitChange = useCallback(
    (nextRegion: CropRegion, immediate = false) => {
      const next = clampRegion(nextRegion)

      latestRegionRef.current = next
      setDraftRegion(next)

      if (immediate) {
        if (changeRafRef.current !== null) {
          window.cancelAnimationFrame(changeRafRef.current)
          changeRafRef.current = null
        }
        onChange(next)
        return
      }

      // Throttle parent state updates to animation frames. The local draft region
      // updates immediately, so dragging feels smooth while the parent stays stable.
      if (changeRafRef.current === null) {
        changeRafRef.current = window.requestAnimationFrame(() => {
          changeRafRef.current = null
          onChange(latestRegionRef.current)
        })
      }
    },
    [onChange],
  )

  useEffect(() => {
    if (!region && !skipped) {
      emitChange(DEFAULT_REGION, true)
    }
  }, [region, skipped, emitChange])

  useEffect(() => {
    if (region && dragRef.current.kind === 'none') {
      const next = clampRegion(region)
      latestRegionRef.current = next
      setDraftRegion(next)
    }
  }, [region])

  useEffect(() => {
    return () => {
      if (changeRafRef.current !== null) {
        window.cancelAnimationFrame(changeRafRef.current)
        changeRafRef.current = null
      }
    }
  }, [])

  const getRelativePoint = useCallback((clientX: number, clientY: number) => {
    const el = containerRef.current
    if (!el) return { x: 0, y: 0 }

    const rect = el.getBoundingClientRect()

    return {
      x: clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1),
      y: clamp((clientY - rect.top) / Math.max(1, rect.height), 0, 1),
    }
  }, [])

  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
      const mode = dragRef.current
      if (mode.kind === 'none') return

      if (activePointersRef.current.has(e.pointerId)) {
        activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      }

      e.preventDefault()

      if (mode.kind === 'pinch') {
        const pts = Array.from(activePointersRef.current.values()) as Array<{ x: number; y: number }>
        if (pts.length < 2) return
        const dx = pts[0].x - pts[1].x
        const dy = pts[0].y - pts[1].y
        const currentDist = Math.hypot(dx, dy)
        const scale = currentDist / Math.max(1, mode.initialDist)
        const newWidth = mode.origin.width * scale
        const newHeight = mode.origin.height * scale
        emitChange({
          x: mode.centerX - newWidth / 2,
          y: mode.centerY - newHeight / 2,
          width: newWidth,
          height: newHeight,
        })
        return
      }

      const p = getRelativePoint(e.clientX, e.clientY)

      if (mode.kind === 'move') {
        const dx = p.x - mode.startX
        const dy = p.y - mode.startY

        emitChange({
          x: mode.origin.x + dx,
          y: mode.origin.y + dy,
          width: mode.origin.width,
          height: mode.origin.height,
        })
        return
      }

      const o = mode.origin
      let { x, y, width, height } = o
      const right = o.x + o.width
      const bottom = o.y + o.height

      if (mode.handle.includes('n')) {
        y = clamp(p.y, 0, bottom - MIN_DIMENSION)
        height = bottom - y
      }

      if (mode.handle.includes('s')) {
        height = clamp(p.y - o.y, MIN_DIMENSION, 1 - o.y)
      }

      if (mode.handle.includes('w')) {
        x = clamp(p.x, 0, right - MIN_DIMENSION)
        width = right - x
      }

      if (mode.handle.includes('e')) {
        width = clamp(p.x - o.x, MIN_DIMENSION, 1 - o.x)
      }

      emitChange({ x, y, width, height })
    },
    [emitChange, getRelativePoint],
  )

  const releaseListeners = useCallback(() => {
    window.removeEventListener('pointermove', handlePointerMove)
    window.removeEventListener('pointerup', handlePointerUp)
    window.removeEventListener('pointercancel', handlePointerUp)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handlePointerMove])

  // eslint-disable-next-line @typescript-eslint/no-use-before-define
  function handlePointerUp(e: { pointerId: number }) {
    activePointersRef.current.delete(e.pointerId)
    if (activePointersRef.current.size > 0) return
    if (dragRef.current.kind !== 'none') {
      dragRef.current = { kind: 'none' }
      setIsDragging(false)
      emitChange(latestRegionRef.current, true)
    }
    releaseListeners()
  }

  const startDrag = useCallback(
    (mode: DragMode) => {
      dragRef.current = mode
      setIsDragging(true)

      window.addEventListener('pointermove', handlePointerMove, { passive: false })
      window.addEventListener('pointerup', handlePointerUp)
      window.addEventListener('pointercancel', handlePointerUp)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [handlePointerMove],
  )

  useEffect(() => {
    return () => {
      releaseListeners()
      activePointersRef.current.clear()
    }
  }, [releaseListeners])

  const handleBodyPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (skipped) return

    e.preventDefault()

    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // Pointer capture can fail in rare browser states. Window listeners still handle movement.
    }

    activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (activePointersRef.current.size >= 2) {
      const pts = Array.from(activePointersRef.current.values()) as Array<{ x: number; y: number }>
      const initialDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
      const origin = latestRegionRef.current
      startDrag({
        kind: 'pinch',
        initialDist: Math.max(1, initialDist),
        origin,
        centerX: origin.x + origin.width / 2,
        centerY: origin.y + origin.height / 2,
      })
      return
    }

    const p = getRelativePoint(e.clientX, e.clientY)

    startDrag({
      kind: 'move',
      startX: p.x,
      startY: p.y,
      origin: latestRegionRef.current,
    })
  }

  const handleHandlePointerDown = (handle: HandleId) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (skipped) return

    e.preventDefault()
    e.stopPropagation()

    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // Pointer capture can fail in rare browser states. Window listeners still handle movement.
    }

    activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    const p = getRelativePoint(e.clientX, e.clientY)

    startDrag({
      kind: 'resize',
      handle,
      origin: latestRegionRef.current,
      startX: p.x,
      startY: p.y,
    })
  }

  const resetRegion = useCallback(() => {
    emitChange(DEFAULT_REGION, true)
  }, [emitChange])

  // Edge slider helpers — each controls one edge directly (expand AND contract).
  const setTopEdge = (newTop: number) => {
    const r = latestRegionRef.current
    const bottom = r.y + r.height
    const y = clamp(newTop, 0, bottom - MIN_DIMENSION)
    emitChange({ x: r.x, y, width: r.width, height: bottom - y })
  }
  const setBottomEdge = (newBottom: number) => {
    const r = latestRegionRef.current
    const height = clamp(newBottom - r.y, MIN_DIMENSION, 1 - r.y)
    emitChange({ x: r.x, y: r.y, width: r.width, height })
  }
  const setLeftEdge = (newLeft: number) => {
    const r = latestRegionRef.current
    const right = r.x + r.width
    const x = clamp(newLeft, 0, right - MIN_DIMENSION)
    emitChange({ x, y: r.y, width: right - x, height: r.height })
  }
  const setRightEdge = (newRight: number) => {
    const r = latestRegionRef.current
    const width = clamp(newRight - r.x, MIN_DIMENSION, 1 - r.x)
    emitChange({ x: r.x, y: r.y, width, height: r.height })
  }

  const widthPct = Math.round(activeRegion.width * 100)
  const heightPct = Math.round(activeRegion.height * 100)
  const topPct = Math.round(activeRegion.y * 100)
  const bottomPct = Math.round((activeRegion.y + activeRegion.height) * 100)
  const leftPct = Math.round(activeRegion.x * 100)
  const rightPct = Math.round((activeRegion.x + activeRegion.width) * 100)

  return (
    <div className="space-y-2">
      {label && (
        <div className="flex items-center justify-between">
          <span
            className="text-[10px] font-black tracking-[0.18em] uppercase"
            style={{ color: 'var(--bronze-light)' }}
          >
            {label}
          </span>
          {skipped ? (
            <button
              type="button"
              onClick={onUnskip}
              className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground"
            >
              Use crop box
            </button>
          ) : (
            <span className="text-[10px] font-mono text-muted-foreground">
              {widthPct}% x {heightPct}%
            </span>
          )}
        </div>
      )}

      <div
        ref={containerRef}
        className="relative w-full overflow-hidden rounded select-none"
        style={{
          border: '1px solid var(--bronze-dark)',
          background: '#0d0a06',
          touchAction: 'none',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt="Crop preview"
          draggable={false}
          className="block w-full h-auto pointer-events-none"
          style={{ opacity: skipped ? 0.55 : 1 }}
        />

        {skipped && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span
              className="text-[10px] font-black tracking-[0.2em] uppercase px-2 py-1 rounded"
              style={{
                color: 'var(--bronze-light)',
                background: 'rgba(0,0,0,0.55)',
                border: '1px solid var(--bronze-dark)',
              }}
            >
              Using full photo
            </span>
          </div>
        )}

        {!skipped && (
          <>
            <div
              className="absolute"
              style={{
                left: `${activeRegion.x * 100}%`,
                top: `${activeRegion.y * 100}%`,
                width: `${activeRegion.width * 100}%`,
                height: `${activeRegion.height * 100}%`,
                boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)',
                outline: '2px dashed var(--bronze-light)',
                outlineOffset: -1,
                background: 'rgba(212,168,75,0.10)',
                cursor: isDragging ? 'grabbing' : 'grab',
                touchAction: 'none',
                willChange: 'left, top, width, height',
              }}
              onPointerDown={handleBodyPointerDown}
              role="slider"
              aria-label="Antler focus crop box. Drag to move. Pinch with two fingers to resize."
              aria-valuetext={`${widthPct} percent wide by ${heightPct} percent tall`}
            >
              <div
                className="pointer-events-none absolute inset-0 rounded-sm"
                style={{
                  boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.16)',
                }}
              />

              <div
                className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-[0.14em]"
                style={{
                  color: 'rgba(255,244,210,0.92)',
                  background: 'rgba(0,0,0,0.45)',
                  border: '1px solid rgba(212,168,75,0.45)',
                }}
              >
                Drag / Pinch
              </div>

              {(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as HandleId[]).map((h) => (
                <Handle key={h} id={h} onPointerDown={handleHandlePointerDown(h)} />
              ))}
            </div>
          </>
        )}
      </div>

      {!skipped && (
        <div className="rounded-md border border-border/60 bg-card/45 p-2">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">
                Fine-tune edges
              </p>
              <p className="text-[10px] text-muted-foreground">
                Slide each edge to expand or contract that side.
              </p>
            </div>

            <button
              type="button"
              onClick={resetRegion}
              className="rounded border border-border/70 px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground"
            >
              Reset
            </button>
          </div>

          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            <EdgeSlider
              label="Top"
              value={activeRegion.y}
              min={0}
              max={Math.max(0, activeRegion.y + activeRegion.height - MIN_DIMENSION)}
              percent={topPct}
              onChange={setTopEdge}
            />
            <EdgeSlider
              label="Bottom"
              value={activeRegion.y + activeRegion.height}
              min={Math.min(1, activeRegion.y + MIN_DIMENSION)}
              max={1}
              percent={bottomPct}
              onChange={setBottomEdge}
            />
            <EdgeSlider
              label="Left"
              value={activeRegion.x}
              min={0}
              max={Math.max(0, activeRegion.x + activeRegion.width - MIN_DIMENSION)}
              percent={leftPct}
              onChange={setLeftEdge}
            />
            <EdgeSlider
              label="Right"
              value={activeRegion.x + activeRegion.width}
              min={Math.min(1, activeRegion.x + MIN_DIMENSION)}
              max={1}
              percent={rightPct}
              onChange={setRightEdge}
            />
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 text-[11px] font-mono">
        <p className="text-muted-foreground">
          {skipped
            ? 'Skipped - original photo will be sent to scoring.'
            : 'Drag the amber box to move it. Pinch with two fingers to resize, or use the edge sliders.'}
        </p>
        {!skipped && (
          <button
            type="button"
            onClick={onSkip}
            className="shrink-0 uppercase tracking-wider text-muted-foreground hover:text-foreground"
          >
            Skip - use full photo
          </button>
        )}
      </div>
    </div>
  )
}

function EdgeSlider({
  label,
  value,
  min,
  max,
  percent,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  percent: number
  onChange: (v: number) => void
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
        <span>{label}</span>
        <span className="tabular-nums text-foreground/70">{percent}%</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={0.001}
        value={Math.min(Math.max(value, min), max)}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(parseFloat(e.target.value))}
        className="h-2 w-full cursor-pointer appearance-none rounded-full bg-black/40 accent-[var(--bronze-light)]"
        style={{ touchAction: 'none' }}
      />
    </label>
  )
}

function Handle({
  id,
  onPointerDown,
}: {
  id: HandleId
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void
}) {
  const positions: Record<HandleId, React.CSSProperties> = {
    nw: { top: -11, left: -11, cursor: 'nwse-resize' },
    n: { top: -11, left: '50%', marginLeft: -11, cursor: 'ns-resize' },
    ne: { top: -11, right: -11, cursor: 'nesw-resize' },
    e: { top: '50%', right: -11, marginTop: -11, cursor: 'ew-resize' },
    se: { bottom: -11, right: -11, cursor: 'nwse-resize' },
    s: { bottom: -11, left: '50%', marginLeft: -11, cursor: 'ns-resize' },
    sw: { bottom: -11, left: -11, cursor: 'nesw-resize' },
    w: { top: '50%', left: -11, marginTop: -11, cursor: 'ew-resize' },
  }

  return (
    <div
      onPointerDown={onPointerDown}
      className="absolute flex items-center justify-center"
      style={{
        width: 22,
        height: 22,
        touchAction: 'none',
        ...positions[id],
      }}
    >
      <div
        style={{
          width: 12,
          height: 12,
          background: 'var(--bronze-light)',
          border: '1px solid #0d0a06',
          borderRadius: 3,
          boxShadow: '0 0 0 3px rgba(0,0,0,0.28)',
        }}
      />
    </div>
  )
}
