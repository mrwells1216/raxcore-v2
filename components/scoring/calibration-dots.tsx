'use client'

/**
 * Pedicle calibration dots overlay.
 *
 * The user drags two amber dots onto each antler's burr-base (pedicle) and
 * optionally enters their own measured pedicle spacing. Pixel distance / known
 * inches feeds the `user_placed_known` (0.85 confidence) or
 * `user_placed_anatomical` (0.68, using the 3.8" population average)
 * calibration source — slots 4–5 in §8 of CLAUDE.md.
 *
 * Coordinates returned to the caller are in IMAGE pixel space (not canvas px),
 * with letterbox/pillarbox math borrowed from the §3.17 LandmarkOverlay fix so
 * dots line up regardless of container aspect ratio.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export interface PedicleDotPlacement {
  imageIndex: number
  leftPx: number
  leftPy: number
  rightPx: number
  rightPy: number
  knownInches: number | null
}

interface CalibrationDotsProps {
  imageUrl: string
  imageIndex: number
  imageWidth: number
  imageHeight: number
  initial?: PedicleDotPlacement | null
  onChange: (placement: PedicleDotPlacement | null) => void
}

const DEFAULT_LEFT_RATIO = { x: 0.35, y: 0.30 }
const DEFAULT_RIGHT_RATIO = { x: 0.65, y: 0.30 }
const KNOWN_INCHES_MIN = 2.0
const KNOWN_INCHES_MAX = 8.0

interface ContainerSize {
  width: number
  height: number
}

function computeContainImage(
  container: ContainerSize,
  imageW: number,
  imageH: number,
): { scale: number; offsetX: number; offsetY: number; renderW: number; renderH: number } {
  if (!container.width || !container.height || !imageW || !imageH) {
    return { scale: 1, offsetX: 0, offsetY: 0, renderW: container.width, renderH: container.height }
  }
  const imageAR = imageW / imageH
  const containerAR = container.width / container.height
  let renderW: number
  let renderH: number
  if (imageAR > containerAR) {
    // letterbox — image wider than container
    renderW = container.width
    renderH = container.width / imageAR
  } else {
    renderW = container.height * imageAR
    renderH = container.height
  }
  const scale = renderW / imageW
  const offsetX = (container.width - renderW) / 2
  const offsetY = (container.height - renderH) / 2
  return { scale, offsetX, offsetY, renderW, renderH }
}

export function CalibrationDots({
  imageUrl,
  imageIndex,
  imageWidth,
  imageHeight,
  initial,
  onChange,
}: CalibrationDotsProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [containerSize, setContainerSize] = useState<ContainerSize>({ width: 0, height: 0 })
  const [leftImg, setLeftImg] = useState<{ x: number; y: number }>(() => ({
    x: initial?.leftPx ?? imageWidth * DEFAULT_LEFT_RATIO.x,
    y: initial?.leftPy ?? imageHeight * DEFAULT_LEFT_RATIO.y,
  }))
  const [rightImg, setRightImg] = useState<{ x: number; y: number }>(() => ({
    x: initial?.rightPx ?? imageWidth * DEFAULT_RIGHT_RATIO.x,
    y: initial?.rightPy ?? imageHeight * DEFAULT_RIGHT_RATIO.y,
  }))
  const [knownInches, setKnownInches] = useState<string>(
    initial?.knownInches != null ? String(initial.knownInches) : '',
  )
  const [dragging, setDragging] = useState<'left' | 'right' | null>(null)

  useEffect(() => {
    if (!containerRef.current) return
    const el = containerRef.current
    const update = () => {
      const rect = el.getBoundingClientRect()
      setContainerSize({ width: rect.width, height: rect.height })
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const transform = useMemo(
    () => computeContainImage(containerSize, imageWidth, imageHeight),
    [containerSize, imageWidth, imageHeight],
  )

  const imgToCanvas = useCallback(
    (pt: { x: number; y: number }) => ({
      x: transform.offsetX + pt.x * transform.scale,
      y: transform.offsetY + pt.y * transform.scale,
    }),
    [transform],
  )

  const canvasToImg = useCallback(
    (canvasX: number, canvasY: number) => {
      if (transform.scale <= 0) return { x: 0, y: 0 }
      const xImg = (canvasX - transform.offsetX) / transform.scale
      const yImg = (canvasY - transform.offsetY) / transform.scale
      return {
        x: Math.max(0, Math.min(imageWidth, xImg)),
        y: Math.max(0, Math.min(imageHeight, yImg)),
      }
    },
    [transform, imageWidth, imageHeight],
  )

  const onPointerDown = useCallback(
    (which: 'left' | 'right') => (e: React.PointerEvent) => {
      e.preventDefault()
      ;(e.target as Element).setPointerCapture(e.pointerId)
      setDragging(which)
    },
    [],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const canvasX = e.clientX - rect.left
      const canvasY = e.clientY - rect.top
      const imgPt = canvasToImg(canvasX, canvasY)
      if (dragging === 'left') setLeftImg(imgPt)
      else setRightImg(imgPt)
    },
    [dragging, canvasToImg],
  )

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragging) return
    try {
      ;(e.target as Element).releasePointerCapture(e.pointerId)
    } catch {
      // some browsers throw if the pointer isn't captured by this element
    }
    setDragging(null)
  }, [dragging])

  const parsedKnown = useMemo(() => {
    if (knownInches.trim() === '') return null
    const n = Number(knownInches)
    if (!Number.isFinite(n)) return null
    return n
  }, [knownInches])

  const knownWarning = useMemo(() => {
    if (parsedKnown == null) return null
    if (parsedKnown < KNOWN_INCHES_MIN || parsedKnown > KNOWN_INCHES_MAX) {
      return `Outside ${KNOWN_INCHES_MIN}–${KNOWN_INCHES_MAX}" range — will fall back to anatomical average`
    }
    return null
  }, [parsedKnown])

  useEffect(() => {
    const valid =
      Number.isFinite(leftImg.x) && Number.isFinite(leftImg.y) &&
      Number.isFinite(rightImg.x) && Number.isFinite(rightImg.y)
    if (!valid) {
      onChange(null)
      return
    }
    onChange({
      imageIndex,
      leftPx: leftImg.x,
      leftPy: leftImg.y,
      rightPx: rightImg.x,
      rightPy: rightImg.y,
      knownInches: parsedKnown,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leftImg.x, leftImg.y, rightImg.x, rightImg.y, parsedKnown, imageIndex])

  const leftCanvas = imgToCanvas(leftImg)
  const rightCanvas = imgToCanvas(rightImg)
  const pixelDist = Math.hypot(
    rightImg.x - leftImg.x,
    rightImg.y - leftImg.y,
  )
  const referenceInches = parsedKnown != null && parsedKnown >= KNOWN_INCHES_MIN && parsedKnown <= KNOWN_INCHES_MAX
    ? parsedKnown
    : 3.8
  const ppi = pixelDist > 0 ? pixelDist / referenceInches : 0

  return (
    <div className="space-y-3">
      <div
        ref={containerRef}
        className="relative w-full select-none overflow-hidden rounded-lg border border-amber-500/30 bg-black"
        style={{ aspectRatio: imageWidth && imageHeight ? `${imageWidth} / ${imageHeight}` : '4 / 3' }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt="Pedicle calibration target"
          className="absolute inset-0 h-full w-full object-contain"
          draggable={false}
        />
        <svg
          className="absolute inset-0 h-full w-full"
          viewBox={`0 0 ${containerSize.width || 1} ${containerSize.height || 1}`}
          preserveAspectRatio="none"
        >
          {containerSize.width > 0 && (
            <line
              x1={leftCanvas.x}
              y1={leftCanvas.y}
              x2={rightCanvas.x}
              y2={rightCanvas.y}
              stroke="#f59e0b"
              strokeWidth={1.5}
              strokeDasharray="4 4"
            />
          )}
        </svg>
        <button
          type="button"
          aria-label="Left pedicle dot"
          onPointerDown={onPointerDown('left')}
          className="absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-amber-500 shadow-lg touch-none"
          style={{ left: leftCanvas.x, top: leftCanvas.y, cursor: dragging === 'left' ? 'grabbing' : 'grab' }}
        />
        <button
          type="button"
          aria-label="Right pedicle dot"
          onPointerDown={onPointerDown('right')}
          className="absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-amber-500 shadow-lg touch-none"
          style={{ left: rightCanvas.x, top: rightCanvas.y, cursor: dragging === 'right' ? 'grabbing' : 'grab' }}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="text-zinc-300">Measured pedicle spacing (inches, optional)</span>
          <input
            type="number"
            step="0.1"
            min={KNOWN_INCHES_MIN}
            max={KNOWN_INCHES_MAX}
            value={knownInches}
            onChange={(e) => setKnownInches(e.target.value)}
            placeholder="e.g. 4.2"
            className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:border-amber-500 focus:outline-none"
          />
          <span className="mt-1 block text-xs text-zinc-500">
            Leave blank to use the 3.8&quot; whitetail average (lower confidence).
          </span>
          {knownWarning && (
            <span className="mt-1 block text-xs text-red-400">{knownWarning}</span>
          )}
        </label>
        <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3 text-xs">
          <div className="text-zinc-400">Implied scale</div>
          <div className="mt-1 font-mono text-amber-400">
            {pixelDist > 0 ? `${pixelDist.toFixed(0)} px / ${referenceInches.toFixed(1)}" = ${ppi.toFixed(1)} px/in` : '—'}
          </div>
          <div className="mt-2 text-zinc-500">
            Confidence: {parsedKnown != null && parsedKnown >= KNOWN_INCHES_MIN && parsedKnown <= KNOWN_INCHES_MAX
              ? '0.85 (user-measured)'
              : '0.68 (anatomical average)'}
          </div>
        </div>
      </div>
    </div>
  )
}
