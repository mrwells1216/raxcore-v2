'use client'

/**
 * Provenance Badge Component
 * 
 * Displays the source and confidence of a measurement value.
 * Used in score sheet displays to show where each value came from.
 */

import { Badge } from '@/components/ui/badge'
import { 
  Tooltip, 
  TooltipContent, 
  TooltipProvider, 
  TooltipTrigger 
} from '@/components/ui/tooltip'
import { 
  Bot, 
  Sparkles, 
  AlertTriangle, 
  User, 
  Check,
  Pencil,
} from 'lucide-react'
import type { 
  ProvenanceSource, 
  ConfidenceBucket, 
  EditStatus,
  MeasuredField,
} from '@/lib/rules-engine'

interface ProvenanceBadgeProps {
  /** Provenance source */
  provenance: ProvenanceSource
  /** Confidence bucket */
  confidence?: ConfidenceBucket
  /** Edit status */
  editStatus?: EditStatus
  /** Whether the field was edited */
  wasEdited?: boolean
  /** Original value (for tooltip) */
  originalValue?: number | null
  /** Current value (for diff display) */
  currentValue?: number | null
  /** Size variant */
  size?: 'sm' | 'md'
}

const provenanceConfig: Record<ProvenanceSource, {
  label: string
  shortLabel: string
  icon: typeof Bot
  className: string
  description: string
}> = {
  ai_raw: {
    label: 'AI',
    shortLabel: 'AI',
    icon: Bot,
    className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    description: 'Measured by AI vision',
  },
  precision_pass: {
    label: 'Precision',
    shortLabel: 'PP',
    icon: Sparkles,
    className: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
    description: 'Adjusted by precision pass',
  },
  fallback: {
    label: 'Fallback',
    shortLabel: 'FB',
    icon: AlertTriangle,
    className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    description: 'Estimated from heuristics',
  },
  human_review: {
    label: 'Human',
    shortLabel: 'HR',
    icon: User,
    className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    description: 'Corrected by human review',
  },
}

const confidenceConfig: Record<ConfidenceBucket, {
  label: string
  className: string
}> = {
  high: {
    label: 'High confidence',
    className: 'border-green-300 dark:border-green-700',
  },
  medium: {
    label: 'Medium confidence',
    className: 'border-yellow-300 dark:border-yellow-700',
  },
  low: {
    label: 'Low confidence',
    className: 'border-red-300 dark:border-red-700',
  },
}

export function ProvenanceBadge({
  provenance,
  confidence = 'medium',
  editStatus,
  wasEdited,
  originalValue,
  currentValue,
  size = 'sm',
}: ProvenanceBadgeProps) {
  const config = provenanceConfig[provenance]
  const confConfig = confidenceConfig[confidence]
  const Icon = config.icon

  const showDiff = wasEdited && originalValue !== null && originalValue !== currentValue

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge 
            variant="outline" 
            className={`
              ${config.className} 
              ${confConfig.className}
              ${size === 'sm' ? 'text-[10px] px-1.5 py-0' : 'text-xs px-2 py-0.5'}
              font-normal cursor-help border
            `}
          >
            <Icon className={size === 'sm' ? 'h-2.5 w-2.5 mr-0.5' : 'h-3 w-3 mr-1'} />
            {size === 'sm' ? config.shortLabel : config.label}
            {wasEdited && (
              <Pencil className={size === 'sm' ? 'h-2 w-2 ml-0.5' : 'h-2.5 w-2.5 ml-1'} />
            )}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <div className="space-y-1">
            <p className="font-medium">{config.description}</p>
            <p className="text-xs text-muted-foreground">{confConfig.label}</p>
            {showDiff && (
              <p className="text-xs">
                Original: <span className="font-mono">{originalValue?.toFixed(2)}</span>
                {' → '}
                <span className="font-mono font-medium">{currentValue?.toFixed(2)}</span>
              </p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/**
 * Render provenance for a MeasuredField
 */
export function MeasuredFieldBadge({ 
  field, 
  size = 'sm' 
}: { 
  field: MeasuredField
  size?: 'sm' | 'md' 
}) {
  return (
    <ProvenanceBadge
      provenance={field.provenance}
      confidence={field.confidence}
      editStatus={field.editStatus}
      wasEdited={field.wasEdited}
      originalValue={field.originalValue}
      currentValue={field.value}
      size={size}
    />
  )
}

/**
 * Compact inline provenance indicator (just an icon)
 */
export function ProvenanceIcon({
  provenance,
  wasEdited,
  className = '',
}: {
  provenance: ProvenanceSource
  wasEdited?: boolean
  className?: string
}) {
  const config = provenanceConfig[provenance]
  const Icon = config.icon

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={`inline-flex items-center ${className}`}>
            <Icon className="h-3 w-3" />
            {wasEdited && <Pencil className="h-2 w-2 ml-0.5" />}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p>{config.description}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/**
 * Score totals provenance summary
 */
export function TotalsProvenanceBadge({
  grossProvenance,
  netProvenance,
  hasHumanEdits,
}: {
  grossProvenance: ProvenanceSource
  netProvenance: ProvenanceSource
  hasHumanEdits: boolean
}) {
  // Determine overall provenance for totals
  const overallProvenance: ProvenanceSource = hasHumanEdits 
    ? 'human_review' 
    : grossProvenance === 'precision_pass' || netProvenance === 'precision_pass'
      ? 'precision_pass'
      : grossProvenance === 'fallback' || netProvenance === 'fallback'
        ? 'fallback'
        : 'ai_raw'

  const config = provenanceConfig[overallProvenance]
  const Icon = config.icon

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className={`${config.className} text-xs font-normal`}>
            <Icon className="h-3 w-3 mr-1" />
            {hasHumanEdits ? 'Reviewed' : config.label}
            {hasHumanEdits && <Check className="h-3 w-3 ml-1" />}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <p>
            {hasHumanEdits 
              ? 'Totals include human-reviewed corrections' 
              : config.description}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
