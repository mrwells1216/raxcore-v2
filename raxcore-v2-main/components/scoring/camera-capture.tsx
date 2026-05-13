'use client'

import { useRef, useState, useCallback, useEffect } from 'react'
import { Camera, SwitchCamera, X, Check, RefreshCw, Eye, Maximize2, Sun, Focus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { ANGLE_TYPES } from '@/lib/constants'
import { cn } from '@/lib/utils'
import type { AngleType } from '@/lib/types'

interface CapturedImage {
  id: string
  url: string
  file?: File
  angleType: AngleType
  width: number
  height: number
}

interface CameraCaptureProps {
  onCapture: (image: CapturedImage) => void
}

export function CameraCapture({ onCapture }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  
  const [isStreaming, setIsStreaming] = useState(false)
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment')
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null)
  const [angleType, setAngleType] = useState<AngleType>('front')
  const [error, setError] = useState<string | null>(null)

  const startCamera = useCallback(async () => {
    try {
      setError(null)
      
      // Stop any existing stream
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop())
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode,
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      })

      streamRef.current = stream
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
        setIsStreaming(true)
      }
    } catch (err) {
      console.error('Camera error:', err)
      setError('Unable to access camera. Please check permissions.')
      setIsStreaming(false)
    }
  }, [facingMode])

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    setIsStreaming(false)
  }, [])

  const switchCamera = useCallback(() => {
    const newFacing = facingMode === 'environment' ? 'user' : 'environment'
    setFacingMode(newFacing)
  }, [facingMode])

  useEffect(() => {
    if (isStreaming) {
      startCamera()
    }
  }, [facingMode])

  useEffect(() => {
    return () => {
      stopCamera()
    }
  }, [stopCamera])

  const takePhoto = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return

    const video = videoRef.current
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    
    if (!ctx) return

    // Set canvas size to video size
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight

    // Draw video frame to canvas
    ctx.drawImage(video, 0, 0)

    // Get data URL with moderate quality (will be preprocessed further before upload)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8)
    setCapturedPhoto(dataUrl)
    stopCamera()
  }, [stopCamera])

  const confirmPhoto = useCallback(async () => {
    if (!capturedPhoto || !canvasRef.current) return

    // Convert data URL to blob
    const response = await fetch(capturedPhoto)
    const blob = await response.blob()
    const file = new File([blob], `capture-${Date.now()}.jpg`, { type: 'image/jpeg' })

    onCapture({
      id: crypto.randomUUID(),
      url: capturedPhoto,
      file,
      angleType,
      width: canvasRef.current.width,
      height: canvasRef.current.height,
    })

    setCapturedPhoto(null)
  }, [capturedPhoto, angleType, onCapture])

  const retakePhoto = useCallback(() => {
    setCapturedPhoto(null)
    startCamera()
  }, [startCamera])

  return (
    <div className="space-y-4">
      {/* Angle Selection */}
      <div className="space-y-2">
        <Label>Photo Angle</Label>
        <Select value={angleType} onValueChange={(v) => setAngleType(v as AngleType)}>
          <SelectTrigger className="min-h-[48px]">
            <SelectValue placeholder="Select angle" />
          </SelectTrigger>
          <SelectContent>
            {ANGLE_TYPES.map((type) => (
              <SelectItem key={type.value} value={type.value}>
                {type.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {angleType === 'front' && 'Center the full rack, keep both sides visible'}
          {angleType === 'left' && 'Show the left beam curvature and tine heights'}
          {angleType === 'right' && 'Show the right beam curvature and tine heights'}
          {angleType === 'back' && 'Rear view helps verify spread and symmetry'}
          {angleType === 'other' && 'Use for abnormal points or unique features'}
        </p>
      </div>

      {/* Camera/Preview Area */}
      <div className="relative aspect-[4/3] bg-secondary rounded-lg overflow-hidden">
        {/* Hidden canvas for capture */}
        <canvas ref={canvasRef} className="hidden" />
        
        {/* Video stream */}
        {!capturedPhoto && (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={`absolute inset-0 w-full h-full object-cover ${isStreaming ? '' : 'hidden'}`}
          />
        )}

        {/* Captured photo preview */}
        {capturedPhoto && (
          <img
            src={capturedPhoto}
            alt="Captured"
            className="absolute inset-0 w-full h-full object-cover"
          />
        )}

        {/* Live Capture Guidance Overlay */}
        {isStreaming && !capturedPhoto && (
          <CaptureGuidanceOverlay angleType={angleType} />
        )}

        {/* Placeholder when not streaming */}
        {!isStreaming && !capturedPhoto && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground">
            <Camera className="h-12 w-12 mb-2" />
            <p className="text-sm">Tap Start Camera to begin</p>
            {error && (
              <p className="text-sm text-destructive mt-2 px-4 text-center">{error}</p>
            )}
          </div>
        )}

        {/* Camera switch button */}
        {isStreaming && (
          <Button
            variant="secondary"
            size="icon"
            className="absolute top-3 right-3 h-10 w-10 rounded-full"
            onClick={switchCamera}
          >
            <SwitchCamera className="h-5 w-5" />
          </Button>
        )}
      </div>

      {/* Controls */}
      <div className="flex gap-3">
        {!capturedPhoto ? (
          <>
            {!isStreaming ? (
              <Button 
                onClick={startCamera} 
                className="flex-1 min-h-[48px] gap-2"
              >
                <Camera className="h-5 w-5" />
                Start Camera
              </Button>
            ) : (
              <>
                <Button 
                  variant="outline"
                  onClick={stopCamera} 
                  className="min-h-[48px]"
                >
                  <X className="h-5 w-5" />
                </Button>
                <Button 
                  onClick={takePhoto} 
                  className="flex-1 min-h-[48px] gap-2"
                >
                  <Camera className="h-5 w-5" />
                  Capture
                </Button>
              </>
            )}
          </>
        ) : (
          <>
            <Button 
              variant="outline"
              onClick={retakePhoto} 
              className="flex-1 min-h-[48px] gap-2"
            >
              <RefreshCw className="h-5 w-5" />
              Retake
            </Button>
        <Button 
          onClick={confirmPhoto} 
          className="flex-1 min-h-[48px] gap-2"
        >
          <Check className="h-5 w-5" />
          Use Photo
        </Button>
      </>
    )}
  </div>
</div>
)
}

// Capture guidance overlay component
function CaptureGuidanceOverlay({ angleType }: { angleType: AngleType }) {
  const guidance = CAPTURE_GUIDANCE[angleType] || CAPTURE_GUIDANCE.front

  return (
    <div className="absolute inset-0 pointer-events-none">
      {/* Top guidance bar */}
      <div className="absolute top-0 left-0 right-0 bg-gradient-to-b from-black/60 to-transparent p-3">
        <div className="flex items-center justify-center gap-2 text-white text-sm">
          <guidance.icon className="h-4 w-4" />
          <span className="font-medium">{guidance.title}</span>
        </div>
      </div>
      
      {/* Center framing guide */}
      <div className="absolute inset-8 border-2 border-white/30 rounded-lg">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white/20 backdrop-blur-sm px-2 py-0.5 rounded text-white text-xs">
          Center rack here
        </div>
      </div>
      
      {/* Bottom tips */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-3">
        <div className="flex flex-wrap items-center justify-center gap-2">
          {guidance.tips.map((tip, i) => (
            <span 
              key={i} 
              className="text-xs text-white/90 bg-white/20 backdrop-blur-sm px-2 py-1 rounded-full"
            >
              {tip}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

// Guidance configuration per angle type
const CAPTURE_GUIDANCE: Record<AngleType, {
  title: string
  icon: typeof Camera
  tips: string[]
}> = {
  front: {
    title: 'Front View',
    icon: Maximize2,
    tips: ['Center full rack', 'Both ears visible', 'Avoid tilt'],
  },
  left: {
    title: 'Left Side',
    icon: Eye,
    tips: ['Show left beam curve', 'Include ear for scale', 'Capture all tines'],
  },
  right: {
    title: 'Right Side',
    icon: Eye,
    tips: ['Show right beam curve', 'Include ear for scale', 'Capture all tines'],
  },
  back: {
    title: 'Back View',
    icon: Maximize2,
    tips: ['Show inside spread', 'Both beams visible', 'Level angle'],
  },
  other: {
    title: 'Additional Angle',
    icon: Camera,
    tips: ['Capture unique features', 'Good lighting', 'Sharp focus'],
  },
}
