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
  SelfCheckSummary 
} from '@/lib/types'
import { HIGH_OUTPUT_STATES, LOW_OUTPUT_STATES, ANATOMICAL_REFERENCES, CONFIDENCE_THRESHOLDS } from '@/lib/constants'
import { createClient } from '@/lib/supabase/server'
import { 
  scoreWithVision, 
  visionOutputToMeasurements, 
  visionOutputToLandmarks,
  type VisionScoringResult 
} from './vision-scorer'
import { normalizeMeasurements, type NormalizationResult } from './normalization'
import { checkLandmarkConsistency, type LandmarkConsistencyResult } from './landmark-consistency'
import { recalibrateConfidence, type CalibratedConfidence } from './confidence-calibration'
import { computeLearningCorrection, toSimpleLearningSummary } from './learning-correction'
import { computeMeasurementLevelCorrection, type MeasurementCorrectionResult } from './measurement-correction'
import { runSelfCheck, type SelfCheckResult } from './self-check'
import { runTwoPassScoring, type TwoPassScoringResult, type SecondPassInput } from './second-pass'
import { getActiveCalibrationProfile } from '@/lib/calibration/utils'
import type { ExtendedLearningSummary, CalibrationProfile, MeasurementCorrectionSummary } from '@/lib/types'

export interface ImageAnalysisInput {
  imageUrl: string
  angleType: AngleType
  width: number
  height: number
}

export interface ScoringInput {
  images: ImageAnalysisInput[]
  state: string
  rackType: 'typical' | 'non-typical'
  earsFullyVisible?: boolean
  sourceType?: SourceType | string
  captureDevice?: CaptureDevice | string
  harvestYear?: number
  mainFramePoints?: number
  // Phase 20: Optional explicit calibration profile for model comparison
  // If not provided, uses the active calibration profile
  calibrationProfile?: CalibrationProfile | null
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
  if (example.state === input.state) {
    score += SIMILARITY_WEIGHTS.state
    matchingFeatures.push(`State: ${input.state}`)
  } else if (
    (HIGH_OUTPUT_STATES.includes(input.state as typeof HIGH_OUTPUT_STATES[number]) &&
      HIGH_OUTPUT_STATES.includes(example.state as typeof HIGH_OUTPUT_STATES[number])) ||
    (LOW_OUTPUT_STATES.includes(input.state as typeof LOW_OUTPUT_STATES[number]) &&
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

function generateMeasurements(input: ScoringInput, stateCalibration: StateCalibration, confidence: number): Measurements {
  const seed = [input.state, input.rackType, input.sourceType || 'na', input.captureDevice || 'na', String(input.mainFramePoints || 0), String(input.images.length)].join('|')
  const isTypical = input.rackType === 'typical'
  const framePts = input.mainFramePoints || (isTypical ? 10 : 11)
  const giantStateBoost = HIGH_OUTPUT_STATES.includes(input.state as typeof HIGH_OUTPUT_STATES[number]) ? 1.4 : 0
  const lowStatePenalty = LOW_OUTPUT_STATES.includes(input.state as typeof LOW_OUTPUT_STATES[number]) ? -1 : 0
  const imageBoost = Math.min(2.25, input.images.length * 0.45)
  const mountBoost = input.sourceType === 'mounted_photo' || input.sourceType === 'european_mount' ? 1.1 : 0
  const qualityBoost = confidence >= 75 ? 1.4 : confidence >= 55 ? 0.6 : -0.5
  const frameBoost = framePts >= 12 ? 2.2 : framePts >= 10 ? 0.8 : -0.6
  const context = stateCalibration.prior_adjustment + giantStateBoost + lowStatePenalty + imageBoost + mountBoost + qualityBoost + frameBoost

  const insideSpread = seeded(`${seed}:spread`, 16.2, 22.8) + context * 0.28
  const mainBeamLeft = seeded(`${seed}:mbl`, 21.8, 27.6) + context * 0.34
  const mainBeamRight = seeded(`${seed}:mbr`, 21.7, 27.3) + context * 0.34
  const g2Base = seeded(`${seed}:g2`, 8.4, 11.7) + context * 0.15
  const g3Base = seeded(`${seed}:g3`, 7.2, 10.4) + context * 0.14
  const g4Base = seeded(`${seed}:g4`, 4.3, 8.1) + context * 0.1
  const abnormal = isTypical ? 0 : seeded(`${seed}:ab`, 6.0, 16.5) + Math.max(0, context * 0.25)

  return {
    inside_spread: Number(insideSpread.toFixed(1)),
    main_beam_left: Number(mainBeamLeft.toFixed(1)),
    main_beam_right: Number(mainBeamRight.toFixed(1)),
    g1_left: Number(seeded(`${seed}:g1l`, 3.6, 5.8).toFixed(1)),
    g1_right: Number(seeded(`${seed}:g1r`, 3.6, 5.8).toFixed(1)),
    g2_left: Number(g2Base.toFixed(1)),
    g2_right: Number((g2Base - seeded(`${seed}:g2d`, 0.0, 0.8)).toFixed(1)),
    g3_left: Number(g3Base.toFixed(1)),
    g3_right: Number((g3Base - seeded(`${seed}:g3d`, 0.0, 0.7)).toFixed(1)),
    g4_left: Number(g4Base.toFixed(1)),
    g4_right: Number((g4Base - seeded(`${seed}:g4d`, 0.0, 0.7)).toFixed(1)),
    g5_left: framePts >= 12 ? Number(seeded(`${seed}:g5l`, 1.2, 4.1).toFixed(1)) : null,
    g5_right: framePts >= 12 ? Number(seeded(`${seed}:g5r`, 1.2, 4.0).toFixed(1)) : null,
    h1_left: Number((seeded(`${seed}:h1l`, 4.0, 5.2) + context * 0.05).toFixed(1)),
    h1_right: Number((seeded(`${seed}:h1r`, 4.0, 5.2) + context * 0.05).toFixed(1)),
    h2_left: Number((seeded(`${seed}:h2l`, 3.8, 5.0) + context * 0.05).toFixed(1)),
    h2_right: Number((seeded(`${seed}:h2r`, 3.8, 5.0) + context * 0.05).toFixed(1)),
    h3_left: Number((seeded(`${seed}:h3l`, 3.6, 4.8) + context * 0.05).toFixed(1)),
    h3_right: Number((seeded(`${seed}:h3r`, 3.6, 4.8) + context * 0.05).toFixed(1)),
    h4_left: Number((seeded(`${seed}:h4l`, 3.4, 4.6) + context * 0.05).toFixed(1)),
    h4_right: Number((seeded(`${seed}:h4r`, 3.4, 4.6) + context * 0.05).toFixed(1)),
    abnormal_points: Number(abnormal.toFixed(1)),
    deductions: Number(seeded(`${seed}:ded`, 1.8, 5.2).toFixed(1)),
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
 */
export async function scoreBuck(input: ScoringInput): Promise<ScoringOutput> {
  const startTime = Date.now()
  const angles = input.images.map((img) => img.angleType)
  const angleDiversity = calculateAngleDiversity(angles)
  const stateCalibration = getStateCalibration(input.state)

  // Try vision scoring first
  const visionResult = await scoreWithVision({
    images: input.images,
    state: input.state,
    rackType: input.rackType,
    earsFullyVisible: input.earsFullyVisible,
    sourceType: input.sourceType,
    captureDevice: input.captureDevice,
    mainFramePoints: input.mainFramePoints,
  })

  if (visionResult.success) {
    // Vision scoring succeeded - use vision measurements with Phase 10 learning
    // Pass explicit calibration profile if provided, otherwise uses active profile
    return buildVisionScoringOutput(
      input,
      visionResult,
      input.calibrationProfile,
      stateCalibration,
      angleDiversity,
      startTime
    )
  }

  // Vision failed - fall back to heuristic scoring
  // Use legacy learning for heuristic path
  const learned = await getLearnedAdjustment(input, angleDiversity)
  console.warn('Vision scoring failed, using heuristic fallback:', visionResult.error)
  return buildHeuristicScoringOutput(
    input,
    learned,
    stateCalibration,
    angleDiversity,
    startTime,
    visionResult.fallbackReason
  )
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
  const rawMeasurements = visionOutputToMeasurements(visionOutput)
  const rawLandmarks = visionOutputToLandmarks(visionOutput)

  // STAGE 1: Raw vision output
  const baseVisionConfidence = visionOutput.confidence_percent

  // STAGE 2: Normalization - reduce outliers, enforce realistic ranges
  const normalizationResult = normalizeMeasurements(rawMeasurements)
  const normalizedMeasurements = normalizationResult.normalized

  // STAGE 3: Landmark consistency - validate anatomical ratios
  const consistencyResult = checkLandmarkConsistency(
    normalizedMeasurements,
    rawLandmarks,
    visionOutput.landmarks.ear_base_to_tip_estimated
  )
  const consistentMeasurements = consistencyResult.adjustedMeasurements

  // STAGE 4: Confidence recalibration based on all factors
  const calibratedConfidence = recalibrateConfidence(
    baseVisionConfidence,
    rawLandmarks,
    input.images.map(img => img.angleType),
    normalizationResult,
    consistencyResult
  )

  // Phase 20: Use explicit calibration profile if provided, otherwise fetch active profile
  const calibrationProfile = explicitCalibrationProfile ?? await getActiveCalibrationProfile()

  // STAGE 5: Phase 21 Measurement-Level Correction - correct individual measurements first
  const measurementCorrectionResult = await computeMeasurementLevelCorrection(
    {
      state: input.state,
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
    consistentMeasurements
  )

  // Use measurement-corrected measurements as the base for further processing
  const measurementCorrectedMeasurements = measurementCorrectionResult.correctedMeasurements

  // STAGE 6: Phase 10 Learning Correction - additional total-score adjustment
  // This provides supplemental correction on top of measurement-level corrections
  const learningResult = await computeLearningCorrection(
    {
      state: input.state,
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
    measurementCorrectedMeasurements
  )

  // STAGE 7: Apply any remaining per-field corrections from learning result
  const correctedMeasurements = { ...measurementCorrectedMeasurements }
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
  const confidenceScaling = calibrationProfile?.confidence_scaling ?? 1.0
  const baseConfidenceWithBoost = calibratedConfidence.finalConfidence + learningResult.confidenceBoost
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
    state: input.state,
    rackType: input.rackType,
    mainFramePoints: input.mainFramePoints,
    sourceType: input.sourceType,
  })

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
    state: input.state,
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

  const { low, high } = calculateErrorBands(gross, confidencePercent)

  // Build explanations combining all stages
  const explanations: string[] = [
    ...visionOutput.explanation,
    `Vision model analyzed ${input.images.length} image(s) with ${baseVisionConfidence}% base confidence.`,
  ]
  
  // Add normalization info if adjustments were made
  if (normalizationResult.adjustments.length > 0) {
    explanations.push(`Applied ${normalizationResult.adjustments.length} measurement normalization(s).`)
  }
  
  // Add consistency info if issues found
  if (consistencyResult.issues.length > 0) {
    explanations.push(`Landmark consistency: ${consistencyResult.landmarkQuality}.`)
  }
  
  // Add calibration explanation
  explanations.push(...calibratedConfidence.explanation)
  
  // Add Phase 21 measurement correction notes
  if (measurementCorrectionResult.summary.totalCategoriesCorrected > 0) {
    explanations.push(...measurementCorrectionResult.summary.notes)
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

  // Build scaling references
  const scalingReferencesUsed: string[] = [...visionOutput.anatomical_references_used]
  if (input.mainFramePoints) {
    scalingReferencesUsed.push(`User-provided frame hint (${input.mainFramePoints}-point)`)
  }
  scalingReferencesUsed.push(`State calibration (${input.state})`)

  // Convert to simple learning summary for backward compatibility
  const simpleSummary = toSimpleLearningSummary(learningResult.summary)

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
  const landmarks: LandmarksDetected = {
    ears_visible: input.earsFullyVisible ?? true,
    eyes_visible: true,
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

  // Reduce confidence for heuristic method
  const confidencePercent = Math.min(85, Math.round(baseConfidence * 0.85 + learned.confidenceBoost))
  explanations.unshift('Using heuristic estimation (vision analysis unavailable).')
  explanations.push(...learned.notes)

  const measurements = generateMeasurements(input, stateCalibration, confidencePercent)
  let { gross, net } = calculateScores(measurements)

  gross = Number((gross + learned.grossBias).toFixed(1))
  net = Number((net + learned.netBias).toFixed(1))

  const { low, high } = calculateErrorBands(gross, confidencePercent)

  const scalingReferencesUsed: string[] = []
  if (landmarks.ears_visible) scalingReferencesUsed.push(`Ear base-to-tip (${ANATOMICAL_REFERENCES.EAR_BASE_TO_TIP}" reference)`)
  if (landmarks.eyes_visible) scalingReferencesUsed.push(`Eye-to-eye distance (${ANATOMICAL_REFERENCES.EYE_TO_EYE}" reference)`)
  if (input.mainFramePoints) scalingReferencesUsed.push(`Main frame hint (${input.mainFramePoints}-point frame)`)
  if (input.captureDevice) scalingReferencesUsed.push(`Capture context (${String(input.captureDevice).replaceAll('_', ' ')})`)
  scalingReferencesUsed.push(`State guardrail (${input.state})`)

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
    // Phase 9 metadata (not applicable for heuristic)
    normalizationApplied: false,
    normalizationAdjustments: 0,
    landmarkConsistencyScore: 0.5,
    confidenceReliability: confidencePercent >= 65 ? 'medium' : 'low',
  }
}

export async function reconstruct3D(_input: ScoringInput): Promise<unknown> {
  throw new Error('3D reconstruction not yet implemented')
}

export async function visualizeTaxidermy(_input: unknown): Promise<unknown> {
  throw new Error('Taxidermy visualization not yet implemented')
}
