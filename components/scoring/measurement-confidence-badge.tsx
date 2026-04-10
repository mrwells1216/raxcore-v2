'use client'

/**
 * Measurement Confidence Badge
 * 
 * Displays field-level confidence as a color-coded badge.
 * Used in score sheet displays to show measurement trust level.
 */

import { Badge } from '@/components/ui/badge'
import { 
  Tooltip, 
  TooltipContent, 
  TooltipProvider, 
  TooltipTrigger 
} from '@/components/ui/tooltip'
import { 
  CheckCircle2, 
  AlertTriangle, 
  MinusCircle,
  HelpCircle,
} from 'lucide-react'
import type { MeasurementDisplayConfidence } from '@/lib/scoring/measurement-display-confidence'
import { 
  getMeasurementConfidenceColor,
  getMeasurementConfidenceLabel,
} from '@/lib/scoring/measurement-display-confidence'

interface MeasurementConfidenceBadgeProps {
  confidence: MeasurementDisplayConfidence
  size?: 'sm' | 'md'
  showIcon?: boolean
  showLabel?: boolean
}

const confidenceIcons: Record<MeasurementDisplayConfidence, typeof CheckCircle2> = {
  high: CheckCircle2,
  medium: AlertTriangle,
  low: MinusCircle,
  unknown: HelpCircle,
}

const confidenceDescriptions: Record<MeasurementDisplayConfidence, string> = {
  high: 'High confidence - Human reviewed or precision-adjusted with strong validation',
  medium: 'Medium confidence - AI-measured with standard validation',
  low: 'Low confidence - Estimated or fallback measurement',
  unknown: 'Unknown - Measurement unavailable or incomplete',
}

export function MeasurementConfidenceBadge({
  confidence,
  size = 'sm',
  showIcon = true,
  showLabel = true,
}: MeasurementConfidenceBadgeProps) {
  const colorClass = getMeasurementConfidenceColor(confidence)
  const label = getMeasurementConfidenceLabel(confidence)
  const description = confidenceDescriptions[confidence]
  const Icon = confidenceIcons[confidence]

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge 
            variant="outline" 
            className={`
              ${colorClass}
              ${size === 'sm' ? 'text-[10px] px-1.5 py-0' : 'text-xs px-2 py-0.5'}
              font-normal cursor-help border
            `}
          >
            {showIcon && (
              <Icon className={size === 'sm' ? 'h-2.5 w-2.5 mr-0.5' : 'h-3 w-3 mr-1'} />
            )}
            {showLabel && label}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <p className="text-xs">{description}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/**
 * Compact dot indicator for inline confidence display
 */
export function MeasurementConfidenceDot({
  confidence,
  className = '',
}: {
  confidence: MeasurementDisplayConfidence
  className?: string
}) {
  const colorClass = getMeasurementConfidenceColor(confidence)
  const description = confidenceDescriptions[confidence]

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={`inline-flex items-center ${className}`}>
            <span className={`h-2 w-2 rounded-full ${colorClass.split(' ')[2]}`} />
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p className="text-xs">{description}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
