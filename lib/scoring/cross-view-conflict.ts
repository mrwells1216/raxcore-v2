/**
 * Phase 49.5: Cross-View Conflict Engine + Residual Analysis + Trust-Weighted Fusion
 * 
 * Detects and classifies disagreement between views, assigns per-view trust scores
 * per measurement family, and performs conflict-aware fusion instead of naive averaging.
 * 
 * CORE RULE: When views disagree, the system must explain, not average.
 */

import type { AngleType, Measurements, LandmarksDetected } from '@/lib/types'
import type { ImageMeasurement } from './fusion'
import type { GeometryConsistencyResult } from './geometry-consistency'
import type { MeasurementFamily } from './segment-confidence-interval'

// ============================================================================
// TYPES
// ============================================================================

export type DisagreementType =
  | 'scale_reference_conflict'
  | 'perspective_distortion'
  | 'occlusion_missing_structure'
  | 'asymmetry_vs_perspective'
  | 'landmark_instability'
  | 'multi_view_inconsistency'
  | 'low_quality_input'

export type FusionStrategy = 'weighted_average' | 'dominant_view' | 'highest_trust' | 'flagged_for_review'
export type DisagreementLevel = 'low' | 'moderate' | 'high' | 'critical'

export interface ViewTrustScores {
  imageIndex: number
  angleType: AngleType
  /** Trust scores per measurement family (0-1) */
  trust: Record<MeasurementFamily, number>
  /** Overall trust for this view */
  overallTrust: number
  /** Signals that contributed to trust calculation */
  trustSignals: ViewTrustSignals
  /** Whether this view is marked as outlier */
  isOutlier: boolean
  /** Reason if marked outlier */
  outlierReason: string | null
}

export interface ViewTrustSignals {
  referenceQuality: number
  landmarkConfidence: number
  angleClassQuality: number
  visibilityScore: number
  geometryConsistency: number
  cropOcclusionPenalty: number
}

export interface PerFamilyResiduals {
  family: MeasurementFamily
  /** Per-view estimates for this family */
  viewEstimates: {
    imageIndex: number
    angleType: AngleType
    value: number
    confidence: number
  }[]
  /** Statistical metrics */
  maxDeviation: number
  meanDeviation: number
  stdDev: number
  /** View index that provides the dominant estimate */
  dominantViewIndex: number | null
  /** Disagreement score 0-1 */
  disagreementScore: number
  /** Disagreement level classification */
  disagreementLevel: DisagreementLevel
}

export interface DisagreementClassification {
  family: MeasurementFamily
  /** Primary type of disagreement */
  primaryType: DisagreementType
  /** Secondary types if multiple factors */
  secondaryTypes: DisagreementType[]
  /** Human-readable explanation */
  explanation: string
  /** Signals that led to this classification */
  contributingSignals: string[]
  /** Whether reverse engineering is recommended */
  reverseEngineeringRecommended: boolean
  /** Reason for reverse engineering recommendation */
  reverseEngineeringReason: string | null
}

export interface ConflictAwareFusionResult {
  /** Fused value for this family */
  fusedValue: number
  /** Fusion strategy used */
  strategy: FusionStrategy
  /** Primary view used (if dominant view strategy) */
  primaryViewIndex: number | null
  /** Secondary views included (if any) */
  secondaryViewIndices: number[]
  /** Confidence in the fused value */
  fusionConfidence: number
  /** Explanation of fusion decision */
  explanation: string
}

export interface CrossViewConflictResult {
  /** Per-family residual analysis */
  perFamilyResiduals: PerFamilyResiduals[]
  
  /** Per-view trust scores */
  viewTrustScores: ViewTrustScores[]
  
  /** Disagreement classifications per family */
  disagreementClassifications: DisagreementClassification[]
  
  /** Conflict-aware fusion results per family */
  fusionResults: Record<MeasurementFamily, ConflictAwareFusionResult>
  
  /** Final fused measurements */
  fusedMeasurements: Measurements
  
  /** Views rejected as outliers */
  rejectedViews: {
    imageIndex: number
    angleType: AngleType
    reason: string
  }[]
  
  /** Overall conflict summary */
  conflictSummary: {
    totalDisagreements: number
    highDisagreementFamilies: MeasurementFamily[]
    dominantViewUsed: boolean
    reverseEngineeringRecommended: boolean
    reverseEngineeringTriggerReasons: string[]
    overallConfidence: number
  }
  
  /** Debug/admin explanation */
  explanation: string[]
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DISAGREEMENT_THRESHOLDS = {
  /** Below this is considered low disagreement (proceed with weighted fusion) */
  low: 0.10,
  /** Below this is moderate (weight toward high-trust views) */
  moderate: 0.20,
  /** Below this is high (use dominant view) */
  high: 0.35,
  /** Above this is critical (flag for review) */
  critical: 0.50,
} as const

const MEASUREMENT_FAMILY_FIELDS: Record<MeasurementFamily, (keyof Measurements)[]> = {
  spread: ['inside_spread'],
  beam: ['main_beam_left', 'main_beam_right'],
  tine: ['g1_left', 'g1_right', 'g2_left', 'g2_right', 'g3_left', 'g3_right', 'g4_left', 'g4_right', 'g5_left', 'g5_right'],
  mass: ['h1_left', 'h1_right', 'h2_left', 'h2_right', 'h3_left', 'h3_right', 'h4_left', 'h4_right'],
  deduction: ['deductions', 'abnormal_points'],
}

const ANGLE_TYPE_TRUST_BONUS: Record<MeasurementFamily, Record<AngleType, number>> = {
  spread: { front: 0.3, back: 0.15, left: 0.0, right: 0.0, other: -0.1 },
  beam: { front: 0.1, back: 0.0, left: 0.25, right: 0.25, other: -0.1 },
  tine: { front: 0.05, back: 0.0, left: 0.25, right: 0.25, other: -0.1 },
  mass: { front: 0.0, back: 0.0, left: 0.2, right: 0.2, other: -0.15 },
  deduction: { front: 0.2, back: 0.1, left: 0.15, right: 0.15, other: -0.1 },
}

// ============================================================================
// INPUT TYPES
// ============================================================================

export interface CrossViewConflictInput {
  /** Per-image measurements from vision scoring */
  imageMeasurements: ImageMeasurement[]
  /** Base measurements (single best estimate or initial fusion) */
  baseMeasurements: Measurements
  /** Per-image landmark data */
  perImageLandmarks: {
    imageIndex: number
    angleType: AngleType
    landmarks: LandmarksDetected
    landmarkConfidence: number
    referenceQuality: number
  }[]
  /** Geometry consistency result (if available) */
  geometryConsistency?: GeometryConsistencyResult | null
  /** Whether ears are fully visible */
  earsFullyVisible?: boolean
}

// ============================================================================
// MAIN FUNCTION
// ============================================================================

export function analyzesCrossViewConflicts(
  input: CrossViewConflictInput
): CrossViewConflictResult {
  const {
    imageMeasurements,
    baseMeasurements,
    perImageLandmarks,
    geometryConsistency,
    earsFullyVisible,
  } = input

  const explanation: string[] = []
  explanation.push(`Cross-view conflict analysis for ${imageMeasurements.length} image(s)`)

  // ============================================================================
  // 1. COMPUTE VIEW TRUST SCORES (PER FAMILY)
  // ============================================================================
  
  const viewTrustScores = computeViewTrustScores(
    imageMeasurements,
    perImageLandmarks,
    geometryConsistency,
    earsFullyVisible
  )
  explanation.push(`Computed trust scores for ${viewTrustScores.length} views`)

  // ============================================================================
  // 2. COMPUTE PER-FAMILY RESIDUALS
  // ============================================================================
  
  const perFamilyResiduals = computePerFamilyResiduals(
    imageMeasurements,
    viewTrustScores
  )
  explanation.push(`Computed residuals for ${perFamilyResiduals.length} measurement families`)

  // ============================================================================
  // 3. CLASSIFY DISAGREEMENTS
  // ============================================================================
  
  const disagreementClassifications = classifyDisagreements(
    perFamilyResiduals,
    viewTrustScores,
    perImageLandmarks,
    imageMeasurements
  )
  
  const highDisagreementCount = disagreementClassifications.filter(
    d => ['high', 'critical'].includes(perFamilyResiduals.find(r => r.family === d.family)?.disagreementLevel || '')
  ).length
  explanation.push(`Classified ${disagreementClassifications.length} disagreements (${highDisagreementCount} high/critical)`)

  // ============================================================================
  // 4. IDENTIFY OUTLIER VIEWS
  // ============================================================================
  
  const { updatedTrustScores, rejectedViews } = identifyOutlierViews(
    viewTrustScores,
    perFamilyResiduals
  )
  explanation.push(`Identified ${rejectedViews.length} outlier view(s)`)

  // ============================================================================
  // 5. PERFORM CONFLICT-AWARE FUSION
  // ============================================================================
  
  const { fusionResults, fusedMeasurements } = performConflictAwareFusion(
    imageMeasurements,
    baseMeasurements,
    perFamilyResiduals,
    updatedTrustScores,
    disagreementClassifications
  )
  explanation.push(`Performed conflict-aware fusion for all families`)

  // ============================================================================
  // 6. BUILD CONFLICT SUMMARY
  // ============================================================================
  
  const reverseEngineeringTriggers: string[] = []
  for (const dc of disagreementClassifications) {
    if (dc.reverseEngineeringRecommended && dc.reverseEngineeringReason) {
      reverseEngineeringTriggers.push(dc.reverseEngineeringReason)
    }
  }

  const highDisagreementFamilies = perFamilyResiduals
    .filter(r => r.disagreementLevel === 'high' || r.disagreementLevel === 'critical')
    .map(r => r.family)

  const dominantViewUsed = Object.values(fusionResults).some(
    r => r.strategy === 'dominant_view' || r.strategy === 'highest_trust'
  )

  // Calculate overall confidence
  const familyConfidences = Object.values(fusionResults).map(r => r.fusionConfidence)
  const overallConfidence = familyConfidences.length > 0
    ? familyConfidences.reduce((a, b) => a + b, 0) / familyConfidences.length
    : 0.5

  const conflictSummary = {
    totalDisagreements: disagreementClassifications.length,
    highDisagreementFamilies,
    dominantViewUsed,
    reverseEngineeringRecommended: reverseEngineeringTriggers.length > 0,
    reverseEngineeringTriggerReasons: reverseEngineeringTriggers,
    overallConfidence,
  }

  return {
    perFamilyResiduals,
    viewTrustScores: updatedTrustScores,
    disagreementClassifications,
    fusionResults,
    fusedMeasurements,
    rejectedViews,
    conflictSummary,
    explanation,
  }
}

// ============================================================================
// VIEW TRUST SCORING
// ============================================================================

function computeViewTrustScores(
  imageMeasurements: ImageMeasurement[],
  perImageLandmarks: CrossViewConflictInput['perImageLandmarks'],
  geometryConsistency: GeometryConsistencyResult | null | undefined,
  earsFullyVisible: boolean | undefined
): ViewTrustScores[] {
  const results: ViewTrustScores[] = []

  for (const imgMeasurement of imageMeasurements) {
    const landmarkData = perImageLandmarks.find(l => l.imageIndex === imgMeasurement.imageIndex)
    
    // Build trust signals
    const signals: ViewTrustSignals = {
      referenceQuality: landmarkData?.referenceQuality ?? 0.3,
      landmarkConfidence: landmarkData?.landmarkConfidence ?? 0.3,
      angleClassQuality: getAngleClassQuality(imgMeasurement.angleType),
      visibilityScore: computeVisibilityScore(landmarkData?.landmarks, earsFullyVisible),
      geometryConsistency: geometryConsistency?.consistencyScore ?? 0.5,
      cropOcclusionPenalty: 0, // Would come from image validation
    }

    // Compute per-family trust
    const trust: Record<MeasurementFamily, number> = {
      spread: 0,
      beam: 0,
      tine: 0,
      mass: 0,
      deduction: 0,
    }

    for (const family of Object.keys(trust) as MeasurementFamily[]) {
      let familyTrust = 0.3 // Base trust
      
      // Add reference quality
      familyTrust += signals.referenceQuality * 0.25
      
      // Add landmark confidence
      familyTrust += signals.landmarkConfidence * 0.2
      
      // Add angle-specific bonus
      const angleBonus = ANGLE_TYPE_TRUST_BONUS[family][imgMeasurement.angleType] ?? 0
      familyTrust += angleBonus
      
      // Add visibility score
      familyTrust += signals.visibilityScore * 0.15
      
      // Add geometry consistency
      familyTrust += signals.geometryConsistency * 0.1
      
      // Apply penalties
      familyTrust -= signals.cropOcclusionPenalty * 0.3
      
      // Apply geometry trust penalties if available
      if (geometryConsistency?.measurementTrustPenalties) {
        const penalty = geometryConsistency.measurementTrustPenalties[family] ?? 0
        familyTrust -= penalty * 0.5
      }
      
      trust[family] = Math.max(0.05, Math.min(0.98, familyTrust))
    }

    // Compute overall trust
    const overallTrust = (trust.spread + trust.beam + trust.tine + trust.mass + trust.deduction) / 5

    results.push({
      imageIndex: imgMeasurement.imageIndex,
      angleType: imgMeasurement.angleType,
      trust,
      overallTrust,
      trustSignals: signals,
      isOutlier: false,
      outlierReason: null,
    })
  }

  return results
}

function getAngleClassQuality(angleType: AngleType): number {
  switch (angleType) {
    case 'front': return 0.9
    case 'left': return 0.85
    case 'right': return 0.85
    case 'back': return 0.6
    case 'other': return 0.3
    default: return 0.4
  }
}

function computeVisibilityScore(
  landmarks: LandmarksDetected | undefined,
  earsFullyVisible: boolean | undefined
): number {
  if (!landmarks) return 0.3
  
  let score = 0.2
  if (landmarks.ears_visible) score += earsFullyVisible ? 0.4 : 0.25
  if (landmarks.eyes_visible) score += 0.2
  if (landmarks.antlers_visible) score += 0.2
  
  return Math.min(1, score)
}

// ============================================================================
// PER-FAMILY RESIDUAL ANALYSIS
// ============================================================================

function computePerFamilyResiduals(
  imageMeasurements: ImageMeasurement[],
  viewTrustScores: ViewTrustScores[]
): PerFamilyResiduals[] {
  const families: MeasurementFamily[] = ['spread', 'beam', 'tine', 'mass', 'deduction']
  const results: PerFamilyResiduals[] = []

  for (const family of families) {
    const fields = MEASUREMENT_FAMILY_FIELDS[family]
    const viewEstimates: PerFamilyResiduals['viewEstimates'] = []

    // Collect estimates from each view for this family
    for (const imgMeasurement of imageMeasurements) {
      let familySum = 0
      let fieldCount = 0

      for (const field of fields) {
        const value = imgMeasurement.measurements[field]
        if (typeof value === 'number' && value > 0) {
          familySum += value
          fieldCount++
        }
      }

      if (fieldCount > 0) {
        const trustScore = viewTrustScores.find(v => v.imageIndex === imgMeasurement.imageIndex)
        viewEstimates.push({
          imageIndex: imgMeasurement.imageIndex,
          angleType: imgMeasurement.angleType,
          value: familySum / fieldCount, // Average for the family
          confidence: trustScore?.trust[family] ?? imgMeasurement.confidence,
        })
      }
    }

    // Calculate residual metrics
    if (viewEstimates.length === 0) {
      results.push({
        family,
        viewEstimates: [],
        maxDeviation: 0,
        meanDeviation: 0,
        stdDev: 0,
        dominantViewIndex: null,
        disagreementScore: 0,
        disagreementLevel: 'low',
      })
      continue
    }

    if (viewEstimates.length === 1) {
      results.push({
        family,
        viewEstimates,
        maxDeviation: 0,
        meanDeviation: 0,
        stdDev: 0,
        dominantViewIndex: viewEstimates[0].imageIndex,
        disagreementScore: 0,
        disagreementLevel: 'low',
      })
      continue
    }

    // Calculate statistics
    const values = viewEstimates.map(v => v.value)
    const mean = values.reduce((a, b) => a + b, 0) / values.length
    const deviations = values.map(v => Math.abs(v - mean))
    const maxDeviation = Math.max(...deviations)
    const meanDeviation = deviations.reduce((a, b) => a + b, 0) / deviations.length
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length
    const stdDev = Math.sqrt(variance)

    // Disagreement score normalized by mean
    const disagreementScore = mean > 0 ? maxDeviation / mean : 0

    // Determine disagreement level
    let disagreementLevel: DisagreementLevel = 'low'
    if (disagreementScore >= DISAGREEMENT_THRESHOLDS.critical) disagreementLevel = 'critical'
    else if (disagreementScore >= DISAGREEMENT_THRESHOLDS.high) disagreementLevel = 'high'
    else if (disagreementScore >= DISAGREEMENT_THRESHOLDS.moderate) disagreementLevel = 'moderate'

    // Find dominant view (highest confidence with value close to weighted mean)
    const weightedMean = viewEstimates.reduce(
      (sum, v) => sum + v.value * v.confidence,
      0
    ) / viewEstimates.reduce((sum, v) => sum + v.confidence, 0)
    
    let dominantViewIndex: number | null = null
    let bestScore = -1
    for (const est of viewEstimates) {
      const distanceToWeightedMean = Math.abs(est.value - weightedMean) / (mean || 1)
      const score = est.confidence * (1 - distanceToWeightedMean)
      if (score > bestScore) {
        bestScore = score
        dominantViewIndex = est.imageIndex
      }
    }

    results.push({
      family,
      viewEstimates,
      maxDeviation,
      meanDeviation,
      stdDev,
      dominantViewIndex,
      disagreementScore,
      disagreementLevel,
    })
  }

  return results
}

// ============================================================================
// DISAGREEMENT CLASSIFICATION
// ============================================================================

function classifyDisagreements(
  perFamilyResiduals: PerFamilyResiduals[],
  viewTrustScores: ViewTrustScores[],
  perImageLandmarks: CrossViewConflictInput['perImageLandmarks'],
  imageMeasurements: ImageMeasurement[]
): DisagreementClassification[] {
  const classifications: DisagreementClassification[] = []

  for (const residual of perFamilyResiduals) {
    if (residual.disagreementLevel === 'low') continue

    const contributingSignals: string[] = []
    let primaryType: DisagreementType = 'multi_view_inconsistency'
    const secondaryTypes: DisagreementType[] = []
    let reverseEngineeringRecommended = false
    let reverseEngineeringReason: string | null = null

    // Analyze signals to classify disagreement type
    
    // 1. Check for reference quality mismatch
    const referenceQualities = viewTrustScores.map(v => v.trustSignals.referenceQuality)
    const refQualityVariance = calculateVariance(referenceQualities)
    if (refQualityVariance > 0.04) {
      if (primaryType === 'multi_view_inconsistency') {
        primaryType = 'scale_reference_conflict'
      } else {
        secondaryTypes.push('scale_reference_conflict')
      }
      contributingSignals.push(`Reference quality variance: ${(refQualityVariance * 100).toFixed(1)}%`)
    }

    // 2. Check for angle-based perspective issues
    const angles = imageMeasurements.map(m => m.angleType)
    const hasFrontalAndSide = angles.includes('front') && (angles.includes('left') || angles.includes('right'))
    if (hasFrontalAndSide && residual.family === 'spread') {
      secondaryTypes.push('perspective_distortion')
      contributingSignals.push('Front and side angles may see spread differently')
    }

    // 3. Check for landmark instability
    const landmarkConfidences = viewTrustScores.map(v => v.trustSignals.landmarkConfidence)
    const landmarkVariance = calculateVariance(landmarkConfidences)
    if (landmarkVariance > 0.05) {
      secondaryTypes.push('landmark_instability')
      contributingSignals.push(`Landmark confidence variance: ${(landmarkVariance * 100).toFixed(1)}%`)
    }

    // 4. Check for asymmetry vs perspective confusion (for beam family)
    if (residual.family === 'beam') {
      const leftOnlyViews = imageMeasurements.filter(m => m.angleType === 'left').length
      const rightOnlyViews = imageMeasurements.filter(m => m.angleType === 'right').length
      if ((leftOnlyViews > 0 && rightOnlyViews === 0) || (rightOnlyViews > 0 && leftOnlyViews === 0)) {
        secondaryTypes.push('asymmetry_vs_perspective')
        contributingSignals.push('Single-side view cannot distinguish real asymmetry from perspective')
        reverseEngineeringRecommended = true
        reverseEngineeringReason = 'Beam asymmetry ambiguous - need both sides or front view'
      }
    }

    // 5. Check for low quality inputs
    const avgTrust = viewTrustScores.reduce((sum, v) => sum + v.overallTrust, 0) / viewTrustScores.length
    if (avgTrust < 0.4) {
      secondaryTypes.push('low_quality_input')
      contributingSignals.push(`Average view trust is low: ${(avgTrust * 100).toFixed(0)}%`)
    }

    // 6. Check for visibility issues (potential occlusion)
    const visibilityScores = viewTrustScores.map(v => v.trustSignals.visibilityScore)
    const minVisibility = Math.min(...visibilityScores)
    if (minVisibility < 0.4 && visibilityScores.some(v => v > 0.7)) {
      secondaryTypes.push('occlusion_missing_structure')
      contributingSignals.push('Significant visibility difference between views')
    }

    // Determine if reverse engineering is needed
    if (residual.disagreementLevel === 'critical') {
      reverseEngineeringRecommended = true
      reverseEngineeringReason = reverseEngineeringReason || 
        `Critical disagreement in ${residual.family} (${(residual.disagreementScore * 100).toFixed(0)}% deviation)`
    }
    
    // Check for conflicting high-trust views
    const highTrustViews = viewTrustScores.filter(v => v.trust[residual.family] > 0.7)
    if (highTrustViews.length >= 2 && residual.disagreementLevel === 'high') {
      reverseEngineeringRecommended = true
      reverseEngineeringReason = reverseEngineeringReason ||
        `Multiple high-trust views disagree on ${residual.family}`
    }

    // Build explanation
    const explanation = buildDisagreementExplanation(
      residual,
      primaryType,
      secondaryTypes,
      contributingSignals
    )

    classifications.push({
      family: residual.family,
      primaryType,
      secondaryTypes,
      explanation,
      contributingSignals,
      reverseEngineeringRecommended,
      reverseEngineeringReason,
    })
  }

  return classifications
}

function calculateVariance(values: number[]): number {
  if (values.length < 2) return 0
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  return values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length
}

function buildDisagreementExplanation(
  residual: PerFamilyResiduals,
  primaryType: DisagreementType,
  secondaryTypes: DisagreementType[],
  signals: string[]
): string {
  const typeLabels: Record<DisagreementType, string> = {
    scale_reference_conflict: 'scale reference mismatch',
    perspective_distortion: 'perspective distortion',
    occlusion_missing_structure: 'occlusion or missing structure',
    asymmetry_vs_perspective: 'asymmetry vs perspective ambiguity',
    landmark_instability: 'landmark detection instability',
    multi_view_inconsistency: 'multi-view inconsistency',
    low_quality_input: 'low quality input',
  }

  const parts: string[] = [
    `${residual.family.toUpperCase()}: ${residual.disagreementLevel} disagreement`,
    `(max deviation: ${residual.maxDeviation.toFixed(1)}", ${(residual.disagreementScore * 100).toFixed(0)}% relative).`,
    `Primary cause: ${typeLabels[primaryType]}.`,
  ]

  if (secondaryTypes.length > 0) {
    parts.push(`Contributing factors: ${secondaryTypes.map(t => typeLabels[t]).join(', ')}.`)
  }

  return parts.join(' ')
}

// ============================================================================
// OUTLIER VIEW DETECTION
// ============================================================================

function identifyOutlierViews(
  viewTrustScores: ViewTrustScores[],
  perFamilyResiduals: PerFamilyResiduals[]
): {
  updatedTrustScores: ViewTrustScores[]
  rejectedViews: CrossViewConflictResult['rejectedViews']
} {
  const rejectedViews: CrossViewConflictResult['rejectedViews'] = []
  const updatedTrustScores = viewTrustScores.map(v => ({ ...v }))

  if (viewTrustScores.length < 3) {
    // Need at least 3 views to identify outliers
    return { updatedTrustScores, rejectedViews }
  }

  for (const view of updatedTrustScores) {
    let outlierScore = 0
    const reasons: string[] = []

    // Check if view is consistently an outlier across families
    for (const residual of perFamilyResiduals) {
      if (residual.viewEstimates.length < 3) continue
      
      const viewEstimate = residual.viewEstimates.find(e => e.imageIndex === view.imageIndex)
      if (!viewEstimate) continue

      // Calculate z-score for this view's estimate
      const values = residual.viewEstimates.map(e => e.value)
      const mean = values.reduce((a, b) => a + b, 0) / values.length
      const stdDev = Math.sqrt(
        values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length
      )

      if (stdDev > 0) {
        const zScore = Math.abs(viewEstimate.value - mean) / stdDev
        if (zScore > 2.0) {
          outlierScore += 1
          reasons.push(`${residual.family}: ${zScore.toFixed(1)}σ from mean`)
        }
      }
    }

    // Check overall trust score
    if (view.overallTrust < 0.25) {
      outlierScore += 1
      reasons.push(`Low overall trust: ${(view.overallTrust * 100).toFixed(0)}%`)
    }

    // Check geometry consistency
    if (view.trustSignals.geometryConsistency < 0.4) {
      outlierScore += 0.5
      reasons.push('Low geometry consistency')
    }

    // Mark as outlier if score is high enough
    if (outlierScore >= 2) {
      view.isOutlier = true
      view.outlierReason = reasons.join('; ')
      rejectedViews.push({
        imageIndex: view.imageIndex,
        angleType: view.angleType,
        reason: view.outlierReason,
      })
    }
  }

  return { updatedTrustScores, rejectedViews }
}

// ============================================================================
// CONFLICT-AWARE FUSION
// ============================================================================

function performConflictAwareFusion(
  imageMeasurements: ImageMeasurement[],
  baseMeasurements: Measurements,
  perFamilyResiduals: PerFamilyResiduals[],
  viewTrustScores: ViewTrustScores[],
  disagreementClassifications: DisagreementClassification[]
): {
  fusionResults: Record<MeasurementFamily, ConflictAwareFusionResult>
  fusedMeasurements: Measurements
} {
  const fusionResults: Record<MeasurementFamily, ConflictAwareFusionResult> = {} as Record<MeasurementFamily, ConflictAwareFusionResult>
  const fusedMeasurements = { ...baseMeasurements }

  // Get non-outlier views
  const validViews = viewTrustScores.filter(v => !v.isOutlier)
  const validImageMeasurements = imageMeasurements.filter(
    m => validViews.some(v => v.imageIndex === m.imageIndex)
  )

  for (const residual of perFamilyResiduals) {
    const family = residual.family
    const classification = disagreementClassifications.find(d => d.family === family)

    // Determine fusion strategy based on disagreement level
    let strategy: FusionStrategy
    let primaryViewIndex: number | null = null
    let secondaryViewIndices: number[] = []
    let fusedValue: number = 0
    let fusionConfidence: number = 0.5
    let explanation: string

    // Filter to valid view estimates
    const validEstimates = residual.viewEstimates.filter(
      e => validViews.some(v => v.imageIndex === e.imageIndex)
    )

    if (validEstimates.length === 0) {
      // No valid estimates, use base measurement
      strategy = 'flagged_for_review'
      fusedValue = getBaseMeasurementForFamily(baseMeasurements, family)
      fusionConfidence = 0.2
      explanation = 'No valid view estimates available'
    } else if (residual.disagreementLevel === 'low') {
      // Low disagreement: weighted average
      strategy = 'weighted_average'
      const { value, confidence } = computeWeightedAverage(validEstimates, viewTrustScores, family)
      fusedValue = value
      fusionConfidence = confidence * 1.1 // Bonus for agreement
      secondaryViewIndices = validEstimates.map(e => e.imageIndex)
      explanation = `Low disagreement - weighted average across ${validEstimates.length} views`
    } else if (residual.disagreementLevel === 'moderate') {
      // Moderate disagreement: weight heavily toward highest trust
      strategy = 'highest_trust'
      const { value, confidence, primaryIndex, secondaryIndices } = computeHighTrustFusion(
        validEstimates,
        viewTrustScores,
        family
      )
      fusedValue = value
      fusionConfidence = confidence
      primaryViewIndex = primaryIndex
      secondaryViewIndices = secondaryIndices
      explanation = `Moderate disagreement - weighted toward highest-trust view (index ${primaryIndex})`
    } else if (residual.disagreementLevel === 'high') {
      // High disagreement: use dominant view only
      strategy = 'dominant_view'
      const dominantEstimate = validEstimates.find(e => e.imageIndex === residual.dominantViewIndex)
      if (dominantEstimate) {
        fusedValue = dominantEstimate.value
        primaryViewIndex = dominantEstimate.imageIndex
        fusionConfidence = dominantEstimate.confidence * 0.85 // Penalty for relying on single view
        explanation = `High disagreement - using dominant view (index ${primaryViewIndex})`
      } else {
        // Fallback to highest confidence
        const sorted = [...validEstimates].sort((a, b) => b.confidence - a.confidence)
        fusedValue = sorted[0].value
        primaryViewIndex = sorted[0].imageIndex
        fusionConfidence = sorted[0].confidence * 0.8
        explanation = `High disagreement - fallback to highest confidence view`
      }
    } else {
      // Critical disagreement: flag for review, use dominant but with low confidence
      strategy = 'flagged_for_review'
      const sorted = [...validEstimates].sort((a, b) => b.confidence - a.confidence)
      fusedValue = sorted[0].value
      primaryViewIndex = sorted[0].imageIndex
      fusionConfidence = Math.min(0.4, sorted[0].confidence * 0.6)
      explanation = `Critical disagreement - flagged for review, using highest confidence as fallback`
    }

    // Apply the fused value to measurements
    applyFusedValueToMeasurements(fusedMeasurements, family, fusedValue, validImageMeasurements)

    fusionResults[family] = {
      fusedValue,
      strategy,
      primaryViewIndex,
      secondaryViewIndices,
      fusionConfidence: Math.max(0.1, Math.min(0.98, fusionConfidence)),
      explanation,
    }
  }

  return { fusionResults, fusedMeasurements }
}

function getBaseMeasurementForFamily(measurements: Measurements, family: MeasurementFamily): number {
  const fields = MEASUREMENT_FAMILY_FIELDS[family]
  let sum = 0
  let count = 0
  for (const field of fields) {
    const value = measurements[field]
    if (typeof value === 'number' && value > 0) {
      sum += value
      count++
    }
  }
  return count > 0 ? sum / count : 0
}

function computeWeightedAverage(
  estimates: PerFamilyResiduals['viewEstimates'],
  trustScores: ViewTrustScores[],
  family: MeasurementFamily
): { value: number; confidence: number } {
  let weightedSum = 0
  let totalWeight = 0

  for (const est of estimates) {
    const trust = trustScores.find(t => t.imageIndex === est.imageIndex)?.trust[family] ?? est.confidence
    const weight = trust * trust // Square for stronger weighting
    weightedSum += est.value * weight
    totalWeight += weight
  }

  const value = totalWeight > 0 ? weightedSum / totalWeight : 0
  const confidence = estimates.length > 0
    ? estimates.reduce((sum, e) => sum + e.confidence, 0) / estimates.length
    : 0.3

  return { value, confidence }
}

function computeHighTrustFusion(
  estimates: PerFamilyResiduals['viewEstimates'],
  trustScores: ViewTrustScores[],
  family: MeasurementFamily
): {
  value: number
  confidence: number
  primaryIndex: number | null
  secondaryIndices: number[]
} {
  // Sort by trust score for this family
  const sorted = [...estimates].sort((a, b) => {
    const trustA = trustScores.find(t => t.imageIndex === a.imageIndex)?.trust[family] ?? a.confidence
    const trustB = trustScores.find(t => t.imageIndex === b.imageIndex)?.trust[family] ?? b.confidence
    return trustB - trustA
  })

  if (sorted.length === 0) {
    return { value: 0, confidence: 0.2, primaryIndex: null, secondaryIndices: [] }
  }

  const primary = sorted[0]
  const primaryTrust = trustScores.find(t => t.imageIndex === primary.imageIndex)?.trust[family] ?? primary.confidence
  
  // Include secondary views if they're close to primary in trust
  const secondaryIndices: number[] = []
  let weightedSum = primary.value * (primaryTrust * primaryTrust)
  let totalWeight = primaryTrust * primaryTrust

  for (let i = 1; i < sorted.length; i++) {
    const est = sorted[i]
    const trust = trustScores.find(t => t.imageIndex === est.imageIndex)?.trust[family] ?? est.confidence
    
    // Only include if trust is at least 70% of primary
    if (trust >= primaryTrust * 0.7) {
      secondaryIndices.push(est.imageIndex)
      const weight = trust * trust * 0.5 // Secondary views get half weight
      weightedSum += est.value * weight
      totalWeight += weight
    }
  }

  return {
    value: totalWeight > 0 ? weightedSum / totalWeight : primary.value,
    confidence: primaryTrust * 0.9,
    primaryIndex: primary.imageIndex,
    secondaryIndices,
  }
}

function applyFusedValueToMeasurements(
  measurements: Measurements,
  family: MeasurementFamily,
  _fusedValue: number,
  validImageMeasurements: ImageMeasurement[]
): void {
  const fields = MEASUREMENT_FAMILY_FIELDS[family]
  
  // For each field in the family, compute the best estimate from valid measurements
  for (const field of fields) {
    const fieldValues: { value: number; confidence: number }[] = []
    
    for (const imgMeasurement of validImageMeasurements) {
      const value = imgMeasurement.measurements[field]
      if (typeof value === 'number' && value > 0) {
        fieldValues.push({ value, confidence: imgMeasurement.confidence })
      }
    }

    if (fieldValues.length > 0) {
      // Weighted average for individual fields
      let weightedSum = 0
      let totalWeight = 0
      for (const fv of fieldValues) {
        const weight = fv.confidence * fv.confidence
        weightedSum += fv.value * weight
        totalWeight += weight
      }
      const fusedFieldValue = totalWeight > 0 ? weightedSum / totalWeight : fieldValues[0].value
      ;(measurements as Record<string, number | null>)[field] = Number(fusedFieldValue.toFixed(1))
    }
  }
}

// ============================================================================
// UTILITY EXPORTS
// ============================================================================

/**
 * Convert conflict result to storable metadata
 */
export function conflictResultToMetadata(result: CrossViewConflictResult): {
  perFamilyResiduals: Record<string, {
    maxDeviation: number
    meanDeviation: number
    stdDev: number
    disagreementScore: number
    disagreementLevel: string
    dominantViewIndex: number | null
  }>
  viewTrustScores: Record<number, {
    angleType: string
    overallTrust: number
    isOutlier: boolean
    perFamilyTrust: Record<string, number>
  }>
  disagreementClassifications: {
    family: string
    primaryType: string
    reverseEngineeringRecommended: boolean
    explanation: string
  }[]
  fusionStrategies: Record<string, string>
  conflictSummary: typeof result.conflictSummary
} {
  return {
    perFamilyResiduals: Object.fromEntries(
      result.perFamilyResiduals.map(r => [r.family, {
        maxDeviation: r.maxDeviation,
        meanDeviation: r.meanDeviation,
        stdDev: r.stdDev,
        disagreementScore: r.disagreementScore,
        disagreementLevel: r.disagreementLevel,
        dominantViewIndex: r.dominantViewIndex,
      }])
    ),
    viewTrustScores: Object.fromEntries(
      result.viewTrustScores.map(v => [v.imageIndex, {
        angleType: v.angleType,
        overallTrust: v.overallTrust,
        isOutlier: v.isOutlier,
        perFamilyTrust: v.trust,
      }])
    ),
    disagreementClassifications: result.disagreementClassifications.map(d => ({
      family: d.family,
      primaryType: d.primaryType,
      reverseEngineeringRecommended: d.reverseEngineeringRecommended,
      explanation: d.explanation,
    })),
    fusionStrategies: Object.fromEntries(
      Object.entries(result.fusionResults).map(([family, r]) => [family, r.strategy])
    ),
    conflictSummary: result.conflictSummary,
  }
}
