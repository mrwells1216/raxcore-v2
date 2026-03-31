'use client'

import { useState } from 'react'
import { 
  Target, AlertTriangle, ChevronDown, ChevronUp, 
  RefreshCw, Plus, Check, Ruler, Box, Cpu, Calculator,
  TrendingUp, TrendingDown, Minus, Brain, Sparkles
} from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Separator } from '@/components/ui/separator'
import { GroundTruthForm } from './ground-truth-form'
import { ConfidenceIndicator, ConfidenceExplanation, ConfidenceBadge } from './confidence-indicator'
import { IntakeQualityDisplay, IntakeQualityBadge } from './intake-quality-display'
import { BuckLocationLink } from '@/components/map/buck-location-link'
import { PrecisionPassCard } from './precision-pass-card'
import { StructuralHypothesisCard } from './structural-hypothesis-card'
import { AbnormalPointsDisplay } from './abnormal-points-display'
import { SCORING_DISCLAIMER } from '@/lib/constants'
import type { ScoringResult, ScoringFormData, GroundTruthFormData, IntakeQualitySummary, Buck } from '@/lib/types'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

// Raw API response shape — some fields live at the top level, not inside prediction
// Uses Omit to safely override non-optional ScoringResult fields that can be
// missing/null in partial or fallback responses.
// Note: API returns camelCase (confidenceExplanation) but we also accept snake_case for compat.
type RawScoringResult = Omit<ScoringResult, 'buck' | 'confidence_explanation' | 'scaling_references_used' | 'prediction'> & {
  buck?: (Buck & { property_id?: string | null }) | null
  prediction: Partial<ScoringResult['prediction']> & { id?: string }
  // Accept both camelCase (API) and snake_case (legacy) field names
  confidence_explanation?: string[] | null
  confidenceExplanation?: string[] | null
  scaling_references_used?: string[] | null
  scalingReferencesUsed?: string[] | null
  learningSummary?: {
    similarExamplesUsed?: number
    matchQuality?: 'none' | 'weak' | 'moderate' | 'strong'
    strongestMatchingFeatures?: string[]
  } | null
  trainingCorrectionResult?: {
    correctionApplied: boolean
    correctionAmount: number
    correctionSourcesUsed: string[]
    correctionSampleSize: number
    correctionStrength: 'none' | 'low' | 'medium' | 'high'
    learningAdjusted: boolean
    historicalPatternSummary: string
    similarExampleCount: number
    estimatedBiasBeforeCorrection: number
    finalBiasAdjustment: number
    exampleConsistency: number
    averageSimilarity: number
  } | null
  intakeQuality?: IntakeQualitySummary | null
  // Top-level fields from the API route response
  estimatedScore?: number | null
  netScore?: number | null
  scoreRange?: { low: number | null; high: number | null } | null
  confidencePercent?: number | null
  confidence?: 'low' | 'medium' | 'high' | string | null
  fallbackMetadata?: { summary?: string; fallbackStrategy?: string } | null
}

interface ScoringResultsProps {
  result: RawScoringResult
  formData: ScoringFormData
  onReset: () => void
}

// Normalized shape the UI always consumes
interface NormalizedResult {
  grossScore: number | null
  netScore: number | null
  rangeLow: number | null
  rangeHigh: number | null
  confidencePercent: number
  confidenceLabel: 'low' | 'medium' | 'high'
  isFallback: boolean
  fallbackMessage: string | null
  measurements: ScoringResult['prediction']['measurements']
  predictionId: string
  buckId: string | null
  propertyId: string | null
  // Normalized explanation arrays (handle both camelCase and snake_case from API)
  confidenceExplanation: string[]
  scalingReferencesUsed: string[]
  learningSummary: RawScoringResult['learningSummary']
  trainingCorrectionResult: RawScoringResult['trainingCorrectionResult']
}

function normalizeResult(result: RawScoringResult): NormalizedResult {
  const p = result.prediction

  // Gross score: prefer DB field, fall back to top-level API field
  const grossScore = p?.predicted_gross ?? result.estimatedScore ?? null

  // Net score: prefer DB field, fall back to top-level API field
  const netScore = p?.predicted_net ?? result.netScore ?? null

  // Error band: prefer DB fields, fall back to scoreRange object
  const rangeLow = p?.error_band_low ?? result.scoreRange?.low ?? null
  const rangeHigh = p?.error_band_high ?? result.scoreRange?.high ?? null

  // Confidence: prefer DB field, fall back to top-level, then 0
  const rawConf = p?.confidence_percent ?? result.confidencePercent ?? 0
  // Normalize string confidence labels from heuristic fallback
  let confidencePercent: number
  if (typeof rawConf === 'string') {
    const label = (rawConf as string).toLowerCase()
    confidencePercent = label === 'high' ? 75 : label === 'medium' ? 55 : 30
  } else {
    confidencePercent = Number(rawConf) || 0
  }

  // Confidence label based on percent
  const confidenceLabel: 'low' | 'medium' | 'high' =
    confidencePercent >= 75 ? 'high' : confidencePercent >= 50 ? 'medium' : 'low'

  // Fallback detection
  const isFallback =
    result.scoringMethod === 'heuristic' ||
    result.scoringMethod === 'vision_with_fallback' ||
    !!result.fallbackMetadata?.fallbackStrategy

  const fallbackMessage = isFallback
    ? result.fallbackMetadata?.summary || 'Using simplified analysis. Some measurements may be unavailable.'
    : null

  // Normalize explanation arrays — handle both camelCase (API) and snake_case (legacy)
  const confidenceExplanation: string[] = Array.isArray(result.confidenceExplanation)
    ? result.confidenceExplanation.filter(Boolean)
    : Array.isArray(result.confidence_explanation)
      ? result.confidence_explanation.filter(Boolean)
      : []

  const scalingReferencesUsed: string[] = Array.isArray(result.scalingReferencesUsed)
    ? result.scalingReferencesUsed.filter(Boolean)
    : Array.isArray(result.scaling_references_used)
      ? result.scaling_references_used.filter(Boolean)
      : []

  if (process.env.NODE_ENV === 'development') {
    console.log('[v0] Normalized scoring result:', {
      grossScore, netScore, rangeLow, rangeHigh, confidencePercent, confidenceLabel, isFallback,
      rawPredictedGross: p?.predicted_gross,
      rawEstimatedScore: result.estimatedScore,
      rawScoreRange: result.scoreRange,
      rawConfidence: p?.confidence_percent ?? result.confidencePercent,
      hasExplanation: confidenceExplanation.length > 0,
      hasScalingRefs: scalingReferencesUsed.length > 0,
    })
  }

  return {
    grossScore,
    netScore,
    rangeLow,
    rangeHigh,
    confidencePercent,
    confidenceLabel,
    isFallback,
    fallbackMessage,
    measurements: (p?.measurements as ScoringResult['prediction']['measurements']) ?? null,
    predictionId: p?.id ?? '',
    buckId: result.buck?.id ?? null,
    propertyId: result.buck?.property_id ?? null,
    confidenceExplanation,
    scalingReferencesUsed,
    learningSummary: result.learningSummary ?? null,
    trainingCorrectionResult: result.trainingCorrectionResult ?? null,
  }
}

export function ScoringResults({ result, formData, onReset }: ScoringResultsProps) {
  const [showMeasurements, setShowMeasurements] = useState(false)
  const [showConfidence, setShowConfidence] = useState(false)
  const [showLearning, setShowLearning] = useState(false)
  const [showTrainingForm, setShowTrainingForm] = useState(false)
  const [isSubmittingTraining, setIsSubmittingTraining] = useState(false)
  const [trainingSubmitted, setTrainingSubmitted] = useState(false)

  const normalized = normalizeResult(result)
  const { prediction } = result
  const confidence = normalized.confidencePercent

  const handleTrainingSubmit = async (data: GroundTruthFormData) => {
    setIsSubmittingTraining(true)
    try {
      const response = await fetch('/api/training', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          buck_id: normalized.buckId,
          prediction_id: normalized.predictionId,
          ...data,
        }),
      })

      if (!response.ok) throw new Error('Failed to submit')

      setTrainingSubmitted(true)
      setShowTrainingForm(false)
      toast.success('Thank you! Your data helps improve our model.')
    } catch (error) {
      console.error('Training submission error:', error)
      toast.error('Failed to submit. Please try again.')
    } finally {
      setIsSubmittingTraining(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {/* Hero Score Card */}
      <Card className="overflow-hidden border-2">
        <div className="bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-6">
          {/* Header */}
          <div className="flex items-start justify-between mb-6">
            <div>
              <h2 className="text-lg font-semibold text-foreground">AI Score Estimate</h2>
              <p className="text-sm text-muted-foreground">
                {formData.rack_type === 'typical' ? 'Typical' : 'Non-Typical'} Buck - {formData.state}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <ConfidenceBadge confidence={confidence} />
              {result.intakeQuality && (
                <IntakeQualityBadge 
                  tier={result.intakeQuality.tier} 
                  score={result.intakeQuality.overallScore} 
                />
              )}
              <Badge
                variant={result.scoringMethod === 'vision' ? 'secondary' : 'outline'}
                className="text-xs gap-1"
              >
                {result.scoringMethod === 'vision' ? (
                  <>
                    <Cpu className="h-3 w-3" />
                    Vision AI
                  </>
                ) : (
                  <>
                    <Calculator className="h-3 w-3" />
                    Simplified Estimate
                  </>
                )}
              </Badge>
            </div>
          </div>

          {/* Fallback notice */}
          {normalized.isFallback && normalized.fallbackMessage && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <p className="text-xs text-muted-foreground">{normalized.fallbackMessage}</p>
            </div>
          )}

          {/* Main Scores */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            <ScoreDisplay 
              label="Gross Score"
              value={normalized.grossScore}
              range={
                normalized.rangeLow != null && normalized.rangeHigh != null
                  ? `${normalized.rangeLow.toFixed(0)}\u2013${normalized.rangeHigh.toFixed(0)}`
                  : null
              }
              isPrimary
            />
            <ScoreDisplay 
              label="Net Score"
              value={normalized.netScore}
              subtitle="After deductions"
            />
          </div>

          {/* Error Band Visual */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Estimated Range</span>
              <span className="font-medium tabular-nums">
                {normalized.rangeLow != null && normalized.rangeHigh != null
                  ? `${normalized.rangeLow.toFixed(1)}\u2033 \u2013 ${normalized.rangeHigh.toFixed(1)}\u2033`
                  : 'Unavailable'}
              </span>
            </div>
            <div className="relative h-2 bg-secondary rounded-full overflow-hidden">
              <div 
                className="absolute inset-y-0 bg-primary/30 rounded-full"
                style={{
                  left: '10%',
                  right: '10%',
                }}
              />
              <div 
                className="absolute top-1/2 -translate-y-1/2 w-1 h-3 bg-primary rounded-full"
                style={{
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                }}
              />
            </div>
          </div>
        </div>
        
        <CardContent className="pt-4 space-y-4">
          {/* Confidence Breakdown (Collapsible) */}
          <Collapsible open={showConfidence} onOpenChange={setShowConfidence}>
            <CollapsibleTrigger asChild>
              <Button 
                variant="ghost" 
                className="w-full justify-between px-3 h-auto py-3 hover:bg-secondary/50"
              >
                <div className="flex items-center gap-2">
                  <ConfidenceIndicator confidence={confidence} size="sm" showLabel={false} />
                  <span className="text-sm font-medium">Why this confidence?</span>
                </div>
                {showConfidence ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2">
              <ConfidenceExplanation 
                factors={normalized.confidenceExplanation}
                learningSummary={normalized.learningSummary}
                scalingReferences={normalized.scalingReferencesUsed}
                scoringMethod={result.scoringMethod}
                isFallback={normalized.isFallback}
              />
            </CollapsibleContent>
          </Collapsible>

          <Separator />

          {/* Quick Actions */}
          <div className="grid grid-cols-2 gap-3">
            {normalized.buckId ? (
              <Link href={`/render/${normalized.buckId}`} className="block">
                <Button variant="outline" className="w-full min-h-[48px] gap-2">
                  <Box className="h-4 w-4" />
                  View 3D Model
                </Button>
              </Link>
            ) : (
              <Button variant="outline" className="w-full min-h-[48px] gap-2" disabled>
                <Box className="h-4 w-4" />
                View 3D Model
              </Button>
            )}
            <Button 
              variant="outline" 
              className="min-h-[48px] gap-2"
              onClick={() => setShowMeasurements(!showMeasurements)}
            >
              <Ruler className="h-4 w-4" />
              {showMeasurements ? 'Hide' : 'Show'} Details
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Learning Adjustment Card */}
      {normalized.trainingCorrectionResult && (
        <LearningAdjustmentCard
          correction={normalized.trainingCorrectionResult}
          open={showLearning}
          onOpenChange={setShowLearning}
        />
      )}

      {/* Image Quality Summary - Phase 15 */}
      {result.intakeQuality && (
        <IntakeQualityDisplay 
          quality={result.intakeQuality}
          showRecommendations={result.intakeQuality.tier === 'fair' || result.intakeQuality.tier === 'poor'}
          compact={result.intakeQuality.tier === 'excellent' || result.intakeQuality.tier === 'good'}
        />
      )}

      {/* Measurements Breakdown */}
      <Collapsible open={showMeasurements} onOpenChange={setShowMeasurements}>
        <CollapsibleContent>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Ruler className="h-4 w-4" />
                Measurement Breakdown
              </CardTitle>
            </CardHeader>
            <CardContent>
              {normalized.measurements ? (
                <MeasurementsGrid measurements={normalized.measurements} />
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Detailed measurements unavailable for this result.
                </p>
              )}
            </CardContent>
          </Card>
        </CollapsibleContent>
      </Collapsible>

      {/* Phase 54: Abnormal/Irregular Points Display */}
      <AbnormalPointsDisplay
        irregularPointsPresent={formData.irregular_points_present}
        nonTypicalTraitsPresent={formData.non_typical_traits_present}
        estimatedIrregularPointsCount={formData.estimated_irregular_points_count}
        abnormalPointNotes={formData.abnormal_point_notes}
        abnormalPointTags={formData.abnormal_point_tags}
        variant="card"
      />

      {/* Precision Pass - Phase 50 */}
      {normalized.predictionId && <PrecisionPassCard predictionId={normalized.predictionId} />}

      {/* Structural Hypothesis - Phase 51 */}
      {normalized.predictionId && <StructuralHypothesisCard predictionId={normalized.predictionId} />}

      {/* Location Linking */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Target className="h-4 w-4" />
            Location
          </CardTitle>
          <CardDescription>
            Link this buck to a property for mapping
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BuckLocationLink 
            buckId={normalized.buckId ?? ''}
            currentPropertyId={normalized.propertyId}
            compact
          />
        </CardContent>
      </Card>

      {/* Training Data Submission */}
      {!trainingSubmitted ? (
        <Card className="border-dashed">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Know the Real Score?
            </CardTitle>
            <CardDescription>
              Submit actual measurements to help improve future predictions. 
              Your data is reviewed before training.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {showTrainingForm ? (
              <GroundTruthForm 
                onSubmit={handleTrainingSubmit}
                onCancel={() => setShowTrainingForm(false)}
                isSubmitting={isSubmittingTraining}
              />
            ) : (
              <Button 
                variant="outline" 
                onClick={() => setShowTrainingForm(true)}
                className="w-full min-h-[48px] gap-2"
              >
                <Plus className="h-4 w-4" />
                Submit Real Score
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card className="border-primary/50 bg-primary/5">
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                <Check className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="font-medium">Training Data Submitted</p>
                <p className="text-sm text-muted-foreground">Thank you for helping improve RAXcore!</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Disclaimer */}
      <Card className="bg-amber-500/5 border-amber-500/20">
        <CardContent className="py-4">
          <div className="flex gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0" />
            <p className="text-sm text-muted-foreground">
              {SCORING_DISCLAIMER}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex gap-3">
        <Button 
          variant="outline" 
          onClick={onReset}
          className="flex-1 min-h-[48px] gap-2"
        >
          <RefreshCw className="h-4 w-4" />
          Score Another Buck
        </Button>
      </div>
    </div>
  )
}

// Sub-components

interface ScoreDisplayProps {
  label: string
  value: number | null | undefined
  range?: string | null
  subtitle?: string
  isPrimary?: boolean
}

function ScoreDisplay({ label, value, range, subtitle, isPrimary }: ScoreDisplayProps) {
  // Never show undefined or NaN — use em dash for missing scores
  const displayValue =
    value != null && !isNaN(Number(value))
      ? Number(value).toFixed(1)
      : '\u2014'

  return (
    <div className={cn(
      "text-center p-4 rounded-xl",
      isPrimary ? "bg-primary/10 border border-primary/20" : "bg-secondary/50"
    )}>
      <p className="text-sm text-muted-foreground mb-1">{label}</p>
      <p className={cn(
        "font-bold tracking-tight tabular-nums",
        isPrimary ? "text-5xl text-primary" : "text-4xl"
      )}>
        {displayValue}
      </p>
      {range ? (
        <p className="text-xs text-muted-foreground mt-1">
          {range} range
        </p>
      ) : value == null ? (
        <p className="text-xs text-muted-foreground mt-1">Unavailable</p>
      ) : null}
      {subtitle && (
        <p className="text-xs text-muted-foreground mt-1">
          {subtitle}
        </p>
      )}
    </div>
  )
}

interface MeasurementsGridProps {
  measurements: NonNullable<ScoringResult['prediction']['measurements']>
}

function MeasurementsGrid({ measurements }: MeasurementsGridProps) {
  return (
    <div className="space-y-4">
      {/* Key Measurements */}
      <div className="grid grid-cols-3 gap-3">
        <MeasurementCard 
          label="Inside Spread" 
          value={measurements.inside_spread}
          highlight
        />
        <MeasurementCard 
          label="Main Beam L" 
          value={measurements.main_beam_left}
        />
        <MeasurementCard 
          label="Main Beam R" 
          value={measurements.main_beam_right}
        />
      </div>

      {/* Tines */}
      <div className="space-y-2">
        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Tine Lengths
        </h4>
        <div className="grid grid-cols-4 gap-2">
          {['g1', 'g2', 'g3', 'g4'].map((g) => {
            const left = measurements[`${g}_left` as keyof typeof measurements] as number | null
            const right = measurements[`${g}_right` as keyof typeof measurements] as number | null
            return (
              <div key={g} className="text-center p-2 rounded-lg bg-secondary/30">
                <p className="text-xs text-muted-foreground font-medium">{g.toUpperCase()}</p>
                <div className="flex items-center justify-center gap-1 text-sm tabular-nums mt-1">
                  <span>{left?.toFixed(1) || '-'}</span>
                  <span className="text-muted-foreground">/</span>
                  <span>{right?.toFixed(1) || '-'}</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Circumferences */}
      <div className="space-y-2">
        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Circumferences (H1-H4)
        </h4>
        <div className="grid grid-cols-4 gap-2">
          {['h1', 'h2', 'h3', 'h4'].map((h) => {
            const left = measurements[`${h}_left` as keyof typeof measurements] as number | null
            const right = measurements[`${h}_right` as keyof typeof measurements] as number | null
            return (
              <div key={h} className="text-center p-2 rounded-lg bg-secondary/30">
                <p className="text-xs text-muted-foreground font-medium">{h.toUpperCase()}</p>
                <div className="flex items-center justify-center gap-1 text-sm tabular-nums mt-1">
                  <span>{left?.toFixed(1) || '-'}</span>
                  <span className="text-muted-foreground">/</span>
                  <span>{right?.toFixed(1) || '-'}</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Deductions */}
      <div className="flex items-center justify-between p-3 rounded-lg bg-destructive/5 border border-destructive/20">
        <div className="flex items-center gap-2">
          <TrendingDown className="h-4 w-4 text-destructive" />
          <span className="text-sm font-medium">Total Deductions</span>
        </div>
        <span className="text-lg font-bold text-destructive tabular-nums">
          -{measurements.deductions?.toFixed(1) || '0'}&quot;
        </span>
      </div>

      {/* Abnormal Points */}
      {measurements.abnormal_points && measurements.abnormal_points > 0 && (
        <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/50">
          <span className="text-sm text-muted-foreground">Abnormal Points</span>
          <span className="font-medium tabular-nums">
            {measurements.abnormal_points.toFixed(1)}&quot;
          </span>
        </div>
      )}
    </div>
  )
}

interface MeasurementCardProps {
  label: string
  value: number | null | undefined
  highlight?: boolean
}

function MeasurementCard({ label, value, highlight }: MeasurementCardProps) {
  return (
    <div className={cn(
      "text-center p-3 rounded-lg",
      highlight ? "bg-primary/10 border border-primary/20" : "bg-secondary/50"
    )}>
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className={cn(
        "text-xl font-bold tabular-nums",
        highlight && "text-primary"
      )}>
        {value?.toFixed(1) || '-'}&quot;
      </p>
    </div>
  )
}

// ─── Learning Adjustment Card ──────────────────────────────────────────────

interface LearningAdjustmentCardProps {
  correction: NonNullable<RawScoringResult['trainingCorrectionResult']>
  open: boolean
  onOpenChange: (open: boolean) => void
}

function LearningAdjustmentCard({ correction, open, onOpenChange }: LearningAdjustmentCardProps) {
  const { correctionApplied, correctionAmount, correctionStrength, correctionSampleSize,
    historicalPatternSummary, similarExampleCount, estimatedBiasBeforeCorrection,
    finalBiasAdjustment, exampleConsistency, averageSimilarity, correctionSourcesUsed,
    learningAdjusted } = correction

  const isPositive = correctionAmount > 0
  const isNegative = correctionAmount < 0
  const absAmount = Math.abs(correctionAmount)

  const strengthColor = correctionStrength === 'high'
    ? 'text-primary'
    : correctionStrength === 'medium'
    ? 'text-amber-600 dark:text-amber-400'
    : 'text-muted-foreground'

  const adjustmentLabel = !correctionApplied
    ? 'No adjustment'
    : isPositive
    ? `+${absAmount.toFixed(1)}\u2033 (upward)`
    : `-${absAmount.toFixed(1)}\u2033 (downward)`

  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <Card className={cn(
        "border",
        learningAdjusted
          ? "border-primary/20 bg-primary/5"
          : "border-border"
      )}>
        <CollapsibleTrigger asChild>
          <button
            className="w-full text-left p-4 flex items-center justify-between gap-3 hover:bg-secondary/30 rounded-t-xl transition-colors"
            aria-expanded={open}
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                learningAdjusted ? "bg-primary/10" : "bg-secondary"
              )}>
                <Brain className={cn("h-4 w-4", learningAdjusted ? "text-primary" : "text-muted-foreground")} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium leading-none">
                  Learning Adjustment
                </p>
                <p className={cn("text-xs mt-1 tabular-nums", strengthColor)}>
                  {correctionApplied
                    ? adjustmentLabel
                    : 'Insufficient data for correction'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {learningAdjusted && (
                <Badge variant="secondary" className="text-xs gap-1">
                  <Sparkles className="h-3 w-3" />
                  Applied
                </Badge>
              )}
              {open
                ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
                : <ChevronDown className="h-4 w-4 text-muted-foreground" />
              }
            </div>
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="px-4 pb-4 space-y-4">
            <Separator />

            {/* Pattern summary */}
            <p className="text-sm text-muted-foreground leading-relaxed">
              {historicalPatternSummary}
            </p>

            {/* Correction grid */}
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-lg bg-secondary/50 space-y-0.5">
                <p className="text-xs text-muted-foreground">Raw AI Bias</p>
                <p className={cn(
                  "text-base font-semibold tabular-nums",
                  estimatedBiasBeforeCorrection > 0
                    ? "text-amber-600 dark:text-amber-400"
                    : estimatedBiasBeforeCorrection < 0
                    ? "text-blue-600 dark:text-blue-400"
                    : "text-muted-foreground"
                )}>
                  {estimatedBiasBeforeCorrection > 0 ? '+' : ''}
                  {estimatedBiasBeforeCorrection.toFixed(2)}&quot;
                </p>
              </div>
              <div className="p-3 rounded-lg bg-secondary/50 space-y-0.5">
                <p className="text-xs text-muted-foreground">Applied Fix</p>
                <p className={cn(
                  "text-base font-semibold tabular-nums",
                  finalBiasAdjustment > 0
                    ? "text-primary"
                    : finalBiasAdjustment < 0
                    ? "text-destructive"
                    : "text-muted-foreground"
                )}>
                  {finalBiasAdjustment >= 0 ? '+' : ''}
                  {finalBiasAdjustment.toFixed(2)}&quot;
                </p>
              </div>
              <div className="p-3 rounded-lg bg-secondary/50 space-y-0.5">
                <p className="text-xs text-muted-foreground">Examples Used</p>
                <p className="text-base font-semibold tabular-nums">
                  {correctionSampleSize}
                  <span className="text-xs font-normal text-muted-foreground ml-1">
                    / {similarExampleCount} found
                  </span>
                </p>
              </div>
              <div className="p-3 rounded-lg bg-secondary/50 space-y-0.5">
                <p className="text-xs text-muted-foreground">Consistency</p>
                <p className="text-base font-semibold tabular-nums">
                  {Math.round(exampleConsistency * 100)}%
                </p>
              </div>
            </div>

            {/* Similarity bar */}
            {averageSimilarity > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Avg. scenario similarity</span>
                  <span className="font-medium tabular-nums">
                    {Math.round(averageSimilarity * 100)}%
                  </span>
                </div>
                <Progress value={Math.round(averageSimilarity * 100)} className="h-1.5" />
              </div>
            )}

            {/* Matching features */}
            {correctionSourcesUsed.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Matched on
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {correctionSourcesUsed.map((src) => (
                    <Badge key={src} variant="outline" className="text-xs font-normal">
                      {src}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  )
}
