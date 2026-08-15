'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * A single blackout stroke. Coordinates are normalized 0–1 relative to the
 * full image (x across width, y across height) so they replay identically at
 * any resolution. `size` is the brush diameter as a fraction of image width.
 */
export interface RedactionStroke {
  size: number
  points: Array<{ x: number; y: number }>
}

export const PEN_SIZES = [
  { id: 'small', label: 'S', frac: 0.03 },
  { id: 'medium', label: 'M', frac: 0.065 },
  { id: 'large', label: 'L', frac: 0.13 },
] as const

type PenSizeId = (typeof PEN_SIZES)[number]['id']

/** Coverage fraction above which we warn the user they may be hiding the rack. */
const COVERAGE_WARN_THRESHOLD = 0.5

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0))
}

function strokePath(
  ctx: CanvasRenderingContext2D,
  stroke: RedactionStroke,
  width: number,
  height: number,
): void {
  if (stroke.points.length === 0) return
  const lineWidth = Math.max(2, stroke.size * width)
  ctx.lineWidth = lineWidth
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = '#000000'
  ctx.fillStyle = '#000000'

  if (stroke.points.length === 1) {
    const p = stroke.points[0]
    ctx.beginPath()
    ctx.arc(p.x * width, p.y * height, lineWidth / 2, 0, Math.PI * 2)
    ctx.fill()
    return
  }

  ctx.beginPath()
  ctx.moveTo(stroke.points[0].x * width, stroke.points[0].y * height)
  for (let i = 1; i < stroke.points.length; i += 1) {
    ctx.lineTo(stroke.points[i].x * width, stroke.points[i].y * height)
  }
  ctx.stroke()
}

/**
 * Estimate the fraction of the image covered by the strokes by rasterizing
 * them onto a small offscreen canvas and counting opaque pixels.
 */
export function estimateRedactionCoverage(strokes: RedactionStroke[]): number {
  if (strokes.length === 0) return 0
  if (typeof document === 'undefined') return 0
  const W = 96
  const H = 96
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return 0
  for (const stroke of strokes) strokePath(ctx, stroke, W, H)
  const data = ctx.getImageData(0, 0, W, H).data
  let covered = 0
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 0) covered += 1
  }
  return covered / (W * H)
}

/**
 * Burn blackout strokes into an image data URL at full resolution. Returns
 * the original data URL untouched when there are no strokes. The output is
 * what every downstream consumer (detection, scoring, landmarks, display)
 * sees — redacted pixels are gone before upload.
 */
export function bakeRedactionsIntoDataUrl(
  dataUrl: string,
  strokes: RedactionStroke[],
): Promise<string> {
  if (!strokes || strokes.length === 0) return Promise.resolve(dataUrl)
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth
        canvas.height = img.naturalHeight
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          resolve(dataUrl)
          return
        }
        ctx.drawImage(img, 0, 0)
        for (const stroke of strokes) {
          strokePath(ctx, stroke, canvas.width, canvas.height)
        }
        resolve(canvas.toDataURL('image/jpeg', 0.85))
      } catch (err) {
        reject(err)
      }
    }
    img.onerror = () => reject(new Error('redaction bake: image failed to load'))
    img.src = dataUrl
  })
}

interface RedactionPenProps {
  imageUrl: string
  strokes: RedactionStroke[]
  onChange: (strokes: RedactionStroke[]) => void
  label?: string
}

/**
 * Blackout pen overlay: draw black strokes over parts of the photo (other
 * deer, background racks, people) so the AI never sees them. Strokes are
 * stored normalized and burned into the image pixels at submit time.
 */
export function RedactionPen({ imageUrl, strokes, onChange, label }: RedactionPenProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawingRef = useRef<RedactionStroke | null>(null)
  const rafRef = useRef<number | null>(null)

  const [penSize, setPenSize] = useState<PenSizeId>('medium')
  const [isDrawing, setIsDrawing] = useState(false)
  const [coverage, setCoverage] = useState(0)

  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    const rect = container.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    const dpr = window.devicePixelRatio || 1
    const w = Math.round(rect.width * dpr)
    const h = Math.round(rect.height * dpr)
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, w, h)
    for (const stroke of strokes) strokePath(ctx, stroke, w, h)
    if (drawingRef.current) strokePath(ctx, drawingRef.current, w, h)
  }, [strokes])

  useEffect(() => {
    redraw()
    setCoverage(estimateRedactionCoverage(strokes))
  }, [strokes, redraw])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver(() => redraw())
    observer.observe(container)
    return () => observer.disconnect()
  }, [redraw])

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current)
    }
  }, [])

  const toNormalized = useCallback((clientX: number, clientY: number) => {
    const el = containerRef.current
    if (!el) return { x: 0, y: 0 }
    const rect = el.getBoundingClientRect()
    return {
      x: clamp01((clientX - rect.left) / rect.width),
      y: clamp01((clientY - rect.top) / rect.height),
    }
  }, [])

  const scheduleRedraw = useCallback(() => {
    if (rafRef.current !== null) return
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null
      redraw()
    })
  }, [redraw])

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      e.preventDefault()
      const sizeFrac = PEN_SIZES.find(s => s.id === penSize)?.frac ?? 0.065
      drawingRef.current = { size: sizeFrac, points: [toNormalized(e.clientX, e.clientY)] }
      setIsDrawing(true)
      e.currentTarget.setPointerCapture(e.pointerId)
      scheduleRedraw()
    },
    [penSize, toNormalized, scheduleRedraw],
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const stroke = drawingRef.current
      if (!stroke) return
      e.preventDefault()
      stroke.points.push(toNormalized(e.clientX, e.clientY))
      scheduleRedraw()
    },
    [toNormalized, scheduleRedraw],
  )

  const handlePointerUp = useCallback(() => {
    const stroke = drawingRef.current
    drawingRef.current = null
    setIsDrawing(false)
    if (stroke && stroke.points.length > 0) {
      onChange([...strokes, stroke])
    }
  }, [strokes, onChange])

  const handleUndo = useCallback(() => {
    if (strokes.length > 0) onChange(strokes.slice(0, -1))
  }, [strokes, onChange])

  const handleClear = useCallback(() => {
    if (strokes.length > 0) onChange([])
  }, [strokes, onChange])

  return (
    <div className="space-y-2">
      {label && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            {label}
          </span>
          {strokes.length > 0 && (
            <span className="text-[10px] font-mono tabular-nums text-muted-foreground">
              {strokes.length} stroke{strokes.length === 1 ? '' : 's'} · ~{Math.round(coverage * 100)}% covered
            </span>
          )}
        </div>
      )}

      <div
        ref={containerRef}
        className="relative w-full overflow-hidden rounded select-none"
        style={{ border: '1px solid var(--bronze-dark)' }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt={label ?? 'Photo to redact'}
          className="block w-full h-auto"
          draggable={false}
        />
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full"
          style={{ touchAction: 'none', cursor: isDrawing ? 'crosshair' : 'crosshair' }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        />
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Pen</span>
          {PEN_SIZES.map(size => (
            <button
              key={size.id}
              type="button"
              onClick={() => setPenSize(size.id)}
              aria-pressed={penSize === size.id}
              className="grid place-items-center rounded-full border transition-colors"
              style={{
                width: 30,
                height: 30,
                borderColor: penSize === size.id ? 'var(--bronze-light)' : 'var(--bronze-dark)',
                background: penSize === size.id ? 'rgba(0,0,0,0.5)' : 'transparent',
              }}
            >
              <span
                aria-hidden
                className="rounded-full bg-foreground/80"
                style={{
                  width: 6 + PEN_SIZES.findIndex(s => s.id === size.id) * 5,
                  height: 6 + PEN_SIZES.findIndex(s => s.id === size.id) * 5,
                }}
              />
              <span className="sr-only">{size.label} pen</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 text-[10px] font-mono uppercase tracking-wider">
          <button
            type="button"
            onClick={handleUndo}
            disabled={strokes.length === 0}
            className="text-muted-foreground hover:text-foreground disabled:opacity-40"
          >
            Undo
          </button>
          <button
            type="button"
            onClick={handleClear}
            disabled={strokes.length === 0}
            className="text-muted-foreground hover:text-foreground disabled:opacity-40"
          >
            Clear
          </button>
        </div>
      </div>

      {coverage > COVERAGE_WARN_THRESHOLD && (
        <p className="text-[11px] font-mono text-amber-500">
          Most of this photo is blacked out — make sure the rack itself is untouched or scoring will fail.
        </p>
      )}
    </div>
  )
}
