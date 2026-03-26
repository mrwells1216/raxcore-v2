'use client'

import { useState } from 'react'
import { 
  Camera, 
  AlertTriangle, 
  CheckCircle2, 
  ChevronDown, 
  ChevronUp,
  Sun,
  Focus,
  Move,
  Eye,
  RotateCcw
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import type { AngleType } from '@/lib/types'

interface ImageGuidanceProps {
  capturedAngles: AngleType[]
  showTips?: boolean
  compact?: boolean
}

const ANGLE_GUIDANCE = {
  front: {
    label: 'Front View',
    description: 'Center the full rack, capture both antlers symmetrically',
    tips: ['Keep rack centered in frame', 'Capture both ear tips if visible', 'Level with the deer head'],
    priority: 1,
  },
  left: {
    label: 'Left 45 / Side',
    description: 'Angled view showing left beam depth and tine length',
    tips: ['Show full left beam curvature', 'Capture G1-G4 tine heights', 'Include ear for scale'],
    priority: 2,
  },
  right: {
    label: 'Right 45 / Side',
    description: 'Angled view showing right beam depth and tine length',
    tips: ['Show full right beam curvature', 'Capture G1-G4 tine heights', 'Include ear for scale'],
    priority: 2,
  },
  back: {
    label: 'Back View',
    description: 'Rear angle to verify spread and beam symmetry',
    tips: ['Shows inside spread clearly', 'Helps verify beam lengths', 'Optional but helpful'],
    priority: 3,
  },
  other: {
    label: 'Other Angle',
    description: 'Additional angle for detail or specific features',
    tips: ['Good for abnormal points', 'Mass measurements', 'Any unique features'],
    priority: 4,
  },
}

const CAPTURE_TIPS = [
  {
    icon: Focus,
    title: 'Keep it sharp',
    description: 'Ensure the rack is in focus, avoid blur',
  },
  {
    icon: Sun,
    title: 'Good lighting',
    description: 'Avoid heavy shadows or backlit conditions',
  },
  {
    icon: Move,
    title: 'Fill the frame',
    description: 'Get close enough that the rack fills most of the image',
  },
  {
    icon: Eye,
    title: 'Ears visible',
    description: 'Keep both ears in frame when possible for scaling reference',
  },
]

export function ImageGuidance({ capturedAngles, showTips = true, compact = false }: ImageGuidanceProps) {
  const [isExpanded, setIsExpanded] = useState(!compact)
  
  const hasAngle = (angle: AngleType) => capturedAngles.includes(angle)
  const coverage = capturedAngles.length
  const hasFront = hasAngle('front')
  const hasLeftOrRight = hasAngle('left') || hasAngle('right')
  
  const coverageLevel = 
    coverage >= 3 && hasFront && hasLeftOrRight ? 'excellent' :
    coverage >= 2 && (hasFront || hasLeftOrRight) ? 'good' :
    coverage >= 1 ? 'minimal' : 'none'

  const coverageColors = {
    excellent: 'text-primary bg-primary/10 border-primary/30',
    good: 'text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/30',
    minimal: 'text-orange-600 dark:text-orange-400 bg-orange-500/10 border-orange-500/30',
    none: 'text-muted-foreground bg-secondary border-border',
  }

  const coverageLabels = {
    excellent: 'Excellent Coverage',
    good: 'Good Coverage',
    minimal: 'Minimal Coverage',
    none: 'No Images Yet',
  }

  if (compact) {
    return (
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <CollapsibleTrigger className="w-full">
          <div className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-secondary/30 transition-colors">
            <div className="flex items-center gap-3">
              <Camera className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Photo Tips</span>
              <Badge 
                variant="outline" 
                className={cn("text-xs", coverageColors[coverageLevel])}
              >
                {coverageLabels[coverageLevel]}
              </Badge>
            </div>
            {isExpanded ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="pt-3 space-y-3">
            <AngleCoverage capturedAngles={capturedAngles} />
            {showTips && <QuickTips />}
          </div>
        </CollapsibleContent>
      </Collapsible>
    )
  }

  return (
    <div className="space-y-4">
      {/* Coverage Status */}
      <div className={cn(
        "p-3 rounded-lg border",
        coverageColors[coverageLevel]
      )}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {coverageLevel === 'excellent' ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : coverageLevel === 'none' ? (
              <Camera className="h-4 w-4" />
            ) : (
              <AlertTriangle className="h-4 w-4" />
            )}
            <span className="text-sm font-medium">{coverageLabels[coverageLevel]}</span>
          </div>
          <span className="text-sm">{coverage} image{coverage !== 1 ? 's' : ''}</span>
        </div>
        {coverageLevel !== 'excellent' && coverage < 3 && (
          <p className="text-xs mt-1.5 opacity-80">
            {coverage === 0 
              ? 'Start with a front view of the rack'
              : `Add ${3 - coverage} more angle${3 - coverage !== 1 ? 's' : ''} for better accuracy`
            }
          </p>
        )}
      </div>

      {/* Angle Coverage Indicators */}
      <AngleCoverage capturedAngles={capturedAngles} />

      {/* Quick Tips */}
      {showTips && <QuickTips />}
    </div>
  )
}

function AngleCoverage({ capturedAngles }: { capturedAngles: AngleType[] }) {
  const hasAngle = (angle: AngleType) => capturedAngles.includes(angle)
  
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        Recommended Angles
      </p>
      <div className="grid grid-cols-2 gap-2">
        {(['front', 'left', 'right', 'back'] as AngleType[]).map((angle) => {
          const guidance = ANGLE_GUIDANCE[angle]
          const captured = hasAngle(angle)
          return (
            <div 
              key={angle}
              className={cn(
                "p-2.5 rounded-lg border text-left transition-colors",
                captured 
                  ? "bg-primary/5 border-primary/30" 
                  : "bg-secondary/30 border-border"
              )}
            >
              <div className="flex items-center gap-2 mb-1">
                {captured ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />
                ) : (
                  <div className="h-3.5 w-3.5 rounded-full border-2 border-muted-foreground/30 shrink-0" />
                )}
                <span className={cn(
                  "text-sm font-medium",
                  captured ? "text-foreground" : "text-muted-foreground"
                )}>
                  {guidance.label}
                </span>
              </div>
              <p className="text-xs text-muted-foreground line-clamp-2 pl-5.5">
                {guidance.description}
              </p>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function QuickTips() {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        Quick Tips
      </p>
      <div className="grid grid-cols-2 gap-2">
        {CAPTURE_TIPS.map((tip) => (
          <div key={tip.title} className="flex items-start gap-2 p-2 rounded-lg bg-secondary/30">
            <tip.icon className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-medium">{tip.title}</p>
              <p className="text-xs text-muted-foreground">{tip.description}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// Quality warning component
interface ImageQualityWarningProps {
  issues: string[]
  severity: 'info' | 'warning' | 'error'
}

export function ImageQualityWarning({ issues, severity }: ImageQualityWarningProps) {
  if (issues.length === 0) return null

  const colors = {
    info: 'bg-secondary border-border text-foreground',
    warning: 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300',
    error: 'bg-destructive/10 border-destructive/30 text-destructive',
  }

  return (
    <div className={cn("p-3 rounded-lg border", colors[severity])}>
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="text-sm font-medium">
            {severity === 'error' ? 'Image Quality Issue' : 'Tip for Better Results'}
          </p>
          <ul className="text-xs space-y-0.5">
            {issues.map((issue, i) => (
              <li key={i}>{issue}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

// Confidence factors display
interface ConfidenceFactorsProps {
  factors: {
    label: string
    positive: boolean
    description: string
  }[]
}

export function ConfidenceFactors({ factors }: ConfidenceFactorsProps) {
  if (factors.length === 0) return null

  return (
    <div className="space-y-2">
      {factors.map((factor, i) => (
        <div 
          key={i}
          className={cn(
            "flex items-start gap-2 p-2 rounded-lg text-sm",
            factor.positive 
              ? "bg-primary/5 text-primary" 
              : "bg-amber-500/5 text-amber-700 dark:text-amber-300"
          )}
        >
          {factor.positive ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          )}
          <div>
            <p className="font-medium">{factor.label}</p>
            <p className="text-xs opacity-80">{factor.description}</p>
          </div>
        </div>
      ))}
    </div>
  )
}
