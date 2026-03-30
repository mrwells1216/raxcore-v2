'use client'

import { cn } from '@/lib/utils'
import { 
  CheckCircle2, 
  AlertTriangle, 
  AlertCircle,
  Eye,
  Camera,
  Sun,
  Layers,
  Sparkles
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'

interface ConfidenceIndicatorProps {
  confidence: number
  showLabel?: boolean
  size?: 'sm' | 'md' | 'lg'
}

export function ConfidenceIndicator({ confidence, showLabel = true, size = 'md' }: ConfidenceIndicatorProps) {
  const level = 
    confidence >= 75 ? 'high' :
    confidence >= 50 ? 'medium' : 'low'

  const colors = {
    high: 'text-primary',
    medium: 'text-amber-600 dark:text-amber-400',
    low: 'text-red-600 dark:text-red-400',
  }

  const bgColors = {
    high: 'bg-primary/10',
    medium: 'bg-amber-500/10',
    low: 'bg-red-500/10',
  }

  const labels = {
    high: 'High Confidence',
    medium: 'Medium Confidence',
    low: 'Low Confidence',
  }

  const iconSizes = {
    sm: 'h-3.5 w-3.5',
    md: 'h-4 w-4',
    lg: 'h-5 w-5',
  }

  const Icon = level === 'high' ? CheckCircle2 : level === 'medium' ? AlertTriangle : AlertCircle

  return (
    <div className={cn("flex items-center gap-2", colors[level])}>
      <Icon className={iconSizes[size]} />
      <span className={cn(
        "font-semibold tabular-nums",
        size === 'sm' && "text-sm",
        size === 'lg' && "text-lg"
      )}>
        {confidence.toFixed(0)}%
      </span>
      {showLabel && (
        <span className={cn(
          "text-muted-foreground font-normal",
          size === 'sm' && "text-xs",
          size === 'lg' && "text-base"
        )}>
          {labels[level]}
        </span>
      )}
    </div>
  )
}

interface ConfidenceExplanationProps {
  factors?: string[] | null
  learningSummary?: {
    similarExamplesUsed: number
    matchQuality: 'none' | 'weak' | 'moderate' | 'strong'
    strongestMatchingFeatures: string[]
  } | null
  scalingReferences?: string[] | null
  scoringMethod?: 'vision' | 'heuristic' | 'vision_with_fallback' | string | null
  isFallback?: boolean
}

export function ConfidenceExplanation({ 
  factors, 
  learningSummary, 
  scalingReferences,
  scoringMethod,
  isFallback,
}: ConfidenceExplanationProps) {
  // Safe arrays — never undefined going into .map(). Guard against null/undefined props.
  const safeFactors: string[] = Array.isArray(factors) ? (factors as string[]).filter(Boolean) : []
  const safeRefs: string[] = Array.isArray(scalingReferences) ? (scalingReferences as string[]).filter(Boolean) : []

  // Categorize factors into positive and negative
  const positiveKeywords = ['multi', 'high', 'clear', 'visible', 'good', 'strong', 'front', 'excellent']
  const negativeKeywords = ['low', 'poor', 'missing', 'blur', 'shadow', 'single', 'weak', 'trail']

  const categorizedFactors = safeFactors.map(factor => {
    const lowerFactor = factor.toLowerCase()
    const isPositive = positiveKeywords.some(kw => lowerFactor.includes(kw))
    const isNegative = negativeKeywords.some(kw => lowerFactor.includes(kw))
    return {
      text: factor,
      type: isPositive ? 'positive' : isNegative ? 'negative' : 'neutral' as 'positive' | 'negative' | 'neutral',
    }
  })

  // No detail at all — show graceful empty state
  const hasNoDetail = safeFactors.length === 0 && safeRefs.length === 0 && !learningSummary

  return (
    <div className="space-y-4">
      {/* Scoring Method */}
      {scoringMethod && (
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-sm">
            {scoringMethod === 'vision' && 'Analyzed with Vision AI'}
            {scoringMethod === 'heuristic' && 'Analyzed with Heuristic Model'}
            {scoringMethod === 'vision_with_fallback' && 'Vision AI with Heuristic Backup'}
            {scoringMethod !== 'vision' && scoringMethod !== 'heuristic' && scoringMethod !== 'vision_with_fallback' && 'Analyzed with AI Model'}
          </span>
        </div>
      )}

      {/* Graceful empty state when no detail fields are available */}
      {hasNoDetail ? (
        <div className="flex items-start gap-2 rounded-lg bg-secondary/50 p-3">
          <AlertCircle className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
          <p className="text-sm text-muted-foreground">
            {isFallback
              ? 'This score used simplified analysis, so fewer confidence details are available.'
              : 'Detailed confidence breakdown is unavailable for this result.'}
          </p>
        </div>
      ) : (
        <>
          {/* Confidence Factors */}
          {categorizedFactors.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Why this confidence level
              </p>
              <div className="space-y-1.5">
                {categorizedFactors.map((factor, i) => (
                  <div
                    key={i}
                    className={cn(
                      "flex items-start gap-2 text-sm p-2 rounded-lg",
                      factor.type === 'positive' && "bg-primary/5",
                      factor.type === 'negative' && "bg-amber-500/5",
                      factor.type === 'neutral' && "bg-secondary/50"
                    )}
                  >
                    {factor.type === 'positive' ? (
                      <CheckCircle2 className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                    ) : factor.type === 'negative' ? (
                      <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                    ) : (
                      <AlertCircle className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                    )}
                    <span className={cn(
                      factor.type === 'positive' && "text-primary",
                      factor.type === 'negative' && "text-amber-700 dark:text-amber-300"
                    )}>
                      {factor.text}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Scaling References */}
          {safeRefs.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <Eye className="h-3 w-3" />
                Scaling References Used
              </p>
              <div className="flex flex-wrap gap-1.5">
                {safeRefs.map((ref, i) => (
                  <Badge key={i} variant="secondary" className="text-xs font-normal">
                    {ref}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Learning Summary */}
          {learningSummary && (learningSummary.similarExamplesUsed ?? 0) > 0 && (
            <div className="space-y-2 p-3 rounded-lg bg-primary/5 border border-primary/20">
              <p className="text-xs font-medium text-primary uppercase tracking-wide flex items-center gap-1.5">
                <Layers className="h-3 w-3" />
                Verified Training Data Applied
              </p>
              <p className="text-sm text-muted-foreground">
                Adjusted using {learningSummary.similarExamplesUsed} similar verified score{learningSummary.similarExamplesUsed !== 1 ? 's' : ''}
                {' '}with {learningSummary.matchQuality ?? 'unknown'} match quality.
              </p>
              {Array.isArray(learningSummary.strongestMatchingFeatures) && learningSummary.strongestMatchingFeatures.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {learningSummary.strongestMatchingFeatures.slice(0, 4).map((feature, i) => (
                    <Badge key={i} variant="outline" className="text-xs font-normal border-primary/30 text-primary">
                      {feature}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// Compact badge version for mobile headers
interface ConfidenceBadgeProps {
  confidence: number
  className?: string
}

export function ConfidenceBadge({ confidence, className }: ConfidenceBadgeProps) {
  const level = 
    confidence >= 75 ? 'high' :
    confidence >= 50 ? 'medium' : 'low'

  const colors = {
    high: 'bg-primary/10 text-primary border-primary/30',
    medium: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30',
    low: 'bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/30',
  }

  return (
    <Badge 
      variant="outline" 
      className={cn("font-semibold tabular-nums", colors[level], className)}
    >
      {confidence.toFixed(0)}% Confidence
    </Badge>
  )
}
