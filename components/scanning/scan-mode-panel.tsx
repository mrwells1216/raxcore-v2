'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Camera, Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  createEmptyScanSlots,
  buildScanCoverageSummary,
  type ScanAngle,
  type ScanCaptureSlot,
} from '@/lib/capture/scan-session'
import { toast } from 'sonner'

interface ScanModePanelProps {
  onFilesReady: (files: File[], angles: ScanAngle[]) => void
}

export function ScanModePanel({ onFilesReady }: ScanModePanelProps) {
  const [slots, setSlots] = useState<ScanCaptureSlot[]>(createEmptyScanSlots)
  const [selectedAngle, setSelectedAngle] = useState<ScanAngle>('front')
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [isCapturing, setIsCapturing] = useState(false)

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const coverage = buildScanCoverageSummary(slots)

  // Start camera stream
  useEffect(() => {
    let mounted = true

    async function startCamera() {
      try {
        const mediaStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
        })
        if (mounted && videoRef.current) {
          videoRef.current.srcObject = mediaStream
          setStream(mediaStream)
        }
      } catch (error) {
        console.error('[scan-mode] camera access failed:', error)
        toast.error('Camera access denied. Please allow camera access to use scan mode.')
      }
    }

    startCamera()

    return () => {
      mounted = false
      if (stream) {
        stream.getTracks().forEach((track) => track.stop())
      }
    }
  }, [])

  // Stop stream when unmounting
  useEffect(() => {
    return () => {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop())
      }
    }
  }, [stream])

  const captureFrame = useCallback(async (angle: ScanAngle) => {
    if (!videoRef.current || !canvasRef.current) return

    setIsCapturing(true)

    const video = videoRef.current
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Set canvas size to match video
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight

    // Draw current frame
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

    // Convert to blob then file
    canvas.toBlob((blob) => {
      if (!blob) {
        toast.error('Failed to capture frame')
        setIsCapturing(false)
        return
      }

      const file = new File([blob], `scan-${angle}.jpg`, { type: 'image/jpeg' })
      const previewUrl = URL.createObjectURL(blob)

      setSlots((prev) =>
        prev.map((slot) =>
          slot.angle === angle
            ? { ...slot, file, previewUrl, capturedAt: new Date().toISOString() }
            : slot
        )
      )

      toast.success(`${angle.charAt(0).toUpperCase() + angle.slice(1)} view captured`)
      setIsCapturing(false)
    }, 'image/jpeg', 0.9)
  }, [])

  const handleCapture = useCallback(() => {
    captureFrame(selectedAngle)
  }, [selectedAngle, captureFrame])

  const handleRecapture = useCallback((angle: ScanAngle) => {
    setSlots((prev) =>
      prev.map((slot) => {
        if (slot.angle === angle && slot.previewUrl) {
          URL.revokeObjectURL(slot.previewUrl)
        }
        return slot.angle === angle
          ? { ...slot, file: null, previewUrl: null, capturedAt: null }
          : slot
      })
    )
    setSelectedAngle(angle)
  }, [])

  const handleFinalize = useCallback(() => {
    const files = slots.map((s) => s.file).filter(Boolean) as File[]
    const angles = slots.filter((s) => s.file).map((s) => s.angle)

    if (files.length !== 3 || angles.length !== 3) {
      toast.error('Please capture all three views before continuing')
      return
    }

    onFilesReady(files, angles)
  }, [slots, onFilesReady])

  return (
    <div className="space-y-4">
      {/* Camera Preview */}
      <Card className="overflow-hidden bg-black">
        <div className="relative aspect-[4/3]">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
          />

          {/* Selected angle guide overlay */}
          <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-black/70 backdrop-blur-sm text-white px-4 py-2 rounded-full text-sm font-medium">
            {selectedAngle === 'front' && 'Center the rack straight on'}
            {selectedAngle === 'left' && 'Rotate to show the left side clearly'}
            {selectedAngle === 'right' && 'Rotate to show the right side clearly'}
          </div>

          {/* Capture button */}
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2">
            <Button
              size="lg"
              onClick={handleCapture}
              disabled={isCapturing || !stream}
              className="rounded-full h-16 w-16 p-0 bg-white hover:bg-white/90 text-black shadow-lg"
            >
              <Camera className="h-6 w-6" />
            </Button>
          </div>
        </div>
      </Card>

      {/* Hidden canvas for capture */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Angle selector chips */}
      <div className="flex gap-2 justify-center">
        {(['front', 'left', 'right'] as ScanAngle[]).map((angle) => {
          const slot = slots.find((s) => s.angle === angle)
          const isCaptured = Boolean(slot?.file)
          const isSelected = selectedAngle === angle

          return (
            <button
              key={angle}
              onClick={() => setSelectedAngle(angle)}
              className={`
                px-4 py-2 rounded-lg font-medium text-sm transition-all
                ${
                  isCaptured
                    ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200 border-2 border-green-500'
                    : isSelected
                    ? 'bg-primary text-primary-foreground border-2 border-primary'
                    : 'bg-secondary text-secondary-foreground border-2 border-border hover:bg-secondary/80'
                }
              `}
            >
              <div className="flex items-center gap-2">
                {isCaptured && <Check className="h-4 w-4" />}
                {angle.charAt(0).toUpperCase() + angle.slice(1)}
              </div>
            </button>
          )
        })}
      </div>

      {/* Slot previews */}
      <div className="grid grid-cols-3 gap-3">
        {slots.map((slot) => (
          <div key={slot.angle} className="space-y-2">
            <div className="text-xs font-medium text-center capitalize text-muted-foreground">
              {slot.angle}
            </div>
            <div className="relative aspect-square bg-secondary rounded-lg overflow-hidden border-2 border-border">
              {slot.previewUrl ? (
                <>
                  <img
                    src={slot.previewUrl}
                    alt={`${slot.angle} view`}
                    className="w-full h-full object-cover"
                  />
                  <button
                    onClick={() => handleRecapture(slot.angle)}
                    className="absolute top-1 right-1 bg-black/60 hover:bg-black/80 text-white rounded-full p-1"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </>
              ) : (
                <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                  <Camera className="h-6 w-6" />
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Coverage status */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Coverage</span>
          <span
            className={`text-xs font-semibold px-2 py-1 rounded-full ${
              coverage.coverageLabel === 'strong'
                ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200'
                : coverage.coverageLabel === 'partial'
                ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-200'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200'
            }`}
          >
            {coverage.coverageLabel}
          </span>
        </div>

        <div className="text-xs text-muted-foreground">{coverage.recommendationReason}</div>

        {coverage.missingAngles.length > 0 && (
          <div className="text-xs">
            <span className="font-medium">Still needed:</span>{' '}
            {coverage.missingAngles.join(', ')}
          </div>
        )}

        {coverage.satisfied && (
          <Button onClick={handleFinalize} className="w-full">
            Continue with These Photos
          </Button>
        )}

        {!coverage.satisfied && (
          <Button disabled className="w-full">
            Capture all three views to continue
          </Button>
        )}
      </Card>
    </div>
  )
}
