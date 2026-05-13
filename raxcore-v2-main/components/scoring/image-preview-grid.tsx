'use client'

import { X, CheckCircle2, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { AngleType } from '@/lib/types'
import { cn } from '@/lib/utils'

interface CapturedImage {
  id: string
  url: string
  file?: File
  angleType: AngleType
  width: number
  height: number
}

interface ImagePreviewGridProps {
  images: CapturedImage[]
  onRemove: (id: string) => void
}

const ANGLE_LABELS: Record<AngleType, string> = {
  front: 'Front',
  left: 'Left',
  right: 'Right',
  back: 'Back',
  other: 'Other',
}

const RECOMMENDED_ANGLES: AngleType[] = ['front', 'left', 'right']

export function ImagePreviewGrid({ images, onRemove }: ImagePreviewGridProps) {
  const capturedAngles = images.map(img => img.angleType)
  const hasFront = capturedAngles.includes('front')
  const hasLeftOrRight = capturedAngles.includes('left') || capturedAngles.includes('right')
  const coverageLevel = 
    images.length >= 3 && hasFront && hasLeftOrRight ? 'excellent' :
    images.length >= 2 && (hasFront || hasLeftOrRight) ? 'good' :
    'minimal'

  return (
    <div className="space-y-3">
      {/* Header with coverage indicator */}
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">
          Added Images ({images.length})
        </h4>
        <Badge 
          variant="outline"
          className={cn(
            "text-xs",
            coverageLevel === 'excellent' && "bg-primary/10 text-primary border-primary/30",
            coverageLevel === 'good' && "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
            coverageLevel === 'minimal' && "bg-secondary"
          )}
        >
          {coverageLevel === 'excellent' ? (
            <><CheckCircle2 className="h-3 w-3 mr-1" />Excellent coverage</>
          ) : coverageLevel === 'good' ? (
            'Good coverage'
          ) : (
            'Needs more angles'
          )}
        </Badge>
      </div>
      
      {/* Image grid - responsive sizing */}
      <div className="grid grid-cols-3 gap-2">
        {images.map((image) => (
          <div 
            key={image.id} 
            className="relative aspect-square rounded-lg overflow-hidden bg-secondary group"
          >
            <img
              src={image.url}
              alt={`${image.angleType} view`}
              className="w-full h-full object-cover"
            />
            
            {/* Angle badge */}
            <div className="absolute bottom-1 left-1">
              <Badge 
                variant="secondary" 
                className={cn(
                  "text-[10px] px-1.5 py-0 bg-background/80 backdrop-blur-sm",
                  RECOMMENDED_ANGLES.includes(image.angleType) && "bg-primary/80 text-primary-foreground"
                )}
              >
                {ANGLE_LABELS[image.angleType]}
              </Badge>
            </div>
            
            {/* Remove button - always visible on mobile */}
            <Button
              variant="destructive"
              size="icon"
              className="absolute top-1 right-1 h-7 w-7 sm:h-6 sm:w-6 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
              onClick={() => onRemove(image.id)}
            >
              <X className="h-3.5 w-3.5 sm:h-3 sm:w-3" />
            </Button>
          </div>
        ))}
      </div>
      
      {/* Missing angles hint */}
      {images.length < 3 && (
        <div className="flex items-start gap-2 p-2 rounded-lg bg-amber-500/5 border border-amber-500/20">
          <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="text-xs text-amber-700 dark:text-amber-300">
            <p className="font-medium">Better accuracy with more angles</p>
            <p className="text-amber-600 dark:text-amber-400">
              Missing: {!hasFront && 'Front'} 
              {!hasFront && !capturedAngles.includes('left') && ', '}
              {!capturedAngles.includes('left') && 'Left side'}
              {(!hasFront || !capturedAngles.includes('left')) && !capturedAngles.includes('right') && ', '}
              {!capturedAngles.includes('right') && 'Right side'}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
