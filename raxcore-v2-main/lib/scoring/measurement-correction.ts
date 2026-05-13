/**
 * Phase 21: Measurement-Level Error Correction
 * 
 * Corrects individual measurement components (spread, beams, tines, mass, deductions)
 * before recomputing final gross/net scores. This provides more granular and accurate
 * corrections compared to total-score-level adjustments.
 * 
 * Pipeline position: After normalization, before final score calculation
 */

import { createClient } from '@/lib/supabase/server'
import type { 
  Measurements, 
  SourceType, 
  CaptureDevice,
  CalibrationProfile 
} from '@/lib/types'
import { HIGH_OUTPUT_STATES, LOW_OUTPUT_STATES } from '@/lib/constants'
import { 
  getCalibrationApplicationValues,
} from '@/lib/calibration/utils'

// ============================================================================
// TYPES
// ============================================================================

export type MeasurementCategory = 'spread' | 'beam' | 'tine' | 'mass' | 'deduction'

export interface MeasurementCorrectionInput {
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
  calibrationProfile?: CalibrationProfile | null
}

export interface CategoryCorrection {
  category: MeasurementCategory
  fields: string[]
  originalTotal: number
  correctedTotal: number
  correctionAmount: number
  correctionPercent: number
  confidence: number
  sampleCount: number
  direction: 'increase' | 'decrease' | 'none'
  capped: boolean
  cappingReason: string | null
}

export interface FieldCorrection {
  field: string
  category: MeasurementCategory
  originalValue: number
  correction: number
  correctedValue: number
  confidence: number
  sampleCount: number
}

export interface MeasurementCorrectionResult {
  // Original and corrected measurements
  originalMeasurements: Measurements
  correctedMeasurements: Measurements
  
  // Per-field corrections
  fieldCorrections: FieldCorrection[]
  
  // Category-level summary
  categoryCorrections: CategoryCorrection[]
  
  // Recomputed scores
  originalGross: number
  originalNet: number
  correctedGross: number
  correctedNet: number
  totalCorrectionGross: number
  totalCorrectionNet: number
  
  // Summary for UI/API
  summary: MeasurementCorrectionSummary
}

export interface MeasurementCorrectionSummary {
  totalFieldsCorrected: number
  totalCategoriesCorrected: number
  strongestCorrection: {
    category: MeasurementCategory
    amount: number
    direction: 'increase' | 'decrease'
  } | null
  weakestCategory: MeasurementCategory | null
  overallCorrectionDirection: 'increase' | 'decrease' | 'mixed' | 'none'
  grossCorrectionApplied: number
  netCorrectionApplied: number
  confidenceWeightedAvg: number
  verifiedExamplesUsed: number
  highlySimilarExamplesUsed: number
  correctionStrength: 'none' | 'low' | 'medium' | 'high'
  notes: string[]
}

export interface VerifiedMeasurementExample {
  id: string
  buckId: string
  similarity: number
  matchingFeatures: string[]
  // Ground truth measurements
  gtSpread?: number
  gtBeamLeft?: number
  gtBeamRight?: number
  gtTines?: Record<string, number>
  gtMass?: Record<string, number>
  gtDeductions?: number
  gtGross: number
  gtNet?: number
  // Predicted measurements
  predSpread?: number
  predBeamLeft?: number
  predBeamRight?: number
  predTines?: Record<string, number>
  predMass?: Record<string, number>
  predDeductions?: number
  predGross: number
  predNet?: number
  // Per-category errors (ground_truth - predicted)
  spreadError?: number
  beamError?: number
  tineError?: number
  massError?: number
  deductionError?: number
}

// ============================================================================
// CONFIGURATION
// ============================================================================

// Measurement category mappings
export const MEASUREMENT_CATEGORIES: Record<MeasurementCategory, string[]> = {
  spread: ['inside_spread'],
  beam: ['main_beam_left', 'main_beam_right'],
  tine: [
    'g1_left', 'g1_right', 
    'g2_left', 'g2_right', 
    'g3_left', 'g3_right', 
    'g4_left', 'g4_right', 
    'g5_left', 'g5_right'
  ],
  mass: [
    'h1_left', 'h1_right', 
    'h2_left', 'h2_right', 
    'h3_left', 'h3_right', 
    'h4_left', 'h4_right'
  ],
  deduction: ['deductions', 'abnormal_points'],
}

// Category-specific correction caps (in inches)
const DEFAULT_CATEGORY_CAPS: Record<MeasurementCategory, number> = {
  spread: 3.0,
  beam: 4.0,
  tine: 2.0,
  mass: 1.0,
  deduction: 2.5,
}

// Per-field correction caps as percentage of typical value
const FIELD_CORRECTION_PERCENT_CAP = 0.15 // 15% max

// Similarity weights for feature matching
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
  stateRegion: 0.05,
} as const

// Guardrails
const GUARDRAILS = {
  MIN_SIMILAR_EXAMPLES: 3,
  MIN_SIMILARITY_THRESHOLD: 0.25,
  HIGH_SIMILARITY_THRESHOLD: 0.50,
  MIN_CONSISTENCY_FOR_STRONG_CORRECTION: 0.6,
  MIN_CONSISTENCY_FOR_ANY_CORRECTION: 0.3,
  LOW_CONFIDENCE_CORRECTION_SCALE: 1.2,
  HIGH_CONFIDENCE_CORRECTION_SCALE: 0.6,
  CONFIDENCE_BREAKPOINT_LOW: 55,
  CONFIDENCE_BREAKPOINT_HIGH: 80,
} as const

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function getConfidenceTier(confidence: number): 'low' | 'medium' | 'high' {
  if (confidence >= 75) return 'high'
  if (confidence >= 50) return 'medium'
  return 'low'
}

function getCategoryFromField(field: string): MeasurementCategory | null {
  for (const [category, fields] of Object.entries(MEASUREMENT_CATEGORIES)) {
    if (fields.includes(field)) {
      return category as MeasurementCategory
    }
  }
  return null
}

function calculateCategoryTotal(measurements: Measurements, category: MeasurementCategory): number {
  const fields = MEASUREMENT_CATEGORIES[category]
  let total = 0
  for (const field of fields) {
    const value = measurements[field as keyof Measurements]
    if (typeof value === 'number' && value > 0) {
      total += value
    }
  }
  return total
}

function calculateGrossScore(measurements: Measurements): number {
  const fields = [
    'inside_spread',
    'main_beam_left', 'main_beam_right',
    'g1_left', 'g1_right',
    'g2_left', 'g2_right',
    'g3_left', 'g3_right',
    'g4_left', 'g4_right',
    'g5_left', 'g5_right',
    'h1_left', 'h1_right',
    'h2_left', 'h2_right',
    'h3_left', 'h3_right',
    'h4_left', 'h4_right',
    'abnormal_points',
  ]
  
  let total = 0
  for (const field of fields) {
    const value = measurements[field as keyof Measurements]
    if (typeof value === 'number') {
      total += value
    }
  }
  return Number(total.toFixed(1))
}

function calculateNetScore(measurements: Measurements): number {
  const gross = calculateGrossScore(measurements)
  const deductions = measurements.deductions || 0
  const abnormal = measurements.abnormal_points || 0
  return Number((gross - deductions - abnormal).toFixed(1))
}

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

function calculateSimilarity(
  input: MeasurementCorrectionInput,
  example: ExampleMetadata
): { score: number; matchingFeatures: string[] } {
  let score = 0
  const matchingFeatures: string[] = []

  // State match (exact)
  if (example.state === input.state) {
    score += SIMILARITY_WEIGHTS.state
    matchingFeatures.push(`State: ${input.state}`)
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
    }
  }

  // Source type match
  if (example.source_type && input.sourceType && example.source_type === input.sourceType) {
    score += SIMILARITY_WEIGHTS.sourceType
    matchingFeatures.push(`Source: ${input.sourceType}`)
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

  return { score, matchingFeatures }
}

function calculateConsistency(errors: number[]): number {
  if (errors.length < 2) return 1.0
  
  const mean = errors.reduce((a, b) => a + b, 0) / errors.length
  if (Math.abs(mean) < 0.5) return 0.8
  
  const variance = errors.reduce((sum, e) => sum + Math.pow(e - mean, 2), 0) / errors.length
  const stdDev = Math.sqrt(variance)
  const cv = stdDev / Math.abs(mean)
  
  return Math.max(0, Math.min(1, 1 - cv * 0.5))
}

// ============================================================================
// MAIN MEASUREMENT CORRECTION FUNCTION
// ============================================================================

export async function computeMeasurementLevelCorrection(
  input: MeasurementCorrectionInput,
  currentMeasurements: Measurements
): Promise<MeasurementCorrectionResult> {
  const emptyResult = createEmptyResult(currentMeasurements)

  try {
    const supabase = await createClient()
    
    // Fetch verified training examples with measurement-level data
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
        circumference_measurements,
        measurement_errors
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
      .select('buck_id, images_used, angle_diversity_score, confidence_percent, measurements')
      .in('buck_id', buckIds)

    const predictionsMap = new Map(predictions?.map(p => [p.buck_id, p]) || [])

    // Calculate similarity and build weighted examples with measurement-level errors
    const weightedExamples: VerifiedMeasurementExample[] = []

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
        harvest_method: buck.harvest_method,
        angle_diversity_score: prediction?.angle_diversity_score,
        confidence_percent: prediction?.confidence_percent,
      })

      // Only include examples meeting minimum similarity
      if (score >= GUARDRAILS.MIN_SIMILARITY_THRESHOLD) {
        const measErrors = example.measurement_errors as Record<string, number> | null
        const predMeasurements = prediction?.measurements as Measurements | null
        
        weightedExamples.push({
          id: example.id,
          buckId: example.buck_id,
          similarity: score,
          matchingFeatures,
          // Ground truth (from training example if available)
          gtSpread: example.inside_spread ?? undefined,
          gtBeamLeft: example.main_beam_left ?? undefined,
          gtBeamRight: example.main_beam_right ?? undefined,
          gtTines: example.tine_measurements as Record<string, number> | undefined,
          gtMass: example.circumference_measurements as Record<string, number> | undefined,
          gtGross: example.ground_truth_score,
          gtNet: undefined, // Not always stored
          // Predicted (from prediction measurements)
          predSpread: predMeasurements?.inside_spread ?? undefined,
          predBeamLeft: predMeasurements?.main_beam_left ?? undefined,
          predBeamRight: predMeasurements?.main_beam_right ?? undefined,
          predGross: example.predicted_score || 0,
          predNet: undefined,
          // Per-category errors (if stored)
          spreadError: measErrors?.spread ?? undefined,
          beamError: measErrors?.beam ?? undefined,
          tineError: measErrors?.tine ?? undefined,
          massError: measErrors?.mass ?? undefined,
          deductionError: measErrors?.deduction ?? undefined,
        })
      }
    }

    // Check minimum example requirement
    if (weightedExamples.length < GUARDRAILS.MIN_SIMILAR_EXAMPLES) {
      emptyResult.summary.notes = [
        `Found ${weightedExamples.length} similar example(s), need at least ${GUARDRAILS.MIN_SIMILAR_EXAMPLES} for correction.`
      ]
      return emptyResult
    }

    // Sort by similarity and take top examples
    weightedExamples.sort((a, b) => b.similarity - a.similarity)
    const topExamples = weightedExamples.slice(0, 20)
    const highlySimilarExamples = topExamples.filter(e => e.similarity >= GUARDRAILS.HIGH_SIMILARITY_THRESHOLD)

    // Get calibration values
    const calibrationValues = getCalibrationApplicationValues(input.calibrationProfile)

    // Compute per-category corrections using weighted examples
    const categoryCorrections: CategoryCorrection[] = []
    const fieldCorrections: FieldCorrection[] = []
    const correctedMeasurements = { ...currentMeasurements }

    for (const category of Object.keys(MEASUREMENT_CATEGORIES) as MeasurementCategory[]) {
      const categoryResult = computeCategoryCorrection(
        category,
        topExamples,
        currentMeasurements,
        input,
        calibrationValues
      )

      if (categoryResult) {
        categoryCorrections.push(categoryResult.categoryCorrection)
        
        // Apply field-level corrections
        for (const fieldCorr of categoryResult.fieldCorrections) {
          fieldCorrections.push(fieldCorr)
          const key = fieldCorr.field as keyof Measurements
          if (typeof correctedMeasurements[key] === 'number') {
            (correctedMeasurements as Record<string, number | null>)[fieldCorr.field] = fieldCorr.correctedValue
          }
        }
      }
    }

    // Recompute scores from corrected measurements
    const originalGross = calculateGrossScore(currentMeasurements)
    const originalNet = calculateNetScore(currentMeasurements)
    const correctedGross = calculateGrossScore(correctedMeasurements)
    const correctedNet = calculateNetScore(correctedMeasurements)

    // Build summary
    const avgSimilarity = topExamples.reduce((sum, ex) => sum + ex.similarity, 0) / topExamples.length
    const totalFieldsCorrected = fieldCorrections.filter(f => Math.abs(f.correction) >= 0.1).length
    const totalCategoriesCorrected = categoryCorrections.filter(c => Math.abs(c.correctionAmount) >= 0.1).length

    // Find strongest correction
    let strongestCorrection: MeasurementCorrectionSummary['strongestCorrection'] = null
    let maxCorrectionAbs = 0
    for (const cat of categoryCorrections) {
      if (Math.abs(cat.correctionAmount) > maxCorrectionAbs) {
        maxCorrectionAbs = Math.abs(cat.correctionAmount)
        strongestCorrection = {
          category: cat.category,
          amount: cat.correctionAmount,
          direction: cat.correctionAmount > 0 ? 'increase' : 'decrease',
        }
      }
    }

    // Find weakest category (lowest confidence)
    let weakestCategory: MeasurementCategory | null = null
    let minConfidence = Infinity
    for (const cat of categoryCorrections) {
      if (cat.confidence < minConfidence && cat.sampleCount >= 3) {
        minConfidence = cat.confidence
        weakestCategory = cat.category
      }
    }

    // Determine overall direction
    const totalCorrection = correctedGross - originalGross
    let overallDirection: MeasurementCorrectionSummary['overallCorrectionDirection'] = 'none'
    if (totalCorrection > 0.5) overallDirection = 'increase'
    else if (totalCorrection < -0.5) overallDirection = 'decrease'
    else if (categoryCorrections.some(c => c.direction === 'increase') && categoryCorrections.some(c => c.direction === 'decrease')) {
      overallDirection = 'mixed'
    }

    // Determine correction strength
    let correctionStrength: MeasurementCorrectionSummary['correctionStrength'] = 'none'
    if (Math.abs(totalCorrection) >= 5) correctionStrength = 'high'
    else if (Math.abs(totalCorrection) >= 2.5) correctionStrength = 'medium'
    else if (Math.abs(totalCorrection) >= 1) correctionStrength = 'low'

    // Build notes
    const notes: string[] = []
    notes.push(`Used ${topExamples.length} similar verified examples (${highlySimilarExamples.length} highly similar).`)
    
    if (totalFieldsCorrected > 0) {
      notes.push(`Corrected ${totalFieldsCorrected} measurement field(s) across ${totalCategoriesCorrected} category(ies).`)
    }
    
    if (strongestCorrection) {
      const dirStr = strongestCorrection.direction === 'increase' ? 'increased' : 'decreased'
      notes.push(`Strongest correction: ${strongestCorrection.category} ${dirStr} by ${Math.abs(strongestCorrection.amount).toFixed(1)}".`)
    }

    if (weakestCategory) {
      notes.push(`Weakest evidence: ${weakestCategory} category (${(minConfidence * 100).toFixed(0)}% confidence).`)
    }

    const summary: MeasurementCorrectionSummary = {
      totalFieldsCorrected,
      totalCategoriesCorrected,
      strongestCorrection,
      weakestCategory,
      overallCorrectionDirection: overallDirection,
      grossCorrectionApplied: Number((correctedGross - originalGross).toFixed(2)),
      netCorrectionApplied: Number((correctedNet - originalNet).toFixed(2)),
      confidenceWeightedAvg: Number(avgSimilarity.toFixed(2)),
      verifiedExamplesUsed: topExamples.length,
      highlySimilarExamplesUsed: highlySimilarExamples.length,
      correctionStrength,
      notes,
    }

    return {
      originalMeasurements: currentMeasurements,
      correctedMeasurements,
      fieldCorrections,
      categoryCorrections,
      originalGross,
      originalNet,
      correctedGross,
      correctedNet,
      totalCorrectionGross: Number((correctedGross - originalGross).toFixed(2)),
      totalCorrectionNet: Number((correctedNet - originalNet).toFixed(2)),
      summary,
    }
  } catch (err) {
    console.error('Error in measurement-level correction:', err)
    emptyResult.summary.notes = ['Error computing measurement corrections.']
    return emptyResult
  }
}

// ============================================================================
// CATEGORY-SPECIFIC CORRECTION
// ============================================================================

interface CategoryCorrectionResult {
  categoryCorrection: CategoryCorrection
  fieldCorrections: FieldCorrection[]
}

function computeCategoryCorrection(
  category: MeasurementCategory,
  examples: VerifiedMeasurementExample[],
  currentMeasurements: Measurements,
  input: MeasurementCorrectionInput,
  calibrationValues: ReturnType<typeof getCalibrationApplicationValues>
): CategoryCorrectionResult | null {
  const fields = MEASUREMENT_CATEGORIES[category]
  
  // Get errors for this category from examples
  const categoryErrors: { error: number; similarity: number }[] = []
  
  for (const ex of examples) {
    let error: number | undefined
    
    // Try to use stored measurement errors first
    switch (category) {
      case 'spread':
        error = ex.spreadError ?? (ex.gtSpread && ex.predSpread ? ex.gtSpread - ex.predSpread : undefined)
        break
      case 'beam':
        error = ex.beamError ?? computeBeamError(ex)
        break
      case 'tine':
        error = ex.tineError ?? computeTineError(ex)
        break
      case 'mass':
        error = ex.massError ?? computeMassError(ex)
        break
      case 'deduction':
        error = ex.deductionError
        break
    }
    
    if (error !== undefined && !isNaN(error)) {
      categoryErrors.push({ error, similarity: ex.similarity })
    }
  }

  // If not enough data for this category, return null
  if (categoryErrors.length < 2) {
    return null
  }

  // Calculate weighted correction
  let totalWeight = 0
  let weightedErrorSum = 0
  const errors: number[] = []

  for (const { error, similarity } of categoryErrors) {
    const weight = similarity * similarity // Square for stronger weighting
    totalWeight += weight
    weightedErrorSum += error * weight
    errors.push(error)
  }

  const rawCorrection = totalWeight > 0 ? weightedErrorSum / totalWeight : 0
  const consistency = calculateConsistency(errors)

  // Check if examples are too inconsistent
  if (consistency < GUARDRAILS.MIN_CONSISTENCY_FOR_ANY_CORRECTION) {
    return null
  }

  // Get calibration weight and cap for this category
  const { weight, cap } = getCategoryCalibration(category, calibrationValues)
  
  // Apply consistency scaling
  let scaledCorrection = rawCorrection * weight
  if (consistency < GUARDRAILS.MIN_CONSISTENCY_FOR_STRONG_CORRECTION) {
    scaledCorrection *= consistency / GUARDRAILS.MIN_CONSISTENCY_FOR_STRONG_CORRECTION
  }

  // Apply confidence-based scaling
  if (input.baseVisionConfidence < GUARDRAILS.CONFIDENCE_BREAKPOINT_LOW) {
    scaledCorrection *= GUARDRAILS.LOW_CONFIDENCE_CORRECTION_SCALE
  } else if (input.baseVisionConfidence > GUARDRAILS.CONFIDENCE_BREAKPOINT_HIGH) {
    scaledCorrection *= GUARDRAILS.HIGH_CONFIDENCE_CORRECTION_SCALE
  }

  // Apply sample count scaling
  if (categoryErrors.length < 8) {
    scaledCorrection *= categoryErrors.length / 8
  }

  // Apply cap
  let capped = false
  let cappingReason: string | null = null
  if (Math.abs(scaledCorrection) > cap) {
    scaledCorrection = Math.sign(scaledCorrection) * cap
    capped = true
    cappingReason = `Capped at ${cap}" for ${category}`
  }

  // Calculate original category total
  const originalTotal = calculateCategoryTotal(currentMeasurements, category)
  const correctedTotal = originalTotal + scaledCorrection

  // Compute per-field corrections (distribute proportionally)
  const fieldCorrections: FieldCorrection[] = []
  const fieldValues: { field: string; value: number }[] = []
  let totalFieldValue = 0

  for (const field of fields) {
    const value = currentMeasurements[field as keyof Measurements]
    if (typeof value === 'number' && value > 0) {
      fieldValues.push({ field, value })
      totalFieldValue += value
    }
  }

  // Distribute correction proportionally across fields
  for (const { field, value } of fieldValues) {
    const proportion = totalFieldValue > 0 ? value / totalFieldValue : 1 / fieldValues.length
    let fieldCorrection = scaledCorrection * proportion
    
    // Apply per-field percentage cap
    const maxFieldCorrection = value * FIELD_CORRECTION_PERCENT_CAP
    if (Math.abs(fieldCorrection) > maxFieldCorrection) {
      fieldCorrection = Math.sign(fieldCorrection) * maxFieldCorrection
    }

    fieldCorrections.push({
      field,
      category,
      originalValue: value,
      correction: Number(fieldCorrection.toFixed(2)),
      correctedValue: Number((value + fieldCorrection).toFixed(1)),
      confidence: consistency,
      sampleCount: categoryErrors.length,
    })
  }

  const categoryCorrection: CategoryCorrection = {
    category,
    fields,
    originalTotal: Number(originalTotal.toFixed(1)),
    correctedTotal: Number(correctedTotal.toFixed(1)),
    correctionAmount: Number(scaledCorrection.toFixed(2)),
    correctionPercent: originalTotal > 0 ? Number(((scaledCorrection / originalTotal) * 100).toFixed(1)) : 0,
    confidence: consistency,
    sampleCount: categoryErrors.length,
    direction: scaledCorrection > 0.1 ? 'increase' : scaledCorrection < -0.1 ? 'decrease' : 'none',
    capped,
    cappingReason,
  }

  return { categoryCorrection, fieldCorrections }
}

function computeBeamError(ex: VerifiedMeasurementExample): number | undefined {
  if (ex.gtBeamLeft !== undefined && ex.gtBeamRight !== undefined &&
      ex.predBeamLeft !== undefined && ex.predBeamRight !== undefined) {
    const gtTotal = ex.gtBeamLeft + ex.gtBeamRight
    const predTotal = ex.predBeamLeft + ex.predBeamRight
    return gtTotal - predTotal
  }
  return undefined
}

function computeTineError(ex: VerifiedMeasurementExample): number | undefined {
  if (ex.gtTines && Object.keys(ex.gtTines).length > 0) {
    // Sum all tine measurements
    const gtTotal = Object.values(ex.gtTines).reduce((a, b) => a + b, 0)
    // If we have predicted tines, compute error
    if (ex.predTines && Object.keys(ex.predTines).length > 0) {
      const predTotal = Object.values(ex.predTines).reduce((a, b) => a + b, 0)
      return gtTotal - predTotal
    }
  }
  return undefined
}

function computeMassError(ex: VerifiedMeasurementExample): number | undefined {
  if (ex.gtMass && Object.keys(ex.gtMass).length > 0) {
    const gtTotal = Object.values(ex.gtMass).reduce((a, b) => a + b, 0)
    if (ex.predMass && Object.keys(ex.predMass).length > 0) {
      const predTotal = Object.values(ex.predMass).reduce((a, b) => a + b, 0)
      return gtTotal - predTotal
    }
  }
  return undefined
}

function getCategoryCalibration(
  category: MeasurementCategory,
  calibration: ReturnType<typeof getCalibrationApplicationValues>
): { weight: number; cap: number } {
  switch (category) {
    case 'spread':
      return { weight: calibration.spreadWeight, cap: calibration.maxSpreadCorrection }
    case 'beam':
      return { weight: calibration.beamWeight, cap: calibration.maxBeamCorrection }
    case 'tine':
      return { weight: calibration.tineWeight, cap: calibration.maxTineCorrection }
    case 'mass':
      return { weight: calibration.massWeight, cap: calibration.maxMassCorrection }
    case 'deduction':
      return { weight: calibration.deductionWeight, cap: DEFAULT_CATEGORY_CAPS.deduction }
  }
}

function createEmptyResult(measurements: Measurements): MeasurementCorrectionResult {
  const gross = calculateGrossScore(measurements)
  const net = calculateNetScore(measurements)
  
  return {
    originalMeasurements: measurements,
    correctedMeasurements: measurements,
    fieldCorrections: [],
    categoryCorrections: [],
    originalGross: gross,
    originalNet: net,
    correctedGross: gross,
    correctedNet: net,
    totalCorrectionGross: 0,
    totalCorrectionNet: 0,
    summary: {
      totalFieldsCorrected: 0,
      totalCategoriesCorrected: 0,
      strongestCorrection: null,
      weakestCategory: null,
      overallCorrectionDirection: 'none',
      grossCorrectionApplied: 0,
      netCorrectionApplied: 0,
      confidenceWeightedAvg: 0,
      verifiedExamplesUsed: 0,
      highlySimilarExamplesUsed: 0,
      correctionStrength: 'none',
      notes: [],
    },
  }
}
