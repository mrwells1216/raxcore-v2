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
const DPAD_STEP = 1
const LOUPE_SIZE = 104
// Pulled back again: at higher zoom the burr filled the window with no
// surrounding skull to orient against. 1.5x is enough to place a dot
// precisely while still showing what you are looking at.
const LOUPE_ZOOM = 1.5
// The loupe is pinned to a fixed corner rather than chasing the dot — a
// window that moves while you drag is harder to read than one that stays put.
// It stays visible the whole time the tool is open (not just mid-drag) so it
// reads as a fixed instrument rather than something that flickers in and out.
const LOUPE_MARGIN = 8
const LOUPE_SRC_RADIUS = LOUPE_SIZE / (2 * LOUPE_ZOOM) // 15px of image space from center

type DotId = 'left' | 'right'
type DpadDir = 'up' | 'down' | 'left' | 'right'

interface ContainerSize {
  width: number
  height: number
}

interface LoupeState {
  canvasX: number
  canvasY: number
  imgX: number
  imgY: number
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
  const imgRef = useRef<HTMLImageElement | null>(null)
  const loupeCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const dpadIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pointerDownPos = useRef<{ x: number; y: number } | null>(null)

  const [containerSize, setContainerSize] = useState<ContainerSize>({ width: 0, height: 0 })
  // True pixel size read off the loaded image. The imageWidth/imageHeight
  // props are frequently placeholder values (the wizard defaults to 1024x768),
  // and a wrong aspect here both letterboxes the photo — shifting it when you
  // switch tools — and skews the pixel→image coordinate mapping for the dots.
  const [naturalSize, setNaturalSize] = useState<ContainerSize | null>(null)
  const aspectW = naturalSize?.width || imageWidth
  const aspectH = naturalSize?.height || imageHeight
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
  const [dragging, setDragging] = useState<DotId | null>(null)
  const [selected, setSelected] = useState<DotId | null>(null)
  const [loupeState, setLoupeState] = useState<LoupeState | null>(null)

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

  // Cleanup D-pad interval on unmount
  useEffect(() => {
    return () => {
      if (dpadIntervalRef.current) clearInterval(dpadIntervalRef.current)
    }
  }, [])

  const transform = useMemo(
    () => computeContainImage(containerSize, aspectW, aspectH),
    [containerSize, aspectW, aspectH],
  )

  // Keep the loupe pointed at whichever dot is in play — the one being
  // dragged, else the selected one, else the left dot. Previously this was
  // only populated during a touch drag, so the window vanished the moment you
  // lifted your finger, which is exactly when you want to check placement.
  const loupeFocus = dragging ?? selected ?? 'left'
  const loupeImgPoint = loupeFocus === 'right' ? rightImg : leftImg
  useEffect(() => {
    if (!containerSize.width || !containerSize.height) return
    const canvasPt = {
      x: transform.offsetX + loupeImgPoint.x * transform.scale,
      y: transform.offsetY + loupeImgPoint.y * transform.scale,
    }
    setLoupeState({
      canvasX: canvasPt.x,
      canvasY: canvasPt.y,
      imgX: loupeImgPoint.x,
      imgY: loupeImgPoint.y,
    })
  }, [loupeImgPoint.x, loupeImgPoint.y, transform, containerSize.width, containerSize.height])

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
        x: Math.max(0, Math.min(aspectW, xImg)),
        y: Math.max(0, Math.min(aspectH, yImg)),
      }
    },
    [transform, aspectW, aspectH],
  )

  const onPointerDown = useCallback(
    (which: DotId) => (e: React.PointerEvent) => {
      e.preventDefault()
      e.stopPropagation()
      ;(e.target as Element).setPointerCapture(e.pointerId)
      setDragging(which)
      const rect = containerRef.current!.getBoundingClientRect()
      pointerDownPos.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
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
      // Loupe only on touch input so it can appear offset from the finger
      if (e.pointerType === 'touch') {
        setLoupeState({ canvasX, canvasY, imgX: imgPt.x, imgY: imgPt.y })
      }
    },
    [dragging, canvasToImg],
  )

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging) return
      try {
        ;(e.target as Element).releasePointerCapture(e.pointerId)
      } catch {
        // safe to ignore
      }
      // Tap (< 8px movement) → select this dot for D-pad fine-tuning
      if (pointerDownPos.current) {
        const rect = containerRef.current?.getBoundingClientRect()
        if (rect) {
          const dx = (e.clientX - rect.left) - pointerDownPos.current.x
          const dy = (e.clientY - rect.top) - pointerDownPos.current.y
          if (Math.hypot(dx, dy) < 8) setSelected(dragging)
        }
      }
      pointerDownPos.current = null
      setDragging(null)
      setLoupeState(null)
    },
    [dragging],
  )

  // Draw magnification loupe whenever its state changes
  useEffect(() => {
    const canvas = loupeCanvasRef.current
    if (!canvas || !loupeState) return
    const img = imgRef.current
    if (!img || !img.naturalWidth) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, LOUPE_SIZE, LOUPE_SIZE)

    // Clip to circle
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, LOUPE_SIZE, LOUPE_SIZE)
    ctx.clip()

    // Magnified crop of the original image
    ctx.drawImage(
      img,
      loupeState.imgX - LOUPE_SRC_RADIUS,
      loupeState.imgY - LOUPE_SRC_RADIUS,
      LOUPE_SRC_RADIUS * 2,
      LOUPE_SRC_RADIUS * 2,
      0, 0, LOUPE_SIZE, LOUPE_SIZE,
    )
    ctx.restore()

    // Crosshairs
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'
    ctx.lineWidth = 1
    ctx.setLineDash([4, 3])
    ctx.beginPath()
    ctx.moveTo(LOUPE_SIZE / 2, 4)
    ctx.lineTo(LOUPE_SIZE / 2, LOUPE_SIZE - 4)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(4, LOUPE_SIZE / 2)
    ctx.lineTo(LOUPE_SIZE - 4, LOUPE_SIZE / 2)
    ctx.stroke()
    ctx.setLineDash([])

    // Center amber dot
    ctx.beginPath()
    ctx.arc(LOUPE_SIZE / 2, LOUPE_SIZE / 2, 3, 0, Math.PI * 2)
    ctx.fillStyle = '#fbbf24'
    ctx.fill()

    // Amber border ring
    ctx.beginPath()
    ctx.rect(0.5, 0.5, LOUPE_SIZE - 1, LOUPE_SIZE - 1)
    ctx.strokeStyle = '#fbbf24'
    ctx.lineWidth = 2
    ctx.stroke()
  }, [loupeState])

  // D-pad movement
  const moveDot = useCallback(
    (dir: DpadDir) => {
      if (!selected) return
      const delta: Record<DpadDir, { x: number; y: number }> = {
        up:    { x: 0,         y: -DPAD_STEP },
        down:  { x: 0,         y:  DPAD_STEP },
        left:  { x: -DPAD_STEP, y: 0 },
        right: { x:  DPAD_STEP, y: 0 },
      }
      const d = delta[dir]
      const setter = selected === 'left' ? setLeftImg : setRightImg
      setter(prev => ({
        x: Math.max(0, Math.min(imageWidth, prev.x + d.x)),
        y: Math.max(0, Math.min(imageHeight, prev.y + d.y)),
      }))
    },
    [selected, imageWidth, imageHeight],
  )

  const startMove = useCallback(
    (dir: DpadDir) => (e: React.PointerEvent) => {
      e.preventDefault()
      moveDot(dir)
      dpadIntervalRef.current = setInterval(() => moveDot(dir), 100)
    },
    [moveDot],
  )

  const stopMove = useCallback(() => {
    if (dpadIntervalRef.current) {
      clearInterval(dpadIntervalRef.current)
      dpadIntervalRef.current = null
    }
  }, [])

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
  const pixelDist = Math.hypot(rightImg.x - leftImg.x, rightImg.y - leftImg.y)
  const referenceInches =
    parsedKnown != null && parsedKnown >= KNOWN_INCHES_MIN && parsedKnown <= KNOWN_INCHES_MAX
      ? parsedKnown
      : 3.8
  const ppi = pixelDist > 0 ? pixelDist / referenceInches : 0

  // Loupe position: offset from finger, clamped to container
  let loupeLeft = 0
  let loupeTop = 0
  // Fixed top-right corner, always on. Previously this tracked the dragged dot
  // and only appeared mid-touch-drag, so it both jumped around and vanished
  // exactly when you wanted to check your placement.
  loupeLeft = Math.max(0, containerSize.width - LOUPE_SIZE - LOUPE_MARGIN)
  loupeTop = LOUPE_MARGIN


  const dots: Array<{ id: DotId; pos: { x: number; y: number }; label: string }> = [
    { id: 'left',  pos: leftCanvas,  label: 'L' },
    { id: 'right', pos: rightCanvas, label: 'R' },
  ]

  return (
    <div className="space-y-3">
      {/* Image + overlay */}
      <div
        ref={containerRef}
        className="relative w-full select-none overflow-hidden rounded bg-black"
        style={{
          // Match the crop/blackout wrappers exactly (same border, radius, and
          // natural aspect) so switching tools in PhotoEditor doesn't resize
          // or shift the photo. Falling back to 4/3 when dimensions were
          // unknown was the main cause of the jump.
          border: '1px solid var(--bronze-dark)',
          aspectRatio: aspectW && aspectH ? `${aspectW} / ${aspectH}` : undefined,
        }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        // Tap on empty space deselects
        onClick={(e) => {
          const target = e.target as Element
          if (!target.closest('[data-dot]')) setSelected(null)
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imgRef}
          onLoad={(e) => {
            const el = e.currentTarget
            if (el.naturalWidth > 0 && el.naturalHeight > 0) {
              setNaturalSize({ width: el.naturalWidth, height: el.naturalHeight })
            }
          }}
          src={imageUrl}
          alt="Pedicle calibration target"
          className="absolute inset-0 h-full w-full object-contain"
          draggable={false}
          crossOrigin="anonymous"
        />

        {/* SVG: connecting line + dot visuals */}
        <svg
          className="absolute inset-0 h-full w-full"
          viewBox={`0 0 ${containerSize.width || 1} ${containerSize.height || 1}`}
          preserveAspectRatio="none"
          style={{ pointerEvents: 'none' }}
        >
          {containerSize.width > 0 && (
            <>
              <line
                x1={leftCanvas.x}
                y1={leftCanvas.y}
                x2={rightCanvas.x}
                y2={rightCanvas.y}
                stroke="#f59e0b"
                strokeWidth={1.5}
                strokeDasharray="4 4"
                opacity={0.5}
              />
              {dots.map(({ id, pos, label }) => {
                const isSel = selected === id
                return (
                  <g key={id}>
                    {/* Crosshair lines */}
                    <line x1={pos.x - 12} y1={pos.y} x2={pos.x + 12} y2={pos.y}
                      stroke="#fbbf24" strokeWidth={1} opacity={0.65} />
                    <line x1={pos.x} y1={pos.y - 12} x2={pos.x} y2={pos.y + 12}
                      stroke="#fbbf24" strokeWidth={1} opacity={0.65} />
                    {/* Transparent circle */}
                    <circle cx={pos.x} cy={pos.y} r={7}
                      fill="rgba(251,191,36,0.20)"
                      stroke="#fbbf24"
                      strokeWidth={isSel ? 2.5 : 1.5} />
                    {/* Center dot */}
                    <circle cx={pos.x} cy={pos.y} r={2} fill="#fbbf24" opacity={0.9} />
                    {/* Label */}
                    <text
                      x={pos.x}
                      y={pos.y - 14}
                      textAnchor="middle"
                      fontSize={10}
                      fill="white"
                      opacity={0.85}
                      style={{ userSelect: 'none' }}
                    >
                      {label}
                    </text>
                  </g>
                )
              })}
            </>
          )}
        </svg>

        {/* Invisible pointer-event buttons — larger hit area than the dot visual */}
        {dots.map(({ id, pos }) => (
          <button
            key={id}
            type="button"
            data-dot={id}
            aria-label={`${id === 'left' ? 'Left' : 'Right'} pedicle dot`}
            onPointerDown={onPointerDown(id)}
            className="absolute touch-none rounded-full bg-transparent"
            style={{
              left: pos.x,
              top: pos.y,
              width: 32,
              height: 32,
              transform: 'translate(-50%, -50%)',
              cursor: dragging === id ? 'grabbing' : 'grab',
            }}
          />
        ))}

        {/* Magnification loupe (touch drag only) */}
        {loupeState && (
          <canvas
            ref={loupeCanvasRef}
            width={LOUPE_SIZE}
            height={LOUPE_SIZE}
            style={{
              position: 'absolute',
              left: loupeLeft,
              top: loupeTop,
              width: LOUPE_SIZE,
              height: LOUPE_SIZE,
              borderRadius: 6,
              border: '2px solid #fbbf24',
              boxShadow: '0 0 0 1px rgba(0,0,0,0.6), 0 4px 12px rgba(0,0,0,0.5)',
              pointerEvents: 'none',
              zIndex: 10,
            }}
          />
        )}
      </div>

      {/* D-pad fine-tune control */}
      <div className="flex items-center justify-center gap-4 py-1">
        <span className="text-xs text-zinc-400 min-w-0 flex-1 text-right pr-2">
          {selected
            ? `Fine-tuning: ${selected === 'left' ? 'L' : 'R'} dot`
            : 'Tap a dot to fine-tune'}
        </span>
        <div className="grid grid-cols-3 gap-1" style={{ width: 104 }}>
          {/* Row 1: up */}
          <div />
          <button
            type="button"
            aria-label="Move up"
            disabled={!selected}
            onPointerDown={startMove('up')}
            onPointerUp={stopMove}
            onPointerLeave={stopMove}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-zinc-700 bg-zinc-800 text-zinc-200 disabled:opacity-30 hover:bg-zinc-700 active:bg-zinc-600 touch-none select-none"
          >
            ▲
          </button>
          <div />
          {/* Row 2: left, center indicator, right */}
          <button
            type="button"
            aria-label="Move left"
            disabled={!selected}
            onPointerDown={startMove('left')}
            onPointerUp={stopMove}
            onPointerLeave={stopMove}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-zinc-700 bg-zinc-800 text-zinc-200 disabled:opacity-30 hover:bg-zinc-700 active:bg-zinc-600 touch-none select-none"
          >
            ◀
          </button>
          <div className="flex h-8 w-8 items-center justify-center rounded-md border border-zinc-700 bg-zinc-900">
            <div
              className={`h-2.5 w-2.5 rounded-full transition-colors ${selected ? 'bg-amber-400' : 'bg-zinc-600'}`}
            />
          </div>
          <button
            type="button"
            aria-label="Move right"
            disabled={!selected}
            onPointerDown={startMove('right')}
            onPointerUp={stopMove}
            onPointerLeave={stopMove}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-zinc-700 bg-zinc-800 text-zinc-200 disabled:opacity-30 hover:bg-zinc-700 active:bg-zinc-600 touch-none select-none"
          >
            ▶
          </button>
          {/* Row 3: down */}
          <div />
          <button
            type="button"
            aria-label="Move down"
            disabled={!selected}
            onPointerDown={startMove('down')}
            onPointerUp={stopMove}
            onPointerLeave={stopMove}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-zinc-700 bg-zinc-800 text-zinc-200 disabled:opacity-30 hover:bg-zinc-700 active:bg-zinc-600 touch-none select-none"
          >
            ▼
          </button>
          <div />
        </div>
        <div className="flex-1 pl-2" />
      </div>

      {/* Known spacing + implied scale */}
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
            {pixelDist > 0
              ? `${pixelDist.toFixed(0)} px / ${referenceInches.toFixed(1)}" = ${ppi.toFixed(1)} px/in`
              : '—'}
          </div>
          <div className="mt-2 text-zinc-500">
            Confidence:{' '}
            {parsedKnown != null &&
            parsedKnown >= KNOWN_INCHES_MIN &&
            parsedKnown <= KNOWN_INCHES_MAX
              ? '0.85 (user-measured)'
              : '0.68 (anatomical average)'}
          </div>
        </div>
      </div>
    </div>
  )
}
