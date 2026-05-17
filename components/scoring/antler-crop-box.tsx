'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

export interface CropRegion {
  /** Normalized 0..1 relative to displayed image dimensions */
  x: number
  y: number
  width: number
  height: number
}

interface AntlerCropBoxProps {
  imageUrl: string
  onCrop: (region: CropRegion) => void
  onClear: () => void
  initialRegion?: CropRegion | null
  /** Optional label for the photo (e.g. "Front") */
  label?: string
}

type Mode =
  | { kind: 'idle' }
  | { kind: 'drawing'; startX: number; startY: number }
  | { kind: 'moving'; offsetX: number; offsetY: number }
  | { kind: 'resizing'; handle: ResizeHandle }

type ResizeHandle =
  | 'nw' | 'n' | 'ne'
  | 'w'        | 'e'
  | 'sw' | 's' | 'se'

const MIN_SIZE = 0.10

function clamp01(v: number): number {
  if (v < 0) return 0
  if (v > 1) return 1
  return v
}

function normalizeRegion(r: CropRegion): CropRegion {
  let x = clamp01(r.x)
  let y = clamp01(r.y)
  let w = clamp01(r.width)
  let h = clamp01(r.height)
  if (w < MIN_SIZE) w = MIN_SIZE
  if (h < MIN_SIZE) h = MIN_SIZE
  if (x + w > 1) x = 1 - w
  if (y + h > 1) y = 1 - h
  return { x, y, width: w, height: h }
}

export function AntlerCropBox({
  imageUrl,
  onCrop,
  onClear,
  initialRegion = null,
  label,
}: AntlerCropBoxProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [region, setRegion] = useState<CropRegion | null>(initialRegion)
  const [mode, setMode] = useState<Mode>({ kind: 'idle' })
  const [committed, setCommitted] = useState<boolean>(Boolean(initialRegion))

  // Compute normalized pointer coordinates relative to the container
  const pointToNormalized = useCallback((clientX: number, clientY: number) => {
    const el = containerRef.current
    if (!el) return { x: 0, y: 0 }
    const rect = el.getBoundingClientRect()
    return {
      x: clamp01((clientX - rect.left) / rect.width),
      y: clamp01((clientY - rect.top) / rect.height),
    }
  }, [])

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return
      const target = e.target as HTMLElement
      const handle = target.dataset.handle as ResizeHandle | undefined
      const isBoxBody = target.dataset.role === 'box-body'
      const el = containerRef.current
      if (!el) return
      el.setPointerCapture(e.pointerId)

      const p = pointToNormalized(e.clientX, e.clientY)

      if (handle && region) {
        setMode({ kind: 'resizing', handle })
        setCommitted(false)
        return
      }
      if (isBoxBody && region) {
        setMode({
          kind: 'moving',
          offsetX: p.x - region.x,
          offsetY: p.y - region.y,
        })
        setCommitted(false)
        return
      }
      // Draw a new box from this point
      setRegion({ x: p.x, y: p.y, width: 0, height: 0 })
      setMode({ kind: 'drawing', startX: p.x, startY: p.y })
      setCommitted(false)
    },
    [pointToNormalized, region],
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (mode.kind === 'idle') return
      const p = pointToNormalized(e.clientX, e.clientY)

      if (mode.kind === 'drawing') {
        const x = Math.min(mode.startX, p.x)
        const y = Math.min(mode.startY, p.y)
        const width = Math.abs(p.x - mode.startX)
        const height = Math.abs(p.y - mode.startY)
        setRegion({ x, y, width, height })
        return
      }

      if (mode.kind === 'moving' && region) {
        const x = clamp01(p.x - mode.offsetX)
        const y = clamp01(p.y - mode.offsetY)
        setRegion({
          x: Math.min(x, 1 - region.width),
          y: Math.min(y, 1 - region.height),
          width: region.width,
          height: region.height,
        })
        return
      }

      if (mode.kind === 'resizing' && region) {
        const next = { ...region }
        const right = region.x + region.width
        const bottom = region.y + region.height
        if (mode.handle.includes('w')) {
          const newX = Math.min(p.x, right - MIN_SIZE)
          next.x = clamp01(newX)
          next.width = right - next.x
        }
        if (mode.handle.includes('e')) {
          const newRight = Math.max(p.x, region.x + MIN_SIZE)
          next.width = clamp01(newRight) - next.x
        }
        if (mode.handle.includes('n')) {
          const newY = Math.min(p.y, bottom - MIN_SIZE)
          next.y = clamp01(newY)
          next.height = bottom - next.y
        }
        if (mode.handle.includes('s')) {
          const newBottom = Math.max(p.y, region.y + MIN_SIZE)
          next.height = clamp01(newBottom) - next.y
        }
        setRegion(next)
      }
    },
    [mode, pointToNormalized, region],
  )

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const el = containerRef.current
      if (el && el.hasPointerCapture(e.pointerId)) {
        el.releasePointerCapture(e.pointerId)
      }
      if (mode.kind === 'drawing' && region) {
        if (region.width < MIN_SIZE || region.height < MIN_SIZE) {
          setRegion(null)
        } else {
          setRegion(normalizeRegion(region))
        }
      } else if ((mode.kind === 'moving' || mode.kind === 'resizing') && region) {
        setRegion(normalizeRegion(region))
      }
      setMode({ kind: 'idle' })
    },
    [mode, region],
  )

  useEffect(() => {
    if (!initialRegion) return
    setRegion(initialRegion)
    setCommitted(true)
  }, [initialRegion])

  const commit = () => {
    if (!region) return
    const final = normalizeRegion(region)
    setRegion(final)
    setCommitted(true)
    onCrop(final)
  }

  const clear = () => {
    setRegion(null)
    setCommitted(false)
    onClear()
  }

  const pctW = region ? Math.round(region.width * 100) : 0
  const pctH = region ? Math.round(region.height * 100) : 0

  return (
    <div className="space-y-3">
      {label && (
        <p className="text-[11px] font-mono tracking-widest uppercase text-muted-foreground">
          {label}
        </p>
      )}
      <div
        ref={containerRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className={cn(
          'relative w-full select-none touch-none overflow-hidden rounded',
          !region && 'cursor-crosshair',
        )}
        style={{
          aspectRatio: '4 / 3',
          background: '#0f0d0b',
          border: '1px solid var(--bronze-dark)',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt="Photo to crop"
          draggable={false}
          className="absolute inset-0 h-full w-full object-contain pointer-events-none"
        />

        {!region && (
          <div className="absolute inset-3 rounded border-2 border-dashed border-amber-400/60 pointer-events-none animate-pulse flex items-center justify-center">
            <div className="bg-black/60 px-3 py-2 rounded text-center">
              <p className="text-[12px] font-bold text-amber-200">
                Draw a box around the antlers
              </p>
              <p className="text-[10px] font-mono text-amber-100/70 mt-1">
                Drag from one burr base to the opposite beam tip
              </p>
            </div>
          </div>
        )}

        {region && (
          <>
            {/* Dim overlay outside the crop */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background: `linear-gradient(0deg, rgba(0,0,0,0.45), rgba(0,0,0,0.45))`,
                WebkitMaskImage: `linear-gradient(#000, #000), linear-gradient(#000, #000)`,
                WebkitMaskComposite: 'destination-out',
                maskImage: `linear-gradient(#000, #000)`,
                clipPath: `polygon(
                  0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%,
                  ${region.x * 100}% ${region.y * 100}%,
                  ${region.x * 100}% ${(region.y + region.height) * 100}%,
                  ${(region.x + region.width) * 100}% ${(region.y + region.height) * 100}%,
                  ${(region.x + region.width) * 100}% ${region.y * 100}%,
                  ${region.x * 100}% ${region.y * 100}%
                )`,
              }}
            />
            {/* The box */}
            <div
              data-role="box-body"
              className="absolute cursor-move border-2 border-dashed border-amber-400"
              style={{
                left: `${region.x * 100}%`,
                top: `${region.y * 100}%`,
                width: `${region.width * 100}%`,
                height: `${region.height * 100}%`,
                background: 'rgba(245, 175, 60, 0.10)',
                boxShadow: '0 0 0 1px rgba(0,0,0,0.5)',
              }}
            >
              <div className="absolute -top-6 left-0 bg-black/80 px-2 py-0.5 rounded text-[10px] font-mono text-amber-200 whitespace-nowrap pointer-events-none">
                {pctW}% × {pctH}% of photo
              </div>
              {(['nw','n','ne','w','e','sw','s','se'] as ResizeHandle[]).map((h) => (
                <span
                  key={h}
                  data-handle={h}
                  className="absolute h-3 w-3 -m-1.5 bg-amber-300 border border-black/60 rounded-sm"
                  style={handlePosition(h)}
                />
              ))}
            </div>
          </>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={commit}
          disabled={!region || (region.width < MIN_SIZE || region.height < MIN_SIZE)}
          className="flex-1 min-h-[40px] rounded text-xs font-black tracking-widest uppercase transition-all touch-manipulation"
          style={
            region && region.width >= MIN_SIZE && region.height >= MIN_SIZE
              ? {
                  background: committed
                    ? 'linear-gradient(180deg, #2d2719, #1f1a12)'
                    : 'linear-gradient(180deg, var(--bronze-light), var(--bronze-mid), var(--bronze-dark))',
                  color: committed ? 'var(--bronze-light)' : '#161412',
                  boxShadow: committed
                    ? 'inset 0 2px 4px rgba(0,0,0,0.45)'
                    : '0 1px 0 rgba(255,230,150,0.22) inset, 0 -1px 0 rgba(0,0,0,0.35) inset, 0 3px 14px rgba(0,0,0,0.55)',
                  border: committed ? '1px solid var(--bronze-dark)' : 'none',
                }
              : {
                  background: '#252118',
                  color: 'var(--muted-foreground)',
                  cursor: 'not-allowed',
                  boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.40)',
                }
          }
        >
          {committed ? 'Region saved · tap to update' : 'Score this region'}
        </button>
        <button
          type="button"
          onClick={clear}
          className="min-h-[40px] px-4 rounded text-xs font-bold tracking-widest uppercase text-muted-foreground hover:text-foreground transition-colors touch-manipulation"
          style={{ border: '1px solid var(--bronze-dark)', background: '#1a1714' }}
        >
          {region ? 'Clear' : 'Use full photo'}
        </button>
      </div>
    </div>
  )
}

function handlePosition(h: ResizeHandle): React.CSSProperties {
  switch (h) {
    case 'nw': return { left: 0, top: 0, cursor: 'nwse-resize' }
    case 'n':  return { left: '50%', top: 0, cursor: 'ns-resize' }
    case 'ne': return { right: 0, top: 0, cursor: 'nesw-resize' }
    case 'w':  return { left: 0, top: '50%', cursor: 'ew-resize' }
    case 'e':  return { right: 0, top: '50%', cursor: 'ew-resize' }
    case 'sw': return { left: 0, bottom: 0, cursor: 'nesw-resize' }
    case 's':  return { left: '50%', bottom: 0, cursor: 'ns-resize' }
    case 'se': return { right: 0, bottom: 0, cursor: 'nwse-resize' }
  }
}
