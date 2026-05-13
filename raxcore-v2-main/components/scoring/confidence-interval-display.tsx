'use client'

import { useState } from 'react'
import { 
  AlertTriangle, 
  ChevronDown, 
  ChevronUp, 
  TrendingUp, 
  TrendingDown, 
  Minus,
  Target,
  Info
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Progress } from '@/components/ui/progress'
import type { ConfidenceIntervalSummary, FamilyUncertaintySummary, MeasurementFamily, ConfidenceTier } from '@/lib/types'

interface ConfidenceIntervalDisplayProps {
  interval: ConfidenceIntervalSummary
  predictedGross: number
  predictedNet: number
  compact?: boolean
  showFamilyDetails?: boolean
}

export function ConfidenceIntervalDisplay({
  interval,
  predictedGross,
  predictedNet,
  compact = false,
  showFamilyDetails = true,
}: ConfidenceIntervalDisplayProps) {
  const [isExpanded, setIsExpanded] = useState(!compact)

  const tierConfig = getTierConfig(interval.calibratedConfidenceTier)
  const bandWidth = (interval.grossErrorBandHigh - interval.grossErrorBandLow).toFixed(1)

  if (compact) {
    return (
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <CollapsibleTrigger className="w-full">
          <div className={cn(
            "flex items-center justify-between p-3 rounded-lg border transition-colors hover:bg-secondary/30",
            tierConfig.borderColor
          )}>
            <div className="flex items-center gap-3">
              <Target className={cn("h-4 w-4", tierConfig.textColor)} />
              <span className="text-sm font-medium">Score Range</span>
              <Badge variant="outline" className={cn("text-xs", tierConfig.bgColor, tierConfig.textColor)}>
                {interval.calibratedConfidencePercent}% Confidence
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium tabular-nums">
                {interval.grossErrorBandLow.toFixed(0)} - {interval.grossErrorBandHigh.toFixed(0)}&quot;
              </span>
              {isExpanded ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="pt-3 space-y-3">
            <ErrorBandVisualization
              predictedValue={predictedGross}
              bandLow={interval.grossErrorBandLow}
              bandHigh={interval.grossErrorBandHigh}
              label="Gross Score"
            />
            {showFamilyDetails && interval.familyUncertainty.length > 0 && (
              <FamilyUncertaintyGrid families={interval.familyUncertainty} />
            )}
            <ExplanationList 
              summary={interval.confidenceExplanationSummary}
              details={interval.detailedExplanation}
            />
          </div>
        </CollapsibleContent>
      </Collapsible>
    )
  }

  return (
    <Card className={cn("overflow-hidden", tierConfig.borderColor)}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Target className={cn("h-4 w-4", tierConfig.textColor)} />
            Confidence Interval
          </CardTitle>
          <Badge variant="outline" className={cn(tierConfig.bgColor, tierConfig.textColor)}>
            {tierConfig.label} ({interval.calibratedConfidencePercent}%)
          </Badge>
        </div>
        <CardDescription>
          {interval.confidenceExplanationSummary}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Error Band Visualization */}
        <div className="space-y-3">
          <ErrorBandVisualization
            predictedValue={predictedGross}
            bandLow={interval.grossErrorBandLow}
            bandHigh={interval.grossErrorBandHigh}
            label="Gross Score Range"
          />
          <ErrorBandVisualization
            predictedValue={predictedNet}
            bandLow={interval.netErrorBandLow}
            bandHigh={interval.netErrorBandHigh}
            label="Net Score Range"
            secondary
          />
        </div>

        {/* Family Uncertainty */}
        {showFamilyDetails && interval.familyUncertainty.length > 0 && (
          <FamilyUncertaintyGrid families={interval.familyUncertainty} />
        )}

        {/* Weakest/Strongest Family Summary */}
        {(interval.weakestFamily || interval.strongestFamily) && (
          <div className="flex items-center gap-4 text-sm">
            {interval.strongestFamily && (
              <div className="flex items-center gap-1.5 text-primary">
                <TrendingUp className="h-3.5 w-3.5" />
                <span>Strongest: {formatFamily(interval.strongestFamily)}</span>
              </div>
            )}
            {interval.weakestFamily && (
              <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                <TrendingDown className="h-3.5 w-3.5" />
                <span>Weakest: {formatFamily(interval.weakestFamily)}</span>
              </div>
            )}
          </div>
        )}

        {/* Profile Info */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Info className="h-3 w-3" />
          <span>
            {interval.intervalProfileType === 'segment_specific'
              ? `Using ${interval.intervalProfileSegment} profile (${interval.intervalProfileSamples} samples)`
              : interval.intervalProfileType === 'parent_fallback'
                ? 'Using parent segment profile'
                : 'Using global error estimates'}
          </span>
        </div>

        {/* Detailed Explanation */}
        {interval.detailedExplanation.length > 0 && (
          <ExplanationList 
            summary={interval.confidenceExplanationSummary}
            details={interval.detailedExplanation}
            showSummary={false}
          />
        )}
      </CardContent>
    </Card>
  )
}

// Error band visualization component
interface ErrorBandVisualizationProps {
  predictedValue: number
  bandLow: number
  bandHigh: number
  label: string
  secondary?: boolean
}

function ErrorBandVisualization({
  predictedValue,
  bandLow,
  bandHigh,
  label,
  secondary = false,
}: ErrorBandVisualizationProps) {
  const bandWidth = bandHigh - bandLow
  const midpoint = (bandHigh + bandLow) / 2
  
  // Calculate position of predicted value within band (0-100%)
  const predictedPosition = bandWidth > 0 
    ? ((predictedValue - bandLow) / bandWidth) * 100 
    : 50
  
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className={cn(
          secondary ? "text-muted-foreground" : "font-medium"
        )}>{label}</span>
        <span className={cn(
          "tabular-nums",
          secondary ? "text-muted-foreground" : "font-medium"
        )}>
          {bandLow.toFixed(0)}&quot; - {bandHigh.toFixed(0)}&quot;
        </span>
      </div>
      <div className="relative h-2.5 bg-secondary rounded-full overflow-hidden">
        {/* Band background */}
        <div className={cn(
          "absolute inset-y-0 rounded-full",
          secondary ? "bg-muted-foreground/20" : "bg-primary/20"
        )} style={{ left: '5%', right: '5%' }} />
        {/* Predicted value marker */}
        <div 
          className={cn(
            "absolute top-1/2 -translate-y-1/2 w-1.5 h-4 rounded-full",
            secondary ? "bg-muted-foreground" : "bg-primary"
          )}
          style={{ 
            left: `${Math.max(5, Math.min(95, 5 + predictedPosition * 0.9))}%`,
            transform: 'translate(-50%, -50%)',
          }}
        />
      </div>
      <div className="flex items-center justify-center text-xs text-muted-foreground">
        <span>Best estimate: {predictedValue.toFixed(1)}&quot;</span>
      </div>
    </div>
  )
}

// Family uncertainty grid
interface FamilyUncertaintyGridProps {
  families: FamilyUncertaintySummary[]
}

function FamilyUncertaintyGrid({ families }: FamilyUncertaintyGridProps) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        Measurement Confidence by Category
      </p>
      <div className="grid grid-cols-5 gap-1.5">
        {families.map((fam) => (
          <FamilyConfidenceCell key={fam.family} family={fam} />
        ))}
      </div>
    </div>
  )
}

interface FamilyConfidenceCellProps {
  family: FamilyUncertaintySummary
}

function FamilyConfidenceCell({ family }: FamilyConfidenceCellProps) {
  const tierColors = {
    high: 'bg-primary/10 border-primary/30 text-primary',
    medium: 'bg-secondary border-border text-foreground',
    low: 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300',
    very_low: 'bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-300',
  }

  return (
    <div className={cn(
      "text-center p-2 rounded-lg border",
      tierColors[family.tier]
    )}>
      <p className="text-[10px] font-medium uppercase tracking-wide truncate">
        {formatFamily(family.family)}
      </p>
      <p className="text-sm font-bold tabular-nums mt-0.5">
        {family.confidenceScore.toFixed(0)}%
      </p>
      <p className="text-[10px] text-muted-foreground mt-0.5">
        +/- {family.expectedErrorBand.toFixed(1)}&quot;
      </p>
    </div>
  )
}

// Explanation list
interface ExplanationListProps {
  summary: string
  details: string[]
  showSummary?: boolean
}

function ExplanationList({ summary, details, showSummary = true }: ExplanationListProps) {
  const [showAll, setShowAll] = useState(false)

  const visibleDetails = showAll ? details : details.slice(0, 2)

  return (
    <div className="space-y-2">
      {showSummary && (
        <p className="text-sm text-muted-foreground">{summary}</p>
      )}
      {visibleDetails.length > 0 && (
        <ul className="space-y-1">
          {visibleDetails.map((detail, i) => (
            <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
              <Minus className="h-3 w-3 mt-0.5 shrink-0" />
              <span>{detail}</span>
            </li>
          ))}
        </ul>
      )}
      {details.length > 2 && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="text-xs text-primary hover:underline"
        >
          {showAll ? 'Show less' : `Show ${details.length - 2} more`}
        </button>
      )}
    </div>
  )
}

// Utility functions
function getTierConfig(tier: ConfidenceTier): {
  label: string
  textColor: string
  bgColor: string
  borderColor: string
} {
  switch (tier) {
    case 'very_high':
      return {
        label: 'Very High',
        textColor: 'text-primary',
        bgColor: 'bg-primary/10',
        borderColor: 'border-primary/30',
      }
    case 'high':
      return {
        label: 'High',
        textColor: 'text-primary',
        bgColor: 'bg-primary/5',
        borderColor: 'border-primary/20',
      }
    case 'medium':
      return {
        label: 'Medium',
        textColor: 'text-foreground',
        bgColor: 'bg-secondary',
        borderColor: 'border-border',
      }
    case 'low':
      return {
        label: 'Low',
        textColor: 'text-amber-600 dark:text-amber-400',
        bgColor: 'bg-amber-500/10',
        borderColor: 'border-amber-500/30',
      }
    case 'very_low':
      return {
        label: 'Very Low',
        textColor: 'text-red-600 dark:text-red-400',
        bgColor: 'bg-red-500/10',
        borderColor: 'border-red-500/30',
      }
  }
}

function formatFamily(family: MeasurementFamily): string {
  return family.charAt(0).toUpperCase() + family.slice(1)
}
