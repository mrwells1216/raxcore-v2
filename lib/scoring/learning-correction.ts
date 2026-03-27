/**
 * Phase 10: Controlled Learning + Verified Correction Layer
 * 
 * Provides safe, similarity-weighted learning corrections from verified examples
 * without overfitting, instability, or random swings.
 * 
 * Pipeline position: After vision output + normalization, before final score
 */

import { createClient } from '@/lib/supabase/server'
import type { 
  Measurements, 
  AngleType, 
  SourceType, 
  CaptureDevice,
  ExtendedLearningSummary as ExtendedLearningSummaryType,
  MeasurementCorrectionInfo,
  VerifiedExampleInfluenceInfo,
  CalibrationProfile 
} from '@/lib/types'
import { HIGH_OUTPUT_STATES, LOW_OUTPUT_STATES } from '@/lib/constants'
import { DEFAULT_CALIBRATION_VALUES } from '@/lib/types'

// ============================================================================
// TYPES
// ============================================================================

export interface LearningInput {
  state: string
  rackType: 'typical' | 'non-typical'
  mainFramePoints?: number
  sourceType?: SourceType | string
  captureDevice?: CaptureDevice | string
  imageCount: number
  earsFullyVisible?: boolean
  harvestMethod?: string
  angleDiversity: number
  baseVisionConfidence: number
  normalizedConfidence: number
  // Phase 20: Optional calibration profile override
  calibrationProfile?: CalibrationProfile | null
}

// Re-export types from lib/types for convenience
export type MeasurementCorrection = MeasurementCorrectionInfo
export type VerifiedExampleInfluence = VerifiedExampleInfluenceInfo
export type ExtendedLearningSummary = ExtendedLearningSummaryType

export interface LearningCorrectionResult {
  // Score adjustments
  grossCorrection: number
  netCorrection: number
  confidenceBoost: number
  
  // Per-measurement corrections
  measurementCorrections: Map<string, number>
  
  // Summary for UI/API
  summary: ExtendedLearningSummary
}

// ============================================================================
// CONFIGURATION
// ============================================================================

// Similarity weights for feature matching (must sum close to 1.0)
const SIMILARITY_WEIGHTS = {
  state: 0.18,
  rackType: 0.15,
  mainFramePoints: 0.12,
  sourceType: 0.10,
  captureDevice: 0.06,
  imageCount: 0.08,
  earsFullyVisible: 0.05,
  harvestMethod: 0.04,
  angleDiversity: 0.07,
  confidenceTier: 0.10,
  stateRegion: 0.05, // Bonus for same high/low state region
} as const

// Correction guardrails
const GUARDRAILS = {
  // Maximum total score correction
  MAX_GROSS_CORRECTION: 8.0,
  MIN_GROSS_CORRECTION: -8.0,
  
  // Per-measurement maximums (as % of typical value)
  MAX_MEASUREMENT_CORRECTION_PERCENT: 0.15, // 15% max
  
  // Minimum requirements for correction
  MIN_SIMILAR_EXAMPLES: 3,
  MIN_SIMILARITY_THRESHOLD: 0.25, // 25% similarity minimum
  HIGH_SIMILARITY_THRESHOLD: 0.50, // 50% for "highly similar"
  
  // Consistency requirements
  MIN_CONSISTENCY_FOR_STRONG_CORRECTION: 0.6,
  MIN_CONSISTENCY_FOR_ANY_CORRECTION: 0.3,
  
  // Confidence-based scaling
  LOW_CONFIDENCE_CORRECTION_SCALE: 1.2, // Boost corrections when vision confidence low
  HIGH_CONFIDENCE_CORRECTION_SCALE: 0.6, // Reduce corrections when vision confidence high
  CONFIDENCE_BREAKPOINT_LOW: 55,
  CONFIDENCE_BREAKPOINT_HIGH: 80,
} as const

// Measurement categories for per-measurement correction
const MEASUREMENT_CATEGORIES = {
  spread: ['inside_spread'],
  beams: ['main_beam_left', 'main_beam_right'],
  tines: ['g1_left', 'g1_right', 'g2_left', 'g2_right', 'g3_left', 'g3_right', 'g4_left', 'g4_right', 'g5_left', 'g5_right'],
  mass: ['h1_left', 'h1_right', 'h2_left', 'h2_right', 'h3_left', 'h3_right', 'h4_left', 'h4_right'],
  deductions: ['deductions', 'abnormal_points'],
} as const

// ============================================================================
// SIMILARITY CALCULATION
// ============================================================================

interface ExampleMetadata {
  state?: string
  rack_type?: string
  main_frame_points?: number
  source_type?: string
  capture_device?: string
  image_count?: number
  ears_fully_visible?: boolean
  harvest_method?: string
  angle_diversity_score?: number
  confidence_percent?: number
}

function getConfidenceTier(confidence: number): 'low' | 'medium' | 'high' {
  if (confidence >= 75) return 'high'
  if (confidence >= 50) return 'medium'
  return 'low'
}

function calculateSimilarity(
  input: LearningInput,
  example: ExampleMetadata
): { score: number; matchingFeatures: string[]; missingFeatures: string[] } {
  let score = 0
  const matchingFeatures: string[] = []
  const missingFeatures: string[] = []

  // State match (exact)
  if (example.state === input.state) {
    score += SIMILARITY_WEIGHTS.state
    matchingFeatures.push(`State: ${input.state}`)
  } else {
    missingFeatures.push('State')
  }

  // State region match (partial credit)
  const inputIsHighOutput = HIGH_OUTPUT_STATES.includes(input.state as typeof HIGH_OUTPUT_STATES[number])
  const inputIsLowOutput = LOW_OUTPUT_STATES.includes(input.state as typeof LOW_OUTPUT_STATES[number])
  const exampleIsHighOutput = HIGH_OUTPUT_STATES.includes(example.state as typeof HIGH_OUTPUT_STATES[number])
  const exampleIsLowOutput = LOW_OUTPUT_STATES.includes(example.state as typeof LOW_OUTPUT_STATES[number])
  
  if ((inputIsHighOutput && exampleIsHighOutput) || (inputIsLowOutput && exampleIsLowOutput)) {
    score += SIMILARITY_WEIGHTS.stateRegion
    matchingFeatures.push('Same state tier')
  }

  // Rack type match
  if (example.rack_type === input.rackType) {
    score += SIMILARITY_WEIGHTS.rackType
    matchingFeatures.push(`Rack: ${input.rackType}`)
  } else {
    missingFeatures.push('Rack type')
  }

  // Main frame points (tiered)
  if (example.main_frame_points && input.mainFramePoints) {
    const diff = Math.abs(example.main_frame_points - input.mainFramePoints)
    if (diff === 0) {
      score += SIMILARITY_WEIGHTS.mainFramePoints
      matchingFeatures.push(`Frame: ${input.mainFramePoints}-point`)
    } else if (diff <= 2) {
      score += SIMILARITY_WEIGHTS.mainFramePoints * 0.5
      matchingFeatures.push('Similar frame')
    } else {
      missingFeatures.push('Frame size')
    }
  }

  // Source type match
  if (example.source_type && input.sourceType && example.source_type === input.sourceType) {
    score += SIMILARITY_WEIGHTS.sourceType
    matchingFeatures.push(`Source: ${input.sourceType}`)
  } else if (input.sourceType) {
    missingFeatures.push('Source type')
  }

  // Capture device match
  if (example.capture_device && input.captureDevice && example.capture_device === input.captureDevice) {
    score += SIMILARITY_WEIGHTS.captureDevice
    matchingFeatures.push(`Device: ${input.captureDevice}`)
  }

  // Image count similarity
  if (example.image_count !== undefined && example.image_count !== null) {
    const diff = Math.abs(example.image_count - input.imageCount)
    if (diff <= 1) {
      score += SIMILARITY_WEIGHTS.imageCount
      matchingFeatures.push('Image count match')
    } else if (diff <= 2) {
      score += SIMILARITY_WEIGHTS.imageCount * 0.5
    }
  }

  // Ears visibility match
  if (example.ears_fully_visible !== undefined && example.ears_fully_visible !== null) {
    if (example.ears_fully_visible === input.earsFullyVisible) {
      score += SIMILARITY_WEIGHTS.earsFullyVisible
      if (input.earsFullyVisible) matchingFeatures.push('Ears visible')
    }
  }

  // Harvest method match
  if (example.harvest_method && input.harvestMethod && example.harvest_method === input.harvestMethod) {
    score += SIMILARITY_WEIGHTS.harvestMethod
    matchingFeatures.push(`Harvest: ${input.harvestMethod}`)
  }

  // Angle diversity similarity
  if (example.angle_diversity_score !== undefined && example.angle_diversity_score !== null) {
    const diff = Math.abs(example.angle_diversity_score - input.angleDiversity)
    if (diff <= 0.15) {
      score += SIMILARITY_WEIGHTS.angleDiversity
      matchingFeatures.push('Angle coverage match')
    } else if (diff <= 0.3) {
      score += SIMILARITY_WEIGHTS.angleDiversity * 0.5
    }
  }

  // Confidence tier match
  if (example.confidence_percent !== undefined && example.confidence_percent !== null) {
    const exampleTier = getConfidenceTier(example.confidence_percent)
    const inputTier = getConfidenceTier(input.baseVisionConfidence)
    if (exampleTier === inputTier) {
      score += SIMILARITY_WEIGHTS.confidenceTier
      matchingFeatures.push(`Confidence: ${inputTier}`)
    }
  }

  return { score, matchingFeatures, missingFeatures }
}

// ============================================================================
// CONSISTENCY & GUARDRAILS
// ============================================================================

function calculateExampleConsistency(errors: number[]): number {
  if (errors.length < 2) return 1.0
  
  // Calculate coefficient of variation (lower = more consistent)
  const mean = errors.reduce((a, b) => a + b, 0) / errors.length
  if (Math.abs(mean) < 0.5) return 0.8 // Small errors are fairly consistent
  
  const variance = errors.reduce((sum, e) => sum + Math.pow(e - mean, 2), 0) / errors.length
  const stdDev = Math.sqrt(variance)
  const cv = stdDev / Math.abs(mean)
  
  // Convert CV to 0-1 consistency score (lower CV = higher consistency)
  return Math.max(0, Math.min(1, 1 - cv * 0.5))
}

function applyCorrectionGuardrails(
  rawCorrection: number,
  consistency: number,
  similarExampleCount: number,
  baseVisionConfidence: number
): { correction: number; capped: boolean; reason: string | null } {
  let correction = rawCorrection
  let capped = false
  let reason: string | null = null

  // Scale correction based on confidence
  if (baseVisionConfidence < GUARDRAILS.CONFIDENCE_BREAKPOINT_LOW) {
    correction *= GUARDRAILS.LOW_CONFIDENCE_CORRECTION_SCALE
  } else if (baseVisionConfidence > GUARDRAILS.CONFIDENCE_BREAKPOINT_HIGH) {
    correction *= GUARDRAILS.HIGH_CONFIDENCE_CORRECTION_SCALE
  }

  // Reduce correction if examples are inconsistent
  if (consistency < GUARDRAILS.MIN_CONSISTENCY_FOR_STRONG_CORRECTION) {
    const consistencyScale = consistency / GUARDRAILS.MIN_CONSISTENCY_FOR_STRONG_CORRECTION
    correction *= consistencyScale
    if (Math.abs(rawCorrection) !== Math.abs(correction)) {
      reason = `Reduced due to example disagreement (${(consistency * 100).toFixed(0)}% consistency)`
    }
  }

  // Reduce correction if few examples
  if (similarExampleCount < 8) {
    const sampleScale = similarExampleCount / 8
    correction *= sampleScale
    if (!reason) {
      reason = `Reduced due to limited examples (${similarExampleCount})`
    }
  }

  // Apply hard caps
  if (correction > GUARDRAILS.MAX_GROSS_CORRECTION) {
    correction = GUARDRAILS.MAX_GROSS_CORRECTION
    capped = true
    reason = `Capped at +${GUARDRAILS.MAX_GROSS_CORRECTION}" maximum`
  } else if (correction < GUARDRAILS.MIN_GROSS_CORRECTION) {
    correction = GUARDRAILS.MIN_GROSS_CORRECTION
    capped = true
    reason = `Capped at ${GUARDRAILS.MIN_GROSS_CORRECTION}" minimum`
  }

  return { correction, capped, reason }
}

// ============================================================================
// MAIN LEARNING FUNCTION
// ============================================================================

export async function computeLearningCorrection(
  input: LearningInput,
  currentMeasurements?: Measurements
): Promise<LearningCorrectionResult> {
  const emptyResult: LearningCorrectionResult = {
    grossCorrection: 0,
    netCorrection: 0,
    confidenceBoost: 0,
    measurementCorrections: new Map(),
    summary: {
      verifiedExamplesConsidered: 0,
      highlySimilarExamplesUsed: 0,
      strongestMatchingFeatures: [],
      weakestMatchingFeatures: [],
      correctionDirection: 'none',
      grossAdjustmentApplied: 0,
      netAdjustmentApplied: 0,
      confidenceAdjustmentApplied: 0,
      correctionStrength: 'none',
      measurementCorrections: [],
      correctionCapped: false,
      cappingReason: null,
      exampleConsistency: 0,
      influentialExamples: [],
      notes: ['No verified training examples available.'],
      matchQuality: 'none',
    },
  }

  try {
    const supabase = await createClient()
    
    // Fetch verified training examples with full metadata
    const { data: verifiedExamples, error: examplesError } = await supabase
      .from('training_examples')
      .select(`
        id, 
        buck_id,
        error_amount, 
        ground_truth_score, 
        predicted_score,
        main_beam_left,
        main_beam_right,
        inside_spread,
        tine_measurements,
        circumference_measurements
      `)
      .eq('verified_for_training', true)
      .not('error_amount', 'is', null)
      .limit(300)

    if (examplesError || !verifiedExamples || verifiedExamples.length === 0) {
      emptyResult.summary.notes = ['No verified training examples available yet.']
      return emptyResult
    }

    // Get buck metadata for all examples
    const buckIds = verifiedExamples.map(e => e.buck_id).filter(Boolean) as string[]
    
    const { data: bucks } = await supabase
      .from('bucks')
      .select('id, state, rack_type, main_frame_points, source_type, capture_device, ears_fully_visible, harvest_method')
      .in('id', buckIds)

    const bucksMap = new Map(bucks?.map(b => [b.id, b]) || [])

    // Get predictions for confidence and angle diversity
    const { data: predictions } = await supabase
      .from('predictions')
      .select('buck_id, images_used, angle_diversity_score, confidence_percent')
      .in('buck_id', buckIds)

    const predictionsMap = new Map(predictions?.map(p => [p.buck_id, p]) || [])

    // Calculate similarity for each verified example
    interface WeightedExample {
      id: string
      buckId: string
      similarity: number
      error: number
      matchingFeatures: string[]
      groundTruthScore: number
      predictedScore: number
      tineMeasurements?: Record<string, number>
      circumferenceMeasurements?: Record<string, number>
      spreadError?: number
      beamError?: number
    }

    const weightedExamples: WeightedExample[] = []
    const featureFrequency: Map<string, number> = new Map()
    const missingFeatureFrequency: Map<string, number> = new Map()

    for (const example of verifiedExamples) {
      if (!example.buck_id || typeof example.error_amount !== 'number') continue
      
      const buck = bucksMap.get(example.buck_id)
      const prediction = predictionsMap.get(example.buck_id)
      if (!buck) continue

      const { score, matchingFeatures, missingFeatures } = calculateSimilarity(input, {
        state: buck.state,
        rack_type: buck.rack_type,
        main_frame_points: buck.main_frame_points,
        source_type: buck.source_type,
        capture_device: buck.capture_device,
        image_count: prediction?.images_used,
        ears_fully_visible: buck.ears_fully_visible,
        harvest_method: buck.harvest_method,
        angle_diversity_score: prediction?.angle_diversity_score,
        confidence_percent: prediction?.confidence_percent,
      })

      // Only include examples meeting minimum similarity
      if (score >= GUARDRAILS.MIN_SIMILARITY_THRESHOLD) {
        weightedExamples.push({
          id: example.id,
          buckId: example.buck_id,
          similarity: score,
          error: example.error_amount,
          matchingFeatures,
          groundTruthScore: example.ground_truth_score,
          predictedScore: example.predicted_score || 0,
          tineMeasurements: example.tine_measurements as Record<string, number> | undefined,
          circumferenceMeasurements: example.circumference_measurements as Record<string, number> | undefined,
        })

        // Track feature frequency
        for (const feature of matchingFeatures) {
          featureFrequency.set(feature, (featureFrequency.get(feature) || 0) + 1)
        }
        for (const feature of missingFeatures) {
          missingFeatureFrequency.set(feature, (missingFeatureFrequency.get(feature) || 0) + 1)
        }
      }
    }

    // Check minimum example requirement
    if (weightedExamples.length < GUARDRAILS.MIN_SIMILAR_EXAMPLES) {
      emptyResult.summary.verifiedExamplesConsidered = verifiedExamples.length
      emptyResult.summary.notes = [
        `Found ${weightedExamples.length} similar example(s), need at least ${GUARDRAILS.MIN_SIMILAR_EXAMPLES} for correction.`
      ]
      return emptyResult
    }

    // Sort by similarity and take top examples
    weightedExamples.sort((a, b) => b.similarity - a.similarity)
    const topExamples = weightedExamples.slice(0, 20)
    const highlySimlarExamples = topExamples.filter(e => e.similarity >= GUARDRAILS.HIGH_SIMILARITY_THRESHOLD)

    // Calculate weighted error (similarity squared for stronger weighting)
    let totalWeight = 0
    let weightedErrorSum = 0
    const errors: number[] = []
    let positiveCorrections = 0
    let negativeCorrections = 0

    for (const ex of topExamples) {
      const weight = ex.similarity * ex.similarity
      totalWeight += weight
      weightedErrorSum += ex.error * weight
      errors.push(ex.error)

      if (ex.error > 0.5) positiveCorrections++
      else if (ex.error < -0.5) negativeCorrections++
    }

    const rawGrossCorrection = totalWeight > 0 ? weightedErrorSum / totalWeight : 0
    const consistency = calculateExampleConsistency(errors)

    // Check if examples are too inconsistent for any correction
    if (consistency < GUARDRAILS.MIN_CONSISTENCY_FOR_ANY_CORRECTION) {
      return {
        grossCorrection: 0,
        netCorrection: 0,
        confidenceBoost: Math.min(5, topExamples.length * 0.5),
        measurementCorrections: new Map(),
        summary: {
          verifiedExamplesConsidered: verifiedExamples.length,
          highlySimilarExamplesUsed: highlySimlarExamples.length,
          strongestMatchingFeatures: Array.from(featureFrequency.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([f]) => f),
          weakestMatchingFeatures: Array.from(missingFeatureFrequency.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([f]) => f),
          correctionDirection: 'none',
          grossAdjustmentApplied: 0,
          netAdjustmentApplied: 0,
          confidenceAdjustmentApplied: Math.min(5, topExamples.length * 0.5),
          correctionStrength: 'none',
          measurementCorrections: [],
          correctionCapped: false,
          cappingReason: 'Examples disagree too much for reliable correction',
          exampleConsistency: Number(consistency.toFixed(2)),
          influentialExamples: topExamples.slice(0, 5).map(ex => ({
            exampleId: ex.id,
            buckId: ex.buckId,
            similarity: Number(ex.similarity.toFixed(2)),
            matchingFeatures: ex.matchingFeatures,
            errorContribution: ex.error,
            groundTruthScore: ex.groundTruthScore,
            predictedScore: ex.predictedScore,
          })),
          notes: [
            `Found ${topExamples.length} similar example(s) but they disagree significantly.`,
            `Example consistency: ${(consistency * 100).toFixed(0)}% (need ${(GUARDRAILS.MIN_CONSISTENCY_FOR_ANY_CORRECTION * 100).toFixed(0)}% for correction).`
          ],
          matchQuality: 'weak',
        },
      }
    }

    // Apply guardrails to correction
    const { correction: baseGrossCorrection, capped, reason: cappingReason } = applyCorrectionGuardrails(
      rawGrossCorrection,
      consistency,
      topExamples.length,
      input.baseVisionConfidence
    )

    // Phase 20: Apply calibration profile scaling
    const calibration = input.calibrationProfile
    const learningStrength = calibration?.learning_correction_strength ?? DEFAULT_CALIBRATION_VALUES.learning_correction_strength
    const maxTotalCorrection = calibration?.max_total_correction ?? DEFAULT_CALIBRATION_VALUES.max_total_correction
    
    // Scale correction by calibration learning strength
    let grossCorrection = baseGrossCorrection * learningStrength
    
    // Apply calibration's max total correction cap
    if (Math.abs(grossCorrection) > maxTotalCorrection) {
      grossCorrection = Math.sign(grossCorrection) * maxTotalCorrection
    }

    const netCorrection = grossCorrection * 0.85 // Net correction slightly less aggressive

    // Calculate confidence boost
    const avgSimilarity = topExamples.reduce((sum, ex) => sum + ex.similarity, 0) / topExamples.length
    const confidenceBoost = Math.min(12, topExamples.length * avgSimilarity * 1.5)

    // Determine correction direction
    let correctionDirection: ExtendedLearningSummary['correctionDirection'] = 'none'
    if (Math.abs(grossCorrection) > 0.5) {
      if (positiveCorrections > negativeCorrections * 2) correctionDirection = 'increase'
      else if (negativeCorrections > positiveCorrections * 2) correctionDirection = 'decrease'
      else correctionDirection = 'mixed'
    }

    // Determine correction strength
    let correctionStrength: ExtendedLearningSummary['correctionStrength'] = 'none'
    if (Math.abs(grossCorrection) >= 5) correctionStrength = 'high'
    else if (Math.abs(grossCorrection) >= 2.5) correctionStrength = 'medium'
    else if (Math.abs(grossCorrection) >= 1) correctionStrength = 'low'

    // Determine match quality
    let matchQuality: ExtendedLearningSummary['matchQuality'] = 'none'
    if (avgSimilarity >= 0.6) matchQuality = 'strong'
    else if (avgSimilarity >= 0.4) matchQuality = 'moderate'
    else if (avgSimilarity >= GUARDRAILS.MIN_SIMILARITY_THRESHOLD) matchQuality = 'weak'

    // Build per-measurement corrections (simplified - based on overall error direction)
    // Phase 20: Use calibration weights for measurement corrections
    const measurementCorrections = new Map<string, number>()
    const measurementCorrectionsList: MeasurementCorrection[] = []

    // Get calibration weights (default to 1.0 if no calibration profile)
    const spreadWeight = calibration?.spread_correction_weight ?? DEFAULT_CALIBRATION_VALUES.spread_correction_weight
    const beamWeight = calibration?.beam_correction_weight ?? DEFAULT_CALIBRATION_VALUES.beam_correction_weight
    const maxSpreadCorr = calibration?.max_spread_correction ?? DEFAULT_CALIBRATION_VALUES.max_spread_correction
    const maxBeamCorr = calibration?.max_beam_correction ?? DEFAULT_CALIBRATION_VALUES.max_beam_correction

    if (currentMeasurements && Math.abs(grossCorrection) >= 1) {
      // Distribute correction proportionally across measurement categories
      const correctionFraction = grossCorrection / 100 // As fraction of typical total
      
      // Apply small corrections to main measurements (scaled by calibration weights)
      if (currentMeasurements.inside_spread) {
        const spreadCorrection = correctionFraction * currentMeasurements.inside_spread * 0.3 * spreadWeight
        const cappedSpreadCorrection = Math.max(-maxSpreadCorr, Math.min(maxSpreadCorr, spreadCorrection))
        measurementCorrections.set('inside_spread', cappedSpreadCorrection)
        measurementCorrectionsList.push({
          field: 'inside_spread',
          originalValue: currentMeasurements.inside_spread,
          correction: cappedSpreadCorrection,
          correctedValue: currentMeasurements.inside_spread + cappedSpreadCorrection,
          confidence: avgSimilarity,
          sampleCount: topExamples.length,
        })
      }

      // Beam corrections (scaled by calibration weights)
      for (const beam of ['main_beam_left', 'main_beam_right'] as const) {
        const val = currentMeasurements[beam]
        if (val) {
          const beamCorrection = correctionFraction * val * 0.25 * beamWeight
          const cappedBeamCorrection = Math.max(-maxBeamCorr, Math.min(maxBeamCorr, beamCorrection))
          measurementCorrections.set(beam, cappedBeamCorrection)
          measurementCorrectionsList.push({
            field: beam,
            originalValue: val,
            correction: cappedBeamCorrection,
            correctedValue: val + cappedBeamCorrection,
            confidence: avgSimilarity,
            sampleCount: topExamples.length,
          })
        }
      }
    }

    // Build notes
    const notes: string[] = []
    notes.push(`Used ${topExamples.length} similar verified example(s) with ${matchQuality} match quality.`)
    
    if (grossCorrection > 0.5) {
      notes.push(`Training suggests AI under-estimates by ~${grossCorrection.toFixed(1)}" for similar bucks.`)
    } else if (grossCorrection < -0.5) {
      notes.push(`Training suggests AI over-estimates by ~${Math.abs(grossCorrection).toFixed(1)}" for similar bucks.`)
    }

    if (capped && cappingReason) {
      notes.push(cappingReason)
    }

    // Build influential examples list (for admin)
    const influentialExamples: VerifiedExampleInfluence[] = topExamples.slice(0, 8).map(ex => ({
      exampleId: ex.id,
      buckId: ex.buckId,
      similarity: Number(ex.similarity.toFixed(2)),
      matchingFeatures: ex.matchingFeatures,
      errorContribution: ex.error,
      groundTruthScore: ex.groundTruthScore,
      predictedScore: ex.predictedScore,
    }))

    // Build strongest/weakest features
    const strongestFeatures = Array.from(featureFrequency.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([f]) => f)

    const weakestFeatures = Array.from(missingFeatureFrequency.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([f]) => f)

    return {
      grossCorrection: Number(grossCorrection.toFixed(2)),
      netCorrection: Number(netCorrection.toFixed(2)),
      confidenceBoost: Number(confidenceBoost.toFixed(1)),
      measurementCorrections,
      summary: {
        verifiedExamplesConsidered: verifiedExamples.length,
        highlySimilarExamplesUsed: highlySimlarExamples.length,
        strongestMatchingFeatures: strongestFeatures,
        weakestMatchingFeatures: weakestFeatures,
        correctionDirection,
        grossAdjustmentApplied: Number(grossCorrection.toFixed(2)),
        netAdjustmentApplied: Number(netCorrection.toFixed(2)),
        confidenceAdjustmentApplied: Number(confidenceBoost.toFixed(1)),
        correctionStrength,
        measurementCorrections: measurementCorrectionsList,
        correctionCapped: capped,
        cappingReason,
        exampleConsistency: Number(consistency.toFixed(2)),
        influentialExamples,
        notes,
        matchQuality,
      },
    }
  } catch (err) {
    console.error('Error in learning correction:', err)
    emptyResult.summary.notes = ['Error accessing training memory.']
    return emptyResult
  }
}

/**
 * Convert extended learning summary to the simpler LearningSummary for backward compatibility
 */
export function toSimpleLearningSummary(extended: ExtendedLearningSummary) {
  return {
    similarExamplesUsed: extended.highlySimilarExamplesUsed,
    strongestMatchingFeatures: extended.strongestMatchingFeatures,
    correctionIncrease: extended.correctionDirection === 'increase' ? 1 : 0,
    correctionDecrease: extended.correctionDirection === 'decrease' ? 1 : 0,
    confidenceImpact: extended.confidenceAdjustmentApplied,
    matchQuality: extended.matchQuality,
    notes: extended.notes,
  }
}

/**
 * Phase 20: Get the currently active calibration profile
 * Returns null if no active profile exists (defaults will be used)
 */
export async function getActiveCalibrationProfile(): Promise<CalibrationProfile | null> {
  try {
    const supabase = await createClient()
    
    const { data, error } = await supabase
      .from('calibration_profiles')
      .select('*')
      .eq('is_active', true)
      .single()
    
    if (error || !data) {
      return null
    }
    
    return data as CalibrationProfile
  } catch {
    return null
  }
}
