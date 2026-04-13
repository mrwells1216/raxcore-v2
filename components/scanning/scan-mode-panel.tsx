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
  shouldAutoCaptureFrame,
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
}

export function ScanModePanel({ onFilesReady }: ScanModePanelProps) {
  const videoRef    = useRef<HTMLVideoElement>(null)
  const canvasRef   = useRef<HTMLCanvasElement>(null)
  const streamRef   = useRef<MediaStream | null>(null)
  const rafRef      = useRef<number | null>(null)
  const stableRef   = useRef(0)
  const lastAutoRef = useRef(0)

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
    setCameraError(null)
    try {
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop())
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setIsStreaming(true)
  } catch (err) {
  // Handle AbortError gracefully (tab lost focus, React re-render interrupted stream)
  if (err instanceof Error && err.name === 'AbortError') {
    console.warn('[scan-mode] camera aborted, will retry on next mount')
    return
  }
  console.error('[scan-mode] camera start failed:', err)
  setCameraError('Camera access denied. Tap to retry.')
  setIsStreaming(false)
  }
  }, [])

  useEffect(() => {
    startCamera(facingMode)
    return () => {
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop())
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facingMode])

  // ── Analysis loop @ 4 fps ────────────────────────────────────────────────────

  useEffect(() => {
    if (!isStreaming) return
    let lastTick = 0
    const TICK_MS = 250

    const loop = (now: number) => {
      rafRef.current = requestAnimationFrame(loop)
      if (now - lastTick < TICK_MS) return
      lastTick = now

      const video = videoRef.current
      const canvas = canvasRef.current
      if (!video || !canvas || video.readyState < 2) return

      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.drawImage(video, 0, 0)

      const result = analyseFrame(canvas)
      setValidation(result)
      const newZones = detectCoverageZones(result, angleHint)

      setFrames(prev => {
        const currentProgress = buildCoverageProgress(prev)
        const now2 = Date.now()
        if (result.rejectionReason || !result.hasDeer) {
          stableRef.current = 0
          return prev
        }
        stableRef.current++
        if (
          shouldAutoCaptureFrame(result, newZones, currentProgress, stableRef.current) &&
          now2 - lastAutoRef.current > 2000 &&
          prev.length < 8
        ) {
          lastAutoRef.current = now2
          stableRef.current = 0
          setTimeout(() => captureFrameAsync(angleHint, newZones, result), 0)
        }
        return prev
      })
    }

    rafRef.current = requestAnimationFrame(loop)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStreaming, angleHint])

  useEffect(() => {
    setProgress(buildCoverageProgress(frames))
  }, [frames])

  // Auto-advance angle hint when zone is covered
  useEffect(() => {
    if (progress.zones.full_rack && angleHint === 'front')          setAngleHint('left')
    else if (progress.zones.left_antler && angleHint === 'left')    setAngleHint('right')
    else if (progress.zones.right_antler && angleHint === 'right')  setAngleHint('front')
  }, [progress.zones, angleHint])

  // ── Capture helpers ──────────────────────────────────────────────────────────

  const captureFrameAsync = useCallback((
    angle: ScanAngle,
    zones: ReturnType<typeof detectCoverageZones>,
    val: SubjectValidation,
  ) => {
    const video = videoRef.current
    if (!video) return
    const cap = document.createElement('canvas')
    cap.width = video.videoWidth
    cap.height = video.videoHeight
    const ctx = cap.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0)

    cap.toBlob(blob => {
      if (!blob) return
      const file = new File([blob], `scan-${angle}-${Date.now()}.jpg`, { type: 'image/jpeg' })
      const previewUrl = URL.createObjectURL(blob)
      const frame: SmartScanFrame = {
        id: crypto.randomUUID(),
        file,
        previewUrl,
        capturedAt: new Date().toISOString(),
        zones,
        validation: val,
        angle,
      }
      setFrames(prev => {
        const existing = prev.find(f => f.angle === angle)
        if (existing && existing.validation.confidence >= val.confidence) return prev
        return [...prev.filter(f => f.angle !== angle), frame]
      })
      setFlashVisible(true)
      setTimeout(() => setFlashVisible(false), 140)
      if (navigator.vibrate) navigator.vibrate(40)
    }, 'image/jpeg', 0.88)
  }, [])

  const handleManualCapture = useCallback(() => {
    const val: SubjectValidation = validation ?? {
      hasDeer: true, hasRack: true, isSharp: true, isClipped: false,
      brightnessOk: true, confidence: 0.7, rejectionReason: null,
    }
    const zones = detectCoverageZones(val, angleHint)
    stableRef.current = 999
    captureFrameAsync(angleHint, zones, val)
  }, [validation, angleHint, captureFrameAsync])

  const handleRemoveFrame = useCallback((id: string) => {
    setFrames(prev => prev.filter(f => f.id !== id))
    stableRef.current = 0
  }, [])

  const handleFlipCamera = useCallback(() => {
    setFacingMode(prev => prev === 'environment' ? 'user' : 'environment')
    setIsStreaming(false)
  }, [])

  const handleReset = useCallback(() => {
    frames.forEach(f => URL.revokeObjectURL(f.previewUrl))
    setFrames([])
    stableRef.current = 0
    lastAutoRef.current = 0
    setAngleHint('front')
  }, [frames])

  const handleFinalize = useCallback(() => {
    if (frames.length === 0) {
      toast.error('Capture at least one view to continue')
      return
    }
    const { files, angles } = framesToLegacySlots(frames)
    if (files.length === 0) {
      toast.error('No valid frames captured')
      return
    }
    onFilesReady(files, angles)
  }, [frames, onFilesReady])

  const satisfied = progress.satisfied || frames.length >= 3
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
          <button
            type="button"
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 text-white w-full"
            onClick={() => startCamera(facingMode)}
          >
            <Camera className="h-10 w-10 opacity-50" />
            <p className="text-sm text-center px-6">{cameraError}</p>
            <p className="text-xs text-white/50">Tap to retry</p>
          </button>
        )}

        {/* Coverage ring overlay */}
        {isStreaming && !cameraError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <div className="relative" style={{ width: 180, height: 180 }}>
              <CoverageRing progress={progress} size={180} />
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
                <span className="text-2xl font-bold text-white tabular-nums">
                  {progress.percent}%
                </span>
                <span className="text-[11px] text-white/60 font-medium">coverage</span>
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

      {/* Angle hint selector */}
      {!satisfied && (
        <div className="flex gap-1.5">
          {(['front', 'left', 'right'] as ScanAngle[]).map(angle => {
            const zoneMap: Record<ScanAngle, keyof typeof progress.zones> = {
              front: 'full_rack',
              left: 'left_antler',
              right: 'right_antler',
            }
            const done   = progress.zones[zoneMap[angle]]
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
