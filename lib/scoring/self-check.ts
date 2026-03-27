/**
 * Phase 23: First-Pass Self-Check Analysis
 * 
 * After the first-pass result is produced, this module runs a self-check that
 * looks for likely issues that might indicate the estimate is unstable, 
 * contradictory, or anatomically implausible.
 */

import type { Measurements, LandmarksDetected, AngleType } from '@/lib/types'
import { MEASUREMENT_RANGES, ANATOMICAL_RATIOS } from './normalization'
import type { NormalizationResult } from './normalization'
import type { LandmarkConsistencyResult } from './landmark-consistency'
import type { MeasurementCorrectionResult } from './measurement-correction'

// ============================================================================
// TYPES
// ============================================================================

export type SelfCheckIssueSeverity = 'low' | 'medium' | 'high' | 'critical'
export type SelfCheckIssueType = 
  | 'spread_ear_mismatch'
  | 'beam_angle_inconsistency'
  | 'tine_pattern_inconsistent'
  | 'mass_out_of_range'
  | 'extreme_asymmetry'
  | 'image_disagreement'
  | 'confidence_stability_mismatch'
  | 'anatomical_ratio_violation'
  | 'normalization_heavy'
  | 'landmark_consistency_poor'
  | 'measurement_correction_large'
  | 'score_range_implausible'
  | 'component_variance_high'

export interface SelfCheckIssue {
  type: SelfCheckIssueType
  severity: SelfCheckIssueSeverity
  description: string
  affectedMeasurements: string[]
  suggestedAction: 'verify' | 'adjust_weights' | 'use_alternative_scaling' | 'reduce_confidence' | 'trigger_second_pass'
  metadata?: Record<string, unknown>
}

export interface SelfCheckInput {
  // First-pass measurements and scores
  measurements: Measurements
  predictedGross: number
  predictedNet: number
  confidencePercent: number
  
  // Landmarks and references
  landmarks: LandmarksDetected
  
  // Image metadata
  angles: AngleType[]
  imageCount: number
  angleDiversity: number
  
  // Pipeline stage results
  normalizationResult?: NormalizationResult
  landmarkConsistencyResult?: LandmarkConsistencyResult
  measurementCorrectionResult?: MeasurementCorrectionResult
  
  // Vision output metadata
  visionConfidence: number
  
  // Context
  state: string
  rackType: 'typical' | 'non-typical'
  mainFramePoints?: number
  sourceType?: string
}

export interface SelfCheckResult {
  issues: SelfCheckIssue[]
  overallStability: 'stable' | 'uncertain' | 'unstable'
  stabilityScore: number // 0-100, higher is more stable
  triggerSecondPass: boolean
  secondPassReasons: string[]
  componentVariance: {
    spread: number
    beams: number
    tines: number
    mass: number
  }
  confidenceAdjustment: number
  summary: string
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const SELF_CHECK_THRESHOLDS = {
  // Asymmetry thresholds
  MAX_BEAM_ASYMMETRY_PERCENT: 15,
  MAX_TINE_ASYMMETRY_PERCENT: 25,
  MAX_MASS_ASYMMETRY_PERCENT: 12,
  
  // Range thresholds
  IMPLAUSIBLE_GROSS_MIN: 60,
  IMPLAUSIBLE_GROSS_MAX: 280,
  
  // Confidence thresholds
  LOW_CONFIDENCE_THRESHOLD: 45,
  MEDIUM_CONFIDENCE_THRESHOLD: 65,
  
  // Normalization thresholds
  HEAVY_NORMALIZATION_ADJUSTMENTS: 5,
  MAJOR_NORMALIZATION_MAGNITUDE: 8,
  
  // Landmark consistency
  POOR_LANDMARK_CONSISTENCY: 0.5,
  
  // Measurement correction
  LARGE_CORRECTION_THRESHOLD: 5,
  
  // Variance thresholds
  HIGH_COMPONENT_VARIANCE: 0.15,
  
  // Stability score thresholds
  STABLE_THRESHOLD: 75,
  UNCERTAIN_THRESHOLD: 50,
  
  // Second pass trigger threshold
  SECOND_PASS_ISSUE_SEVERITY_SUM: 4, // Sum of issue severities
} as const

// Severity weights for calculating trigger threshold
const SEVERITY_WEIGHTS: Record<SelfCheckIssueSeverity, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 5,
}

// ============================================================================
// MAIN SELF-CHECK FUNCTION
// ============================================================================

export function runSelfCheck(input: SelfCheckInput): SelfCheckResult {
  const issues: SelfCheckIssue[] = []
  
  // 1. Check spread relative to ear references
  checkSpreadEarMismatch(input, issues)
  
  // 2. Check beam length consistency with visible angles
  checkBeamAngleInconsistency(input, issues)
  
  // 3. Check tine pattern consistency
  checkTinePatternInconsistency(input, issues)
  
  // 4. Check mass values are in believable range
  checkMassRange(input, issues)
  
  // 5. Check for extreme left/right asymmetry
  checkExtremeAsymmetry(input, issues)
  
  // 6. Check for image disagreement (if multiple angles)
  checkImageDisagreement(input, issues)
  
  // 7. Check confidence vs stability mismatch
  checkConfidenceStabilityMismatch(input, issues)
  
  // 8. Check anatomical ratio violations
  checkAnatomicalRatioViolations(input, issues)
  
  // 9. Check normalization impact
  checkNormalizationImpact(input, issues)
  
  // 10. Check landmark consistency impact
  checkLandmarkConsistencyImpact(input, issues)
  
  // 11. Check measurement correction magnitude
  checkMeasurementCorrectionMagnitude(input, issues)
  
  // 12. Check score range plausibility
  checkScoreRangePlausibility(input, issues)
  
  // Calculate component variance
  const componentVariance = calculateComponentVariance(input)
  
  // 13. Check component variance
  checkComponentVariance(componentVariance, issues)
  
  // Calculate stability score
  const stabilityScore = calculateStabilityScore(issues)
  
  // Determine overall stability
  const overallStability = determineOverallStability(stabilityScore)
  
  // Determine if second pass should be triggered
  const { triggerSecondPass, secondPassReasons } = shouldTriggerSecondPass(issues, input)
  
  // Calculate confidence adjustment
  const confidenceAdjustment = calculateConfidenceAdjustment(issues)
  
  // Build summary
  const summary = buildSummary(issues, stabilityScore, triggerSecondPass)
  
  return {
    issues,
    overallStability,
    stabilityScore,
    triggerSecondPass,
    secondPassReasons,
    componentVariance,
    confidenceAdjustment,
    summary,
  }
}

// ============================================================================
// INDIVIDUAL CHECK FUNCTIONS
// ============================================================================

function checkSpreadEarMismatch(input: SelfCheckInput, issues: SelfCheckIssue[]): void {
  if (!input.landmarks.ears_visible || input.measurements.inside_spread === null) {
    return
  }
  
  const earTipToTip = input.landmarks.ear_tip_to_tip ?? 16.5
  const spread = input.measurements.inside_spread
  const ratio = spread / earTipToTip
  
  // Spread should typically be 0.85-1.5x ear tip-to-tip
  if (ratio < 0.7 || ratio > 1.7) {
    issues.push({
      type: 'spread_ear_mismatch',
      severity: ratio < 0.5 || ratio > 2.0 ? 'high' : 'medium',
      description: `Spread (${spread.toFixed(1)}") vs ear tip-to-tip (${earTipToTip.toFixed(1)}") ratio of ${ratio.toFixed(2)} is outside typical range`,
      affectedMeasurements: ['inside_spread'],
      suggestedAction: 'trigger_second_pass',
      metadata: { ratio, earTipToTip, spread },
    })
  }
}

function checkBeamAngleInconsistency(input: SelfCheckInput, issues: SelfCheckIssue[]): void {
  const { main_beam_left, main_beam_right } = input.measurements
  if (main_beam_left === null || main_beam_right === null) return
  
  // If we have side angles, beams should be more accurate
  const hasSideAngles = input.angles.includes('left') || input.angles.includes('right')
  const hasFrontAngle = input.angles.includes('front')
  
  // If only front angle, beam measurements are less reliable
  if (hasFrontAngle && !hasSideAngles) {
    const avgBeam = (main_beam_left + main_beam_right) / 2
    // Front-only typically underestimates beams
    if (avgBeam < 20 || avgBeam > 28) {
      issues.push({
        type: 'beam_angle_inconsistency',
        severity: 'medium',
        description: `Beam measurements from front-only angle may be inaccurate (avg: ${avgBeam.toFixed(1)}")`,
        affectedMeasurements: ['main_beam_left', 'main_beam_right'],
        suggestedAction: 'adjust_weights',
        metadata: { avgBeam, angles: input.angles },
      })
    }
  }
}

function checkTinePatternInconsistency(input: SelfCheckInput, issues: SelfCheckIssue[]): void {
  const m = input.measurements
  
  // G2 should typically be the longest tine
  const g2Avg = ((m.g2_left ?? 0) + (m.g2_right ?? 0)) / 2
  const g3Avg = ((m.g3_left ?? 0) + (m.g3_right ?? 0)) / 2
  const g1Avg = ((m.g1_left ?? 0) + (m.g1_right ?? 0)) / 2
  
  // If G1 or G3 is significantly longer than G2, pattern is unusual
  if (g1Avg > g2Avg * 1.2 || g3Avg > g2Avg * 1.15) {
    issues.push({
      type: 'tine_pattern_inconsistent',
      severity: 'low',
      description: `Unusual tine pattern: G1(${g1Avg.toFixed(1)}"), G2(${g2Avg.toFixed(1)}"), G3(${g3Avg.toFixed(1)}")`,
      affectedMeasurements: ['g1_left', 'g1_right', 'g2_left', 'g2_right', 'g3_left', 'g3_right'],
      suggestedAction: 'verify',
      metadata: { g1Avg, g2Avg, g3Avg },
    })
  }
  
  // Check for implausible tine progressions (G4 > G3 or G5 > G4)
  const g4Avg = ((m.g4_left ?? 0) + (m.g4_right ?? 0)) / 2
  const g5Avg = ((m.g5_left ?? 0) + (m.g5_right ?? 0)) / 2
  
  if (g4Avg > g3Avg * 1.1 && g3Avg > 0) {
    issues.push({
      type: 'tine_pattern_inconsistent',
      severity: 'medium',
      description: `G4 (${g4Avg.toFixed(1)}") longer than G3 (${g3Avg.toFixed(1)}") which is unusual`,
      affectedMeasurements: ['g3_left', 'g3_right', 'g4_left', 'g4_right'],
      suggestedAction: 'trigger_second_pass',
      metadata: { g3Avg, g4Avg },
    })
  }
  
  if (g5Avg > g4Avg * 1.1 && g4Avg > 0 && g5Avg > 0) {
    issues.push({
      type: 'tine_pattern_inconsistent',
      severity: 'medium',
      description: `G5 (${g5Avg.toFixed(1)}") longer than G4 (${g4Avg.toFixed(1)}") which is unusual`,
      affectedMeasurements: ['g4_left', 'g4_right', 'g5_left', 'g5_right'],
      suggestedAction: 'trigger_second_pass',
      metadata: { g4Avg, g5Avg },
    })
  }
}

function checkMassRange(input: SelfCheckInput, issues: SelfCheckIssue[]): void {
  const m = input.measurements
  const massFields = ['h1_left', 'h1_right', 'h2_left', 'h2_right', 'h3_left', 'h3_right', 'h4_left', 'h4_right'] as const
  
  for (const field of massFields) {
    const value = m[field]
    if (value === null) continue
    
    // H measurements should be between 2.5 and 7 inches
    if (value < 2.0 || value > 7.5) {
      issues.push({
        type: 'mass_out_of_range',
        severity: value < 1.5 || value > 8.5 ? 'high' : 'medium',
        description: `${field} value (${value.toFixed(1)}") is outside typical range (2.5-7")`,
        affectedMeasurements: [field],
        suggestedAction: 'adjust_weights',
        metadata: { field, value },
      })
    }
  }
  
  // Check H progression (should generally decrease from H1 to H4)
  const h1Avg = ((m.h1_left ?? 0) + (m.h1_right ?? 0)) / 2
  const h4Avg = ((m.h4_left ?? 0) + (m.h4_right ?? 0)) / 2
  
  if (h4Avg > h1Avg * 1.1 && h1Avg > 0) {
    issues.push({
      type: 'mass_out_of_range',
      severity: 'medium',
      description: `H4 (${h4Avg.toFixed(1)}") larger than H1 (${h1Avg.toFixed(1)}") which is unusual`,
      affectedMeasurements: ['h1_left', 'h1_right', 'h4_left', 'h4_right'],
      suggestedAction: 'verify',
      metadata: { h1Avg, h4Avg },
    })
  }
}

function checkExtremeAsymmetry(input: SelfCheckInput, issues: SelfCheckIssue[]): void {
  const m = input.measurements
  
  // Check beam asymmetry
  if (m.main_beam_left !== null && m.main_beam_right !== null) {
    const beamDiff = Math.abs(m.main_beam_left - m.main_beam_right)
    const beamMax = Math.max(m.main_beam_left, m.main_beam_right)
    const beamAsymmetryPercent = (beamDiff / beamMax) * 100
    
    if (beamAsymmetryPercent > SELF_CHECK_THRESHOLDS.MAX_BEAM_ASYMMETRY_PERCENT) {
      issues.push({
        type: 'extreme_asymmetry',
        severity: beamAsymmetryPercent > 25 ? 'high' : 'medium',
        description: `Beam asymmetry of ${beamAsymmetryPercent.toFixed(1)}% (L:${m.main_beam_left.toFixed(1)}", R:${m.main_beam_right.toFixed(1)}") exceeds threshold`,
        affectedMeasurements: ['main_beam_left', 'main_beam_right'],
        suggestedAction: 'trigger_second_pass',
        metadata: { beamAsymmetryPercent, left: m.main_beam_left, right: m.main_beam_right },
      })
    }
  }
  
  // Check G2 asymmetry (most significant tine)
  if (m.g2_left !== null && m.g2_right !== null && m.g2_left > 0 && m.g2_right > 0) {
    const g2Diff = Math.abs(m.g2_left - m.g2_right)
    const g2Max = Math.max(m.g2_left, m.g2_right)
    const g2AsymmetryPercent = (g2Diff / g2Max) * 100
    
    if (g2AsymmetryPercent > SELF_CHECK_THRESHOLDS.MAX_TINE_ASYMMETRY_PERCENT) {
      issues.push({
        type: 'extreme_asymmetry',
        severity: g2AsymmetryPercent > 35 ? 'high' : 'medium',
        description: `G2 tine asymmetry of ${g2AsymmetryPercent.toFixed(1)}% exceeds threshold`,
        affectedMeasurements: ['g2_left', 'g2_right'],
        suggestedAction: 'verify',
        metadata: { g2AsymmetryPercent, left: m.g2_left, right: m.g2_right },
      })
    }
  }
}

function checkImageDisagreement(input: SelfCheckInput, issues: SelfCheckIssue[]): void {
  // If we have multiple angles, check for potential disagreement indicators
  if (input.imageCount < 2) return
  
  // Low angle diversity with multiple images suggests they're all similar angles
  // This reduces reliability as we can't cross-validate measurements
  if (input.angleDiversity < 0.4 && input.imageCount >= 2) {
    issues.push({
      type: 'image_disagreement',
      severity: 'low',
      description: `Multiple images (${input.imageCount}) but low angle diversity (${(input.angleDiversity * 100).toFixed(0)}%) - limited cross-validation`,
      affectedMeasurements: [],
      suggestedAction: 'reduce_confidence',
      metadata: { imageCount: input.imageCount, angleDiversity: input.angleDiversity },
    })
  }
  
  // High confidence with low angle diversity is suspicious
  if (input.confidencePercent > 75 && input.angleDiversity < 0.5) {
    issues.push({
      type: 'image_disagreement',
      severity: 'medium',
      description: `High confidence (${input.confidencePercent}%) with limited angles may be overstated`,
      affectedMeasurements: [],
      suggestedAction: 'trigger_second_pass',
      metadata: { confidence: input.confidencePercent, angleDiversity: input.angleDiversity },
    })
  }
}

function checkConfidenceStabilityMismatch(input: SelfCheckInput, issues: SelfCheckIssue[]): void {
  // High confidence but many normalization adjustments
  if (input.confidencePercent > 70 && input.normalizationResult) {
    const adjustmentCount = input.normalizationResult.adjustments.length
    if (adjustmentCount >= 4) {
      issues.push({
        type: 'confidence_stability_mismatch',
        severity: 'medium',
        description: `High confidence (${input.confidencePercent}%) despite ${adjustmentCount} normalization corrections`,
        affectedMeasurements: input.normalizationResult.adjustments.map(a => a.field),
        suggestedAction: 'reduce_confidence',
        metadata: { confidence: input.confidencePercent, adjustmentCount },
      })
    }
  }
  
  // High confidence with poor landmark consistency
  if (input.confidencePercent > 70 && input.landmarkConsistencyResult) {
    if (input.landmarkConsistencyResult.consistencyScore < 0.6) {
      issues.push({
        type: 'confidence_stability_mismatch',
        severity: 'medium',
        description: `High confidence (${input.confidencePercent}%) with poor landmark consistency (${(input.landmarkConsistencyResult.consistencyScore * 100).toFixed(0)}%)`,
        affectedMeasurements: [],
        suggestedAction: 'trigger_second_pass',
        metadata: { 
          confidence: input.confidencePercent, 
          consistencyScore: input.landmarkConsistencyResult.consistencyScore 
        },
      })
    }
  }
}

function checkAnatomicalRatioViolations(input: SelfCheckInput, issues: SelfCheckIssue[]): void {
  const m = input.measurements
  
  // Check beam-to-spread ratio
  if (m.inside_spread !== null && m.main_beam_left !== null && m.main_beam_right !== null) {
    const avgBeam = (m.main_beam_left + m.main_beam_right) / 2
    const beamToSpread = avgBeam / m.inside_spread
    
    const { min, max } = ANATOMICAL_RATIOS.beam_to_spread
    if (beamToSpread < min * 0.85 || beamToSpread > max * 1.15) {
      issues.push({
        type: 'anatomical_ratio_violation',
        severity: 'medium',
        description: `Beam-to-spread ratio (${beamToSpread.toFixed(2)}) outside expected range (${min}-${max})`,
        affectedMeasurements: ['inside_spread', 'main_beam_left', 'main_beam_right'],
        suggestedAction: 'use_alternative_scaling',
        metadata: { beamToSpread, avgBeam, spread: m.inside_spread },
      })
    }
  }
  
  // Check G2-to-beam ratio
  if (m.main_beam_left !== null && m.main_beam_right !== null && m.g2_left !== null && m.g2_right !== null) {
    const avgBeam = (m.main_beam_left + m.main_beam_right) / 2
    const avgG2 = (m.g2_left + m.g2_right) / 2
    const g2ToBeam = avgG2 / avgBeam
    
    const { min, max } = ANATOMICAL_RATIOS.g2_to_beam
    if (g2ToBeam < min * 0.8 || g2ToBeam > max * 1.2) {
      issues.push({
        type: 'anatomical_ratio_violation',
        severity: g2ToBeam < min * 0.6 || g2ToBeam > max * 1.4 ? 'high' : 'medium',
        description: `G2-to-beam ratio (${g2ToBeam.toFixed(2)}) outside expected range (${min}-${max})`,
        affectedMeasurements: ['g2_left', 'g2_right', 'main_beam_left', 'main_beam_right'],
        suggestedAction: 'trigger_second_pass',
        metadata: { g2ToBeam, avgG2, avgBeam },
      })
    }
  }
}

function checkNormalizationImpact(input: SelfCheckInput, issues: SelfCheckIssue[]): void {
  if (!input.normalizationResult) return
  
  const { adjustments, totalAdjustmentMagnitude, outlierCount } = input.normalizationResult
  
  if (adjustments.length >= SELF_CHECK_THRESHOLDS.HEAVY_NORMALIZATION_ADJUSTMENTS) {
    issues.push({
      type: 'normalization_heavy',
      severity: outlierCount >= 2 ? 'high' : 'medium',
      description: `Heavy normalization: ${adjustments.length} adjustments with ${outlierCount} major outlier(s)`,
      affectedMeasurements: adjustments.map(a => a.field),
      suggestedAction: 'trigger_second_pass',
      metadata: { adjustmentCount: adjustments.length, totalMagnitude: totalAdjustmentMagnitude, outlierCount },
    })
  }
  
  if (totalAdjustmentMagnitude >= SELF_CHECK_THRESHOLDS.MAJOR_NORMALIZATION_MAGNITUDE) {
    issues.push({
      type: 'normalization_heavy',
      severity: 'medium',
      description: `Large total normalization adjustment: ${totalAdjustmentMagnitude.toFixed(1)}"`,
      affectedMeasurements: adjustments.map(a => a.field),
      suggestedAction: 'adjust_weights',
      metadata: { totalMagnitude: totalAdjustmentMagnitude },
    })
  }
}

function checkLandmarkConsistencyImpact(input: SelfCheckInput, issues: SelfCheckIssue[]): void {
  if (!input.landmarkConsistencyResult) return
  
  const { consistencyScore, scalingFactor, landmarkQuality } = input.landmarkConsistencyResult
  
  if (consistencyScore < SELF_CHECK_THRESHOLDS.POOR_LANDMARK_CONSISTENCY) {
    issues.push({
      type: 'landmark_consistency_poor',
      severity: consistencyScore < 0.35 ? 'high' : 'medium',
      description: `Poor landmark consistency (${(consistencyScore * 100).toFixed(0)}%) - ${landmarkQuality} quality`,
      affectedMeasurements: [],
      suggestedAction: 'trigger_second_pass',
      metadata: { consistencyScore, scalingFactor, landmarkQuality },
    })
  }
  
  // Significant scaling factor adjustment
  if (Math.abs(scalingFactor - 1.0) > 0.15) {
    issues.push({
      type: 'landmark_consistency_poor',
      severity: Math.abs(scalingFactor - 1.0) > 0.25 ? 'high' : 'medium',
      description: `Significant scaling correction applied (factor: ${scalingFactor.toFixed(2)})`,
      affectedMeasurements: [],
      suggestedAction: 'use_alternative_scaling',
      metadata: { scalingFactor },
    })
  }
}

function checkMeasurementCorrectionMagnitude(input: SelfCheckInput, issues: SelfCheckIssue[]): void {
  if (!input.measurementCorrectionResult) return
  
  const { totalCorrectionGross, summary } = input.measurementCorrectionResult
  
  if (Math.abs(totalCorrectionGross) >= SELF_CHECK_THRESHOLDS.LARGE_CORRECTION_THRESHOLD) {
    issues.push({
      type: 'measurement_correction_large',
      severity: Math.abs(totalCorrectionGross) >= 8 ? 'high' : 'medium',
      description: `Large measurement-level correction: ${totalCorrectionGross > 0 ? '+' : ''}${totalCorrectionGross.toFixed(1)}" gross`,
      affectedMeasurements: [],
      suggestedAction: 'verify',
      metadata: { 
        totalCorrectionGross, 
        categoriesCorrected: summary.totalCategoriesCorrected,
        direction: summary.overallCorrectionDirection,
      },
    })
  }
}

function checkScoreRangePlausibility(input: SelfCheckInput, issues: SelfCheckIssue[]): void {
  const { predictedGross, predictedNet } = input
  
  if (predictedGross < SELF_CHECK_THRESHOLDS.IMPLAUSIBLE_GROSS_MIN) {
    issues.push({
      type: 'score_range_implausible',
      severity: predictedGross < 50 ? 'critical' : 'high',
      description: `Predicted gross (${predictedGross.toFixed(1)}") is unusually low`,
      affectedMeasurements: [],
      suggestedAction: 'trigger_second_pass',
      metadata: { predictedGross },
    })
  }
  
  if (predictedGross > SELF_CHECK_THRESHOLDS.IMPLAUSIBLE_GROSS_MAX) {
    issues.push({
      type: 'score_range_implausible',
      severity: predictedGross > 320 ? 'critical' : 'high',
      description: `Predicted gross (${predictedGross.toFixed(1)}") is unusually high`,
      affectedMeasurements: [],
      suggestedAction: 'trigger_second_pass',
      metadata: { predictedGross },
    })
  }
  
  // Net should not be vastly different from gross for typical racks
  if (input.rackType === 'typical') {
    const deductionPercent = ((predictedGross - predictedNet) / predictedGross) * 100
    if (deductionPercent > 15) {
      issues.push({
        type: 'score_range_implausible',
        severity: deductionPercent > 25 ? 'high' : 'medium',
        description: `High deductions for typical rack: ${(predictedGross - predictedNet).toFixed(1)}" (${deductionPercent.toFixed(0)}%)`,
        affectedMeasurements: ['deductions', 'abnormal_points'],
        suggestedAction: 'verify',
        metadata: { deductionPercent, grossNetDiff: predictedGross - predictedNet },
      })
    }
  }
}

function checkComponentVariance(
  variance: SelfCheckResult['componentVariance'], 
  issues: SelfCheckIssue[]
): void {
  const highVarianceComponents: string[] = []
  
  if (variance.spread > SELF_CHECK_THRESHOLDS.HIGH_COMPONENT_VARIANCE) {
    highVarianceComponents.push('spread')
  }
  if (variance.beams > SELF_CHECK_THRESHOLDS.HIGH_COMPONENT_VARIANCE) {
    highVarianceComponents.push('beams')
  }
  if (variance.tines > SELF_CHECK_THRESHOLDS.HIGH_COMPONENT_VARIANCE) {
    highVarianceComponents.push('tines')
  }
  if (variance.mass > SELF_CHECK_THRESHOLDS.HIGH_COMPONENT_VARIANCE) {
    highVarianceComponents.push('mass')
  }
  
  if (highVarianceComponents.length >= 2) {
    issues.push({
      type: 'component_variance_high',
      severity: highVarianceComponents.length >= 3 ? 'high' : 'medium',
      description: `High variance in ${highVarianceComponents.join(', ')} measurements`,
      affectedMeasurements: [],
      suggestedAction: 'trigger_second_pass',
      metadata: { variance, highVarianceComponents },
    })
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function calculateComponentVariance(input: SelfCheckInput): SelfCheckResult['componentVariance'] {
  const m = input.measurements
  
  // For variance, we calculate how much each side differs from the average
  // Higher variance = less confidence in the measurement
  
  const calcVariance = (left: number | null, right: number | null): number => {
    if (left === null || right === null) return 0
    const avg = (left + right) / 2
    if (avg === 0) return 0
    return Math.abs(left - right) / avg
  }
  
  return {
    spread: 0, // Single value, no variance
    beams: calcVariance(m.main_beam_left, m.main_beam_right),
    tines: Math.max(
      calcVariance(m.g1_left, m.g1_right),
      calcVariance(m.g2_left, m.g2_right),
      calcVariance(m.g3_left, m.g3_right),
      calcVariance(m.g4_left, m.g4_right)
    ),
    mass: Math.max(
      calcVariance(m.h1_left, m.h1_right),
      calcVariance(m.h2_left, m.h2_right),
      calcVariance(m.h3_left, m.h3_right),
      calcVariance(m.h4_left, m.h4_right)
    ),
  }
}

function calculateStabilityScore(issues: SelfCheckIssue[]): number {
  if (issues.length === 0) return 100
  
  let penalty = 0
  for (const issue of issues) {
    switch (issue.severity) {
      case 'critical': penalty += 25; break
      case 'high': penalty += 15; break
      case 'medium': penalty += 8; break
      case 'low': penalty += 3; break
    }
  }
  
  return Math.max(0, 100 - penalty)
}

function determineOverallStability(stabilityScore: number): SelfCheckResult['overallStability'] {
  if (stabilityScore >= SELF_CHECK_THRESHOLDS.STABLE_THRESHOLD) return 'stable'
  if (stabilityScore >= SELF_CHECK_THRESHOLDS.UNCERTAIN_THRESHOLD) return 'uncertain'
  return 'unstable'
}

function shouldTriggerSecondPass(
  issues: SelfCheckIssue[], 
  input: SelfCheckInput
): { triggerSecondPass: boolean; secondPassReasons: string[] } {
  const secondPassReasons: string[] = []
  
  // Calculate severity sum
  let severitySum = 0
  for (const issue of issues) {
    severitySum += SEVERITY_WEIGHTS[issue.severity]
    if (issue.suggestedAction === 'trigger_second_pass') {
      secondPassReasons.push(issue.description)
    }
  }
  
  // Trigger if severity sum exceeds threshold
  if (severitySum >= SELF_CHECK_THRESHOLDS.SECOND_PASS_ISSUE_SEVERITY_SUM) {
    if (secondPassReasons.length === 0) {
      secondPassReasons.push(`Combined issue severity (${severitySum}) exceeds threshold`)
    }
    return { triggerSecondPass: true, secondPassReasons }
  }
  
  // Also trigger for specific conditions
  const hasCriticalIssue = issues.some(i => i.severity === 'critical')
  if (hasCriticalIssue) {
    const criticalIssue = issues.find(i => i.severity === 'critical')
    if (criticalIssue && !secondPassReasons.includes(criticalIssue.description)) {
      secondPassReasons.push(criticalIssue.description)
    }
    return { triggerSecondPass: true, secondPassReasons }
  }
  
  // Trigger for low confidence with medium+ issues
  if (input.confidencePercent < 50 && issues.some(i => i.severity === 'medium' || i.severity === 'high')) {
    secondPassReasons.push(`Low confidence (${input.confidencePercent}%) with stability issues`)
    return { triggerSecondPass: true, secondPassReasons }
  }
  
  return { triggerSecondPass: secondPassReasons.length > 0, secondPassReasons }
}

function calculateConfidenceAdjustment(issues: SelfCheckIssue[]): number {
  let adjustment = 0
  
  for (const issue of issues) {
    if (issue.suggestedAction === 'reduce_confidence') {
      switch (issue.severity) {
        case 'critical': adjustment -= 15; break
        case 'high': adjustment -= 10; break
        case 'medium': adjustment -= 5; break
        case 'low': adjustment -= 2; break
      }
    }
  }
  
  return Math.max(-25, adjustment)
}

function buildSummary(
  issues: SelfCheckIssue[], 
  stabilityScore: number, 
  triggerSecondPass: boolean
): string {
  if (issues.length === 0) {
    return 'First-pass result appears stable with no significant issues detected.'
  }
  
  const criticalCount = issues.filter(i => i.severity === 'critical').length
  const highCount = issues.filter(i => i.severity === 'high').length
  const mediumCount = issues.filter(i => i.severity === 'medium').length
  
  const parts: string[] = []
  
  if (criticalCount > 0) parts.push(`${criticalCount} critical`)
  if (highCount > 0) parts.push(`${highCount} high`)
  if (mediumCount > 0) parts.push(`${mediumCount} medium`)
  
  let summary = `Self-check found ${parts.join(', ')} issue(s). Stability: ${stabilityScore}%.`
  
  if (triggerSecondPass) {
    summary += ' Second pass recommended.'
  }
  
  return summary
}

// ============================================================================
// EXPORTS
// ============================================================================

export { SELF_CHECK_THRESHOLDS }
