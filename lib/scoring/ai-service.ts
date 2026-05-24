/**
 * RutAI AI Scoring Service
 * Vision-first scorer with heuristic fallback, learns from verified examples.
 */

import type { 
  Measurements, 
  LandmarksDetected, 
  StateCalibration, 
  AngleType, 
  CaptureDevice, 
  SourceType,
  TwoPassScoringMetadata,
  SelfCheckSummary,
  FallbackMetadataInfo,
  RuntimeMetadataInfo
} from '@/lib/types'
import { HIGH_OUTPUT_STATES, LOW_OUTPUT_STATES, ANATOMICAL_REFERENCES, CONFIDENCE_THRESHOLDS } from '@/lib/constants'
import { loadFieldBiases, applyBiasCorrections } from './prompt-bias-correction'
import { HAT_DIMENSIONS } from './hat-reference'
import { createClient } from '@/lib/supabase/server'
import { 
  scoreWithVision, 
  visionOutputToMeasurements, 
  visionOutputToLandmarks,
  visionOutputToReferenceQualityData,
  type PreAiScoringContext,
  type VisionScoringResult 
} from './vision-scorer'
// Phase 54: Weighted multi-reference consensus engine
import { computeReferenceConsensus, consensusToErrorBands, type ReferenceConsensusOutput } from './reference-consensus'
import { normalizeMeasurements, type NormalizationResult } from './normalization'
import { checkLandmarkConsistency, type LandmarkConsistencyResult } from './landmark-consistency'
import { recalibrateConfidence, type CalibratedConfidence } from './confidence-calibration'
import { computeLearningCorrection, toSimpleLearningSummary } from './learning-correction'
import { computeMeasurementLevelCorrection, type MeasurementCorrectionResult } from './measurement-correction'
import { runSelfCheck, type SelfCheckResult } from './self-check'
import { validateScoringOutput, hasCriticalViolation, type PlausibilityReport } from './scoring-plausibility'
import { runTwoPassScoring, type TwoPassScoringResult, type SecondPassInput } from './second-pass'
import { applyFallbackPenalties, type FallbackMetadata } from './fallback-handler'
import { calibrateConfidence, getCalibrationMetadata, type CalibratedConfidenceResult } from './calibrated-confidence'
import { calculateTrustScore, getTrustScoreMetadata, type TrustScoreResult } from './trust-score'
import { resolveSegments, applySegmentedCalibration, logPredictionSegments, type SegmentedCalibration } from './segment-engine'
import { getActiveCalibrationProfile } from '@/lib/calibration/utils'
import type { ExtendedLearningSummary, CalibrationProfile, MeasurementCorrectionSummary, ConfidenceTrustMetadata, ConfidenceTier, TrustTier, Phase42Metadata } from '@/lib/types'
// Phase 42: Geometry consistency and reference ranking
import { checkGeometryConsistency, geometryResultToMetadata, type GeometryConsistencyResult } from './geometry-consistency'
import { rankReferenceSources, referenceRankingToMetadata, type ReferenceRanking } from './reference-ranking'
import { computeEnhancedLandmarks } from './landmarks'
import {
  applyPrecisionReferenceScaling,
  type PrecisionReferenceProfile,
} from './reference-mode'

export interface ImageAnalysisInput {
  imageUrl: string
  angleType: AngleType
  width: number
  height: number
  /** True when this image was server-cropped to the antler region. */
  hasCropBox?: boolean
}

export interface ScoringInput {
  images: ImageAnalysisInput[]
  state?: string | null
  rackType: 'typical' | 'non-typical'
  earsFullyVisible?: boolean
  sourceType?: SourceType | string
  captureDevice?: CaptureDevice | string
  harvestYear?: number
  mainFramePoints?: number
  totalPoints?: number
  preScoringMeasurements?: import('@/lib/types').PreScoringMeasurements
  // Phase 20: Optional explicit calibration profile for model comparison
  // If not provided, uses the active calibration profile
  calibrationProfile?: CalibrationProfile | null
  precisionReferenceProfile?: PrecisionReferenceProfile | null
  referenceObject?: import('@/lib/scoring/reference-object-types').ScoringReferenceObjectInput | null
  preAiScoringContext?: PreAiScoringContext | null
  /** Phase 39: Correlation ID from the parent HTTP request for observability traces */
  traceId?: string
  /** Classroom experiment flags — absent ⇒ all features on (production default). */
  experiment?: import('@/lib/scoring/experiment-config').AiServiceExperimentFlags
}

export interface ScoringOutput {
  predictedGross: number
  predictedNet: number
  confidencePercent: number
  errorBandLow: number
  errorBandHigh: number
  measurements: Measurements
  landmarks: LandmarksDetected
  stateCalibration: StateCalibration
  processingTimeMs: number
  imagesUsed: number
  angleDiversityScore: number
  confidenceExplanation: string[]
  scalingReferencesUsed: string[]
  learningSummary: LearningSummary
  // Vision scoring metadata
  visionModelUsed: string | null
  scoringMethod: 'vision' | 'heuristic' | 'vision_with_fallback'
  visionConfidence: number | null
  // Phase 9: Stabilization metadata
  normalizationApplied: boolean
  normalizationAdjustments: number
  landmarkConsistencyScore: number
  confidenceReliability: 'low' | 'medium' | 'high' | 'very_high'
  // Phase 10: Extended learning summary (for admin)
  extendedLearningSummary?: ExtendedLearningSummary
  // Phase 21: Measurement-level correction summary
  measurementCorrectionSummary?: MeasurementCorrectionSummary
  // Phase 23: Two-pass scoring metadata
  twoPassMetadata?: TwoPassScoringMetadata
  // Phase 24: Runtime/fallback metadata
  fallbackMetadata?: FallbackMetadataInfo | null
  runtimeMetadata?: RuntimeMetadataInfo | null
  imageValidationSummary?: {
    valid: boolean
    validCount: number
    totalCount: number
    warningsOnly: boolean
    issueCount: number
  } | null
  // Raw and normalized scoring stages (used in bulk validation)
  rawVisionGross?: number | null
  rawVisionNet?: number | null
  normalizedGross?: number | null
  normalizedNet?: number | null
  // Phase 25: Calibrated confidence and trust score
  calibratedConfidence?: number
  confidenceTier?: ConfidenceTier
  rawConfidence?: number
  trustScore?: number
  trustTier?: TrustTier
  expectedMae?: number
  confidenceTrustMetadata?: ConfidenceTrustMetadata | null
  // Phase 41: Segmented calibration metadata
  segmentedCalibration?: {
    matchedSegments: SegmentedCalibration['matchedSegments']
    hasSpecificSegments: boolean
    totalSampleCount: number
    confidenceAdjustment: number
    grossDelta: number
  } | null
  // Phase 42: Geometry consistency and reference ranking
  phase42Metadata?: Phase42Metadata | null
  // Phase 49.5: Cross-view conflict analysis metadata
  phase495Metadata?: import('@/lib/types').Phase495Metadata | null
  // Phase 54: Weighted multi-reference consensus
  referenceConsensusResult?: ReferenceConsensusOutput | null
  // Training correction layer — structured output for UI and logging
  trainingCorrectionResult?: TrainingCorrectionResult | null
  precisionReferenceMetadata?: {
    referenceType: string
    applied: boolean
    detected: boolean
    scaleFactor: number
    qualityScore: number
    confidenceBoost: number
    dominantMeasurement: string | null
    referenceSizeInches: number | null
    referencePlacement: string | null
    summary: string
    notes: string[]
  } | null
}

// Learning summary exposed to UI
export interface LearningSummary {
  similarExamplesUsed: number
  strongestMatchingFeatures: string[]
  correctionIncrease: number
  correctionDecrease: number
  confidenceImpact: number
  matchQuality: 'none' | 'weak' | 'moderate' | 'strong'
  notes: string[]
}

/**
 * Structured output from the training correction layer.
 * Surfaced in the score API response and displayed in the UI.
 */
export interface TrainingCorrectionResult {
  /** Whether any correction was actually applied (vs. returned 0) */
  correctionApplied: boolean
  /** Signed gross correction in inches (positive = AI was under-estimating) */
  correctionAmount: number
  /** Which feature buckets contributed to this correction */
  correctionSourcesUsed: string[]
  /** Number of training examples that matched this scenario */
  correctionSampleSize: number
  /** Qualitative strength of the correction */
  correctionStrength: 'none' | 'low' | 'medium' | 'high'
  /** True when the final score was adjusted by the learning layer */
  learningAdjusted: boolean
  /** Human-readable summary of the historical pattern driving the correction */
  historicalPatternSummary: string
  /** Number of similar examples found (may be 0) */
  similarExampleCount: number
  /** The estimated systematic bias in the raw AI output before correction */
  estimatedBiasBeforeCorrection: number
  /** The final bias adjustment actually applied to gross score */
  finalBiasAdjustment: number
  /** Consistency score among contributing training examples (0–1) */
  exampleConsistency: number
  /** The average similarity of contributing examples (0–1) */
  averageSimilarity: number
}

interface LearnedAdjustment {
  grossBias: number
  netBias: number
  confidenceBoost: number
  sampleCount: number
  notes: string[]
  learningSummary: LearningSummary
}

// Similarity weights for feature matching
const SIMILARITY_WEIGHTS = {
  state: 0.25,
  rackType: 0.20,
  mainFramePoints: 0.15,
  sourceType: 0.12,
  captureDevice: 0.08,
  imageCount: 0.10,
  earsFullyVisible: 0.05,
  angleDiversity: 0.05,
} as const

// Maximum correction bias to prevent instability
const MAX_CORRECTION_BIAS = 8.0
const MIN_CORRECTION_BIAS = -8.0

function hashString(input: string): number {
  let hash = 2166136261
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return Math.abs(hash >>> 0)
}

function seeded(input: string, min: number, max: number): number {
  const hash = hashString(input)
  const normalized = (hash % 10000) / 10000
  return min + normalized * (max - min)
}

function calculateAngleDiversity(angles: AngleType[]): number {
  const hasAngles = {
    front: angles.includes('front'),
    left: angles.includes('left'),
    right: angles.includes('right'),
    back: angles.includes('back'),
  }
  let score = 0
  if (hasAngles.front) score += 0.35
  if (hasAngles.left) score += 0.25
  if (hasAngles.right) score += 0.25
  if (hasAngles.back) score += 0.15
  return Math.min(score, 1)
}

function getStateCalibration(state: string): StateCalibration {
  if (HIGH_OUTPUT_STATES.includes(state as typeof HIGH_OUTPUT_STATES[number])) {
    return {
      state,
      prior_adjustment: 2.25,
      giant_buck_likelihood: 'high',
      notes: `${state} is treated as a higher-ceiling state, so over-capping giant estimates is reduced.`,
    }
  }
  if (LOW_OUTPUT_STATES.includes(state as typeof LOW_OUTPUT_STATES[number])) {
    return {
      state,
      prior_adjustment: -1.75,
      giant_buck_likelihood: 'low',
      notes: `${state} gets a lighter guardrail against over-estimating giant frames from weak images.`,
    }
  }
  return {
    state,
    prior_adjustment: 0.4,
    giant_buck_likelihood: 'medium',
    notes: `Standard calibration applied for ${state}.`,
  }
}

/**
 * Calculate similarity score between input and a training example
 */
function calculateSimilarity(
  input: ScoringInput,
  example: {
    state?: string
    rack_type?: string
    main_frame_points?: number
    source_type?: string
    capture_device?: string
    image_count?: number
    ears_fully_visible?: boolean
    angle_diversity_score?: number
  }
): { score: number; matchingFeatures: string[] } {
  let score = 0
  const matchingFeatures: string[] = []

  // State match (exact or regional)
  const inputState = input.state ?? 'unknown'
  if (example.state === inputState) {
    score += SIMILARITY_WEIGHTS.state
    matchingFeatures.push(`State: ${inputState}`)
  } else if (
    (HIGH_OUTPUT_STATES.includes(inputState as typeof HIGH_OUTPUT_STATES[number]) &&
      HIGH_OUTPUT_STATES.includes(example.state as typeof HIGH_OUTPUT_STATES[number])) ||
    (LOW_OUTPUT_STATES.includes(inputState as typeof LOW_OUTPUT_STATES[number]) &&
      LOW_OUTPUT_STATES.includes(example.state as typeof LOW_OUTPUT_STATES[number]))
  ) {
    score += SIMILARITY_WEIGHTS.state * 0.5
    matchingFeatures.push('Similar state region')
  }

  // Rack type match
  if (example.rack_type === input.rackType) {
    score += SIMILARITY_WEIGHTS.rackType
    matchingFeatures.push(`Rack: ${input.rackType}`)
  }

  // Main frame points (within 2 points)
  if (example.main_frame_points && input.mainFramePoints) {
    const diff = Math.abs(example.main_frame_points - input.mainFramePoints)
    if (diff === 0) {
      score += SIMILARITY_WEIGHTS.mainFramePoints
      matchingFeatures.push(`Frame: ${input.mainFramePoints}-point`)
    } else if (diff <= 2) {
      score += SIMILARITY_WEIGHTS.mainFramePoints * 0.5
      matchingFeatures.push('Similar frame size')
    }
  }

  // Source type match
  if (example.source_type === input.sourceType) {
    score += SIMILARITY_WEIGHTS.sourceType
    matchingFeatures.push(`Source: ${input.sourceType}`)
  }

  // Capture device match
  if (example.capture_device === input.captureDevice) {
    score += SIMILARITY_WEIGHTS.captureDevice
    matchingFeatures.push(`Device: ${input.captureDevice}`)
  }

  // Image count similarity (within 2)
  if (example.image_count && input.images.length) {
    const diff = Math.abs(example.image_count - input.images.length)
    if (diff <= 1) {
      score += SIMILARITY_WEIGHTS.imageCount
      matchingFeatures.push(`Similar image count`)
    } else if (diff <= 3) {
      score += SIMILARITY_WEIGHTS.imageCount * 0.5
    }
  }

  // Ears visibility match
  if (example.ears_fully_visible === input.earsFullyVisible) {
    score += SIMILARITY_WEIGHTS.earsFullyVisible
  }

  return { score, matchingFeatures }
}

async function getLearnedAdjustment(input: ScoringInput, angleDiversity: number): Promise<LearnedAdjustment> {
  const emptyResult: LearnedAdjustment = {
    grossBias: 0,
    netBias: 0,
    confidenceBoost: 0,
    sampleCount: 0,
    notes: [],
    learningSummary: {
      similarExamplesUsed: 0,
      strongestMatchingFeatures: [],
      correctionIncrease: 0,
      correctionDecrease: 0,
      confidenceImpact: 0,
      matchQuality: 'none',
      notes: [],
    },
  }

  try {
    const supabase = await createClient()
    
    // Get verified training examples with metadata for similarity matching
    const { data: verifiedExamples, error } = await supabase
      .from('training_examples')
      .select(`
        id, 
        error_amount, 
        ground_truth_score, 
        predicted_score,
        buck_id
      `)
      .eq('verified_for_training', true)
      .not('error_amount', 'is', null)
      .limit(200)

    if (error || !verifiedExamples || verifiedExamples.length === 0) {
      emptyResult.learningSummary.notes.push('No verified training examples available yet.')
      return emptyResult
    }

    // Get buck metadata for similarity matching
    const buckIds = verifiedExamples.map(e => e.buck_id).filter(Boolean)
    const { data: bucks } = await supabase
      .from('bucks')
      .select('id, state, rack_type, main_frame_points, source_type, capture_device, ears_fully_visible')
      .in('id', buckIds)

    const bucksMap = new Map(bucks?.map(b => [b.id, b]) || [])

    // Get predictions for image count and angle diversity
    const { data: predictions } = await supabase
      .from('predictions')
      .select('buck_id, images_used, angle_diversity_score')
      .in('buck_id', buckIds)

    const predictionsMap = new Map(predictions?.map(p => [p.buck_id, p]) || [])

    // Calculate similarity for each example and weight errors
    interface WeightedExample {
      similarity: number
      error: number
      matchingFeatures: string[]
    }

    const weightedExamples: WeightedExample[] = []
    const allMatchingFeatures: Map<string, number> = new Map()

    for (const example of verifiedExamples) {
      if (!example.buck_id || typeof example.error_amount !== 'number') continue
      
      const buck = bucksMap.get(example.buck_id)
      const prediction = predictionsMap.get(example.buck_id)
      if (!buck) continue

      const { score, matchingFeatures } = calculateSimilarity(input, {
        state: buck.state,
        rack_type: buck.rack_type,
        main_frame_points: buck.main_frame_points,
        source_type: buck.source_type,
        capture_device: buck.capture_device,
        image_count: prediction?.images_used,
        ears_fully_visible: buck.ears_fully_visible,
        angle_diversity_score: prediction?.angle_diversity_score,
      })

      // Only include examples with at least 20% similarity
      if (score >= 0.2) {
        weightedExamples.push({
          similarity: score,
          error: example.error_amount,
          matchingFeatures,
        })

        // Track feature frequency
        for (const feature of matchingFeatures) {
          allMatchingFeatures.set(feature, (allMatchingFeatures.get(feature) || 0) + 1)
        }
      }
    }

    if (weightedExamples.length === 0) {
      emptyResult.learningSummary.notes.push('No similar verified examples found for this input profile.')
      return emptyResult
    }

    // Sort by similarity and take top examples
    weightedExamples.sort((a, b) => b.similarity - a.similarity)
    const topExamples = weightedExamples.slice(0, 15)

    // Calculate weighted average bias
    let totalWeight = 0
    let weightedErrorSum = 0
    let positiveCorrections = 0
    let negativeCorrections = 0

    for (const ex of topExamples) {
      const weight = ex.similarity * ex.similarity // Square the similarity for stronger weighting
      totalWeight += weight
      weightedErrorSum += ex.error * weight

      if (ex.error > 0) positiveCorrections++
      else if (ex.error < 0) negativeCorrections++
    }

    let grossBias = totalWeight > 0 ? weightedErrorSum / totalWeight : 0
    
    // Cap correction bias to prevent instability
    grossBias = Math.max(MIN_CORRECTION_BIAS, Math.min(MAX_CORRECTION_BIAS, grossBias))
    const netBias = grossBias * 0.8

    // Calculate confidence boost based on match quality and sample count
    const avgSimilarity = topExamples.reduce((sum, ex) => sum + ex.similarity, 0) / topExamples.length
    const confidenceBoost = Math.min(10, topExamples.length * avgSimilarity * 2)

    // Determine match quality
    let matchQuality: LearningSummary['matchQuality'] = 'none'
    if (avgSimilarity >= 0.6) matchQuality = 'strong'
    else if (avgSimilarity >= 0.4) matchQuality = 'moderate'
    else if (avgSimilarity >= 0.2) matchQuality = 'weak'

    // Get top matching features
    const strongestFeatures = Array.from(allMatchingFeatures.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([feature]) => feature)

    const notes: string[] = []
    notes.push(`Used ${topExamples.length} similar verified example(s) with ${matchQuality} match quality.`)
    if (grossBias > 0) {
      notes.push(`Training suggests AI tends to under-estimate by ~${Math.abs(grossBias).toFixed(1)}" for similar bucks.`)
    } else if (grossBias < 0) {
      notes.push(`Training suggests AI tends to over-estimate by ~${Math.abs(grossBias).toFixed(1)}" for similar bucks.`)
    }

    const learningSummary: LearningSummary = {
      similarExamplesUsed: topExamples.length,
      strongestMatchingFeatures: strongestFeatures,
      correctionIncrease: positiveCorrections,
      correctionDecrease: negativeCorrections,
      confidenceImpact: Number(confidenceBoost.toFixed(1)),
      matchQuality,
      notes,
    }

    return {
      grossBias,
      netBias,
      confidenceBoost,
      sampleCount: topExamples.length,
      notes,
      learningSummary,
    }
  } catch (err) {
    console.error('Error fetching learned adjustments:', err)
    emptyResult.learningSummary.notes.push('Error accessing training memory.')
    return emptyResult
  }
}

function calculateConfidence(angleDiversity: number, earsVisible: boolean, eyesVisible: boolean, imageCount: number, sourceType?: string, captureDevice?: string) {
  let confidence = 0
  const explanations: string[] = []

  confidence += angleDiversity * 40
  if (angleDiversity >= 0.85) explanations.push('Multi-angle images provide strong structural confidence.')
  else if (angleDiversity >= 0.5) explanations.push('Multiple angles detected, improving beam and spread estimation.')
  else explanations.push('Limited angles reduce accuracy. Side photos would tighten the estimate.')

  if (earsVisible && eyesVisible) {
    confidence += 30
    explanations.push('Ears and eyes are available for anatomical scaling.')
  } else if (earsVisible) {
    confidence += 20
    explanations.push('Ears are visible for primary scaling reference.')
  } else if (eyesVisible) {
    confidence += 15
    explanations.push('Eyes are visible for secondary scaling reference.')
  } else {
    explanations.push('Weak anatomical landmarks reduce precision.')
  }

  if (imageCount >= 4) confidence += 15
  else if (imageCount >= 2) confidence += 10
  else {
    confidence += 5
    explanations.push('Single-image scoring keeps a wider error band.')
  }

  if (sourceType === 'mounted_photo' || sourceType === 'european_mount') {
    confidence += 15
    explanations.push('Mounted pose is stable and easier to scale.')
  } else if (sourceType === 'harvest_photo') confidence += 12
  else if (sourceType === 'live_deer') {
    confidence += 8
    explanations.push('Live deer posture may distort spread and beam appearance.')
  } else if (sourceType === 'trail_cam') {
    confidence += 6
    explanations.push('Trail cam perspective can widen distortion.')
  } else confidence += 10

  if (captureDevice === 'digital_camera' || captureDevice === 'iphone') confidence += 3
  if (captureDevice === 'photo_of_photo' || captureDevice === 'vintage_photo') {
    confidence -= 6
    explanations.push('Rephotographed or vintage images usually reduce landmark clarity.')
  }

  return { percent: Math.max(20, Math.min(confidence, 96)), explanations }
}

function calculateErrorBands(predictedGross: number, confidence: number) {
  let errorPercent = 0.25
  if (confidence >= CONFIDENCE_THRESHOLDS.HIGH) errorPercent = 0.08
  else if (confidence >= CONFIDENCE_THRESHOLDS.MEDIUM) errorPercent = 0.15
  const errorAmount = predictedGross * errorPercent
  return { low: Math.max(0, predictedGross - errorAmount), high: predictedGross + errorAmount }
}

// Range invariant: a CI that excludes its own point estimate is a contract
// violation (CLAUDE.md §6.9). Apply at every emission site before low/high
// are rounded or persisted.
export function enforceRangeContainsPoint(
  rangeLow: number,
  rangeHigh: number,
  pointEstimate: number,
): { low: number; high: number } {
  if (!Number.isFinite(pointEstimate)) return { low: rangeLow, high: rangeHigh }
  return {
    low: Math.min(rangeLow, pointEstimate),
    high: Math.max(rangeHigh, pointEstimate),
  }
}

function generateMeasurements(input: ScoringInput, stateCalibration: StateCalibration, confidence: number): Measurements {
  const angles = input.images.map(img => img.angleType)
  const hasFront = angles.includes('front')
  const hasLeft  = angles.includes('left')
  const hasRight = angles.includes('right')
  const hasBack  = angles.includes('back')
  const sideCount = (hasLeft ? 1 : 0) + (hasRight ? 1 : 0)
  const viewCount = (hasFront ? 1 : 0) + sideCount + (hasBack ? 1 : 0)

  // Angle coverage fingerprint included in seed — ensures different angle combos
  // yield different seeded base values even when all other inputs are identical.
  const angleFp = `${hasFront?'F':''}${hasLeft?'L':''}${hasRight?'R':''}${hasBack?'B':''}`
  const seed = [
    input.state ?? 'unknown',
    input.rackType,
    input.sourceType || 'na',
    input.captureDevice || 'na',
    String(input.mainFramePoints || 0),
    String(input.images.length),
    angleFp,
  ].join('|')

  const isTypical = input.rackType === 'typical'
  const framePts  = input.mainFramePoints || (isTypical ? 10 : 11)

  // ── State modifier (weak — should not dominate) ──────────────────────────
  const giantStateBoost = HIGH_OUTPUT_STATES.includes((input.state ?? 'unknown') as typeof HIGH_OUTPUT_STATES[number]) ? 1.0 : 0
  const lowStatePenalty = LOW_OUTPUT_STATES.includes((input.state ?? 'unknown') as typeof LOW_OUTPUT_STATES[number]) ? -1.2 : 0

  // ── Source-type baseline shift ────────────────────────────────────────────
  // Mounted/euro = reliable geometry. Harvest photo = good. Trail cam = noisy.
  const sourceShift =
    input.sourceType === 'mounted_photo' || input.sourceType === 'european_mount' ? 2.5 :
    input.sourceType === 'harvest_photo' ? 1.0 :
    input.sourceType === 'live_deer'     ? 0.5 :
    input.sourceType === 'trail_cam'     ? -1.5 :
    0

  // ── View coverage signal — this is the primary differentiator ────────────
  // More views + front = more confident beam/tine estimates → higher baseline
  const viewShift =
    viewCount >= 3 && hasFront ? 3.5 :
    viewCount >= 3             ? 2.5 :
    viewCount === 2 && hasFront ? 2.0 :
    viewCount === 2             ? 1.0 :
    hasFront                    ? 0.5 :
    -1.5   // side-only single image — most uncertain

  // Bonus for true bilateral coverage (both sides) — enables beam comparison
  const bilateralBonus = (hasLeft && hasRight) ? 1.2 : 0

  // ── Frame point signal ────────────────────────────────────────────────────
  const frameShift = framePts >= 14 ? 4.0 : framePts >= 12 ? 2.8 : framePts >= 10 ? 0.8 : -1.2

  // ── Image count modifier (diminishing) ───────────────────────────────────
  const imageShift = Math.min(1.8, input.images.length * 0.35)

  // ── Final composite context ───────────────────────────────────────────────
  // State is now a weak modifier (max ±1.2) rather than a dominant driver.
  // View coverage, source type, and frame points carry the bulk of the signal.
  const context = (
    stateCalibration.prior_adjustment * 0.5
    + giantStateBoost
    + lowStatePenalty
    + sourceShift
    + viewShift
    + bilateralBonus
    + frameShift
    + imageShift
  )

  // ── Measurement ranges widen based on view coverage ──────────────────────
  // Tighter range when we have good coverage; wider when coverage is weak.
  const spreadRange  = viewCount >= 2 && hasFront ? [15.5, 24.5] : [14.0, 23.5]
  const beamRange    = sideCount >= 1            ? [21.0, 29.0]  : [19.5, 27.5]
  const g2Range      = hasFront || sideCount >= 1 ? [8.0, 12.5]  : [7.5, 11.5]
  const g3Range      = hasFront || sideCount >= 1 ? [6.5, 11.0]  : [6.0, 10.5]
  const g4Range      = sideCount >= 1            ? [4.0, 9.0]   : [3.5, 8.5]

  const insideSpread = seeded(`${seed}:spread`, spreadRange[0], spreadRange[1]) + context * 0.32
  const mainBeamLeft = seeded(`${seed}:mbl`,    beamRange[0],   beamRange[1])   + context * 0.38
  const mainBeamRight= seeded(`${seed}:mbr`,    beamRange[0]-0.2, beamRange[1]-0.3) + context * 0.38
  const g2Base       = seeded(`${seed}:g2`,     g2Range[0],     g2Range[1])     + context * 0.18
  const g3Base       = seeded(`${seed}:g3`,     g3Range[0],     g3Range[1])     + context * 0.16
  const g4Base       = seeded(`${seed}:g4`,     g4Range[0],     g4Range[1])     + context * 0.12
  const abnormal     = isTypical ? 0 : seeded(`${seed}:ab`, 5.0, 18.0) + Math.max(0, context * 0.28)

  // Mass (circumferences) — driven by mass cue from source type
  const massShift = sourceShift * 0.06
  const h1 = seeded(`${seed}:h1l`, 3.9, 5.4) + context * 0.06 + massShift
  const h2 = seeded(`${seed}:h2l`, 3.7, 5.1) + context * 0.06 + massShift
  const h3 = seeded(`${seed}:h3l`, 3.5, 4.9) + context * 0.06 + massShift
  const h4 = seeded(`${seed}:h4l`, 3.3, 4.7) + context * 0.06 + massShift

  return {
    inside_spread:   Number(insideSpread.toFixed(1)),
    main_beam_left:  Number(mainBeamLeft.toFixed(1)),
    main_beam_right: Number(mainBeamRight.toFixed(1)),
    g1_left:         Number(seeded(`${seed}:g1l`, 3.4, 6.2).toFixed(1)),
    g1_right:        Number(seeded(`${seed}:g1r`, 3.4, 6.2).toFixed(1)),
    g2_left:         Number(g2Base.toFixed(1)),
    g2_right:        Number((g2Base - seeded(`${seed}:g2d`, 0.0, 1.0)).toFixed(1)),
    g3_left:         Number(g3Base.toFixed(1)),
    g3_right:        Number((g3Base - seeded(`${seed}:g3d`, 0.0, 0.9)).toFixed(1)),
    g4_left:         Number(g4Base.toFixed(1)),
    g4_right:        Number((g4Base - seeded(`${seed}:g4d`, 0.0, 0.9)).toFixed(1)),
    g5_left:         framePts >= 12 ? Number(seeded(`${seed}:g5l`, 1.0, 4.5).toFixed(1)) : null,
    g5_right:        framePts >= 12 ? Number(seeded(`${seed}:g5r`, 1.0, 4.4).toFixed(1)) : null,
    h1_left:         Number(h1.toFixed(1)),
    h1_right:        Number((h1 - seeded(`${seed}:h1d`, 0, 0.3)).toFixed(1)),
    h2_left:         Number(h2.toFixed(1)),
    h2_right:        Number((h2 - seeded(`${seed}:h2d`, 0, 0.3)).toFixed(1)),
    h3_left:         Number(h3.toFixed(1)),
    h3_right:        Number((h3 - seeded(`${seed}:h3d`, 0, 0.3)).toFixed(1)),
    h4_left:         Number(h4.toFixed(1)),
    h4_right:        Number((h4 - seeded(`${seed}:h4d`, 0, 0.3)).toFixed(1)),
    abnormal_points: Number(abnormal.toFixed(1)),
    deductions:      Number(seeded(`${seed}:ded`, 1.5, 6.5).toFixed(1)),
  }
}

function calculateScores(measurements: Measurements) {
  const vals = [
    measurements.inside_spread,
    measurements.main_beam_left, measurements.main_beam_right,
    measurements.g1_left, measurements.g1_right,
    measurements.g2_left, measurements.g2_right,
    measurements.g3_left, measurements.g3_right,
    measurements.g4_left, measurements.g4_right,
    measurements.g5_left, measurements.g5_right,
    measurements.h1_left, measurements.h1_right,
    measurements.h2_left, measurements.h2_right,
    measurements.h3_left, measurements.h3_right,
    measurements.h4_left, measurements.h4_right,
    measurements.abnormal_points,
  ].filter((v): v is number => v !== null)
  const gross = vals.reduce((sum, v) => sum + v, 0)
  const net = gross - (measurements.deductions || 0) - (measurements.abnormal_points || 0)
  return { gross: Number(gross.toFixed(1)), net: Number(net.toFixed(1)) }
}

/**
 * Main scoring function - attempts vision scoring first, falls back to heuristics
 * Phase 24: Enhanced with runtime hardening and detailed fallback metadata
 */
export async function scoreBuck(input: ScoringInput): Promise<ScoringOutput> {
  const startTime = Date.now()
  const angles = input.images.map((img) => img.angleType)
  const angleDiversity = calculateAngleDiversity(angles)
  const stateCalibration = getStateCalibration(input.state ?? 'unknown')

  // Load field biases early so they can be injected into the vision prompt
  // (also used later in stage 2.5 for post-hoc measurement correction).
  // Classroom can disable this via the promptBiasCorrection flag.
  const biasCorrectionEnabled = input.experiment?.promptBiasCorrection !== false
  const preloadedFieldBiases = biasCorrectionEnabled
    ? await loadFieldBiases().catch(() => ({} as Record<string, number>))
    : {}

  // Try vision scoring first (with Phase 24 runtime hardening)
  const visionResult = await scoreWithVision({
    images: input.images,
    state: input.state ?? 'unknown',
    rackType: input.rackType,
    earsFullyVisible: input.earsFullyVisible,
    sourceType: input.sourceType,
    captureDevice: input.captureDevice,
    mainFramePoints: input.mainFramePoints,
    totalPoints: input.totalPoints,
    preScoringMeasurements: input.preScoringMeasurements,
    precisionReference: input.precisionReferenceProfile,
    referenceObject: input.referenceObject ?? undefined,
    preAiScoringContext: input.preAiScoringContext ?? null,
    traceId: input.traceId,  // Phase 39: propagate trace ID
    fieldBiases: Object.keys(preloadedFieldBiases).length > 0 ? preloadedFieldBiases : undefined,
    customPromptOverride: input.experiment?.customPrompt ?? undefined,
  })

  if (visionResult.success) {
    // Vision scoring succeeded - use vision measurements with Phase 10 learning
    // Pass explicit calibration profile if provided, otherwise uses active profile
    const output = await buildVisionScoringOutput(
      input,
      visionResult,
      input.calibrationProfile,
      stateCalibration,
      angleDiversity,
      startTime
    )
    
    // Phase 24: Add runtime metadata to successful output
    return {
      ...output,
      runtimeMetadata: {
        totalAttempts: visionResult.runtimeMetadata.totalAttempts,
        successfulAttempt: visionResult.runtimeMetadata.successfulAttempt,
        totalTimeMs: visionResult.runtimeMetadata.totalTimeMs,
        retryDelaysMs: visionResult.runtimeMetadata.retryDelaysMs,
        timedOut: visionResult.runtimeMetadata.timedOut,
        wasRetried: visionResult.runtimeMetadata.wasRetried,
      },
      imageValidationSummary: {
        valid: visionResult.imageValidation.valid,
        validCount: visionResult.imageValidation.validImageCount,
        totalCount: visionResult.imageValidation.totalImageCount,
        warningsOnly: visionResult.imageValidation.warningsOnly,
        issueCount: visionResult.imageValidation.issues.length,
      },
      fallbackMetadata: null, // No fallback used
    }
  }

  // Vision failed - fall back to heuristic scoring
  // Use legacy learning for heuristic path
  const learned = await getLearnedAdjustment(input, angleDiversity)
  
  // Phase 24: Log detailed failure information
  console.warn('Vision scoring failed, using heuristic fallback:', {
    error: visionResult.error,
    fallbackReason: visionResult.fallbackReason,
    userMessage: visionResult.userMessage,
    attempts: visionResult.runtimeMetadata?.totalAttempts || 0,
    timeMs: visionResult.runtimeMetadata?.totalTimeMs || 0,
    timedOut: visionResult.runtimeMetadata?.timedOut || false,
    imageValidation: visionResult.imageValidation?.summary || 'N/A',
  })

  // Build heuristic output with fallback metadata
  const heuristicOutput = buildHeuristicScoringOutput(
    input,
    learned,
    stateCalibration,
    angleDiversity,
    startTime,
    visionResult.fallbackReason
  )

  // Phase 24: Convert fallback metadata to storable format
  const fallbackMetadata: FallbackMetadataInfo = {
    usedFallback: true,
    fallbackReason: visionResult.fallbackMetadata.fallbackReason,
    fallbackStrategy: visionResult.fallbackMetadata.fallbackStrategy,
    visionErrorTypes: visionResult.visionErrors.map(e => e.type),
    imageValidationIssues: visionResult.imageValidation?.issues.map(i => ({
      imageIndex: i.imageIndex,
      issueType: i.issueType,
      severity: i.severity,
      message: i.message,
      recoverable: i.recoverable,
    })) || [],
    validImageCount: visionResult.imageValidation?.validImageCount || 0,
    totalImageCount: visionResult.imageValidation?.totalImageCount || input.images.length,
    confidencePenalty: visionResult.fallbackMetadata.confidencePenalty,
    errorBandWidening: visionResult.fallbackMetadata.errorBandWidening,
    summary: visionResult.fallbackMetadata.summary,
    timestamp: visionResult.fallbackMetadata.timestamp,
  }

  // Apply fallback penalties to the output
  const penalizedOutput = applyFallbackPenalties(heuristicOutput, visionResult.fallbackMetadata)

  return {
    ...penalizedOutput,
    fallbackMetadata,
    runtimeMetadata: visionResult.runtimeMetadata ? {
      totalAttempts: visionResult.runtimeMetadata.totalAttempts,
      successfulAttempt: visionResult.runtimeMetadata.successfulAttempt,
      totalTimeMs: visionResult.runtimeMetadata.totalTimeMs,
      retryDelaysMs: visionResult.runtimeMetadata.retryDelaysMs,
      timedOut: visionResult.runtimeMetadata.timedOut,
      wasRetried: visionResult.runtimeMetadata.wasRetried,
    } : null,
    imageValidationSummary: visionResult.imageValidation ? {
      valid: visionResult.imageValidation.valid,
      validCount: visionResult.imageValidation.validImageCount,
      totalCount: visionResult.imageValidation.totalImageCount,
      warningsOnly: visionResult.imageValidation.warningsOnly,
      issueCount: visionResult.imageValidation.issues.length,
    } : null,
  }
}

/**
 * Build output from successful vision scoring
 * 
 * Pipeline stages (Phase 9 + 10 + 21 + 23):
 * 1. Vision output -> raw measurements
 * 2. Normalization -> reduce outliers, enforce ranges
 * 3. Landmark consistency -> validate anatomical ratios
 * 4. Confidence recalibration -> based on agreement/variance
 * 5. Phase 21 Measurement-level correction -> per-category corrections first
 * 6. Phase 10 Learning correction -> similarity-weighted verified examples (total score)
 * 7. First-pass score calculation
 * 8. Phase 23 Self-check analysis -> detect issues
 * 9. Phase 23 Second pass (if triggered) -> rescoring with adjusted assumptions
 * 10. Final result selection/blending
 */
async function buildVisionScoringOutput(
  input: ScoringInput,
  visionResult: VisionScoringResult,
  explicitCalibrationProfile: CalibrationProfile | null | undefined,
  stateCalibration: StateCalibration,
  angleDiversity: number,
  startTime: number
): Promise<ScoringOutput> {
  const visionOutput = visionResult.output
  const plausibilityReport: PlausibilityReport =
    input.experiment?.plausibilityValidator === false
      ? { passed: true, violations: [], suggestedConfidenceAdjustments: {} }
      : validateScoringOutput(visionOutput)
  if (plausibilityReport.violations.length > 0) {
    console.warn('[ai-service] plausibility violations detected', {
      passed: plausibilityReport.passed,
      criticalCount: plausibilityReport.violations.filter(v => v.severity === 'critical').length,
      warningCount: plausibilityReport.violations.filter(v => v.severity === 'warning').length,
      rules: plausibilityReport.violations.map(v => v.rule),
    })
  }
  const unscaledMeasurements = visionOutputToMeasurements(visionOutput)
  const rawLandmarks = visionOutputToLandmarks(visionOutput)
  const precisionReferenceResult = applyPrecisionReferenceScaling({
    profile: input.precisionReferenceProfile,
    observation: visionOutput.reference_object,
    measurements: unscaledMeasurements,
  })
  const rawMeasurements = precisionReferenceResult.adjustedMeasurements
  const precisionAdjustedVisionGross = precisionReferenceResult.applied
    ? Number((visionOutput.gross_score * precisionReferenceResult.scaleFactor).toFixed(1))
    : visionOutput.gross_score

  // STAGE 1: Raw vision output
  const baseVisionConfidence = Math.min(
    97,
    visionOutput.confidence_percent + precisionReferenceResult.confidenceBoost,
  )

  // STAGE 2: Normalization - reduce outliers, enforce realistic ranges
  const normalizationResult = normalizeMeasurements(rawMeasurements)
  const normalizedMeasurements = normalizationResult.normalized

  // STAGE 2.5: Apply learned per-field bias corrections from correction_events
  // (Classroom can disable via the promptBiasCorrection flag).
  const fieldBiases = input.experiment?.promptBiasCorrection === false
    ? ({} as Record<string, number>)
    : await loadFieldBiases().catch(() => ({} as Record<string, number>))
  const { corrected: biasCorrectedMeasurements } = applyBiasCorrections(normalizedMeasurements, fieldBiases)

  // STAGE 3: Landmark consistency - validate anatomical ratios
  const consistencyResult = checkLandmarkConsistency(
    biasCorrectedMeasurements,
    rawLandmarks,
    visionOutput.landmarks.ear_base_to_tip_estimated
  )
  const consistentMeasurements = consistencyResult.adjustedMeasurements

  // STAGE 3.5: Phase 42 - Enhanced Landmarks, Reference Ranking, and Geometry Consistency
  const angles = input.images.map(img => img.angleType)
  
  // Phase 42a: Compute enhanced landmark data with quality tracking
  const enhancedLandmarkData = computeEnhancedLandmarks({
    images: input.images.map((img, i) => ({
      imageUrl: img.imageUrl,
      angleType: img.angleType,
      width: img.width,
      height: img.height,
      index: i,
    })),
    earsFullyVisible: input.earsFullyVisible,
    mainFramePoints: input.mainFramePoints,
    visionLandmarks: {
      ears_visible: rawLandmarks.ears_visible,
      eyes_visible: rawLandmarks.eyes_visible,
      antlers_visible: rawLandmarks.antlers_visible,
      ear_base_to_tip_estimated: visionOutput.landmarks.ear_base_to_tip_estimated,
    },
  })
  
  // Phase 42b: Rank reference sources for scaling
  const referenceRanking = rankReferenceSources({
    landmarks: rawLandmarks,
    angleTypes: angles,
    earsFullyVisible: input.earsFullyVisible,
    visionReportedEarLength: visionOutput.landmarks.ear_base_to_tip_estimated,
  })
  
  // Phase 42c: Check geometry consistency
  const geometryResult = checkGeometryConsistency({
    measurements: consistentMeasurements,
    landmarks: rawLandmarks,
    angleTypes: angles,
    earsFullyVisible: input.earsFullyVisible,
    visionEarLength: visionOutput.landmarks.ear_base_to_tip_estimated,
  })
  
  // Phase 42d: Apply geometry refinements if needed (only for critical issues with weak reference)
  const geometryRefinedMeasurements = geometryResult.refinedMeasurements

  // Phase 54: Weighted multi-reference consensus
  const referenceQualityData = visionOutputToReferenceQualityData(visionOutput)
  const referenceConsensusResult = computeReferenceConsensus({
    visionGross:            precisionAdjustedVisionGross,
    visionConfidencePercent: baseVisionConfidence,
    landmarks:              rawLandmarks,
    angleTypes:             angles,
    earsFullyVisible:       input.earsFullyVisible,
    referenceQualityData,
    measurements:           consistentMeasurements,
  })

  // STAGE 4: Confidence recalibration based on all factors
  // Phase 42: Include geometry consistency adjustment in confidence
  const geometryConfidenceAdjustment = geometryResult.confidenceAdjustment
  const adjustedBaseConfidence = Math.max(15, Math.min(95, baseVisionConfidence + geometryConfidenceAdjustment))
  
  const calibratedConfidence = recalibrateConfidence(
    adjustedBaseConfidence,
    rawLandmarks,
    angles,
    normalizationResult,
    consistencyResult
  )

  // Phase 20: Use explicit calibration profile if provided, otherwise fetch active profile
  const calibrationProfile = explicitCalibrationProfile ?? await getActiveCalibrationProfile()

  // STAGE 5: Phase 21 Measurement-Level Correction - correct individual measurements first
  // Phase 42: Use geometry-refined measurements as input (includes any critical-issue refinements)
  const measurementCorrectionResult = await computeMeasurementLevelCorrection(
    {
      state: input.state ?? 'unknown',
      rackType: input.rackType,
      mainFramePoints: input.mainFramePoints,
      sourceType: input.sourceType,
      captureDevice: input.captureDevice,
      imageCount: input.images.length,
      earsFullyVisible: input.earsFullyVisible,
      harvestMethod: undefined,
      angleDiversity,
      baseVisionConfidence: adjustedBaseConfidence,
      normalizedConfidence: calibratedConfidence.finalConfidence,
      calibrationProfile,
    },
    geometryRefinedMeasurements
  )

  // Use measurement-corrected measurements as the base for further processing
  const measurementCorrectedMeasurements = measurementCorrectionResult.correctedMeasurements

  // STAGE 5.5: Phase 41 Segmented Calibration — blended per-segment multipliers/biases
  // PATCH D: derive richer context signals deterministically rather than leaving them undefined

  // reference_visibility: strong if ears are clearly visible (good body reference),
  // partial if ears visible but source is trail cam or single image, weak otherwise
  const derivedReferenceVisibility = (() => {
    if (input.earsFullyVisible === true) {
      const isSingleOrTrailCam = input.images.length === 1 || input.sourceType === 'trail_cam'
      return isSingleOrTrailCam ? 'partial' : 'strong'
    }
    if (input.earsFullyVisible === false) return 'weak'
    // unknown — infer from image count + source
    if (input.sourceType === 'trail_cam' || input.images.length === 1) return 'partial'
    return 'partial' // safe default
  })() as import('./segment-engine').ReferenceVisibility

  // lighting_quality: trail cam night shots are low_light; mounted/European are normal;
  // single-image trail cams have higher chance of harsh conditions
  const derivedLightingQuality = (() => {
    if (input.captureDevice === 'trail_camera') {
      // No way to know night vs day from metadata alone — use 'low_light' as safe trail-cam default
      return 'low_light'
    }
    if (input.sourceType === 'mounted_photo' || input.sourceType === 'european_mount') return 'normal'
    if (input.sourceType === 'harvest_photo') return 'normal'
    // live deer + single image has higher chance of harsh shadow / motion blur
    if (input.sourceType === 'live_deer' && input.images.length === 1) return 'harsh_shadow'
    return 'normal'
  })() as import('./segment-engine').LightingQuality

  const segmentContext = {
    sourceType: input.sourceType,
    imageCount: input.images.length,
    angleDiversity,
    rackType: input.rackType,
    state: input.state ?? 'unknown',
    earsFullyVisible: input.earsFullyVisible,
    captureDevice: input.captureDevice,
    referenceVisibility: derivedReferenceVisibility,
    lightingQuality: derivedLightingQuality,
  }
  const segmentedCal = await resolveSegments(segmentContext)
  const segmentCorrectionResult = applySegmentedCalibration(
    measurementCorrectedMeasurements as unknown as Record<string, number | null>,
    segmentedCal
  )
  // Merge segment-corrected values back into a typed Measurements object
  const segmentCorrectedMeasurements = {
    ...measurementCorrectedMeasurements,
    ...segmentCorrectionResult.correctedMeasurements,
  } as typeof measurementCorrectedMeasurements

  // STAGE 6: Phase 10 Learning Correction - additional total-score adjustment
  // This provides supplemental correction on top of measurement-level + segment corrections
  const learningResult = await computeLearningCorrection(
    {
      state: input.state ?? 'unknown',
      rackType: input.rackType,
      mainFramePoints: input.mainFramePoints,
      sourceType: input.sourceType,
      captureDevice: input.captureDevice,
      imageCount: input.images.length,
      earsFullyVisible: input.earsFullyVisible,
      harvestMethod: undefined,
      angleDiversity,
      baseVisionConfidence,
      normalizedConfidence: calibratedConfidence.finalConfidence,
      calibrationProfile,
    },
    segmentCorrectedMeasurements  // Phase 41: use segment-corrected as base
  )

  // STAGE 7: Apply any remaining per-field corrections from learning result
  // Phase 41 PATCH A: base must start from segmentCorrectedMeasurements so Phase 41
  // corrections are reflected in the final first-pass gross/net, not just in learning inputs.
  const correctedMeasurements = { ...segmentCorrectedMeasurements }
  for (const [field, correction] of learningResult.measurementCorrections) {
    const key = field as keyof typeof correctedMeasurements
    const currentVal = correctedMeasurements[key]
    if (typeof currentVal === 'number') {
      (correctedMeasurements as Record<string, number | null>)[key] = Number((currentVal + correction).toFixed(1))
    }
  }

  // Calculate first-pass scores from corrected measurements
  const { gross: rawGross, net: rawNet } = calculateScores(correctedMeasurements)

  // Apply remaining overall score corrections (reduced since measurement-level already applied)
  // Scale down the learning correction since measurement corrections already applied
  const scaledGrossCorrection = learningResult.grossCorrection * 0.5
  const scaledNetCorrection = learningResult.netCorrection * 0.5
  const firstPassGross = Number((rawGross + scaledGrossCorrection).toFixed(1))
  const firstPassNet = Number((rawNet + scaledNetCorrection).toFixed(1))

  // Combine confidence from calibration and learning boost
  // Phase 20: Apply calibration profile's confidence scaling
  // Phase 41: Additionally apply segment-level confidence adjustment (clamped ±15)
  const confidenceScaling = calibrationProfile?.confidence_scaling ?? 1.0
  const segmentConfAdj = Math.max(-15, Math.min(15, segmentedCal.confidenceAdjustment))
  const baseConfidenceWithBoost = calibratedConfidence.finalConfidence + learningResult.confidenceBoost + segmentConfAdj
  const scaledConfidence = baseConfidenceWithBoost * confidenceScaling
  const firstPassConfidence = Math.min(97, Math.max(15, Math.round(scaledConfidence)))

  // STAGE 8: Phase 23 Self-Check Analysis
  const selfCheckResult = runSelfCheck({
    measurements: correctedMeasurements,
    predictedGross: firstPassGross,
    predictedNet: firstPassNet,
    confidencePercent: firstPassConfidence,
    landmarks: rawLandmarks,
    angles: input.images.map(img => img.angleType),
    imageCount: input.images.length,
    angleDiversity,
    normalizationResult,
    landmarkConsistencyResult: consistencyResult,
    measurementCorrectionResult,
    visionConfidence: baseVisionConfidence,
    state: input.state ?? 'unknown',
    rackType: input.rackType,
    mainFramePoints: input.mainFramePoints,
    sourceType: input.sourceType,
  })

  // Surgical Precision: OR critical plausibility violations into the second-pass trigger.
  // Plausibility lives upstream of self-check and feeds it so the existing two-pass
  // plumbing can re-score without modifying self-check's own rule set.
  if (hasCriticalViolation(plausibilityReport) && !selfCheckResult.triggerSecondPass) {
    selfCheckResult.triggerSecondPass = true
    selfCheckResult.secondPassReasons.push(
      ...plausibilityReport.violations
        .filter(v => v.severity === 'critical')
        .map(v => `plausibility:${v.rule}${v.fieldKey ? `:${v.fieldKey}` : ''}`),
    )
  }

  // Classroom: hard-disable the second pass when the experiment turns it off.
  if (input.experiment?.secondPass === false) {
    selfCheckResult.triggerSecondPass = false
  }

  // STAGE 9 & 10: Phase 23 Two-Pass Scoring (if triggered)
  const secondPassInput: SecondPassInput = {
    firstPassMeasurements: correctedMeasurements,
    firstPassGross,
    firstPassNet,
    firstPassConfidence,
    selfCheckResult,
    rawVisionMeasurements: rawMeasurements,
    rawLandmarks,
    visionReportedEarLength: visionOutput.landmarks.ear_base_to_tip_estimated,
    angles: input.images.map(img => img.angleType),
    imageCount: input.images.length,
    state: input.state ?? 'unknown',
    rackType: input.rackType,
    sourceType: input.sourceType,
    earsFullyVisible: input.earsFullyVisible,
    calibrationProfile,
  }

  const twoPassResult = await runTwoPassScoring(secondPassInput, startTime)

  // Use final result from two-pass scoring
  const finalMeasurements = twoPassResult.finalMeasurements
  const gross = twoPassResult.finalGross
  const net = twoPassResult.finalNet
  const confidencePercent = twoPassResult.finalConfidence

  // Build two-pass metadata for storage/admin
  const twoPassMetadata: TwoPassScoringMetadata = {
    secondPassRan: twoPassResult.secondPassRan,
    selfCheck: {
      issues: selfCheckResult.issues,
      overallStability: selfCheckResult.overallStability,
      stabilityScore: selfCheckResult.stabilityScore,
      triggerSecondPass: selfCheckResult.triggerSecondPass,
      secondPassReasons: selfCheckResult.secondPassReasons,
      componentVariance: selfCheckResult.componentVariance,
      confidenceAdjustment: selfCheckResult.confidenceAdjustment,
      summary: selfCheckResult.summary,
    },
    firstPassGross,
    firstPassNet,
    firstPassConfidence,
    secondPassGross: twoPassResult.secondPass?.predictedGross ?? null,
    secondPassNet: twoPassResult.secondPass?.predictedNet ?? null,
    secondPassConfidence: twoPassResult.secondPass?.confidencePercent ?? null,
    passComparison: twoPassResult.passComparison,
    selection: twoPassResult.selection,
    adjustmentsSummary: twoPassResult.adjustmentsSummary,
    secondPassReasons: twoPassResult.secondPassReasons,
    processingTimeMs: twoPassResult.processingTimeMs,
  }

  // STAGE 11: Phase 25 Calibrated Confidence
  const calibratedConfidenceResult = await calibrateConfidence({
    rawConfidence: confidencePercent,
    scoringMethod: 'vision',
    sourceType: input.sourceType,
    imageCount: input.images.length,
    angleDiversity,
    usedFallback: false,
    fallbackReason: null,
  })

  // STAGE 12: Phase 25 Trust Score
  const trustScoreResult = calculateTrustScore({
    imageCount: input.images.length,
    validImageCount: input.images.length, // All images valid if we got here
    angleTypes: input.images.map(img => img.angleType),
    angleDiversity,
    imageValidationIssues: [], // No validation issues in vision path
    landmarks: rawLandmarks,
    landmarkConsistencyScore: consistencyResult.consistencyScore,
    usedFallback: false,
    fallbackReason: null,
    wasRetried: false,
    totalAttempts: 1,
    timedOut: false,
    normalizationAdjustments: normalizationResult.adjustments.length,
    normalizationOutliers: normalizationResult.outlierCount,
    measurementConflicts: consistencyResult.issues.filter(i => i.severity === 'major').length,
    secondPassRan: twoPassResult.secondPassRan,
    sourceType: input.sourceType,
    captureDevice: input.captureDevice,
    earsFullyVisible: input.earsFullyVisible,
    mainFramePoints: input.mainFramePoints,
  })

  // Phase 54: Use reference consensus for error bands instead of a single confidence value.
  // The consensus engine already ran above; here we derive the final band from it.
  // Blend: use the consensus-derived band as the base, then cap it via calibrated confidence.
  const consensusBands = consensusToErrorBands(referenceConsensusResult)
  // Also compute the legacy band so we can take the tighter of the two for conservative estimates
  const legacyBands = calculateErrorBands(gross, calibratedConfidenceResult.calibratedConfidence)
  let low  = Math.max(consensusBands.low, legacyBands.low)   // tighter lower bound
  let high = Math.min(consensusBands.high, legacyBands.high) // tighter upper bound

  // Invariant: the displayed range must contain the point estimate. Intersecting
  // two independently-computed bands can yield a window that excludes `gross`
  // when the two estimators disagree (which is itself a signal worth surfacing
  // but never a reason to ship an incoherent CI). Widen back to include gross
  // and record the disagreement so the explanation panel can show it.
  let bandDisagreementNote: string | null = null
  if (gross < low || gross > high) {
    console.warn('[error-band] band intersection excluded point estimate — widening to contain it', {
      gross,
      consensusBands,
      legacyBands,
      tightenedLow: low,
      tightenedHigh: high,
    })
    bandDisagreementNote =
      `Calibration disagreement: consensus and legacy error bands diverge around ${gross.toFixed(1)}". ` +
      `Range widened to contain the point estimate.`
    low = Math.min(low, gross)
    high = Math.max(high, gross)
  }

  // Build confidence/trust metadata
  const confidenceTrustMetadata: ConfidenceTrustMetadata = {
    rawConfidence: confidencePercent,
    calibratedConfidence: calibratedConfidenceResult.calibratedConfidence,
    confidenceTier: calibratedConfidenceResult.tier,
    expectedMae: calibratedConfidenceResult.expectedErrorBand.expectedMae,
    trustScore: trustScoreResult.overallScore,
    trustTier: trustScoreResult.tier,
    confidenceExplanation: calibratedConfidenceResult.explanation,
    trustExplanation: [trustScoreResult.summary, ...trustScoreResult.positiveFactors.slice(0, 2)],
    topPositiveFactors: trustScoreResult.positiveFactors.slice(0, 3),
    topNegativeFactors: trustScoreResult.negativeFactors.slice(0, 3),
    recommendations: trustScoreResult.recommendations,
  }

  // Build explanations combining all stages
  const explanations: string[] = [
    ...visionOutput.explanation,
    `Vision model analyzed ${input.images.length} image(s) with ${baseVisionConfidence}% base confidence.`,
  ]

  if (bandDisagreementNote) {
    explanations.push(bandDisagreementNote)
  }

  if (precisionReferenceResult.detected) {
    explanations.push(precisionReferenceResult.summary)
  }
  if (precisionReferenceResult.notes.length > 0) {
    explanations.push(...precisionReferenceResult.notes)
  }
  
  // Add normalization info if adjustments were made
  if (normalizationResult.adjustments.length > 0) {
    explanations.push(`Applied ${normalizationResult.adjustments.length} measurement normalization(s).`)
  }
  
  // Add consistency info if issues found
  if (consistencyResult.issues.length > 0) {
    explanations.push(`Landmark consistency: ${consistencyResult.landmarkQuality}.`)
  }
  
  // Phase 42: Add geometry consistency and reference ranking info
  if (geometryResult.flags.length > 0) {
    explanations.push(`Geometry check: ${geometryResult.tier} (${geometryResult.flags.length} flags).`)
    if (geometryResult.confidenceAdjustment !== 0) {
      explanations.push(`Geometry confidence adjustment: ${geometryResult.confidenceAdjustment > 0 ? '+' : ''}${geometryResult.confidenceAdjustment}%.`)
    }
  }
  if (!referenceRanking.isSufficient) {
    explanations.push(`Reference quality: limited (${referenceRanking.primary.source.replace(/_/g, ' ')}).`)
  }
  
  // Add calibration explanation
  explanations.push(...calibratedConfidence.explanation)
  
  // Add Phase 21 measurement correction notes
  if (measurementCorrectionResult.summary.totalCategoriesCorrected > 0) {
    explanations.push(...measurementCorrectionResult.summary.notes)
  }

  // Phase 41: Add segment calibration note
  if (segmentedCal.hasSpecificSegments) {
    const activeNames = segmentedCal.matchedSegments
      .filter(s => !s.gated && s.level > 0)
      .map(s => s.name)
      .join(', ')
    explanations.push(`Segment calibration applied (${activeNames}): gross delta ${segmentCorrectionResult.grossDelta >= 0 ? '+' : ''}${segmentCorrectionResult.grossDelta.toFixed(1)}".`)
  }
  
  // Add Phase 10 learning notes
  explanations.push(...learningResult.summary.notes)

  // Add Phase 23 two-pass notes
  if (twoPassResult.secondPassRan) {
    explanations.push(`Second-pass scoring applied: ${twoPassResult.selection.method.replace('_', ' ')}.`)
    if (twoPassResult.passComparison) {
      const diff = Math.abs(twoPassResult.passComparison.grossDifference)
      if (diff >= 2) {
        explanations.push(`Pass difference: ${diff.toFixed(1)}".`)
      }
    }
  } else {
    explanations.push(`Self-check: ${selfCheckResult.overallStability} (${selfCheckResult.stabilityScore}% stability).`)
  }

  // Phase 54: Inject reference consensus explanation lines
  if (referenceConsensusResult.explanation.length > 0) {
    explanations.push(...referenceConsensusResult.explanation)
  }

  // Ring reference confidence note
  if (input.referenceObject?.ring?.present) {
    const ring = input.referenceObject.ring
    if (ring.innerDiameterInches && ring.confidence === 'estimated') {
      explanations.push(
        `Ring reference provided: US size ${ring.ringSizeUS ?? 'unknown'}, ` +
        `approx. ${ring.innerDiameterInches} in inner diameter. ` +
        `Used only as an estimated reference if clearly visible. ` +
        `Ruler or tape calibration is recommended for verified scoring.`
      )
    } else if (!ring.innerDiameterInches) {
      explanations.push(
        'Ring reference indicated but ring size not specified — not used for scale estimation.'
      )
    }
  }

  // Hat reference confidence note (independent of ring — both can be present)
  if (input.referenceObject?.hat?.present) {
    const hat = input.referenceObject.hat
    if (hat.hatType && hat.brimWidthInches) {
      explanations.push(
        `Hat reference provided: ${HAT_DIMENSIONS[hat.hatType].label}, ` +
        `approx. ${hat.brimWidthInches}" brim width. ` +
        `Used only as an estimated reference if clearly visible. ` +
        `Brim width varies by manufacturer (~±0.25"). ` +
        `Ruler or tape calibration is recommended for verified scoring.`
      )
    } else if (hat.hatType && hat.crownHeightInches) {
      explanations.push(
        `Hat reference provided: ${HAT_DIMENSIONS[hat.hatType].label}, ` +
        `crown only (no brim — lower reliability). ` +
        `Approx. ${hat.crownHeightInches}" crown height.`
      )
    } else if (!hat.hatType) {
      explanations.push(
        'Hat reference indicated but hat type not specified — not used for scale estimation.'
      )
    }
  }

  // Build scaling references
  const scalingReferencesUsed: string[] = [...visionOutput.anatomical_references_used]
  if (input.mainFramePoints) {
    scalingReferencesUsed.push(`User-provided frame hint (${input.mainFramePoints}-point)`)
  }
  if (input.precisionReferenceProfile?.summary.referencePresent) {
    const precisionRefLabel = `Precision reference (${input.precisionReferenceProfile.typeLabel})`
    scalingReferencesUsed.push(
      precisionReferenceResult.applied
        ? `${precisionRefLabel} ${precisionReferenceResult.summary}`
        : precisionRefLabel
    )
  }
  // Phase 54: Add dominant reference labels from consensus
  if (referenceConsensusResult.dominantReferences.length > 0) {
    scalingReferencesUsed.push(
      `Consensus: ${referenceConsensusResult.dominantReferences.map(r => r.replace(/_/g, ' ')).join(', ')}`
    )
  }
  scalingReferencesUsed.push(`State calibration (${input.state ?? 'unknown'})`)

  // Convert to simple learning summary for backward compatibility
  const simpleSummary = toSimpleLearningSummary(learningResult.summary)

  // Build TrainingCorrectionResult — structured output for UI and downstream logging
  const _correctionApplied = Math.abs(scaledGrossCorrection) >= 0.25
  const _lSummary = learningResult.summary
  const _correctionSources: string[] = _lSummary.strongestMatchingFeatures.slice(0, 4)
  const _biasDirection = scaledGrossCorrection > 0.25
    ? 'under-estimated'
    : scaledGrossCorrection < -0.25
    ? 'over-estimated'
    : 'no consistent bias detected'
  const _patternNote = _correctionApplied
    ? `AI ${_biasDirection} by ~${Math.abs(scaledGrossCorrection).toFixed(1)}" in ${_lSummary.highlySimilarExamplesUsed ?? _lSummary.verifiedExamplesConsidered ?? 0} similar historical examples`
    : `${_lSummary.notes[0] ?? 'Insufficient matching examples for correction'}`

  const trainingCorrectionResult: TrainingCorrectionResult = {
    correctionApplied: _correctionApplied,
    correctionAmount: Number(scaledGrossCorrection.toFixed(2)),
    correctionSourcesUsed: _correctionSources,
    correctionSampleSize: _lSummary.highlySimilarExamplesUsed ?? 0,
    correctionStrength: _lSummary.correctionStrength ?? 'none',
    learningAdjusted: _correctionApplied,
    historicalPatternSummary: _patternNote,
    similarExampleCount: _lSummary.verifiedExamplesConsidered ?? 0,
    estimatedBiasBeforeCorrection: Number(learningResult.grossCorrection.toFixed(2)),
    finalBiasAdjustment: Number(scaledGrossCorrection.toFixed(2)),
    exampleConsistency: _lSummary.exampleConsistency ?? 0,
    averageSimilarity: typeof (_lSummary as { avgSimilarity?: number }).avgSimilarity === 'number'
      ? ((_lSummary as { avgSimilarity?: number }).avgSimilarity as number)
      : 0,
  }

  // Phase 41: Fire-and-forget segment audit log (PATCH E: clean typed deltas, no unsafe cast)
  logPredictionSegments({
    traceId: input.traceId ?? null,
    predictionId: null, // populated downstream when the prediction row is persisted
    calibration: segmentedCal,
    calibrationDeltas: segmentCorrectionResult.deltas,
  })

  return {
    predictedGross: gross,
    predictedNet: net,
    confidencePercent,
    errorBandLow: Number(low.toFixed(1)),
    errorBandHigh: Number(high.toFixed(1)),
    measurements: finalMeasurements,
    landmarks: rawLandmarks,
    stateCalibration,
    processingTimeMs: twoPassResult.processingTimeMs + visionResult.processingTimeMs,
    imagesUsed: input.images.length,
    angleDiversityScore: Number(angleDiversity.toFixed(2)),
    confidenceExplanation: explanations,
    scalingReferencesUsed,
    learningSummary: simpleSummary,
    visionModelUsed: visionResult.modelUsed,
    scoringMethod: 'vision',
    visionConfidence: baseVisionConfidence,
    // Phase 9 metadata
    normalizationApplied: normalizationResult.adjustments.length > 0,
    normalizationAdjustments: normalizationResult.adjustments.length,
    landmarkConsistencyScore: Number(consistencyResult.consistencyScore.toFixed(2)),
    confidenceReliability: calibratedConfidence.reliability,
    // Phase 10 extended learning summary (for admin)
    extendedLearningSummary: learningResult.summary,
    // Phase 21 measurement-level correction summary
    measurementCorrectionSummary: measurementCorrectionResult.summary,
    // Phase 23 two-pass scoring metadata
    twoPassMetadata,
    // Phase 25 calibrated confidence and trust score
    calibratedConfidence: calibratedConfidenceResult.calibratedConfidence,
    confidenceTier: calibratedConfidenceResult.tier,
    rawConfidence: confidencePercent,
    trustScore: trustScoreResult.overallScore,
    trustTier: trustScoreResult.tier,
    expectedMae: calibratedConfidenceResult.expectedErrorBand.expectedMae,
    confidenceTrustMetadata,
    // Phase 41: Segment calibration summary
    segmentedCalibration: {
      matchedSegments: segmentedCal.matchedSegments,
      hasSpecificSegments: segmentedCal.hasSpecificSegments,
      totalSampleCount: segmentedCal.totalSampleCount,
      confidenceAdjustment: segmentedCal.confidenceAdjustment,
      grossDelta: segmentCorrectionResult.grossDelta,
    },
    // Phase 42: Geometry consistency and reference ranking
    phase42Metadata: {
      enhanced_landmarks: enhancedLandmarkData,
      reference_ranking: {
        primary_source: referenceRanking.primary.source,
        primary_confidence: referenceRanking.primary.confidence,
        fallback_source: referenceRanking.fallback?.source || null,
        fallback_confidence: referenceRanking.fallback?.confidence || null,
        overall_reliability: referenceRanking.overallReliability,
        is_sufficient: referenceRanking.isSufficient,
        spread_reference: referenceRanking.familyReferences.spread.source,
        beam_reference: referenceRanking.familyReferences.beam.source,
        tine_reference: referenceRanking.familyReferences.tine.source,
        mass_reference: referenceRanking.familyReferences.mass.source,
        warnings: referenceRanking.warnings,
      },
      geometry_consistency: {
        consistency_score: geometryResult.consistencyScore,
        tier: geometryResult.tier,
        confidence_adjustment: geometryResult.confidenceAdjustment,
        critical_flags: geometryResult.flags.filter(f => f.severity === 'critical').length,
        warning_flags: geometryResult.flags.filter(f => f.severity === 'warning').length,
        info_flags: geometryResult.flags.filter(f => f.severity === 'info').length,
        measurement_trust_penalties: geometryResult.measurementTrustPenalties,
        asymmetry_likely_real: geometryResult.asymmetryAnalysis.isLikelyReal,
        asymmetry_cause: geometryResult.asymmetryAnalysis.apparentCause,
        asymmetry_divergence: geometryResult.asymmetryAnalysis.leftRightDivergence,
        summary: geometryResult.summary,
        flags: geometryResult.flags.map(f => ({
          id: f.id,
          category: f.category,
          severity: f.severity,
          field: f.field,
          message: f.message,
        })),
      },
      phase42_version: '1.0.0',
      processed_at: new Date().toISOString(),
    },
    // Phase 54: Weighted multi-reference consensus output
    referenceConsensusResult,
    // Training correction layer output
    trainingCorrectionResult,
    precisionReferenceMetadata: input.precisionReferenceProfile
      ? {
          referenceType: input.precisionReferenceProfile.summary.referenceType,
          applied: precisionReferenceResult.applied,
          detected: precisionReferenceResult.detected,
          scaleFactor: precisionReferenceResult.scaleFactor,
          qualityScore: precisionReferenceResult.qualityScore,
          confidenceBoost: precisionReferenceResult.confidenceBoost,
          dominantMeasurement: precisionReferenceResult.dominantMeasurement,
          referenceSizeInches: input.precisionReferenceProfile.referenceSizeInches,
          referencePlacement: input.precisionReferenceProfile.referencePlacement,
          summary: precisionReferenceResult.summary,
          notes: precisionReferenceResult.notes,
        }
      : null,
  }
}


/**
 * Build output from heuristic scoring (fallback path)
 */
function buildHeuristicScoringOutput(
  input: ScoringInput,
  learned: LearnedAdjustment,
  stateCalibration: StateCalibration,
  angleDiversity: number,
  startTime: number,
  fallbackReason: string
): ScoringOutput {
  const angles   = input.images.map(img => img.angleType)
  const hasFront = angles.includes('front')
  const hasLeft  = angles.includes('left')
  const hasRight = angles.includes('right')
  const sideCount = (hasLeft ? 1 : 0) + (hasRight ? 1 : 0)
  const viewCount = (hasFront ? 1 : 0) + sideCount + (angles.includes('back') ? 1 : 0)
  const hasMultiView = viewCount >= 2

  const landmarks: LandmarksDetected = {
    ears_visible: input.earsFullyVisible ?? false,
    eyes_visible: hasFront,         // front angle gives eye reference
    antlers_visible: true,
    ear_base_to_tip: ANATOMICAL_REFERENCES.EAR_BASE_TO_TIP,
    eye_to_eye: ANATOMICAL_REFERENCES.EYE_TO_EYE,
    ear_tip_to_tip: ANATOMICAL_REFERENCES.EAR_TIP_TO_TIP_ALERT,
    quality_notes: [`Heuristic fallback: ${fallbackReason}`],
  }

  const { percent: baseConfidence, explanations } = calculateConfidence(
    angleDiversity,
    landmarks.ears_visible,
    landmarks.eyes_visible,
    input.images.length,
    input.sourceType,
    input.captureDevice,
  )

  // Reduce confidence for heuristic method — multi-view gets a smaller penalty
  // than single-view because it has more signal to work with.
  const heuristicPenalty = hasMultiView ? 0.88 : 0.78
  const confidencePercent = Math.min(82, Math.round(baseConfidence * heuristicPenalty + learned.confidenceBoost))
  explanations.unshift('Using heuristic estimation (vision analysis unavailable).')
  if (hasMultiView) {
    explanations.push(`Multi-view coverage (${viewCount} angles) improves fallback estimate.`)
  } else {
    explanations.push('Limited to single-view input — higher uncertainty applied.')
  }
  explanations.push(...learned.notes)

  const measurements = generateMeasurements(input, stateCalibration, confidencePercent)
  let { gross, net } = calculateScores(measurements)

  gross = Number((gross + learned.grossBias).toFixed(1))
  net   = Number((net   + learned.netBias).toFixed(1))

  // View-coverage-aware error bands:
  // Good multi-view coverage → tighter band even in fallback.
  // Single weak image → wide band to communicate real uncertainty.
  const viewBandFactor =
    viewCount >= 3 && hasFront ? 1.0 :
    viewCount >= 2             ? 1.15 :
    hasFront                   ? 1.25 :
    1.40  // side-only or unknown angle single image
  const { low: baseLow, high: baseHigh } = calculateErrorBands(gross, confidencePercent)
  const bandMid = (baseLow + baseHigh) / 2
  const halfBand = ((baseHigh - baseLow) / 2) * viewBandFactor
  const rawLow  = Math.max(0, bandMid - halfBand)
  const rawHigh = bandMid + halfBand
  // When baseLow clamps to 0 (small gross values), bandMid drifts away from
  // gross and the widened band can exclude it. Force containment (§6.9).
  const { low, high } = enforceRangeContainsPoint(rawLow, rawHigh, gross)

  // ── Dev log — one structured line per fallback run ────────────────────────
  if (process.env.NODE_ENV === 'development' || process.env.VERCEL_ENV === 'preview') {
    console.log('[fallback] heuristic scoring', {
      mode: 'fallback',
      reason: fallbackReason,
      state: input.state,
      rackType: input.rackType,
      sourceType: input.sourceType,
      captureDevice: input.captureDevice,
      imageCount: input.images.length,
      earsVisible: input.earsFullyVisible,
      mainFramePoints: input.mainFramePoints,
      viewCoverage: { hasFront, hasLeft, hasRight, viewCount },
      angleDiversity: Number(angleDiversity.toFixed(2)),
      stateAdjustment: stateCalibration.prior_adjustment,
      baselineChosen: `state=${input.state} source=${input.sourceType || 'na'} views=${viewCount}`,
      adjustmentsApplied: {
        heuristicPenalty,
        learnedGrossBias: learned.grossBias,
        learnedNetBias: learned.netBias,
        learnedConfidenceBoost: learned.confidenceBoost,
        viewBandFactor,
      },
      finalGross: gross,
      finalNet: net,
      confidencePercent,
      errorBand: { low: Number(low.toFixed(1)), high: Number(high.toFixed(1)) },
      confidenceReason: confidencePercent >= 65 ? 'medium' : 'low',
    })
  }

  const scalingReferencesUsed: string[] = []
  if (landmarks.ears_visible) scalingReferencesUsed.push(`Ear base-to-tip (${ANATOMICAL_REFERENCES.EAR_BASE_TO_TIP}" reference)`)
  if (landmarks.eyes_visible) scalingReferencesUsed.push(`Eye-to-eye distance (${ANATOMICAL_REFERENCES.EYE_TO_EYE}" reference)`)
  if (input.mainFramePoints) scalingReferencesUsed.push(`Main frame hint (${input.mainFramePoints}-point frame)`)
  if (input.captureDevice) scalingReferencesUsed.push(`Capture context (${String(input.captureDevice).replaceAll('_', ' ')})`)
  scalingReferencesUsed.push(`View coverage (${viewCount} angle${viewCount !== 1 ? 's' : ''}: ${angles.join(', ')})`)
  scalingReferencesUsed.push(`State guardrail (${input.state ?? 'unknown'})`)

  return {
    predictedGross: gross,
    predictedNet: net,
    confidencePercent,
    errorBandLow: Number(low.toFixed(1)),
    errorBandHigh: Number(high.toFixed(1)),
    measurements,
    landmarks,
    stateCalibration,
    processingTimeMs: Date.now() - startTime,
    imagesUsed: input.images.length,
    angleDiversityScore: Number(angleDiversity.toFixed(2)),
    confidenceExplanation: explanations,
    scalingReferencesUsed,
    learningSummary: learned.learningSummary,
    visionModelUsed: null,
    scoringMethod: 'heuristic',
    visionConfidence: null,
    normalizationApplied: false,
    normalizationAdjustments: 0,
    landmarkConsistencyScore: hasMultiView ? 0.6 : 0.4,
    confidenceReliability: confidencePercent >= 65 ? 'medium' : 'low',
  }
}

export async function reconstruct3D(_input: ScoringInput): Promise<unknown> {
  throw new Error('3D reconstruction not yet implemented')
}

export async function visualizeTaxidermy(_input: unknown): Promise<unknown> {
  throw new Error('Taxidermy visualization not yet implemented')
}
