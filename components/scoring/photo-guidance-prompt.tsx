'use client'

import { useState } from 'react'
import { Camera, X, ChevronRight, Lightbulb, ArrowRight, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { NextPhotoGuidanceSummary, AngleType, MeasurementFamily } from '@/lib/types'

interface PhotoGuidancePromptProps {
  guidance: NextPhotoGuidanceSummary
  onAddPhoto?: (angle: AngleType | null) => void
  onDismiss?: () => void
  variant?: 'inline' | 'modal' | 'banner'
  className?: string
}

export function PhotoGuidancePrompt({
  guidance,
  onAddPhoto,
  onDismiss,
  variant = 'inline',
  className,
}: PhotoGuidancePromptProps) {
  const [isDismissed, setIsDismissed] = useState(false)

  if (!guidance.shouldAsk || isDismissed) {
    return null
  }

  const handleDismiss = () => {
    setIsDismissed(true)
    onDismiss?.()
  }

  const handleAddPhoto = () => {
    onAddPhoto?.(guidance.recommendedAngle)
  }

  const benefitConfig = getBenefitConfig(guidance.estimatedBenefit)
  const isUrgent = guidance.decision === 'strongly_recommend_before_finalize'

  if (variant === 'banner') {
    return (
      <div className={cn(
        "p-3 rounded-lg border flex items-center justify-between gap-4",
        isUrgent 
          ? "bg-amber-500/10 border-amber-500/30" 
          : "bg-primary/5 border-primary/20",
        className
      )}>
        <div className="flex items-center gap-3 min-w-0">
          <div className={cn(
            "flex h-8 w-8 items-center justify-center rounded-full shrink-0",
            isUrgent ? "bg-amber-500/20" : "bg-primary/10"
          )}>
            {isUrgent ? (
              <AlertTriangle className={cn("h-4 w-4", isUrgent ? "text-amber-600 dark:text-amber-400" : "text-primary")} />
            ) : (
              <Lightbulb className="h-4 w-4 text-primary" />
            )}
          </div>
          <div className="min-w-0">
            <p className={cn(
              "text-sm font-medium truncate",
              isUrgent ? "text-amber-700 dark:text-amber-300" : "text-foreground"
            )}>
              {guidance.userMessage}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {guidance.userReason}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDismiss}
            className="text-muted-foreground hover:text-foreground"
          >
            Skip
          </Button>
          <Button
            size="sm"
            onClick={handleAddPhoto}
            className={cn(
              "gap-1.5",
              isUrgent && "bg-amber-600 hover:bg-amber-700 text-white"
            )}
          >
            <Camera className="h-3.5 w-3.5" />
            Add Photo
          </Button>
        </div>
      </div>
    )
  }

  if (variant === 'modal') {
    return (
      <Card className={cn(
        "overflow-hidden",
        isUrgent ? "border-amber-500/50" : "border-primary/30",
        className
      )}>
        <CardContent className="p-6">
          <div className="flex flex-col items-center text-center gap-4">
            <div className={cn(
              "flex h-14 w-14 items-center justify-center rounded-full",
              isUrgent ? "bg-amber-500/20" : "bg-primary/10"
            )}>
              {isUrgent ? (
                <AlertTriangle className="h-7 w-7 text-amber-600 dark:text-amber-400" />
              ) : (
                <Camera className="h-7 w-7 text-primary" />
              )}
            </div>
            
            <div className="space-y-2">
              <h3 className="text-lg font-semibold">
                {isUrgent 
                  ? 'One More Photo Could Significantly Improve Accuracy'
                  : 'Want a Tighter Estimate?'}
              </h3>
              <p className="text-muted-foreground">
                {guidance.userMessage}
              </p>
              <p className="text-sm text-muted-foreground">
                {guidance.userReason}
              </p>
            </div>

            {guidance.targetFamily && (
              <Badge variant="secondary" className="text-xs">
                Would improve {formatFamily(guidance.targetFamily)} measurement
              </Badge>
            )}

            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Expected improvement:</span>
              <Badge 
                variant="outline" 
                className={cn("text-xs", benefitConfig.color)}
              >
                {benefitConfig.label} (+{guidance.expectedConfidenceImprovement}% confidence)
              </Badge>
            </div>

            <div className="flex gap-3 w-full mt-2">
              <Button
                variant="outline"
                onClick={handleDismiss}
                className="flex-1"
              >
                Continue Without
              </Button>
              <Button
                onClick={handleAddPhoto}
                className={cn(
                  "flex-1 gap-2",
                  isUrgent && "bg-amber-600 hover:bg-amber-700 text-white"
                )}
              >
                <Camera className="h-4 w-4" />
                Add Photo
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  // Default inline variant
  return (
    <div className={cn(
      "p-4 rounded-lg border space-y-3",
      isUrgent 
        ? "bg-amber-500/10 border-amber-500/30" 
        : "bg-primary/5 border-primary/20",
      className
    )}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className={cn(
            "flex h-9 w-9 items-center justify-center rounded-full shrink-0 mt-0.5",
            isUrgent ? "bg-amber-500/20" : "bg-primary/10"
          )}>
            {isUrgent ? (
              <AlertTriangle className="h-4.5 w-4.5 text-amber-600 dark:text-amber-400" />
            ) : (
              <Lightbulb className="h-4.5 w-4.5 text-primary" />
            )}
          </div>
          <div>
            <p className={cn(
              "font-medium",
              isUrgent ? "text-amber-700 dark:text-amber-300" : "text-foreground"
            )}>
              {isUrgent ? 'Additional Photo Recommended' : 'Photo Tip'}
            </p>
            <p className="text-sm text-muted-foreground mt-0.5">
              {guidance.userMessage}
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 h-8 w-8 text-muted-foreground hover:text-foreground"
          onClick={handleDismiss}
        >
          <X className="h-4 w-4" />
          <span className="sr-only">Dismiss</span>
        </Button>
      </div>

      <div className="pl-12 space-y-3">
        <p className="text-xs text-muted-foreground">
          {guidance.userReason}
        </p>

        <div className="flex items-center flex-wrap gap-2">
          {guidance.recommendedAngle && (
            <Badge variant="secondary" className="text-xs">
              {formatAngle(guidance.recommendedAngle)} angle
            </Badge>
          )}
          {guidance.targetFamily && (
            <Badge variant="outline" className="text-xs">
              Improves {formatFamily(guidance.targetFamily)}
            </Badge>
          )}
          <Badge 
            variant="outline" 
            className={cn("text-xs", benefitConfig.color)}
          >
            {benefitConfig.label} benefit
          </Badge>
        </div>

        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleDismiss}
          >
            Skip for now
          </Button>
          <Button
            size="sm"
            onClick={handleAddPhoto}
            className={cn(
              "gap-1.5",
              isUrgent && "bg-amber-600 hover:bg-amber-700 text-white"
            )}
          >
            <Camera className="h-3.5 w-3.5" />
            Add Photo
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  )
}

// Compact inline badge version
interface PhotoGuidanceBadgeProps {
  guidance: NextPhotoGuidanceSummary
  onClick?: () => void
}

export function PhotoGuidanceBadge({ guidance, onClick }: PhotoGuidanceBadgeProps) {
  if (!guidance.shouldAsk) {
    return null
  }

  const isUrgent = guidance.decision === 'strongly_recommend_before_finalize'

  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors",
        isUrgent
          ? "bg-amber-500/20 text-amber-700 dark:text-amber-300 hover:bg-amber-500/30"
          : "bg-primary/10 text-primary hover:bg-primary/20"
      )}
    >
      <Camera className="h-3 w-3" />
      <span>{isUrgent ? 'Photo recommended' : 'Add photo?'}</span>
      <ChevronRight className="h-3 w-3" />
    </button>
  )
}

// Utility functions
function getBenefitConfig(benefit: 'high' | 'medium' | 'low' | 'minimal'): {
  label: string
  color: string
} {
  switch (benefit) {
    case 'high':
      return { label: 'High', color: 'text-primary border-primary/30' }
    case 'medium':
      return { label: 'Medium', color: 'text-amber-600 dark:text-amber-400 border-amber-500/30' }
    case 'low':
      return { label: 'Low', color: 'text-muted-foreground border-border' }
    case 'minimal':
      return { label: 'Minimal', color: 'text-muted-foreground border-border' }
  }
}

function formatFamily(family: MeasurementFamily): string {
  return family.charAt(0).toUpperCase() + family.slice(1)
}

function formatAngle(angle: AngleType): string {
  switch (angle) {
    case 'front': return 'Front'
    case 'left': return 'Left side'
    case 'right': return 'Right side'
    case 'back': return 'Back'
    default: return 'Additional'
  }
}
