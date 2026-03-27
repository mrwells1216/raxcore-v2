'use client'

import { 
  CheckCircle2, 
  AlertTriangle, 
  AlertCircle, 
  Camera,
  ChevronDown,
  ChevronUp,
  Plus,
  Eye,
  Sun,
  Focus,
  Crop
} from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import type { IntakeQualitySummary, AngleType } from '@/lib/types'

interface IntakeQualityDisplayProps {
  quality: IntakeQualitySummary
  showRecommendations?: boolean
  compact?: boolean
  onAddPhoto?: (angle?: AngleType) => void
}

export function IntakeQualityDisplay({ 
  quality, 
  showRecommendations = true,
  compact = false,
  onAddPhoto
}: IntakeQualityDisplayProps) {
  const [isExpanded, setIsExpanded] = useState(!compact)
  
  const tierConfig = getTierConfig(quality.tier)
  const TierIcon = tierConfig.icon === 'check' ? CheckCircle2 
    : tierConfig.icon === 'warning' ? AlertTriangle 
    : AlertCircle

  if (compact) {
    return (
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <CollapsibleTrigger asChild>
          <Button 
            variant="ghost" 
            className={cn(
              "w-full justify-between px-3 h-auto py-3 hover:bg-secondary/50",
              tierConfig.bgColor,
              tierConfig.borderColor,
              "border rounded-lg"
            )}
          >
            <div className="flex items-center gap-3">
              <TierIcon className={cn("h-4 w-4", tierConfig.color)} />
              <span className="text-sm font-medium">Image Quality: {tierConfig.label}</span>
              <Badge variant="outline" className={cn("text-xs", tierConfig.color, tierConfig.borderColor)}>
                {quality.overallScore}%
              </Badge>
            </div>
            {isExpanded ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-3 space-y-3">
          <QualityFactorsDisplay 
            strongestFactors={quality.strongestFactors}
            weakestFactors={quality.weakestFactors}
          />
          {showRecommendations && quality.recommendations.length > 0 && (
            <RecommendationsDisplay 
              recommendations={quality.recommendations}
              onAddPhoto={onAddPhoto}
            />
          )}
        </CollapsibleContent>
      </Collapsible>
    )
  }

  return (
    <Card className={cn(tierConfig.borderColor, "border")}>
      <CardContent className="p-4 space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className={cn(
              "flex h-10 w-10 items-center justify-center rounded-full",
              tierConfig.bgColor
            )}>
              <TierIcon className={cn("h-5 w-5", tierConfig.color)} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold">Image Quality</span>
                <Badge variant="outline" className={cn("text-xs", tierConfig.color, tierConfig.borderColor)}>
                  {tierConfig.label}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {quality.summary}
              </p>
            </div>
          </div>
          <div className={cn(
            "text-2xl font-bold tabular-nums",
            tierConfig.color
          )}>
            {quality.overallScore}%
          </div>
        </div>

        {/* Factors */}
        <QualityFactorsDisplay 
          strongestFactors={quality.strongestFactors}
          weakestFactors={quality.weakestFactors}
        />

        {/* Recommendations */}
        {showRecommendations && quality.recommendations.length > 0 && (
          <RecommendationsDisplay 
            recommendations={quality.recommendations}
            onAddPhoto={onAddPhoto}
          />
        )}

        {/* Impact notice */}
        {quality.tier === 'fair' || quality.tier === 'poor' ? (
          <div className={cn(
            "p-3 rounded-lg text-sm",
            quality.tier === 'poor' ? 'bg-red-500/5 text-red-700 dark:text-red-300' : 'bg-amber-500/5 text-amber-700 dark:text-amber-300'
          )}>
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">Accuracy Impact</p>
                <p className="text-xs opacity-80">
                  {quality.tier === 'poor' 
                    ? 'Low image quality significantly widens the error range. Consider adding better photos.'
                    : 'Limited image quality may affect estimate precision.'
                  }
                </p>
              </div>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

function QualityFactorsDisplay({ 
  strongestFactors, 
  weakestFactors 
}: { 
  strongestFactors: string[]
  weakestFactors: string[] 
}) {
  if (strongestFactors.length === 0 && weakestFactors.length === 0) {
    return null
  }

  return (
    <div className="grid sm:grid-cols-2 gap-3">
      {strongestFactors.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Helping the estimate
          </p>
          <div className="space-y-1">
            {strongestFactors.map((factor, i) => (
              <div key={i} className="flex items-center gap-2 text-sm text-primary">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                <span>{factor}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {weakestFactors.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Hurting the estimate
          </p>
          <div className="space-y-1">
            {weakestFactors.map((factor, i) => (
              <div key={i} className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <span>{factor}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function RecommendationsDisplay({ 
  recommendations, 
  onAddPhoto 
}: { 
  recommendations: IntakeQualitySummary['recommendations']
  onAddPhoto?: (angle?: AngleType) => void
}) {
  const topRecommendation = recommendations[0]
  if (!topRecommendation) return null

  const getIcon = (rec: typeof topRecommendation) => {
    if (rec.type === 'add_angle') return Camera
    if (rec.angle) return Camera
    if (rec.message.toLowerCase().includes('blur') || rec.message.toLowerCase().includes('sharp')) return Focus
    if (rec.message.toLowerCase().includes('light')) return Sun
    if (rec.message.toLowerCase().includes('crop') || rec.message.toLowerCase().includes('tip')) return Crop
    if (rec.message.toLowerCase().includes('ears')) return Eye
    return Plus
  }

  const Icon = getIcon(topRecommendation)
  const priorityColors = {
    high: 'border-amber-500/50 bg-amber-500/5',
    medium: 'border-border bg-secondary/30',
    low: 'border-border bg-secondary/20',
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        Recommended
      </p>
      <div className={cn(
        "p-3 rounded-lg border",
        priorityColors[topRecommendation.priority]
      )}>
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary">
            <Icon className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">{topRecommendation.message}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{topRecommendation.reason}</p>
          </div>
          {onAddPhoto && topRecommendation.type === 'add_angle' && (
            <Button 
              variant="outline" 
              size="sm" 
              className="shrink-0"
              onClick={() => onAddPhoto(topRecommendation.angle)}
            >
              <Plus className="h-4 w-4 mr-1" />
              Add
            </Button>
          )}
        </div>
      </div>
      
      {/* Show remaining recommendations as compact list */}
      {recommendations.length > 1 && (
        <div className="flex flex-wrap gap-2 pt-1">
          {recommendations.slice(1, 3).map((rec, i) => (
            <Badge 
              key={i} 
              variant="secondary" 
              className="text-xs font-normal"
            >
              {rec.message}
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}

function getTierConfig(tier: IntakeQualitySummary['tier']): {
  label: string
  color: string
  bgColor: string
  borderColor: string
  icon: 'check' | 'warning' | 'error'
} {
  switch (tier) {
    case 'excellent':
      return {
        label: 'Excellent',
        color: 'text-primary',
        bgColor: 'bg-primary/10',
        borderColor: 'border-primary/30',
        icon: 'check',
      }
    case 'good':
      return {
        label: 'Good',
        color: 'text-primary',
        bgColor: 'bg-primary/5',
        borderColor: 'border-primary/20',
        icon: 'check',
      }
    case 'fair':
      return {
        label: 'Fair',
        color: 'text-amber-600 dark:text-amber-400',
        bgColor: 'bg-amber-500/10',
        borderColor: 'border-amber-500/30',
        icon: 'warning',
      }
    case 'poor':
      return {
        label: 'Poor',
        color: 'text-red-600 dark:text-red-400',
        bgColor: 'bg-red-500/10',
        borderColor: 'border-red-500/30',
        icon: 'error',
      }
  }
}

// Compact badge for headers
export function IntakeQualityBadge({ tier, score }: { tier: IntakeQualitySummary['tier']; score: number }) {
  const config = getTierConfig(tier)
  return (
    <Badge variant="outline" className={cn("text-xs gap-1", config.color, config.borderColor)}>
      <Camera className="h-3 w-3" />
      {config.label} ({score}%)
    </Badge>
  )
}
