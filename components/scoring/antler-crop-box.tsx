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

type DragMode =
  | { kind: 'none' }
  | { kind: 'move'; startX: number; startY: number; origin: CropRegion }
  | { kind: 'resize'; handle: HandleId; origin: CropRegion; startX: number; startY: number }

type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

const DEFAULT_REGION: CropRegion = { x: 0.15, y: 0.15, width: 0.7, height: 0.7 }
const MIN_DIMENSION = 0.1

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function clampRegion(r: CropRegion): CropRegion {
  const width = clamp(r.width, MIN_DIMENSION, 1)
  const height = clamp(r.height, MIN_DIMENSION, 1)
  const x = clamp(r.x, 0, 1 - width)
  const y = clamp(r.y, 0, 1 - height)
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
  const [, forceRender] = useState(0)

  const activeRegion = region ?? DEFAULT_REGION

  useEffect(() => {
    if (!region && !skipped) {
      onChange(DEFAULT_REGION)
    }
  }, [region, skipped, onChange])

  const getRelativePoint = useCallback((clientX: number, clientY: number) => {
    const el = containerRef.current
    if (!el) return { x: 0, y: 0 }
    const rect = el.getBoundingClientRect()
    return {
      x: clamp((clientX - rect.left) / rect.width, 0, 1),
      y: clamp((clientY - rect.top) / rect.height, 0, 1),
    }
  }, [])

  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
      const mode = dragRef.current
      if (mode.kind === 'none') return
      const p = getRelativePoint(e.clientX, e.clientY)

      if (mode.kind === 'move') {
        const dx = p.x - mode.startX
        const dy = p.y - mode.startY
        onChange(
          clampRegion({
            x: mode.origin.x + dx,
            y: mode.origin.y + dy,
            width: mode.origin.width,
            height: mode.origin.height,
          }),
        )
        return
      }

      if (mode.kind === 'resize') {
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
        onChange(clampRegion({ x, y, width, height }))
      }
    },
    [getRelativePoint, onChange],
  )

  const endDrag = useCallback(() => {
    if (dragRef.current.kind !== 'none') {
      dragRef.current = { kind: 'none' }
      forceRender((n) => n + 1)
    }
    window.removeEventListener('pointermove', handlePointerMove)
    window.removeEventListener('pointerup', endDrag)
    window.removeEventListener('pointercancel', endDrag)
  }, [handlePointerMove])

  const startDrag = useCallback(
    (mode: DragMode) => {
      dragRef.current = mode
      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', endDrag)
      window.addEventListener('pointercancel', endDrag)
      forceRender((n) => n + 1)
    },
    [endDrag, handlePointerMove],
  )

  useEffect(() => () => endDrag(), [endDrag])

  const handleBodyPointerDown = (e: React.PointerEvent) => {
    if (skipped) return
    e.preventDefault()
    const p = getRelativePoint(e.clientX, e.clientY)
    startDrag({
      kind: 'move',
      startX: p.x,
      startY: p.y,
      origin: activeRegion,
    })
  }

  const handleHandlePointerDown = (handle: HandleId) => (e: React.PointerEvent) => {
    if (skipped) return
    e.preventDefault()
    e.stopPropagation()
    const p = getRelativePoint(e.clientX, e.clientY)
    startDrag({
      kind: 'resize',
      handle,
      origin: activeRegion,
      startX: p.x,
      startY: p.y,
    })
  }

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
              {widthPct}% × {heightPct}%
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
              className="absolute inset-0 pointer-events-none"
              style={{
                background: `linear-gradient(rgba(0,0,0,0.45),rgba(0,0,0,0.45))`,
                WebkitMaskImage: `linear-gradient(#000,#000), linear-gradient(#000,#000)`,
                WebkitMaskComposite: 'xor' as unknown as string,
              }}
            />
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
                cursor: 'move',
                touchAction: 'none',
              }}
              onPointerDown={handleBodyPointerDown}
            >
              {(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as HandleId[]).map((h) => (
                <Handle key={h} id={h} onPointerDown={handleHandlePointerDown(h)} />
              ))}
            </div>
          </>
        )}
      </div>

      <div className="flex items-center justify-between text-[11px] font-mono">
        <p className="text-muted-foreground">
          {skipped
            ? 'Skipped — original photo will be sent to scoring.'
            : 'Drag the box to cover the antlers. Resize with the corner handles.'}
        </p>
        {!skipped && (
          <button
            type="button"
            onClick={onSkip}
            className="uppercase tracking-wider text-muted-foreground hover:text-foreground"
          >
            Skip — use full photo
          </button>
        )}
      </div>
    </div>
  )
}

function Handle({
  id,
  onPointerDown,
}: {
  id: HandleId
  onPointerDown: (e: React.PointerEvent) => void
}) {
  const positions: Record<HandleId, React.CSSProperties> = {
    nw: { top: -6, left: -6, cursor: 'nwse-resize' },
    n: { top: -6, left: '50%', marginLeft: -6, cursor: 'ns-resize' },
    ne: { top: -6, right: -6, cursor: 'nesw-resize' },
    e: { top: '50%', right: -6, marginTop: -6, cursor: 'ew-resize' },
    se: { bottom: -6, right: -6, cursor: 'nwse-resize' },
    s: { bottom: -6, left: '50%', marginLeft: -6, cursor: 'ns-resize' },
    sw: { bottom: -6, left: -6, cursor: 'nesw-resize' },
    w: { top: '50%', left: -6, marginTop: -6, cursor: 'ew-resize' },
  }
  return (
    <div
      onPointerDown={onPointerDown}
      style={{
        position: 'absolute',
        width: 12,
        height: 12,
        background: 'var(--bronze-light)',
        border: '1px solid #0d0a06',
        borderRadius: 2,
        touchAction: 'none',
        ...positions[id],
      }}
    />
  )
}
