'use client'

import { useCallback, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

export interface PedicleCalibrationResult {
  /** Normalized coordinates 0..1 relative to the natural image */
  leftDot: { x: number; y: number }
  rightDot: { x: number; y: number }
  /** Pixel distance between dots at the image's natural resolution */
  pixelDistance: number
  /** User-entered known pedicle spacing in inches; null = anatomical prior */
  knownSpacingInches: number | null
  /** Computed pixelsPerInch */
  pixelsPerInch: number
  /** 0..1 confidence */
  confidence: number
  source: 'user_placed_anatomical' | 'user_placed_known'
}

interface CalibrationDotsProps {
  imageUrl: string
  imageNaturalWidth: number
  imageNaturalHeight: number
  onConfirm: (result: PedicleCalibrationResult) => void
  onSkip: () => void
  label?: string
}

const ANATOMICAL_PEDICLE_SPACING_INCHES = 4.5

function clamp01(v: number): number {
  if (v < 0.02) return 0.02
  if (v > 0.98) return 0.98
  return v
}

export function CalibrationDots({
  imageUrl,
  imageNaturalWidth,
  imageNaturalHeight,
  onConfirm,
  onSkip,
  label,
}: CalibrationDotsProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [leftDot, setLeftDot] = useState<{ x: number; y: number }>({ x: 0.35, y: 0.55 })
  const [rightDot, setRightDot] = useState<{ x: number; y: number }>({ x: 0.65, y: 0.55 })
  const [activeDot, setActiveDot] = useState<'left' | 'right' | null>(null)
  const [knownSpacing, setKnownSpacing] = useState<string>('')
  const [hintDismissed, setHintDismissed] = useState(false)

  const pointToNormalized = useCallback((clientX: number, clientY: number) => {
    const el = containerRef.current
    if (!el) return { x: 0, y: 0 }
    const r = el.getBoundingClientRect()
    return {
      x: clamp01((clientX - r.left) / r.width),
      y: clamp01((clientY - r.top) / r.height),
    }
  }, [])

  const handlePointerDown = useCallback(
    (which: 'left' | 'right') => (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      setHintDismissed(true)
      setActiveDot(which)
      const el = containerRef.current
      if (el) el.setPointerCapture(e.pointerId)
    },
    [],
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!activeDot) return
      const p = pointToNormalized(e.clientX, e.clientY)
      if (activeDot === 'left') setLeftDot(p)
      else setRightDot(p)
    },
    [activeDot, pointToNormalized],
  )

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const el = containerRef.current
      if (el && el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
      setActiveDot(null)
    },
    [],
  )

  // Live computed metrics
  const knownInches =
    knownSpacing.trim().length > 0 && Number.isFinite(Number(knownSpacing)) && Number(knownSpacing) > 0
      ? Number(knownSpacing)
      : null

  const dxNorm = rightDot.x - leftDot.x
  const dyNorm = rightDot.y - leftDot.y
  const naturalDx = dxNorm * imageNaturalWidth
  const naturalDy = dyNorm * imageNaturalHeight
  const pixelDist = Math.sqrt(naturalDx * naturalDx + naturalDy * naturalDy)
  const spacingFor = knownInches ?? ANATOMICAL_PEDICLE_SPACING_INCHES
  const ppi = spacingFor > 0 ? pixelDist / spacingFor : 0

  const confirm = () => {
    onConfirm({
      leftDot,
      rightDot,
      pixelDistance: pixelDist,
      knownSpacingInches: knownInches,
      pixelsPerInch: ppi,
      confidence: knownInches ? 0.85 : 0.68,
      source: knownInches ? 'user_placed_known' : 'user_placed_anatomical',
    })
  }

  // Midpoint for the distance badge
  const midX = (leftDot.x + rightDot.x) / 2
  const midY = (leftDot.y + rightDot.y) / 2

  return (
    <div className="space-y-3">
      {label && (
        <p className="text-[11px] font-mono tracking-widest uppercase text-muted-foreground">
          {label}
        </p>
      )}
      <div
        ref={containerRef}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className="relative w-full select-none touch-none overflow-hidden rounded"
        style={{
          aspectRatio: '4 / 3',
          background: '#0f0d0b',
          border: '1px solid var(--bronze-dark)',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt="Calibration target"
          draggable={false}
          className="absolute inset-0 h-full w-full object-contain pointer-events-none"
        />

        {/* Connecting dashed line */}
        <svg
          className="absolute inset-0 h-full w-full pointer-events-none"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          <line
            x1={leftDot.x * 100}
            y1={leftDot.y * 100}
            x2={rightDot.x * 100}
            y2={rightDot.y * 100}
            stroke="rgba(251,191,36,0.6)"
            strokeWidth="0.35"
            strokeDasharray="1.2 1"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        {/* Distance badge */}
        <div
          className="absolute pointer-events-none -translate-x-1/2 -translate-y-1/2 bg-black/80 px-2 py-1 rounded text-[10px] font-mono whitespace-nowrap"
          style={{
            left: `${midX * 100}%`,
            top: `${midY * 100}%`,
            color: 'rgba(251,191,36,0.95)',
          }}
        >
          {pixelDist.toFixed(0)} px
          {knownInches != null ? (
            <span className="ml-1 text-amber-300/80">→ {ppi.toFixed(1)} px/in</span>
          ) : (
            <span className="ml-1 text-amber-300/55">≈ {ppi.toFixed(1)} px/in</span>
          )}
        </div>

        {/* Dots */}
        {(['left', 'right'] as const).map((which) => {
          const dot = which === 'left' ? leftDot : rightDot
          return (
            <div
              key={which}
              onPointerDown={handlePointerDown(which)}
              className={cn(
                'absolute -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none flex items-center justify-center rounded-full',
                activeDot === which && 'cursor-grabbing scale-110',
              )}
              style={{
                left: `${dot.x * 100}%`,
                top: `${dot.y * 100}%`,
                width: 28,
                height: 28,
                background: 'rgba(251,191,36,0.9)',
                border: '2px solid rgba(255,255,255,0.85)',
                boxShadow:
                  '0 2px 6px rgba(0,0,0,0.55), 0 0 0 1px rgba(0,0,0,0.35)',
              }}
            >
              <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[9px] font-bold tracking-widest text-amber-200 bg-black/70 px-1 rounded whitespace-nowrap">
                {which === 'left' ? 'L PEDICLE' : 'R PEDICLE'}
              </span>
              {/* Crosshair */}
              <div className="absolute h-0.5 w-2 bg-white/85" />
              <div className="absolute h-2 w-0.5 bg-white/85" />
            </div>
          )
        })}

        {!hintDismissed && (
          <div className="absolute inset-x-3 bottom-3 bg-black/70 px-3 py-2 rounded pointer-events-none">
            <p className="text-[11px] font-bold text-amber-200 text-center">
              Drag each dot to the antler base (where it meets the skull)
            </p>
          </div>
        )}
      </div>

      {/* Optional known-spacing input */}
      <div className="space-y-1.5">
        <label className="text-[11px] font-mono tracking-widest uppercase text-muted-foreground">
          Known pedicle spacing (optional)
        </label>
        <input
          type="number"
          min="1"
          max="10"
          step="0.05"
          inputMode="decimal"
          placeholder='e.g. 4.5"'
          value={knownSpacing}
          onChange={(e) => setKnownSpacing(e.target.value)}
          className="w-full min-h-[40px] rounded px-3 text-sm bg-black/40 text-foreground"
          style={{ border: '1px solid var(--bronze-dark)' }}
        />
        <p className="text-[10px] text-muted-foreground">
          Measured center-to-center on the skull plate. Leave blank to use 4.5&quot; (average).
          Entering a known value upgrades confidence from 68% to 85%.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={confirm}
          className="flex-1 min-h-[40px] rounded text-xs font-black tracking-widest uppercase transition-all touch-manipulation"
          style={{
            background:
              'linear-gradient(180deg, var(--bronze-light) 0%, var(--bronze-mid) 55%, var(--bronze-dark) 100%)',
            color: '#161412',
            boxShadow:
              '0 1px 0 rgba(255,230,150,0.22) inset, 0 -1px 0 rgba(0,0,0,0.35) inset, 0 3px 14px rgba(0,0,0,0.55)',
          }}
        >
          Confirm calibration
        </button>
        <button
          type="button"
          onClick={onSkip}
          className="min-h-[40px] px-4 rounded text-xs font-bold tracking-widest uppercase text-muted-foreground hover:text-foreground transition-colors touch-manipulation"
          style={{ border: '1px solid var(--bronze-dark)', background: '#1a1714' }}
        >
          Skip
        </button>
      </div>
    </div>
  )
}
