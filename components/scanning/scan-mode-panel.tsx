'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Camera, X, RotateCcw, Check, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  type ScanAngle,
  type SmartScanFrame,
  type SubjectValidation,
  type CoverageProgress,
  analyseFrame,
  detectCoverageZones,
  buildCoverageProgress,
  framesToLegacySlots,
  buildGuidanceState,
} from '@/lib/capture/scan-session'
import { toast } from 'sonner'

// ─── Zone metadata ─────────────────────────────────────────────────────────────

const ZONE_LABELS: Record<string, string> = {
  full_rack: 'Front', left_antler: 'Left', right_antler: 'Right', beam_tine_detail: 'Detail',
}

const ZONE_ARCS: Record<string, { startDeg: number; spanDeg: number }> = {
  full_rack:        { startDeg: 270, spanDeg: 90 },
  left_antler:      { startDeg:   0, spanDeg: 90 },
  right_antler:     { startDeg:  90, spanDeg: 90 },
  beam_tine_detail: { startDeg: 180, spanDeg: 90 },
}

const REQUIRED_SCAN_ANGLES = ['front', 'left', 'right'] as const satisfies readonly ScanAngle[]

const ANGLE_TO_ZONE: Record<ScanAngle, keyof CoverageProgress['zones']> = {
  front:  'full_rack',
  left:   'left_antler',
  right:  'right_antler',
  detail: 'beam_tine_detail',
}

// ─── SVG arc helpers ───────────────────────────────────────────────────────────

function polarToXY(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

function arcPath(cx: number, cy: number, r: number, startDeg: number, spanDeg: number) {
  const gapDeg = 4
  const s = polarToXY(cx, cy, r, startDeg + gapDeg / 2)
  const e = polarToXY(cx, cy, r, startDeg + spanDeg - gapDeg / 2)
  const large = spanDeg - gapDeg > 180 ? 1 : 0
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y}`
}

// ─── Coverage ring ─────────────────────────────────────────────────────────────

function CoverageRing({ progress, size = 180 }: { progress: CoverageProgress; size?: number }) {
  const cx = size / 2, cy = size / 2, r = size / 2 - 14
  return (
    <svg width={size} height={size} className="absolute inset-0" aria-hidden>
      {Object.entries(ZONE_ARCS).map(([zone, { startDeg, spanDeg }]) => {
        const filled = progress.zones[zone as keyof typeof progress.zones]
        return (
          <path
            key={zone}
            d={arcPath(cx, cy, r, startDeg, spanDeg)}
            fill="none"
            stroke={filled ? 'hsl(var(--primary))' : 'rgba(255,255,255,0.18)'}
            strokeWidth={8}
            strokeLinecap="round"
            style={{ transition: 'stroke 0.4s ease' }}
          />
        )
      })}
    </svg>
  )
}

// ─── Captured frame strip ──────────────────────────────────────────────────────

function FrameStrip({
  frames,
  onRemove,
}: {
  frames: SmartScanFrame[]
  onRemove: (id: string) => void
}) {
  if (frames.length === 0) return null
  return (
    <div className="flex gap-2 overflow-x-auto pb-0.5" style={{ scrollbarWidth: 'none' }}>
      {frames.map((frame) => (
        <div
          key={frame.id}
          className="relative shrink-0 w-14 h-14 rounded-xl overflow-hidden border border-border/50"
        >
          <img src={frame.previewUrl} alt={frame.angle} className="w-full h-full object-cover" />
          <button
            type="button"
            onClick={() => {
              URL.revokeObjectURL(frame.previewUrl)
              onRemove(frame.id)
            }}
            className="absolute top-0.5 right-0.5 h-5 w-5 rounded-full bg-black/70 flex items-center justify-center touch-manipulation"
            aria-label="Remove"
          >
            <X className="h-3 w-3 text-white" />
          </button>
          <span className="absolute bottom-0 inset-x-0 text-center text-[9px] text-white font-medium bg-black/50 py-0.5 capitalize">
            {frame.angle}
          </span>
        </div>
      ))}
    </div>
  )
}

// ─── Main component ────────────────────────────────────────────────────────────

interface ScanModePanelProps {
  onFilesReady: (files: File[], angles: ScanAngle[]) => void
  onFallbackToUpload?: () => void
}

export function ScanModePanel({ onFilesReady, onFallbackToUpload }: ScanModePanelProps) {
  const videoRef    = useRef<HTMLVideoElement>(null)
  const canvasRef   = useRef<HTMLCanvasElement>(null)
  const streamRef   = useRef<MediaStream | null>(null)
  const rafRef        = useRef<number | null>(null)
  const lastUpdateRef = useRef(0)
  // Tracks whether the component is still mounted; prevents AbortError retry
  // noise on normal teardown and races between getUserMedia and unmount.
  const isActiveRef = useRef(true)

  const [isStreaming, setIsStreaming]    = useState(false)
  const [cameraError, setCameraError]   = useState<string | null>(null)
  const [frames, setFrames]             = useState<SmartScanFrame[]>([])
  const [progress, setProgress]         = useState<CoverageProgress>(buildCoverageProgress([]))
  const [validation, setValidation]     = useState<SubjectValidation | null>(null)
  const [angleHint, setAngleHint]       = useState<ScanAngle>('front')
  const [flashVisible, setFlashVisible] = useState(false)
  const [facingMode, setFacingMode]     = useState<'environment' | 'user'>('environment')

  const guidance = buildGuidanceState(validation, progress, isStreaming)

  // ── Camera start/stop ────────────────────────────────────────────────────────

  const startCamera = useCallback(async (facing: 'environment' | 'user') => {
    // Bail immediately if the component has already unmounted
    if (!isActiveRef.current) return

    setCameraError(null)
    try {
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop())
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      })

      // Component may have unmounted while awaiting getUserMedia
      if (!isActiveRef.current) {
        stream.getTracks().forEach(t => t.stop())
        return
      }

      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }

      // Check again after the async play() call
      if (!isActiveRef.current) {
        stream.getTracks().forEach(t => t.stop())
        return
      }

      setIsStreaming(true)
    } catch (err) {
      // Silently discard errors that happen after unmount — they are not real
      // failures, just the result of React strict-mode double-invocation or
      // navigation away while the camera was starting.
      if (!isActiveRef.current) return

      // AbortError is a benign teardown signal (StrictMode, fast navigation).
      // Treat it as a no-op; do not surface an error state to the user.
      if (err instanceof DOMException && err.name === 'AbortError') {
        if (isActiveRef.current) {
          console.debug('[scan-mode] camera initialization aborted')
        }
        return
      }

      console.warn('[scan-mode] camera initialization failed', err)
      setCameraError('Camera access denied. Tap to retry.')
      setIsStreaming(false)
    }
  }, [])

  useEffect(() => {
    isActiveRef.current = true
    startCamera(facingMode)
    return () => {
      isActiveRef.current = false
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop())
      if (videoRef.current) videoRef.current.srcObject = null
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facingMode])

  // ── Analysis loop — optical quality only, no auto-capture ───────────────────

  useEffect(() => {
    if (!isStreaming) return

    let lastTick = 0
    const TICK_MS = 350

    const loop = (rafTime: number) => {
      rafRef.current = requestAnimationFrame(loop)
      if (rafTime - lastTick < TICK_MS) return
      lastTick = rafTime

      const video = videoRef.current
      const canvas = canvasRef.current
      if (!video || !canvas || video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) return

      canvas.width = video.videoWidth
      canvas.height = video.videoHeight

      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) return

      ctx.drawImage(video, 0, 0)

      const result = analyseFrame(canvas)
      const now = Date.now()

      if (now - lastUpdateRef.current > 160) {
        setValidation(result)
        lastUpdateRef.current = now
      }
    }

    rafRef.current = requestAnimationFrame(loop)

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [isStreaming])

  useEffect(() => {
    setProgress(buildCoverageProgress(frames))
  }, [frames])

  // Auto-advance angle hint only after a view is manually captured
  useEffect(() => {
    if (angleHint === 'front' && progress.zones.full_rack && !progress.zones.left_antler) {
      setAngleHint('left')
    } else if (angleHint === 'left' && progress.zones.left_antler && !progress.zones.right_antler) {
      setAngleHint('right')
    }
  }, [angleHint, progress.zones.full_rack, progress.zones.left_antler, progress.zones.right_antler])

  // ── Capture helpers ──────────────────────────────────────────────────────────

  const captureFrameAsync = useCallback((
    angle: ScanAngle,
    zones: ReturnType<typeof detectCoverageZones>,
    val: SubjectValidation,
  ) => {
    const video = videoRef.current

    if (!video || video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
      toast.error('Camera is not ready yet')
      return
    }

    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.drawImage(video, 0, 0)

    canvas.toBlob((blob) => {
      if (!blob) return

      const file = new File([blob], `scan-${angle}-${Date.now()}.jpg`, { type: 'image/jpeg' })
      const previewUrl = URL.createObjectURL(blob)

      const frame: SmartScanFrame = {
        id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `scan-${angle}-${Date.now()}`,
        file,
        previewUrl,
        capturedAt: new Date().toISOString(),
        zones,
        validation: val,
        angle,
      }

      setFrames((prev) => {
        const replaced = prev.find((existing) => existing.angle === angle)
        if (replaced) URL.revokeObjectURL(replaced.previewUrl)
        return [...prev.filter((existing) => existing.angle !== angle), frame]
      })

      setFlashVisible(true)
      window.setTimeout(() => setFlashVisible(false), 140)

      if (navigator.vibrate) navigator.vibrate(35)
    }, 'image/jpeg', 0.9)
  }, [])

  const handleManualCapture = useCallback(() => {
    const val: SubjectValidation = validation ?? {
      hasDeer: false,
      hasRack: false,
      isSharp: true,
      isClipped: false,
      brightnessOk: true,
      confidence: 0.55,
      rejectionReason: null,
    }

    if (val.rejectionReason) {
      toast.error(val.rejectionReason)
      return
    }

    const zones = detectCoverageZones(val, angleHint)
    captureFrameAsync(angleHint, zones, val)
  }, [validation, angleHint, captureFrameAsync])

  const handleRemoveFrame = useCallback((id: string) => {
    setFrames(prev => prev.filter(f => f.id !== id))
  }, [])

  const handleFlipCamera = useCallback(() => {
    setFacingMode(prev => prev === 'environment' ? 'user' : 'environment')
    setIsStreaming(false)
  }, [])

  const handleReset = useCallback(() => {
    frames.forEach(f => URL.revokeObjectURL(f.previewUrl))
    setFrames([])
    setAngleHint('front')
  }, [frames])

  const handleFinalize = useCallback(() => {
    if (frames.length === 0) {
      toast.error('Capture at least one front view to continue')
      return
    }

    if (!progress.zones.full_rack) {
      toast.error('Capture the front full-rack view first')
      return
    }

    const { files, angles } = framesToLegacySlots(frames)

    if (files.length === 0) {
      toast.error('No valid frames captured')
      return
    }

    if (!progress.satisfied) {
      toast.warning('Side views are missing. You can score, but confidence may be lower.')
    }

    onFilesReady(files, angles)
  }, [frames, onFilesReady, progress.satisfied, progress.zones.full_rack])

  const capturedRequiredCount = REQUIRED_SCAN_ANGLES.filter(
    (angle) => progress.zones[ANGLE_TO_ZONE[angle]],
  ).length

  const satisfied = progress.satisfied
  const borderColor =
    guidance.status === 'valid'   ? 'border-primary/70' :
    guidance.status === 'invalid' ? 'border-destructive/60' :
                                    'border-white/15'

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">

      {/* Viewfinder */}
      <div className={cn(
        'relative rounded-2xl overflow-hidden border-2 bg-black transition-colors duration-300',
        'aspect-[3/4] w-full',
        borderColor,
      )}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="absolute inset-0 w-full h-full object-cover"
        />
        <canvas ref={canvasRef} className="sr-only" aria-hidden />

        {/* Flash */}
        {flashVisible && (
          <div className="absolute inset-0 bg-white/25 pointer-events-none" />
        )}

        {/* Camera error */}
{cameraError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 text-white">
            <Camera className="h-10 w-10 opacity-50" />
            <p className="text-sm text-center px-6">{cameraError}</p>
            <button
              type="button"
              onClick={() => startCamera(facingMode)}
              className="text-xs text-white/70 hover:text-white underline touch-manipulation"
            >
              Tap to retry
            </button>
            {onFallbackToUpload && (
              <button
                type="button"
                onClick={onFallbackToUpload}
                className="mt-2 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm font-medium touch-manipulation"
              >
                Switch to Upload
              </button>
            )}
          </div>
        )}

        {/* Coverage ring overlay */}
        {isStreaming && !cameraError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <div className="relative" style={{ width: 180, height: 180 }}>
              <CoverageRing progress={progress} size={180} />
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
                <span className="font-mono text-2xl font-bold tabular-nums text-white">
                  {capturedRequiredCount}/3
                </span>
                <span className="text-[11px] font-medium text-white/60">views captured</span>
              </div>
            </div>
            <div className="flex gap-3 mt-3">
              {Object.entries(ZONE_LABELS).map(([zone, label]) => {
                const filled = progress.zones[zone as keyof typeof progress.zones]
                return (
                  <div key={zone} className="flex items-center gap-1">
                    <div className={cn('h-1.5 w-1.5 rounded-full', filled ? 'bg-primary' : 'bg-white/25')} />
                    <span className={cn('text-[10px] font-medium', filled ? 'text-white' : 'text-white/45')}>
                      {label}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Guidance banner */}
        {isStreaming && !cameraError && (
          <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/85 to-transparent pt-10 pb-20 px-4 pointer-events-none">
            <p className={cn(
              'text-sm font-semibold text-center leading-snug',
              guidance.status === 'invalid' ? 'text-red-400' : 'text-white',
            )}>
              {guidance.headline}
            </p>
            {guidance.subtext && (
              <p className="text-xs text-white/55 text-center mt-0.5">{guidance.subtext}</p>
            )}
          </div>
        )}

        {/* Flip camera button */}
        {isStreaming && (
          <button
            type="button"
            onClick={handleFlipCamera}
            className="absolute top-3 right-3 h-9 w-9 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center touch-manipulation"
            aria-label="Flip camera"
          >
            <RotateCcw className="h-4 w-4 text-white" />
          </button>
        )}

        {/* Manual shutter */}
        {isStreaming && !satisfied && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
            <button
              type="button"
              onClick={handleManualCapture}
              className="h-16 w-16 rounded-full border-4 border-white/80 bg-white/20 backdrop-blur-sm flex items-center justify-center active:scale-95 transition-transform touch-manipulation shadow-lg"
              aria-label="Capture photo"
            >
              <div className="h-11 w-11 rounded-full bg-white" />
            </button>
          </div>
        )}
      </div>

      {/* Honesty disclaimer */}
      <div className="rounded-xl border border-border/60 bg-card/60 p-3 text-xs text-muted-foreground">
        This camera mode does <span className="font-semibold text-foreground">not</span> auto-capture or fake rack detection. It only checks basic photo quality here; deer/rack validation happens in the scoring AI after upload.
      </div>

      {/* Angle hint selector */}
      {!satisfied && (
        <div className="flex gap-1.5">
          {(['front', 'left', 'right'] as ScanAngle[]).map(angle => {
            const done   = progress.zones[ANGLE_TO_ZONE[angle]]
            const active = angleHint === angle
            return (
              <button
                key={angle}
                type="button"
                onClick={() => setAngleHint(angle)}
                className={cn(
                  'flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl',
                  'text-xs font-semibold border transition-all touch-manipulation capitalize',
                  done
                    ? 'bg-primary/15 border-primary/30 text-primary'
                    : active
                      ? 'bg-card border-border text-foreground shadow-sm'
                      : 'bg-transparent border-border/40 text-muted-foreground hover:text-foreground',
                )}
              >
                {done && <Check className="h-3 w-3" />}
                {angle}
              </button>
            )
          })}
        </div>
      )}

      {/* Captured frames */}
      {frames.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              {frames.length} frame{frames.length !== 1 ? 's' : ''} captured
            </span>
            <button
              type="button"
              onClick={handleReset}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 touch-manipulation"
            >
              <RotateCcw className="h-3 w-3" />
              Reset
            </button>
          </div>
          <FrameStrip frames={frames} onRemove={handleRemoveFrame} />
        </div>
      )}

      {/* Continue CTA */}
      {frames.length > 0 && (
        <button
          type="button"
          onClick={handleFinalize}
          className={cn(
            'w-full flex items-center justify-center gap-2 min-h-[52px] rounded-2xl font-semibold text-sm',
            'transition-all touch-manipulation',
            satisfied
              ? 'bg-primary text-primary-foreground shadow-md active:scale-[0.98]'
              : 'bg-card border border-border text-foreground hover:bg-secondary/60',
          )}
        >
          {satisfied ? (
            <>
              <Check className="h-4 w-4" />
              Scan complete — continue
            </>
          ) : (
            <>
              Continue with {frames.length} frame{frames.length !== 1 ? 's' : ''}
              <ChevronRight className="h-4 w-4" />
            </>
          )}
        </button>
      )}
    </div>
  )
}
