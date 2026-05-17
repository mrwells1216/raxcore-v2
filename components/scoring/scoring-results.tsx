'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import useSWR from 'swr'
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
import { buildMeasurementDiff } from '@/lib/review/measurement-diff'
import {
  getLearningScoreWeightLabel,
  parseApproximateLearningScoreInput,
  type ApproximateLearningScoreMetadata,
} from '@/lib/review/types'
import { PrecisionPassCard } from './precision-pass-card'
import { StructuralHypothesisCard } from './structural-hypothesis-card'
import { AbnormalPointsDisplay } from './abnormal-points-display'
import { BCScoreSheet } from './bc-score-sheet'
import { ScoreSheetEditor } from './score-sheet-editor'
import { AntlerImageCarousel } from './antler-image-carousel'
import { LandmarkOverlay } from './landmark-overlay'
import type { LandmarkMeasurement } from '@/lib/scoring/landmark-geometry'
import { TrophyEligibilityCta } from '@/components/trophy-room/trophy-eligibility-cta'
import { SCORING_DISCLAIMER } from '@/lib/constants'
import type { ScoreSheet } from '@/lib/scoring/score-sheet'
import type { FieldProvenanceMap } from '@/lib/rules-engine'
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
  // B&C-style score sheet for measurement breakdown
  scoreSheet?: ScoreSheet | null
  // Build B: graph-native score comparison
  scoreComparison?: {
    activeSource: 'graph_native' | 'legacy' | 'landmark_geometry'
    legacyGross: number | null
    graphGross: number | null
    grossDelta: number | null
    graphCompleteness: number
    graphSource: string
    reason: string
    landmarkLocatedFieldFraction?: number | null
  } | null
  // P1: LiDAR depth auto-calibration
  depthCalibrationMetadata?: {
    subjectDistanceMeters: number
    pixelsPerInch: number
    confidence: number
    source: string
    warnings: string[]
  } | null
  // P2: Landmark pixel detection
  landmarkDetections?: {
    landmarks: Array<{
      id: string
      px: number | null
      py: number | null
      confidence: number
      visibility: string
      source: string
    }>
    imageWidth: number
    imageHeight: number
    locatedCount: number
  } | null
  landmarkScore?: {
    measurements: LandmarkMeasurement[]
    grossScore: number | null
    calibrationSource: string
    locatedFieldCount: number
    totalFieldCount: number
  } | null
  // Raw AI response at top level (some API versions return it here)
  rawAiResponse?: {
    measurements?: Record<string, unknown>
    grossScore?: number | null
    netScore?: number | null
    [key: string]: unknown
  } | null
  // Precision pass data
  latestPrecisionPassRun?: unknown
  // Extended scoring metadata fields
  captureQualitySummary?: unknown
  referenceModeSummary?: unknown
  imageDiagnosticsSummary?: unknown
  confidenceBand?: unknown
  confidenceReasons?: unknown
  rawConfidence?: number | null
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
  calibrationApplied?: boolean | null
  calibrationMeta?: Record<string, unknown> | null
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

  // Debug logging removed - scoring pipeline is working correctly

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
    learningSummary: result.learningSummary ?? undefined,
    trainingCorrectionResult: result.trainingCorrectionResult ?? null,
  }
}

function extractPrecisionPassPayload(result: any): {
  grossScore: number | null
  netScore: number | null
  scoreSheet: any | null
  provenance: FieldProvenanceMap | null
  runId: string | null
} | null {
  const run =
    result?.latestPrecisionPassRun ??
    result?.precisionPassRun ??
    result?.reverseRun ??
    null

  const bestSummary = run?.best_summary ?? null
  if (!bestSummary) return null

  const grossRaw = bestSummary?.predicted_gross ?? null
  const netRaw = bestSummary?.predicted_net ?? null

  const grossScore =
    typeof grossRaw === 'number' ? grossRaw : Number(grossRaw ?? null)

  const netScore =
    typeof netRaw === 'number' ? netRaw : Number(netRaw ?? null)

  const scoreSheet =
    bestSummary?.scoreSheet ??
    bestSummary?.score_sheet ??
    null

  const provenance =
    (bestSummary?.provenance as FieldProvenanceMap | null) ??
    (bestSummary?.field_provenance as FieldProvenanceMap | null) ??
    null

  if (!scoreSheet && !provenance && grossScore == null && netScore == null) {
    return null
  }

  console.log('[precision-pass] extracted persisted payload', {
    runId: run?.id ?? null,
    hasScoreSheet: !!scoreSheet,
    hasProvenance: !!provenance,
    grossScore,
    netScore,
  })

  return {
    grossScore,
    netScore,
    scoreSheet,
    provenance,
    runId: run?.id ?? null,
  }
}

function extractFieldProvenance(result: any): FieldProvenanceMap | null {
  // Case 1: reviewed sheet already stored with provenance
  if (result?.review?.sheet_json?.provenance) {
    console.log('[provenance] extracted', {
      source: 'review.sheet_json.provenance',
      hasReview: true,
      hasPrediction: !!result?.prediction,
      hasRawAiResponse: !!result?.prediction?.raw_ai_response,
    })
    return result.review.sheet_json.provenance as FieldProvenanceMap
  }

  // Case 2: prediction has direct provenance
  if (result?.prediction?.provenance) {
    console.log('[provenance] extracted', {
      source: 'prediction.provenance',
      hasReview: false,
      hasPrediction: true,
      hasRawAiResponse: !!result?.prediction?.raw_ai_response,
    })
    return result.prediction.provenance as FieldProvenanceMap
  }

  // Case 3: provenance stored inside prediction.raw_ai_response
  if (result?.prediction?.raw_ai_response?.provenance) {
    console.log('[provenance] extracted', {
      source: 'prediction.raw_ai_response.provenance',
      hasReview: false,
      hasPrediction: true,
      hasRawAiResponse: true,
    })
    return result.prediction.raw_ai_response.provenance as FieldProvenanceMap
  }

  // Case 4: top-level fallback shape
  if (result?.rawAiResponse?.provenance) {
    console.log('[provenance] extracted', {
      source: 'result.rawAiResponse.provenance',
      hasReview: false,
      hasPrediction: !!result?.prediction,
      hasRawAiResponse: true,
    })
    return result.rawAiResponse.provenance as FieldProvenanceMap
  }

  console.log('[provenance] extracted', {
    source: 'none',
    hasReview: false,
    hasPrediction: !!result?.prediction,
    hasRawAiResponse: !!result?.prediction?.raw_ai_response || !!result?.rawAiResponse,
  })

  return null
}

const fetcher = (url: string) => fetch(url).then((res) => res.json())

function extractApproximateScoreFromReview(reviewedScoreSheet: any): ApproximateLearningScoreMetadata | null {
  const candidate =
    reviewedScoreSheet?.sheet_json?.metadata?.approximate_score ??
    reviewedScoreSheet?.sheet_json?.approximate_score ??
    reviewedScoreSheet?.approximate_score ??
    null

  return parseApproximateLearningScoreInput(candidate).value
}

function formatApproximateScoreSource(score: ApproximateLearningScoreMetadata): string {
  if (score.source === 'official_score_sheet' && score.precision === 'exact') {
    return 'official score sheet'
  }
  if (score.source === 'manual_exact_measurements' && score.precision === 'exact') {
    return 'exact manual measurements'
  }
  if (score.precision === 'rough_estimate') {
    return 'rough memory estimate'
  }
  if (score.source === 'approximate_user_estimate') {
    return 'approximate estimate'
  }
  return 'unknown source'
}

export function ScoringResults({ result, formData, onReset }: ScoringResultsProps) {
  const { data: latestRun } = useSWR(
    result?.prediction?.id
      ? `/api/reverse/latest-run?predictionId=${result.prediction.id}`
      : null,
    fetcher
  )

  const { data: reviewData } = useSWR(
    result?.prediction?.id
      ? `/api/review/save-score-sheet?predictionId=${result.prediction.id}`
      : null,
    fetcher
  )

  const reviewedScoreSheet = reviewData?.reviewedScoreSheet
    ? {
        ...reviewData.reviewedScoreSheet,
        reviewCompleteness: reviewData.reviewCompleteness ?? 0,
        isOfficial: reviewData.isOfficial ?? false,
        reviewedGross:
          reviewData.reviewedScoreSheet?.reviewed_gross ??
          reviewData.reviewedScoreSheet?.sheet_json?.measurements?.grossScore ??
          reviewData.reviewedScoreSheet?.sheet_json?.grossScore ??
          null,
        reviewedNet:
          reviewData.reviewedScoreSheet?.reviewed_net ??
          reviewData.reviewedScoreSheet?.sheet_json?.measurements?.netScore ??
          reviewData.reviewedScoreSheet?.sheet_json?.netScore ??
          null,
        reviewedAt:
          reviewData.reviewedScoreSheet?.updated_at ??
          reviewData.reviewedScoreSheet?.reviewed_at ??
          reviewData.reviewedScoreSheet?.created_at ??
          null,
        reviewedBy:
          reviewData.reviewedScoreSheet?.created_by ??
          reviewData.reviewedScoreSheet?.reviewed_by ??
          'human_review',
        approximateScore: extractApproximateScoreFromReview(reviewData.reviewedScoreSheet),
      }
    : null

  const aiMeasurements =
    result?.prediction?.raw_ai_response?.measurements ??
    result?.rawAiResponse?.measurements ??
    result?.prediction?.measurements ??
    null

  const reviewedMeasurements =
    reviewedScoreSheet?.sheet_json?.measurements ??
    reviewedScoreSheet?.sheet_json ??
    null

  const measurementDiffRows = buildMeasurementDiff({
    aiMeasurements,
    reviewedMeasurements,
  })

  const [showMeasurements, setShowMeasurements] = useState(false)
  const [showConfidence, setShowConfidence] = useState(false)
  const [showLearning, setShowLearning] = useState(false)
  const [showLandmarks, setShowLandmarks] = useState(false)
  const [showTrainingForm, setShowTrainingForm] = useState(false)
  const [isSubmittingTraining, setIsSubmittingTraining] = useState(false)
  const [trainingSubmitted, setTrainingSubmitted] = useState(false)
  const [precisionPassOverride, setPrecisionPassOverride] = useState<{
    grossScore: number | null
    netScore: number | null
    scoreSheet: any | null
    provenance: FieldProvenanceMap | null
    runId: string | null
  } | null>(null)

  // Refs that gate precision-pass hydration — each runId is applied at most once.
  // Using refs (not state) ensures these guards don't themselves trigger re-renders.
  const lastAppliedPrecisionRunIdRef = useRef<string | null>(null)
  const lastHydratedPersistedRunIdRef = useRef<string | null>(null)

  // Hydrate persisted precision-pass override (from DB / latestRun) exactly once per runId.
  useEffect(() => {
    const persisted = extractPrecisionPassPayload({
      ...result,
      latestPrecisionPassRun: latestRun ?? result.latestPrecisionPassRun,
    })
    if (!persisted?.runId) return
    if (lastHydratedPersistedRunIdRef.current === persisted.runId) return
    lastHydratedPersistedRunIdRef.current = persisted.runId
    console.log('[precision-pass] hydrating persisted override', {
      runId: persisted.runId,
      grossScore: persisted.grossScore,
      netScore: persisted.netScore,
      hasScoreSheet: !!persisted.scoreSheet,
      hasProvenance: !!persisted.provenance,
    })
    setPrecisionPassOverride(persisted)
  }, [result, latestRun])

  // Stable callback passed to PrecisionPassCard — must not change identity on re-renders
  // so PrecisionPassCard's internal useEffect doesn't re-fire after we apply the override.
  const handlePrecisionPassComplete = useCallback((payload: {
    grossScore: number | null
    netScore: number | null
    scoreSheet: any | null
    provenance: any | null
    runId: string
  }) => {
    if (!payload.runId) return
    if (lastAppliedPrecisionRunIdRef.current === payload.runId) return
    lastAppliedPrecisionRunIdRef.current = payload.runId
    console.log('[precision-pass] applying UI override', {
      runId: payload.runId,
      hasScoreSheet: !!payload.scoreSheet,
      hasProvenance: !!payload.provenance,
      grossScore: payload.grossScore,
      netScore: payload.netScore,
    })
    setPrecisionPassOverride({
      grossScore: payload.grossScore,
      netScore: payload.netScore,
      scoreSheet: payload.scoreSheet,
      provenance: payload.provenance ?? null,
      runId: payload.runId,
    })
  }, [])

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

  // Extract image URLs - handle both string[] (API response) and BuckImage[] (type def)
  const imageUrls: string[] = Array.isArray(result.images)
    ? (result.images as (string | { public_url?: string | null; image_url?: string | null })[])
        .map(img => typeof img === 'string' ? img : (img.public_url ?? img.image_url ?? ''))
        .filter(Boolean)
    : []

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {/* Antler Image Carousel - at the very top */}
      {imageUrls.length > 0 && (
        <div className="relative">
          <AntlerImageCarousel images={imageUrls} />
          {result.landmarkDetections && result.landmarkDetections.locatedCount > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="absolute top-2 right-2 z-10 gap-1.5 text-xs"
              onClick={() => setShowLandmarks((v) => !v)}
            >
              <Brain className="h-3.5 w-3.5" />
              {showLandmarks ? 'Hide' : 'Landmarks'}
              <span className="ml-0.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium">
                {result.landmarkDetections.locatedCount}
              </span>
            </Button>
          )}
          {showLandmarks && result.landmarkDetections && (
            <div className="absolute inset-0 pointer-events-none">
              <LandmarkOverlay
                landmarks={result.landmarkDetections.landmarks as any}
                measurements={result.landmarkScore?.measurements ?? []}
                imageWidth={result.landmarkDetections.imageWidth}
                imageHeight={result.landmarkDetections.imageHeight}
                containerWidth={result.landmarkDetections.imageWidth}
                containerHeight={result.landmarkDetections.imageHeight}
              />
            </div>
          )}
        </div>
      )}

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
              {result.scoreComparison && (
                <Badge
                  variant="outline"
                  className={cn(
                    'text-xs gap-1',
                    result.scoreComparison.activeSource === 'graph_native'
                      ? 'border-green-500/40 text-green-700 dark:text-green-400'
                      : result.scoreComparison.activeSource === 'landmark_geometry'
                        ? 'border-blue-500/40 text-blue-700 dark:text-blue-400'
                        : 'border-muted-foreground/30 text-muted-foreground',
                  )}
                  title={result.scoreComparison.reason}
                >
                  <Ruler className="h-3 w-3" />
                  {result.scoreComparison.activeSource === 'graph_native'
                    ? `Graph (${Math.round(result.scoreComparison.graphCompleteness * 100)}%)`
                    : result.scoreComparison.activeSource === 'landmark_geometry'
                      ? `Landmark (${Math.round((result.scoreComparison.landmarkLocatedFieldFraction ?? 0) * 100)}%)`
                      : 'Legacy AI'}
                </Badge>
              )}
              {result.depthCalibrationMetadata && (
                <Badge
                  variant="outline"
                  className="text-xs gap-1 border-purple-500/40 text-purple-700 dark:text-purple-400"
                  title={`LiDAR auto-calibration at ${result.depthCalibrationMetadata.subjectDistanceMeters.toFixed(1)}m`}
                >
                  <Sparkles className="h-3 w-3" />
                  LiDAR
                </Badge>
              )}
            </div>
          </div>

          {/* Legitimacy / review status */}
          {reviewedScoreSheet?.isOfficial ? (
            <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800 mb-3">
              Official reviewed score
            </div>
          ) : reviewedScoreSheet?.reviewCompleteness ? (
            <div className="rounded-md border border-yellow-200 bg-yellow-50 px-3 py-2 text-xs text-yellow-800 mb-3">
              Partially reviewed ({reviewedScoreSheet.reviewCompleteness}% complete)
              <div className="mt-1 text-[11px] text-yellow-700">
                Missing one or more required official-review fields
              </div>
            </div>
          ) : (
            <div className="rounded-md border bg-neutral-50 px-3 py-2 text-xs mb-3">
              AI estimated score
            </div>
          )}

          {/* Calibration status */}
          {(() => {
            const calibrationApplied =
              result?.prediction?.calibrationApplied ??
              result?.prediction?.raw_ai_response?.calibrationApplied ??
              result?.rawAiResponse?.calibrationApplied ??
              normalized?.calibrationApplied ??
              false

            const calibrationMeta = (
              result?.prediction?.calibrationMeta ??
              result?.prediction?.raw_ai_response?.['calibrationMeta'] ??
              (result?.rawAiResponse as Record<string, unknown> | null)?.['calibrationMeta'] ??
              normalized?.calibrationMeta ??
              null
            ) as Record<string, unknown> | null

            return calibrationApplied ? (
              <div className="rounded-md border px-3 py-2 text-xs mb-3 bg-neutral-50">
                Calibrated using reviewed data
                {!!calibrationMeta?.profile_type && (
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    profile: {calibrationMeta.profile_type as string}
                    {calibrationMeta?.sample_count ? (
                      <> · {calibrationMeta.sample_count as number} samples</>
                    ) : null}
                  </div>
                )}
              </div>
            ) : null
          })()}

          {/* Capture quality metadata */}
          {(() => {
            const captureQuality = result?.captureQualitySummary as any
            if (!captureQuality?.coverage) return null
            
            return (
              <div className="rounded-md border px-3 py-2 text-xs mb-3 bg-neutral-50">
                Capture quality: {captureQuality.coverage.coverageLabel}
                {captureQuality.coverage.missingAngles?.length ? (
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    Missing: {captureQuality.coverage.missingAngles.join(', ')}
                  </div>
                ) : null}
              </div>
            )
          })()}

          {/* Precision Mode Metadata */}
          {(() => {
            const referenceModeSummary = result?.referenceModeSummary as any ||
              result?.prediction?.referenceModeSummary as any ||
              result?.prediction?.raw_ai_response?.referenceModeSummary as any ||
              null
            
            if (!referenceModeSummary?.precisionModeEnabled) return null
            
            return (
              <div className="rounded-md border px-3 py-2 text-xs mb-3 bg-neutral-50">
                Precision mode enabled
                <div className="mt-1 text-[11px] text-muted-foreground">
                  Reference type: {referenceModeSummary.referenceType ?? 'unknown'}
                  {referenceModeSummary.referenceNotes ? (
                    <> · {referenceModeSummary.referenceNotes}</>
                  ) : null}
                </div>
              </div>
            )
          })()}

          {/* Image Diagnostics */}
          {(() => {
            const imageDiagnosticsSummary = result?.imageDiagnosticsSummary as any ||
              result?.prediction?.imageDiagnosticsSummary as any ||
              result?.prediction?.raw_ai_response?.imageDiagnosticsSummary as any ||
              null
            
            if (!imageDiagnosticsSummary) return null
            
            return (
              <div className="rounded-md border px-3 py-2 text-xs mb-3 bg-neutral-50">
                <div className="font-medium mb-1">Image quality analysis</div>
                <div>
                  Quality: <span className="font-semibold">{imageDiagnosticsSummary.overall}</span>
                </div>
                {imageDiagnosticsSummary.poorCount > 0 && (
                  <div className="mt-1 text-[11px] text-red-700">
                    {imageDiagnosticsSummary.poorCount} image{imageDiagnosticsSummary.poorCount === 1 ? '' : 's'} may reduce accuracy
                  </div>
                )}
                {imageDiagnosticsSummary.okCount > 0 && imageDiagnosticsSummary.poorCount === 0 && (
                  <div className="mt-1 text-[11px] text-yellow-700">
                    {imageDiagnosticsSummary.okCount} image{imageDiagnosticsSummary.okCount === 1 ? '' : 's'} has reduced detail
                  </div>
                )}
              </div>
            )
          })()}

          {/* Confidence Assessment Panel */}
          {(() => {
            const resolvedConfidenceBand = (
              result?.prediction?.confidenceBand ??
              result?.prediction?.raw_ai_response?.['confidenceBand'] ??
              (result?.rawAiResponse as Record<string, unknown> | null)?.['confidenceBand'] ??
              null
            ) as string | null

            const resolvedConfidenceReasons = (
              result?.prediction?.confidenceReasons ??
              result?.prediction?.raw_ai_response?.['confidenceReasons'] ??
              (result?.rawAiResponse as Record<string, unknown> | null)?.['confidenceReasons'] ??
              []
            ) as { direction?: string; label?: string; details?: string }[]

            const resolvedRawConfidence = (
              result?.prediction?.rawConfidence ??
              result?.prediction?.raw_ai_response?.['rawConfidence'] ??
              (result?.rawAiResponse as Record<string, unknown> | null)?.['rawConfidence'] ??
              null
            ) as number | null

            if (!resolvedConfidenceBand && resolvedConfidenceReasons?.length === 0) return null

            return (
              <div className="rounded-lg border px-4 py-4 mb-3">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <div className="text-sm font-medium">Confidence assessment</div>
                    <div className="text-xs text-muted-foreground">
                      Structured confidence based on image coverage, quality, measurement completeness, and runtime path
                    </div>
                  </div>

                  {resolvedConfidenceBand ? (
                    <div className="rounded-full border px-2.5 py-1 text-[11px] font-medium capitalize">
                      {resolvedConfidenceBand}
                    </div>
                  ) : null}
                </div>

                {resolvedRawConfidence != null && (
                  <div className="text-xs text-muted-foreground mb-2">
                    Raw confidence: {resolvedRawConfidence}%
                  </div>
                )}

                {resolvedConfidenceReasons?.length ? (
                  <div className="space-y-2">
                    {resolvedConfidenceReasons.slice(0, 6).map((reason: any, idx: number) => (
                      <div key={idx} className="rounded-md border px-3 py-2 text-xs">
                        <div className="font-medium">
                          {reason.direction === 'boost' ? 'Boost' : 'Penalty'} · {reason.label}
                        </div>
                        <div className="text-muted-foreground mt-1">
                          {reason.details ?? ''}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground">
                    No structured confidence explanation available.
                  </div>
                )}
              </div>
            )
          })()}

          {/* Reviewed Score Sheet Summary Card */}
          {reviewedScoreSheet && (
            <div className="rounded-lg border bg-background px-4 py-4 mb-3">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <div className="text-sm font-medium">Reviewed score sheet</div>
                  <div className="text-xs text-muted-foreground">
                    Human-reviewed measurement summary
                  </div>
                </div>

                {reviewedScoreSheet.isOfficial ? (
                  <div className="rounded-full border border-green-200 bg-green-50 px-2.5 py-1 text-[11px] font-medium text-green-800">
                    Official
                  </div>
                ) : (
                  <div className="rounded-full border border-yellow-200 bg-yellow-50 px-2.5 py-1 text-[11px] font-medium text-yellow-800">
                    Partial
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div className="rounded-md border px-3 py-2">
                  <div className="text-[11px] text-muted-foreground">Reviewed gross</div>
                  <div className="text-sm font-semibold">
                    {reviewedScoreSheet.reviewedGross ?? '-'}
                  </div>
                </div>

                <div className="rounded-md border px-3 py-2">
                  <div className="text-[11px] text-muted-foreground">Reviewed net</div>
                  <div className="text-sm font-semibold">
                    {reviewedScoreSheet.reviewedNet ?? '-'}
                  </div>
                </div>

                <div className="rounded-md border px-3 py-2">
                  <div className="text-[11px] text-muted-foreground">Completeness</div>
                  <div className="text-sm font-semibold">
                    {reviewedScoreSheet.reviewCompleteness ?? 0}%
                  </div>
                </div>

                <div className="rounded-md border px-3 py-2">
                  <div className="text-[11px] text-muted-foreground">Reviewed by</div>
                  <div className="text-sm font-semibold">
                    {reviewedScoreSheet.reviewedBy ?? '-'}
                  </div>
                </div>

                <div className="rounded-md border px-3 py-2 col-span-2 sm:col-span-2">
                  <div className="text-[11px] text-muted-foreground">Reviewed at</div>
                  <div className="text-sm font-semibold">
                    {reviewedScoreSheet.reviewedAt
                      ? new Date(reviewedScoreSheet.reviewedAt).toLocaleString()
                      : '-'}
                  </div>
                </div>
              </div>

              {reviewedScoreSheet.approximateScore && (
                <div className="mt-3 rounded-md border border-dashed px-3 py-2 text-xs">
                  <div className="mb-1 font-medium">Known or approximate score</div>
                  <div className="grid gap-1 text-muted-foreground sm:grid-cols-2">
                    {reviewedScoreSheet.approximateScore.grossScore != null && (
                      <div>
                        Approx. gross provided: {reviewedScoreSheet.approximateScore.grossScore}
                      </div>
                    )}
                    {reviewedScoreSheet.approximateScore.netScore != null && (
                      <div>
                        Approx. net provided: {reviewedScoreSheet.approximateScore.netScore}
                      </div>
                    )}
                    <div>
                      Learning weight: {getLearningScoreWeightLabel(reviewedScoreSheet.approximateScore.learningWeight)} - {formatApproximateScoreSource(reviewedScoreSheet.approximateScore)}
                    </div>
                    <div>Not used for Verified Score</div>
                  </div>
                  {reviewedScoreSheet.approximateScore.notes && (
                    <div className="mt-2 text-muted-foreground">
                      Notes: {reviewedScoreSheet.approximateScore.notes}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Field-level diff view */}
          {reviewedScoreSheet && measurementDiffRows.length > 0 && (
            <div className="rounded-lg border bg-background px-4 py-4 mb-3">
              <div className="mb-3">
                <div className="text-sm font-medium">Field-level review changes</div>
                <div className="text-xs text-muted-foreground">
                  Comparison between AI measurements and reviewed values
                </div>
              </div>

              <div className="text-xs text-muted-foreground mb-2">
                {measurementDiffRows.filter((row) => row.changed).length} changed field(s)
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="py-2 pr-3 font-medium">Field</th>
                      <th className="py-2 pr-3 font-medium">AI</th>
                      <th className="py-2 pr-3 font-medium">Reviewed</th>
                      <th className="py-2 pr-3 font-medium">Delta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {measurementDiffRows.map((row) => (
                      <tr
                        key={row.key}
                        className={row.changed ? 'border-b bg-yellow-50/40' : 'border-b'}
                      >
                        <td className="py-2 pr-3 font-medium">{row.label}</td>
                        <td className="py-2 pr-3">
                          {row.aiValue ?? '-'}
                        </td>
                        <td className="py-2 pr-3">
                          {row.reviewedValue ?? '-'}
                        </td>
                        <td className="py-2 pr-3">
                          {row.delta === null ? '-' : row.delta > 0 ? `+${row.delta}` : row.delta}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Score evolution */}
          <div className="rounded-md border bg-background px-3 py-3 mb-3">
            <div className="text-xs font-medium mb-2">Score evolution</div>
            <div className="space-y-1 text-xs">
              <div>
                AI:{' '}
                {(result?.prediction?.rawPredictedGross ??
                  result?.prediction?.raw_ai_response?.['grossScore'] ??
                  result?.rawAiResponse?.grossScore ??
                  result?.prediction?.raw_ai_response?.['rawPredictedGross'] ??
                  result?.rawAiResponse?.rawPredictedGross ??
                  '-') as number | string | null}
              </div>
              <div>
                Precision:{' '}
                {precisionPassOverride?.grossScore ??
                  (result?.latestPrecisionPassRun as { best_summary?: { predicted_gross?: number } } | null)?.best_summary?.predicted_gross ??
                  '-'}
              </div>
              <div>
                Calibrated:{' '}
                {normalized?.grossScore ??
                  result?.prediction?.predicted_gross ??
                  '-'}
              </div>
              {reviewedScoreSheet?.reviewedGross != null && (
                <div className="font-semibold">
                  Final: {reviewedScoreSheet.reviewedGross}
                </div>
              )}
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

      {/* B&C Score Sheet - Detailed Measurement Breakdown */}
      {result.scoreSheet && (
        <BCScoreSheet 
          scoreSheet={result.scoreSheet} 
          defaultExpanded={false}
        />
      )}


      {/* Trophy Room eligibility CTA */}
      {result.buck?.id && <TrophyEligibilityCta buckId={result.buck.id} />}

      {/* Human Review / Edit Mode for AI Score Sheets */}
      {result.scoreSheet && normalized.predictionId && result.buck?.id && (
        <ScoreSheetEditor
          predictionId={normalized.predictionId}
          buckId={result.buck.id}
          aiScoreSheet={
            precisionPassOverride?.scoreSheet
              ? precisionPassOverride.scoreSheet
              : result.scoreSheet
          }
          aiGrossScore={precisionPassOverride?.grossScore ?? normalized.grossScore ?? 0}
          aiNetScore={precisionPassOverride?.netScore ?? normalized.netScore ?? 0}
          aiConfidence={normalized.confidencePercent}
          isFallback={normalized.isFallback}
          aiFieldProvenance={
            precisionPassOverride?.provenance
              ? precisionPassOverride.provenance
              : extractFieldProvenance(result)
          }
          precisionRunId={precisionPassOverride?.runId ?? null}
          imageUrl={imageUrls[0] ?? null}
          landmarks={
            (result?.prediction?.raw_ai_response as any)?.landmarks ??
            (result?.rawAiResponse as any)?.landmarks ??
            null
          }
        />
      )}
      {/* Measurements Breakdown (Legacy) */}
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
      {normalized.predictionId && (
        <PrecisionPassCard
          predictionId={normalized.predictionId}
          onPrecisionPassComplete={handlePrecisionPassComplete}
        />
      )}

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
