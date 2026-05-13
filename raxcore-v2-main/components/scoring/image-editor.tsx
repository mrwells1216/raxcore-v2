'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { RotateCw, RotateCcw, Crop, Check, X, ZoomIn, ZoomOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

interface ImageEditorProps {
  imageUrl: string
  isOpen: boolean
  onClose: () => void
  onSave: (editedImageUrl: string) => void
}

interface CropArea {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Image editor with crop and rotate functionality.
 * Uses canvas for all transformations.
 */
export function ImageEditor({ imageUrl, isOpen, onClose, onSave }: ImageEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const [rotation, setRotation] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [isCropping, setIsCropping] = useState(false)
  const [cropStart, setCropStart] = useState<{ x: number; y: number } | null>(null)
  const [cropArea, setCropArea] = useState<CropArea | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  // Load image when URL changes
  useEffect(() => {
    if (!imageUrl) return

    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      setImage(img)
      setRotation(0)
      setZoom(1)
      setCropArea(null)
    }
    img.src = imageUrl
  }, [imageUrl])

  // Draw image to canvas with current transformations
  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx || !image) return

    const container = containerRef.current
    if (!container) return

    // Calculate display dimensions
    const maxWidth = container.clientWidth - 32
    const maxHeight = container.clientHeight - 100

    // Account for rotation when calculating dimensions
    const isRotated90 = rotation === 90 || rotation === 270
    const imgWidth = isRotated90 ? image.height : image.width
    const imgHeight = isRotated90 ? image.width : image.height

    const scale = Math.min(maxWidth / imgWidth, maxHeight / imgHeight, 1)
    const displayWidth = imgWidth * scale * zoom
    const displayHeight = imgHeight * scale * zoom

    canvas.width = displayWidth
    canvas.height = displayHeight

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // Apply transformations
    ctx.save()
    ctx.translate(canvas.width / 2, canvas.height / 2)
    ctx.rotate((rotation * Math.PI) / 180)

    // Draw image centered
    const drawWidth = isRotated90 ? displayHeight : displayWidth
    const drawHeight = isRotated90 ? displayWidth : displayHeight
    ctx.drawImage(image, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight)

    ctx.restore()

    // Draw crop overlay if cropping
    if (isCropping && cropArea) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'
      
      // Draw overlay around crop area
      ctx.fillRect(0, 0, canvas.width, cropArea.y)
      ctx.fillRect(0, cropArea.y, cropArea.x, cropArea.height)
      ctx.fillRect(cropArea.x + cropArea.width, cropArea.y, canvas.width - cropArea.x - cropArea.width, cropArea.height)
      ctx.fillRect(0, cropArea.y + cropArea.height, canvas.width, canvas.height - cropArea.y - cropArea.height)

      // Draw crop border
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 2
      ctx.setLineDash([5, 5])
      ctx.strokeRect(cropArea.x, cropArea.y, cropArea.width, cropArea.height)

      // Draw corner handles
      ctx.fillStyle = '#fff'
      const handleSize = 10
      const corners = [
        { x: cropArea.x, y: cropArea.y },
        { x: cropArea.x + cropArea.width, y: cropArea.y },
        { x: cropArea.x, y: cropArea.y + cropArea.height },
        { x: cropArea.x + cropArea.width, y: cropArea.y + cropArea.height },
      ]
      corners.forEach(corner => {
        ctx.fillRect(corner.x - handleSize / 2, corner.y - handleSize / 2, handleSize, handleSize)
      })
    }
  }, [image, rotation, zoom, isCropping, cropArea])

  // Redraw when dependencies change
  useEffect(() => {
    drawCanvas()
  }, [drawCanvas])

  // Handle rotation
  const handleRotateRight = () => {
    setRotation((r) => (r + 90) % 360)
  }

  const handleRotateLeft = () => {
    setRotation((r) => (r - 90 + 360) % 360)
  }

  // Handle zoom
  const handleZoomIn = () => {
    setZoom((z) => Math.min(z + 0.25, 3))
  }

  const handleZoomOut = () => {
    setZoom((z) => Math.max(z - 0.25, 0.5))
  }

  // Handle crop start
  const handleCropStart = () => {
    setIsCropping(true)
    const canvas = canvasRef.current
    if (canvas) {
      // Default crop area to center 80% of image
      const padding = 0.1
      setCropArea({
        x: canvas.width * padding,
        y: canvas.height * padding,
        width: canvas.width * (1 - 2 * padding),
        height: canvas.height * (1 - 2 * padding),
      })
    }
  }

  // Handle mouse events for crop selection
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isCropping) return

    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    setCropStart({ x, y })
    setIsDragging(true)
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isCropping || !isDragging || !cropStart) return

    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const x = Math.max(0, Math.min(e.clientX - rect.left, canvas.width))
    const y = Math.max(0, Math.min(e.clientY - rect.top, canvas.height))

    setCropArea({
      x: Math.min(cropStart.x, x),
      y: Math.min(cropStart.y, y),
      width: Math.abs(x - cropStart.x),
      height: Math.abs(y - cropStart.y),
    })
  }

  const handleMouseUp = () => {
    setIsDragging(false)
  }

  // Handle touch events for mobile
  const handleTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (!isCropping) return
    e.preventDefault()

    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const touch = e.touches[0]
    const x = touch.clientX - rect.left
    const y = touch.clientY - rect.top

    setCropStart({ x, y })
    setIsDragging(true)
  }

  const handleTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (!isCropping || !isDragging || !cropStart) return
    e.preventDefault()

    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const touch = e.touches[0]
    const x = Math.max(0, Math.min(touch.clientX - rect.left, canvas.width))
    const y = Math.max(0, Math.min(touch.clientY - rect.top, canvas.height))

    setCropArea({
      x: Math.min(cropStart.x, x),
      y: Math.min(cropStart.y, y),
      width: Math.abs(x - cropStart.x),
      height: Math.abs(y - cropStart.y),
    })
  }

  const handleTouchEnd = () => {
    setIsDragging(false)
  }

  // Apply crop and save
  const handleApplyCrop = () => {
    if (!cropArea || !canvasRef.current) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Create a new canvas with cropped dimensions
    const croppedCanvas = document.createElement('canvas')
    croppedCanvas.width = cropArea.width
    croppedCanvas.height = cropArea.height
    const croppedCtx = croppedCanvas.getContext('2d')
    if (!croppedCtx) return

    // Copy cropped region
    croppedCtx.drawImage(
      canvas,
      cropArea.x,
      cropArea.y,
      cropArea.width,
      cropArea.height,
      0,
      0,
      cropArea.width,
      cropArea.height
    )

    // Update the main canvas with cropped result
    canvas.width = cropArea.width
    canvas.height = cropArea.height
    ctx.drawImage(croppedCanvas, 0, 0)

    setIsCropping(false)
    setCropArea(null)
  }

  // Cancel crop
  const handleCancelCrop = () => {
    setIsCropping(false)
    setCropArea(null)
    drawCanvas()
  }

  // Save edited image
  const handleSave = () => {
    const canvas = canvasRef.current
    if (!canvas) return

    // Export as data URL
    const editedUrl = canvas.toDataURL('image/jpeg', 0.9)
    onSave(editedUrl)
    onClose()
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[95vw] md:max-w-3xl max-h-[90vh] p-0 overflow-hidden">
        <DialogHeader className="p-4 pb-2">
          <DialogTitle>Edit Image</DialogTitle>
        </DialogHeader>

        <div 
          ref={containerRef}
          className="relative flex-1 min-h-[300px] max-h-[60vh] flex items-center justify-center bg-muted p-4"
        >
          <canvas
            ref={canvasRef}
            className={cn(
              'max-w-full max-h-full rounded-lg shadow-lg',
              isCropping && 'cursor-crosshair'
            )}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          />
        </div>

        {/* Zoom slider */}
        <div className="px-4 py-2 flex items-center gap-4">
          <ZoomOut className="h-4 w-4 text-muted-foreground" />
          <Slider
            value={[zoom]}
            min={0.5}
            max={3}
            step={0.1}
            onValueChange={([value]) => setZoom(value)}
            className="flex-1"
          />
          <ZoomIn className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground w-12 text-right">
            {Math.round(zoom * 100)}%
          </span>
        </div>

        {/* Controls */}
        <div className="p-4 pt-2 flex flex-wrap items-center justify-between gap-2 border-t">
          <div className="flex items-center gap-2">
            {isCropping ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCancelCrop}
                  className="min-h-[44px]"
                >
                  <X className="h-4 w-4 mr-1" />
                  Cancel
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  onClick={handleApplyCrop}
                  disabled={!cropArea || cropArea.width < 10 || cropArea.height < 10}
                  className="min-h-[44px]"
                >
                  <Check className="h-4 w-4 mr-1" />
                  Apply Crop
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRotateLeft}
                  className="min-h-[44px]"
                >
                  <RotateCcw className="h-4 w-4 mr-1" />
                  <span className="hidden sm:inline">Rotate Left</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRotateRight}
                  className="min-h-[44px]"
                >
                  <RotateCw className="h-4 w-4 mr-1" />
                  <span className="hidden sm:inline">Rotate Right</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCropStart}
                  className="min-h-[44px]"
                >
                  <Crop className="h-4 w-4 mr-1" />
                  <span className="hidden sm:inline">Crop</span>
                </Button>
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="min-h-[44px]"
            >
              Cancel
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={handleSave}
              disabled={isCropping}
              className="min-h-[44px]"
            >
              <Check className="h-4 w-4 mr-1" />
              Save Changes
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
