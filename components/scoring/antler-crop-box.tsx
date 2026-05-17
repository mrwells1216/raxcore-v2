'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from 'lucide-react'

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
type ExpandDirection = 'up' | 'down' | 'left' | 'right'

type DragMode =
  | { kind: 'none' }
  | { kind: 'move'; startX: number; startY: number; origin: CropRegion }
  | { kind: 'resize'; handle: HandleId; origin: CropRegion; startX: number; startY: number }

const DEFAULT_REGION: CropRegion = { x: 0.15, y: 0.15, width: 0.7, height: 0.7 }
const MIN_DIMENSION = 0.1
const EXPAND_STEP = 0.025

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

function expandRegionEdge(region: CropRegion, direction: ExpandDirection, step = EXPAND_STEP): CropRegion {
  const r = clampRegion(region)

  if (direction === 'up') {
    const newY = Math.max(0, r.y - step)
    const delta = r.y - newY
    return clampRegion({
      x: r.x,
      y: newY,
      width: r.width,
      height: r.height + delta,
    })
  }

  if (direction === 'down') {
    return clampRegion({
      x: r.x,
      y: r.y,
      width: r.width,
      height: Math.min(1 - r.y, r.height + step),
    })
  }

  if (direction === 'left') {
    const newX = Math.max(0, r.x - step)
    const delta = r.x - newX
    return clampRegion({
      x: newX,
      y: r.y,
      width: r.width + delta,
      height: r.height,
    })
  }

  return clampRegion({
    x: r.x,
    y: r.y,
    width: Math.min(1 - r.x, r.width + step),
    height: r.height,
  })
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
  const repeatDelayRef = useRef<number | null>(null)
  const repeatIntervalRef = useRef<number | null>(null)

  const [draftRegion, setDraftRegion] = useState<CropRegion>(() => clampRegion(region ?? DEFAULT_REGION))
  const [isDragging, setIsDragging] = useState(false)

  const activeRegion = draftRegion

  const clearRepeatTimers = useCallback(() => {
    if (repeatDelayRef.current !== null) {
      window.clearTimeout(repeatDelayRef.current)
      repeatDelayRef.current = null
    }

    if (repeatIntervalRef.current !== null) {
      window.clearInterval(repeatIntervalRef.current)
      repeatIntervalRef.current = null
    }
  }, [])

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
      clearRepeatTimers()
    }
  }, [clearRepeatTimers])

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

      e.preventDefault()

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

  const endDrag = useCallback(() => {
    if (dragRef.current.kind !== 'none') {
      dragRef.current = { kind: 'none' }
      setIsDragging(false)
      emitChange(latestRegionRef.current, true)
    }

    window.removeEventListener('pointermove', handlePointerMove)
    window.removeEventListener('pointerup', endDrag)
    window.removeEventListener('pointercancel', endDrag)
  }, [emitChange, handlePointerMove])

  const startDrag = useCallback(
    (mode: DragMode) => {
      dragRef.current = mode
      setIsDragging(true)

      window.addEventListener('pointermove', handlePointerMove, { passive: false })
      window.addEventListener('pointerup', endDrag)
      window.addEventListener('pointercancel', endDrag)
    },
    [endDrag, handlePointerMove],
  )

  useEffect(() => {
    return () => endDrag()
  }, [endDrag])

  const handleBodyPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (skipped) return

    e.preventDefault()

    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // Pointer capture can fail in rare browser states. Window listeners still handle movement.
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

    const p = getRelativePoint(e.clientX, e.clientY)

    startDrag({
      kind: 'resize',
      handle,
      origin: latestRegionRef.current,
      startX: p.x,
      startY: p.y,
    })
  }

  const expandOnce = useCallback(
    (direction: ExpandDirection) => {
      emitChange(expandRegionEdge(latestRegionRef.current, direction), true)
    },
    [emitChange],
  )

  const handleExpandPointerDown = (direction: ExpandDirection) => (e: React.PointerEvent<HTMLButtonElement>) => {
    if (skipped) return

    e.preventDefault()
    clearRepeatTimers()
    expandOnce(direction)

    repeatDelayRef.current = window.setTimeout(() => {
      repeatDelayRef.current = null
      repeatIntervalRef.current = window.setInterval(() => {
        expandOnce(direction)
      }, 90)
    }, 320)
  }

  const stopExpandRepeat = useCallback(() => {
    clearRepeatTimers()
  }, [clearRepeatTimers])

  const resetRegion = useCallback(() => {
    emitChange(DEFAULT_REGION, true)
  }, [emitChange])

  const widthPct = Math.round(activeRegion.width * 100)
  const heightPct = Math.round(activeRegion.height * 100)

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
              aria-label="Antler focus crop box. Drag to move."
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
                Drag
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
                Expand crop
              </p>
              <p className="text-[10px] text-muted-foreground">
                Arrows expand that edge only - they do not move the box.
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

          <div className="mx-auto grid w-[138px] grid-cols-3 gap-1">
            <span />
            <ExpandButton
              label="Expand up"
              onPointerDown={handleExpandPointerDown('up')}
              onPointerUp={stopExpandRepeat}
              onPointerCancel={stopExpandRepeat}
              onPointerLeave={stopExpandRepeat}
            >
              <ArrowUp className="h-4 w-4" aria-hidden />
            </ExpandButton>
            <span />

            <ExpandButton
              label="Expand left"
              onPointerDown={handleExpandPointerDown('left')}
              onPointerUp={stopExpandRepeat}
              onPointerCancel={stopExpandRepeat}
              onPointerLeave={stopExpandRepeat}
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
            </ExpandButton>
            <div
              className="flex h-11 items-center justify-center rounded border border-border/50 text-[9px] font-mono uppercase text-muted-foreground"
              aria-hidden
            >
              Box
            </div>
            <ExpandButton
              label="Expand right"
              onPointerDown={handleExpandPointerDown('right')}
              onPointerUp={stopExpandRepeat}
              onPointerCancel={stopExpandRepeat}
              onPointerLeave={stopExpandRepeat}
            >
              <ArrowRight className="h-4 w-4" aria-hidden />
            </ExpandButton>

            <span />
            <ExpandButton
              label="Expand down"
              onPointerDown={handleExpandPointerDown('down')}
              onPointerUp={stopExpandRepeat}
              onPointerCancel={stopExpandRepeat}
              onPointerLeave={stopExpandRepeat}
            >
              <ArrowDown className="h-4 w-4" aria-hidden />
            </ExpandButton>
            <span />
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 text-[11px] font-mono">
        <p className="text-muted-foreground">
          {skipped
            ? 'Skipped - original photo will be sent to scoring.'
            : 'Drag inside the amber box to move it. Use handles or arrows to expand the crop.'}
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

function ExpandButton({
  label,
  children,
  onPointerDown,
  onPointerUp,
  onPointerCancel,
  onPointerLeave,
}: {
  label: string
  children: React.ReactNode
  onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => void
  onPointerUp: (e: React.PointerEvent<HTMLButtonElement>) => void
  onPointerCancel: (e: React.PointerEvent<HTMLButtonElement>) => void
  onPointerLeave: (e: React.PointerEvent<HTMLButtonElement>) => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onPointerLeave={onPointerLeave}
      className="flex h-11 touch-manipulation select-none items-center justify-center rounded border border-[var(--bronze-dark)] bg-black/30 text-base font-black text-[var(--bronze-light)] transition active:scale-95 hover:bg-black/45"
      style={{ touchAction: 'none' }}
    >
      {children}
    </button>
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
