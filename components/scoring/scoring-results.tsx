'use client'

import { useState } from 'react'
import { 
  Target, AlertTriangle, ChevronDown, ChevronUp, 
  RefreshCw, Plus, Check, Ruler, Box, Cpu, Calculator,
  TrendingUp, TrendingDown, Minus
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
import type { ScoringResult, ScoringFormData, GroundTruthFormData, IntakeQualitySummary } from '@/lib/types'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface ScoringResultsProps {
  result: ScoringResult & { intakeQuality?: IntakeQualitySummary | null }
  formData: ScoringFormData
  onReset: () => void
}

export function ScoringResults({ result, formData, onReset }: ScoringResultsProps) {
  const [showMeasurements, setShowMeasurements] = useState(false)
  const [showConfidence, setShowConfidence] = useState(false)
  const [showTrainingForm, setShowTrainingForm] = useState(false)
  const [isSubmittingTraining, setIsSubmittingTraining] = useState(false)
  const [trainingSubmitted, setTrainingSubmitted] = useState(false)

  const { prediction } = result
  const confidence = prediction.confidence_percent || 0

  const handleTrainingSubmit = async (data: GroundTruthFormData) => {
    setIsSubmittingTraining(true)
    try {
      const response = await fetch('/api/training', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          buck_id: result.buck.id,
          prediction_id: prediction.id,
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
              <Badge variant="secondary" className="text-xs gap-1">
                {result.scoringMethod === 'vision' ? (
                  <>
                    <Cpu className="h-3 w-3" />
                    Vision AI
                  </>
                ) : (
                  <>
                    <Calculator className="h-3 w-3" />
                    Heuristic
                  </>
                )}
              </Badge>
            </div>
          </div>

          {/* Main Scores */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            <ScoreDisplay 
              label="Gross Score"
              value={prediction.predicted_gross}
              range={`${prediction.error_band_low?.toFixed(0)} - ${prediction.error_band_high?.toFixed(0)}`}
              isPrimary
            />
            <ScoreDisplay 
              label="Net Score"
              value={prediction.predicted_net}
              subtitle="After deductions"
            />
          </div>

          {/* Error Band Visual */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Estimated Range</span>
              <span className="font-medium tabular-nums">
                {prediction.error_band_low?.toFixed(1)}&quot; - {prediction.error_band_high?.toFixed(1)}&quot;
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
                factors={result.confidence_explanation}
                learningSummary={result.learningSummary}
                scalingReferences={result.scaling_references_used}
                scoringMethod={result.scoringMethod}
              />
            </CollapsibleContent>
          </Collapsible>

          <Separator />

          {/* Quick Actions */}
          <div className="grid grid-cols-2 gap-3">
            {result.buck?.id ? (
              <Link href={`/render/${result.buck.id}`} className="block">
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
              {prediction.measurements && (
                <MeasurementsGrid measurements={prediction.measurements} />
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
      <PrecisionPassCard predictionId={prediction.id} />

      {/* Structural Hypothesis - Phase 51 */}
      <StructuralHypothesisCard predictionId={prediction.id} />

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
            buckId={result.buck.id} 
            currentPropertyId={result.buck.property_id}
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
  range?: string
  subtitle?: string
  isPrimary?: boolean
}

function ScoreDisplay({ label, value, range, subtitle, isPrimary }: ScoreDisplayProps) {
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
        {value?.toFixed(1) || '--'}
      </p>
      {range && (
        <p className="text-xs text-muted-foreground mt-1">
          {range} range
        </p>
      )}
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
