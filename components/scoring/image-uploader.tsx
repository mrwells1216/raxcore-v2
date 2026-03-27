'use client'

import { useCallback, useState } from 'react'
import { Upload, ImagePlus, AlertCircle, Eye, Camera, Sun, Focus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { SUPPORTED_IMAGE_TYPES, MAX_FILE_SIZE, MAX_IMAGES, ANGLE_TYPES } from '@/lib/constants'
import type { AngleType } from '@/lib/types'

interface CapturedImage {
  id: string
  url: string
  file?: File
  angleType: AngleType
  width: number
  height: number
}

interface ImageUploaderProps {
  onUpload: (images: CapturedImage[]) => void
}

export function ImageUploader({ onUpload }: ImageUploaderProps) {
  const [dragActive, setDragActive] = useState(false)
  const [defaultAngle, setDefaultAngle] = useState<AngleType>('front')
  const [error, setError] = useState<string | null>(null)

  const processFiles = useCallback(async (files: FileList | File[]) => {
    setError(null)
    const fileArray = Array.from(files)
    
    // Validate
    const validFiles = fileArray.filter(file => {
      if (!SUPPORTED_IMAGE_TYPES.includes(file.type as typeof SUPPORTED_IMAGE_TYPES[number])) {
        setError(`${file.name} is not a supported format`)
        return false
      }
      if (file.size > MAX_FILE_SIZE) {
        setError(`${file.name} exceeds 20MB limit`)
        return false
      }
      return true
    }).slice(0, MAX_IMAGES)

    if (validFiles.length === 0) return

    // Process each file
    const processedImages: CapturedImage[] = await Promise.all(
      validFiles.map(async (file, index) => {
        return new Promise<CapturedImage>((resolve) => {
          const reader = new FileReader()
          reader.onload = (e) => {
            const img = new Image()
            img.crossOrigin = 'anonymous'
            img.onload = () => {
              // Determine angle type based on index if multiple files
              let angle: AngleType = defaultAngle
              if (validFiles.length > 1) {
                const angles: AngleType[] = ['front', 'left', 'right', 'back', 'other']
                angle = angles[index] || 'other'
              }

              resolve({
                id: crypto.randomUUID(),
                url: e.target?.result as string,
                file,
                angleType: angle,
                width: img.width,
                height: img.height,
              })
            }
            img.src = e.target?.result as string
          }
          reader.readAsDataURL(file)
        })
      })
    )

    onUpload(processedImages)
  }, [defaultAngle, onUpload])

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true)
    } else if (e.type === 'dragleave') {
      setDragActive(false)
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files)
    }
  }, [processFiles])

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFiles(e.target.files)
      e.target.value = '' // Reset input
    }
  }, [processFiles])

  return (
    <div className="space-y-4">
      {/* Default angle for single uploads */}
      <div className="space-y-2">
        <Label>Default Photo Angle (for single uploads)</Label>
        <Select value={defaultAngle} onValueChange={(v) => setDefaultAngle(v as AngleType)}>
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
      </div>

      {/* Drop zone */}
      <div
        className={`relative border-2 border-dashed rounded-lg transition-colors ${
          dragActive 
            ? 'border-primary bg-primary/5' 
            : 'border-border hover:border-primary/50'
        }`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        <input
          type="file"
          accept={SUPPORTED_IMAGE_TYPES.join(',')}
          multiple
          onChange={handleFileInput}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />
        
        <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-secondary mb-4">
            {dragActive ? (
              <ImagePlus className="h-7 w-7 text-primary" />
            ) : (
              <Upload className="h-7 w-7 text-muted-foreground" />
            )}
          </div>
          <p className="text-sm font-medium mb-1">
            {dragActive ? 'Drop images here' : 'Drag & drop images here'}
          </p>
          <p className="text-xs text-muted-foreground mb-4">
            or click to browse
          </p>
          <Button variant="outline" size="sm" className="min-h-[44px]" asChild>
            <span>
              <Upload className="h-4 w-4 mr-2" />
              Select Files
            </span>
          </Button>
          <p className="text-xs text-muted-foreground mt-4">
            JPG, PNG, WebP up to 20MB each
          </p>
        </div>
      </div>

      {/* Upload Guidance Tips */}
      <UploadGuidanceTips />

      {/* Error message */}
      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}
    </div>
  )
}

// Upload guidance tips component
function UploadGuidanceTips() {
  const tips = [
    { icon: Camera, text: 'Include front + side angles', highlight: true },
    { icon: Eye, text: 'Keep both ears visible', highlight: true },
    { icon: Focus, text: 'Sharp, in-focus photos', highlight: false },
    { icon: Sun, text: 'Good lighting, avoid shadows', highlight: false },
  ]

  return (
    <div className="p-3 rounded-lg bg-secondary/30 border border-border">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
        For best results
      </p>
      <div className="grid grid-cols-2 gap-2">
        {tips.map((tip, i) => (
          <div 
            key={i}
            className={`flex items-center gap-2 text-xs ${tip.highlight ? 'text-primary font-medium' : 'text-muted-foreground'}`}
          >
            <tip.icon className="h-3.5 w-3.5 shrink-0" />
            <span>{tip.text}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
