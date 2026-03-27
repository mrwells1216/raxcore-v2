/**
 * Phase 23: Second-Pass Scoring with Adjusted Assumptions
 * 
 * When the first-pass self-check detects issues, this module performs a second
 * scoring pass with modified assumptions and weights, then selects or blends
 * the best result using explicit logic.
 */

import type { 
  Measurements, 
  LandmarksDetected, 
  AngleType, 
  CalibrationProfile 
} from '@/lib/types'
import type { SelfCheckResult, SelfCheckIssue, SelfCheckIssueType } from './self-check'
import type { NormalizationResult, NormalizationAdjustment } from './normalization'
import { normalizeMeasurements, MEASUREMENT_RANGES } from './normalization'
import { checkLandmarkConsistency, type LandmarkConsistencyResult } from './landmark-consistency'
import { recalibrateConfidence, type CalibratedConfidence } from './confidence-calibration'
import type { LearningSummary } from './ai-service'

// ============================================================================
// TYPES
// ============================================================================

export interface SecondPassInput {
  // First-pass data
  firstPassMeasurements: Measurements
  firstPassGross: number
  firstPassNet: number
  firstPassConfidence: number
  
  // Self-check result
  selfCheckResult: SelfCheckResult
  
  // Raw vision output (for re-weighting)
  rawVisionMeasurements: Measurements
  rawLandmarks: LandmarksDetected
  visionReportedEarLength?: number
  
  // Context
  angles: AngleType[]
  imageCount: number
  state: string
  rackType: 'typical' | 'non-typical'
  sourceType?: string
  earsFullyVisible?: boolean
  
  // Calibration
  calibrationProfile?: CalibrationProfile | null
}

export interface SecondPassAdjustments {
  // Angle weighting changes
  angleWeights: Record<AngleType, number>
  preferredAngleForSpread: AngleType | null
  preferredAngleForBeams: AngleType | null
  
  // Scaling adjustments
  scalingEmphasis: 'ears' | 'eyes' | 'combined' | 'size_priors'
  scalingStrength: number // 0.5 to 1.5
  
  // Anatomical constraints
  tightenAnatomicalConstraints: boolean
  constraintStrength: number // 0.5 to 2.0
  
  // Measurement weighting
  measurementWeights: Partial<Record<keyof Measurements, number>>
  
  // Reasons for adjustments
  adjustmentReasons: string[]
}

export interface SecondPassOutput {
  measurements: Measurements
  predictedGross: number
  predictedNet: number
  confidencePercent: number
  adjustmentsApplied: SecondPassAdjustments
  normalizationResult: NormalizationResult
  landmarkConsistencyResult: LandmarkConsistencyResult
}

export interface PassComparisonMetrics {
  grossDifference: number
  netDifference: number
  confidenceDifference: number
  stabilityImprovement: number
  measurementChanges: {
    field: string
    firstPass: number
    secondPass: number
    change: number
    changePercent: number
  }[]
}

export type FinalSelectionMethod = 
  | 'first_pass' 
  | 'second_pass' 
  | 'blend_weighted' 
  | 'blend_conservative'

export interface FinalResultSelection {
  method: FinalSelectionMethod
  reason: string
  confidence: number
  firstPassWeight: number
  secondPassWeight: number
  blendingApplied: boolean
}

export interface TwoPassScoringResult {
  // Final output
  finalMeasurements: Measurements
  finalGross: number
  finalNet: number
  finalConfidence: number
  
  // Pass data
  firstPass: {
    measurements: Measurements
    gross: number
    net: number
    confidence: number
  }
  secondPass: SecondPassOutput | null
  
  // Metadata
  secondPassRan: boolean
  selfCheckResult: SelfCheckResult
  passComparison: PassComparisonMetrics | null
  selection: FinalResultSelection
  
  // Explainability
  secondPassReasons: string[]
  adjustmentsSummary: string
  processingTimeMs: number
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const SECOND_PASS_CONFIG = {
  // Minimum improvement to prefer second pass
  MIN_GROSS_IMPROVEMENT: 2.0,
  MIN_CONFIDENCE_IMPROVEMENT: 5,
  MIN_STABILITY_IMPROVEMENT: 10,
  
  // Blending thresholds
  BLEND_THRESHOLD_GROSS_DIFF: 8.0,
  BLEND_THRESHOLD_CONFIDENCE_DIFF: 15,
  
  // Weight ranges
  MIN_ANGLE_WEIGHT: 0.3,
  MAX_ANGLE_WEIGHT: 1.5,
  
  // Conservative blend favors lower estimates
  CONSERVATIVE_BLEND_BIAS: 0.4,
  
  // Constraint tightening factors
  TIGHT_CONSTRAINT_FACTOR: 1.5,
  VERY_TIGHT_CONSTRAINT_FACTOR: 2.0,
} as const

// Default angle weights
const DEFAULT_ANGLE_WEIGHTS: Record<AngleType, number> = {
  front: 1.0,
  left: 1.0,
  right: 1.0,
  back: 0.7,
  other: 0.5,
}

// Angle preferences by measurement type
const ANGLE_PREFERENCES = {
  spread: ['front', 'back'] as AngleType[],
  beams: ['left', 'right'] as AngleType[],
  tines: ['left', 'right', 'front'] as AngleType[],
  mass: ['left', 'right'] as AngleType[],
}

// ============================================================================
// MAIN TWO-PASS SCORING FUNCTION
// ============================================================================

export async function runTwoPassScoring(
  input: SecondPassInput,
  startTime: number
): Promise<TwoPassScoringResult> {
  const { selfCheckResult } = input
  
  // Store first pass data
  const firstPass = {
    measurements: input.firstPassMeasurements,
    gross: input.firstPassGross,
    net: input.firstPassNet,
    confidence: input.firstPassConfidence,
  }
  
  // Check if second pass should run
  if (!selfCheckResult.triggerSecondPass) {
    // No second pass needed - return first pass result
    return {
      finalMeasurements: firstPass.measurements,
      finalGross: firstPass.gross,
      finalNet: firstPass.net,
      finalConfidence: firstPass.confidence,
      firstPass,
      secondPass: null,
      secondPassRan: false,
      selfCheckResult,
      passComparison: null,
      selection: {
        method: 'first_pass',
        reason: 'Self-check found no issues requiring second pass',
        confidence: 100,
        firstPassWeight: 1.0,
        secondPassWeight: 0.0,
        blendingApplied: false,
      },
      secondPassReasons: [],
      adjustmentsSummary: 'First-pass result used directly.',
      processingTimeMs: Date.now() - startTime,
    }
  }
  
  // Calculate second-pass adjustments based on issues
  const adjustments = calculateAdjustments(selfCheckResult, input)
  
  // Run second pass with adjusted assumptions
  const secondPass = runSecondPass(input, adjustments)
  
  // Compare passes
  const passComparison = comparePassResults(firstPass, secondPass)
  
  // Select or blend final result
  const { finalResult, selection } = selectFinalResult(
    firstPass,
    secondPass,
    selfCheckResult,
    passComparison
  )
  
  // Build adjustments summary
  const adjustmentsSummary = buildAdjustmentsSummary(adjustments, selection)
  
  return {
    finalMeasurements: finalResult.measurements,
    finalGross: finalResult.gross,
    finalNet: finalResult.net,
    finalConfidence: finalResult.confidence,
    firstPass,
    secondPass,
    secondPassRan: true,
    selfCheckResult,
    passComparison,
    selection,
    secondPassReasons: selfCheckResult.secondPassReasons,
    adjustmentsSummary,
    processingTimeMs: Date.now() - startTime,
  }
}

// ============================================================================
// ADJUSTMENT CALCULATION
// ============================================================================

function calculateAdjustments(
  selfCheck: SelfCheckResult,
  input: SecondPassInput
): SecondPassAdjustments {
  const adjustments: SecondPassAdjustments = {
    angleWeights: { ...DEFAULT_ANGLE_WEIGHTS },
    preferredAngleForSpread: null,
    preferredAngleForBeams: null,
    scalingEmphasis: 'combined',
    scalingStrength: 1.0,
    tightenAnatomicalConstraints: false,
    constraintStrength: 1.0,
    measurementWeights: {},
    adjustmentReasons: [],
  }
  
  // Group issues by type for targeted adjustments
  const issuesByType = new Map<SelfCheckIssueType, SelfCheckIssue[]>()
  for (const issue of selfCheck.issues) {
    if (!issuesByType.has(issue.type)) {
      issuesByType.set(issue.type, [])
    }
    issuesByType.get(issue.type)!.push(issue)
  }
  
  // Handle spread-ear mismatch
  if (issuesByType.has('spread_ear_mismatch')) {
    adjustments.scalingEmphasis = 'eyes'
    adjustments.scalingStrength = 0.85
    adjustments.adjustmentReasons.push('Using eye-based scaling due to spread-ear mismatch')
    
    // Prefer front angle for spread
    if (input.angles.includes('front')) {
      adjustments.preferredAngleForSpread = 'front'
    }
  }
  
  // Handle beam angle inconsistency
  if (issuesByType.has('beam_angle_inconsistency')) {
    // Increase weight of side angles for beams
    if (input.angles.includes('left')) {
      adjustments.angleWeights.left = 1.3
      adjustments.preferredAngleForBeams = 'left'
    } else if (input.angles.includes('right')) {
      adjustments.angleWeights.right = 1.3
      adjustments.preferredAngleForBeams = 'right'
    }
    
    // Reduce front angle weight for beam measurements
    adjustments.angleWeights.front = 0.7
    adjustments.adjustmentReasons.push('Reduced front angle weight for beam measurements')
  }
  
  // Handle tine pattern inconsistency
  if (issuesByType.has('tine_pattern_inconsistent')) {
    adjustments.tightenAnatomicalConstraints = true
    adjustments.constraintStrength = SECOND_PASS_CONFIG.TIGHT_CONSTRAINT_FACTOR
    adjustments.adjustmentReasons.push('Tightened anatomical constraints for tine pattern')
    
    // Reduce weights for affected tines
    const issues = issuesByType.get('tine_pattern_inconsistent')!
    for (const issue of issues) {
      for (const field of issue.affectedMeasurements) {
        adjustments.measurementWeights[field as keyof Measurements] = 0.85
      }
    }
  }
  
  // Handle extreme asymmetry
  if (issuesByType.has('extreme_asymmetry')) {
    adjustments.tightenAnatomicalConstraints = true
    adjustments.constraintStrength = Math.max(
      adjustments.constraintStrength,
      SECOND_PASS_CONFIG.TIGHT_CONSTRAINT_FACTOR
    )
    adjustments.adjustmentReasons.push('Tightened symmetry constraints due to extreme asymmetry')
  }
  
  // Handle image disagreement
  if (issuesByType.has('image_disagreement')) {
    // Reduce confidence in all measurements
    for (const key of Object.keys(adjustments.measurementWeights)) {
      const current = adjustments.measurementWeights[key as keyof Measurements] ?? 1.0
      adjustments.measurementWeights[key as keyof Measurements] = current * 0.9
    }
    adjustments.adjustmentReasons.push('Reduced measurement weights due to image disagreement')
  }
  
  // Handle anatomical ratio violations
  if (issuesByType.has('anatomical_ratio_violation')) {
    adjustments.tightenAnatomicalConstraints = true
    adjustments.constraintStrength = Math.max(
      adjustments.constraintStrength,
      SECOND_PASS_CONFIG.VERY_TIGHT_CONSTRAINT_FACTOR
    )
    adjustments.adjustmentReasons.push('Strongly tightened ratio constraints')
  }
  
  // Handle landmark consistency issues
  if (issuesByType.has('landmark_consistency_poor')) {
    const issues = issuesByType.get('landmark_consistency_poor')!
    const hasScalingIssue = issues.some(i => i.metadata?.scalingFactor !== undefined)
    
    if (hasScalingIssue) {
      adjustments.scalingEmphasis = 'size_priors'
      adjustments.scalingStrength = 0.75
      adjustments.adjustmentReasons.push('Using size priors due to poor landmark consistency')
    }
  }
  
  // Handle heavy normalization
  if (issuesByType.has('normalization_heavy')) {
    // Use tighter constraints to prevent extreme values
    adjustments.tightenAnatomicalConstraints = true
    adjustments.constraintStrength = Math.max(
      adjustments.constraintStrength,
      SECOND_PASS_CONFIG.TIGHT_CONSTRAINT_FACTOR
    )
    adjustments.adjustmentReasons.push('Tightened constraints due to heavy normalization')
  }
  
  // Handle score range issues
  if (issuesByType.has('score_range_implausible')) {
    adjustments.scalingStrength = 0.7
    adjustments.tightenAnatomicalConstraints = true
    adjustments.constraintStrength = SECOND_PASS_CONFIG.VERY_TIGHT_CONSTRAINT_FACTOR
    adjustments.adjustmentReasons.push('Strongly constrained due to implausible score range')
  }
  
  return adjustments
}

// ============================================================================
// SECOND PASS EXECUTION
// ============================================================================

function runSecondPass(
  input: SecondPassInput,
  adjustments: SecondPassAdjustments
): SecondPassOutput {
  // Start with raw vision measurements
  let measurements = { ...input.rawVisionMeasurements }
  
  // Apply measurement-specific weights
  measurements = applyMeasurementWeights(measurements, adjustments)
  
  // Apply tighter constraints if needed
  if (adjustments.tightenAnatomicalConstraints) {
    measurements = applyTighterConstraints(measurements, adjustments.constraintStrength)
  }
  
  // Apply alternative scaling emphasis
  measurements = applyScalingAdjustment(
    measurements, 
    input.rawLandmarks,
    adjustments
  )
  
  // Re-run normalization with potentially tighter ranges
  const normalizationResult = normalizeMeasurements(measurements)
  measurements = normalizationResult.normalized
  
  // Re-run landmark consistency check
  const landmarkConsistencyResult = checkLandmarkConsistency(
    measurements,
    input.rawLandmarks,
    input.visionReportedEarLength
  )
  measurements = landmarkConsistencyResult.adjustedMeasurements
  
  // Calculate scores
  const { gross, net } = calculateScores(measurements)
  
  // Recalculate confidence with adjustments
  const confidenceResult = recalibrateConfidence(
    input.firstPassConfidence * 0.9, // Start lower due to uncertainty
    input.rawLandmarks,
    input.angles,
    normalizationResult,
    landmarkConsistencyResult
  )
  
  // Apply stability bonus if second pass is more consistent
  let confidence = confidenceResult.finalConfidence
  if (normalizationResult.adjustments.length < 3) {
    confidence += 3 // Small bonus for cleaner result
  }
  
  return {
    measurements,
    predictedGross: gross,
    predictedNet: net,
    confidencePercent: Math.min(95, Math.max(15, Math.round(confidence))),
    adjustmentsApplied: adjustments,
    normalizationResult,
    landmarkConsistencyResult,
  }
}

function applyMeasurementWeights(
  measurements: Measurements,
  adjustments: SecondPassAdjustments
): Measurements {
  const result = { ...measurements }
  
  for (const [field, weight] of Object.entries(adjustments.measurementWeights)) {
    const key = field as keyof Measurements
    const value = result[key]
    if (typeof value === 'number' && weight !== undefined) {
      // Weight < 1.0 pulls toward typical value
      if (weight < 1.0) {
        const range = MEASUREMENT_RANGES[getFieldRangeKey(key)]
        if (range) {
          const typical = (range.typical_min + range.typical_max) / 2
          const adjusted = value * weight + typical * (1 - weight)
          ;(result as Record<string, number | null>)[key] = Number(adjusted.toFixed(1))
        }
      }
    }
  }
  
  return result
}

function applyTighterConstraints(
  measurements: Measurements,
  constraintStrength: number
): Measurements {
  const result = { ...measurements }
  
  // Tighten asymmetry constraints
  const pairs: [keyof Measurements, keyof Measurements][] = [
    ['main_beam_left', 'main_beam_right'],
    ['g1_left', 'g1_right'],
    ['g2_left', 'g2_right'],
    ['g3_left', 'g3_right'],
    ['g4_left', 'g4_right'],
    ['h1_left', 'h1_right'],
    ['h2_left', 'h2_right'],
    ['h3_left', 'h3_right'],
    ['h4_left', 'h4_right'],
  ]
  
  const maxAsymmetry = 0.20 / constraintStrength // Tighter with higher strength
  
  for (const [leftKey, rightKey] of pairs) {
    const left = result[leftKey]
    const right = result[rightKey]
    
    if (typeof left === 'number' && typeof right === 'number' && left > 0 && right > 0) {
      const larger = Math.max(left, right)
      const smaller = Math.min(left, right)
      const asymmetry = (larger - smaller) / larger
      
      if (asymmetry > maxAsymmetry) {
        const targetDiff = larger * maxAsymmetry
        const currentDiff = larger - smaller
        const adjustment = (currentDiff - targetDiff) / 2
        
        const newLarger = larger - adjustment
        const newSmaller = smaller + adjustment
        
        ;(result as Record<string, number | null>)[leftKey] = 
          Number((left === larger ? newLarger : newSmaller).toFixed(1))
        ;(result as Record<string, number | null>)[rightKey] = 
          Number((right === larger ? newLarger : newSmaller).toFixed(1))
      }
    }
  }
  
  return result
}

function applyScalingAdjustment(
  measurements: Measurements,
  landmarks: LandmarksDetected,
  adjustments: SecondPassAdjustments
): Measurements {
  const result = { ...measurements }
  
  if (adjustments.scalingEmphasis === 'size_priors') {
    // Pull measurements toward typical values based on scaling strength
    const pullStrength = 1 - adjustments.scalingStrength
    
    for (const [field, value] of Object.entries(result)) {
      if (typeof value === 'number' && value > 0) {
        const range = MEASUREMENT_RANGES[getFieldRangeKey(field as keyof Measurements)]
        if (range) {
          const typical = (range.typical_min + range.typical_max) / 2
          const pulled = value * adjustments.scalingStrength + typical * pullStrength
          ;(result as Record<string, number | null>)[field] = Number(pulled.toFixed(1))
        }
      }
    }
  }
  
  // Eye-based scaling adjustment
  if (adjustments.scalingEmphasis === 'eyes' && landmarks.eyes_visible) {
    const eyeDistance = landmarks.eye_to_eye ?? 4.25
    const expectedEye = 4.25
    const scaleFactor = expectedEye / eyeDistance
    
    if (Math.abs(scaleFactor - 1.0) > 0.05) {
      // Apply gentle scaling correction
      const gentleScale = 1 + (scaleFactor - 1) * 0.3
      
      if (result.inside_spread !== null) {
        result.inside_spread = Number((result.inside_spread * gentleScale).toFixed(1))
      }
    }
  }
  
  return result
}

function getFieldRangeKey(field: keyof Measurements): keyof typeof MEASUREMENT_RANGES {
  if (field === 'inside_spread') return 'inside_spread'
  if (field.startsWith('main_beam')) return 'main_beam'
  if (field.startsWith('g1')) return 'g1'
  if (field.startsWith('g2')) return 'g2'
  if (field.startsWith('g3')) return 'g3'
  if (field.startsWith('g4')) return 'g4'
  if (field.startsWith('g5')) return 'g5'
  if (field.startsWith('h1')) return 'h1'
  if (field.startsWith('h2')) return 'h2'
  if (field.startsWith('h3')) return 'h3'
  if (field.startsWith('h4')) return 'h4'
  if (field === 'abnormal_points') return 'abnormal_points'
  if (field === 'deductions') return 'deductions'
  return 'inside_spread' // fallback
}

function calculateScores(measurements: Measurements): { gross: number; net: number } {
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
  
  return { 
    gross: Number(gross.toFixed(1)), 
    net: Number(net.toFixed(1)) 
  }
}

// ============================================================================
// PASS COMPARISON
// ============================================================================

function comparePassResults(
  firstPass: { measurements: Measurements; gross: number; net: number; confidence: number },
  secondPass: SecondPassOutput
): PassComparisonMetrics {
  const measurementChanges: PassComparisonMetrics['measurementChanges'] = []
  
  const fields = Object.keys(firstPass.measurements) as (keyof Measurements)[]
  
  for (const field of fields) {
    const first = firstPass.measurements[field]
    const second = secondPass.measurements[field]
    
    if (typeof first === 'number' && typeof second === 'number') {
      const change = second - first
      const changePercent = first > 0 ? (change / first) * 100 : 0
      
      if (Math.abs(change) >= 0.1) {
        measurementChanges.push({
          field,
          firstPass: first,
          secondPass: second,
          change,
          changePercent,
        })
      }
    }
  }
  
  // Sort by absolute change
  measurementChanges.sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
  
  return {
    grossDifference: secondPass.predictedGross - firstPass.gross,
    netDifference: secondPass.predictedNet - firstPass.net,
    confidenceDifference: secondPass.confidencePercent - firstPass.confidence,
    stabilityImprovement: calculateStabilityImprovement(firstPass, secondPass),
    measurementChanges,
  }
}

function calculateStabilityImprovement(
  firstPass: { measurements: Measurements; gross: number; net: number; confidence: number },
  secondPass: SecondPassOutput
): number {
  // Calculate stability based on normalization and consistency results
  let firstPassStability = 70 // Base estimate
  let secondPassStability = 70
  
  // Second pass normalization impact
  const normAdjustments = secondPass.normalizationResult.adjustments.length
  if (normAdjustments <= 2) secondPassStability += 15
  else if (normAdjustments >= 5) secondPassStability -= 10
  
  // Second pass landmark consistency
  const consistency = secondPass.landmarkConsistencyResult.consistencyScore
  if (consistency >= 0.8) secondPassStability += 10
  else if (consistency < 0.5) secondPassStability -= 10
  
  return secondPassStability - firstPassStability
}

// ============================================================================
// FINAL RESULT SELECTION
// ============================================================================

function selectFinalResult(
  firstPass: { measurements: Measurements; gross: number; net: number; confidence: number },
  secondPass: SecondPassOutput,
  selfCheck: SelfCheckResult,
  comparison: PassComparisonMetrics
): { 
  finalResult: { measurements: Measurements; gross: number; net: number; confidence: number }
  selection: FinalResultSelection 
} {
  const grossDiff = Math.abs(comparison.grossDifference)
  const confDiff = comparison.confidenceDifference
  const stabilityImprove = comparison.stabilityImprovement
  
  // Case 1: Second pass significantly more stable and confident
  if (stabilityImprove >= SECOND_PASS_CONFIG.MIN_STABILITY_IMPROVEMENT && 
      confDiff >= 0 &&
      grossDiff < 15) {
    return {
      finalResult: {
        measurements: secondPass.measurements,
        gross: secondPass.predictedGross,
        net: secondPass.predictedNet,
        confidence: secondPass.confidencePercent,
      },
      selection: {
        method: 'second_pass',
        reason: `Second pass more stable (+${stabilityImprove} stability) with ${grossDiff.toFixed(1)}" difference`,
        confidence: 85,
        firstPassWeight: 0,
        secondPassWeight: 1.0,
        blendingApplied: false,
      },
    }
  }
  
  // Case 2: Large disagreement between passes - use conservative blend
  if (grossDiff >= SECOND_PASS_CONFIG.BLEND_THRESHOLD_GROSS_DIFF) {
    const blendedResult = blendResults(firstPass, secondPass, 'conservative')
    return {
      finalResult: blendedResult,
      selection: {
        method: 'blend_conservative',
        reason: `Large pass disagreement (${grossDiff.toFixed(1)}") - using conservative blend`,
        confidence: 65,
        firstPassWeight: SECOND_PASS_CONFIG.CONSERVATIVE_BLEND_BIAS,
        secondPassWeight: 1 - SECOND_PASS_CONFIG.CONSERVATIVE_BLEND_BIAS,
        blendingApplied: true,
      },
    }
  }
  
  // Case 3: Moderate disagreement - weighted blend based on confidence
  if (grossDiff >= SECOND_PASS_CONFIG.MIN_GROSS_IMPROVEMENT && 
      grossDiff < SECOND_PASS_CONFIG.BLEND_THRESHOLD_GROSS_DIFF) {
    // Weight by confidence
    const totalConf = firstPass.confidence + secondPass.confidencePercent
    const firstWeight = firstPass.confidence / totalConf
    const secondWeight = secondPass.confidencePercent / totalConf
    
    const blendedResult = blendResults(
      firstPass, 
      secondPass, 
      'weighted',
      firstWeight,
      secondWeight
    )
    
    return {
      finalResult: blendedResult,
      selection: {
        method: 'blend_weighted',
        reason: `Moderate disagreement (${grossDiff.toFixed(1)}") - confidence-weighted blend`,
        confidence: 75,
        firstPassWeight: firstWeight,
        secondPassWeight: secondWeight,
        blendingApplied: true,
      },
    }
  }
  
  // Case 4: Passes agree closely - prefer higher confidence
  if (secondPass.confidencePercent > firstPass.confidence + 5) {
    return {
      finalResult: {
        measurements: secondPass.measurements,
        gross: secondPass.predictedGross,
        net: secondPass.predictedNet,
        confidence: secondPass.confidencePercent,
      },
      selection: {
        method: 'second_pass',
        reason: `Passes agree (${grossDiff.toFixed(1)}" diff) - second pass higher confidence`,
        confidence: 90,
        firstPassWeight: 0,
        secondPassWeight: 1.0,
        blendingApplied: false,
      },
    }
  }
  
  // Case 5: Default to first pass if no clear improvement
  return {
    finalResult: {
      measurements: firstPass.measurements,
      gross: firstPass.gross,
      net: firstPass.net,
      confidence: firstPass.confidence,
    },
    selection: {
      method: 'first_pass',
      reason: 'Second pass did not show clear improvement',
      confidence: 80,
      firstPassWeight: 1.0,
      secondPassWeight: 0,
      blendingApplied: false,
    },
  }
}

function blendResults(
  firstPass: { measurements: Measurements; gross: number; net: number; confidence: number },
  secondPass: SecondPassOutput,
  mode: 'weighted' | 'conservative',
  firstWeight: number = 0.5,
  secondWeight: number = 0.5
): { measurements: Measurements; gross: number; net: number; confidence: number } {
  let w1 = firstWeight
  let w2 = secondWeight
  
  if (mode === 'conservative') {
    // Conservative favors lower estimates slightly
    w1 = SECOND_PASS_CONFIG.CONSERVATIVE_BLEND_BIAS
    w2 = 1 - w1
    
    // If second pass is lower, give it more weight
    if (secondPass.predictedGross < firstPass.gross) {
      w2 = 0.55
      w1 = 0.45
    }
  }
  
  // Blend measurements
  const blendedMeasurements: Measurements = { ...firstPass.measurements }
  
  for (const [field, val1] of Object.entries(firstPass.measurements)) {
    const val2 = secondPass.measurements[field as keyof Measurements]
    if (typeof val1 === 'number' && typeof val2 === 'number') {
      const blended = val1 * w1 + val2 * w2
      ;(blendedMeasurements as Record<string, number | null>)[field] = Number(blended.toFixed(1))
    }
  }
  
  // Blend scores
  const blendedGross = Number((firstPass.gross * w1 + secondPass.predictedGross * w2).toFixed(1))
  const blendedNet = Number((firstPass.net * w1 + secondPass.predictedNet * w2).toFixed(1))
  
  // Confidence is average minus small penalty for uncertainty
  const blendedConfidence = Math.round((firstPass.confidence + secondPass.confidencePercent) / 2) - 3
  
  return {
    measurements: blendedMeasurements,
    gross: blendedGross,
    net: blendedNet,
    confidence: Math.max(20, blendedConfidence),
  }
}

// ============================================================================
// SUMMARY BUILDING
// ============================================================================

function buildAdjustmentsSummary(
  adjustments: SecondPassAdjustments,
  selection: FinalResultSelection
): string {
  const parts: string[] = []
  
  if (adjustments.adjustmentReasons.length > 0) {
    parts.push(`Adjustments: ${adjustments.adjustmentReasons.slice(0, 2).join('; ')}`)
  }
  
  parts.push(`Selection: ${selection.method.replace('_', ' ')}`)
  
  if (selection.blendingApplied) {
    parts.push(`Blend: ${(selection.firstPassWeight * 100).toFixed(0)}%/${(selection.secondPassWeight * 100).toFixed(0)}%`)
  }
  
  return parts.join('. ')
}

// ============================================================================
// EXPORTS
// ============================================================================

export { SECOND_PASS_CONFIG }
