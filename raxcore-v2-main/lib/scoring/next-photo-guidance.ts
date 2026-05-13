/**
 * Phase 47: "Next Most Informative Photo" Guidance Engine
 *
 * Analyzes current image set quality and measurement family uncertainties
 * to recommend the single most valuable additional photo the user could provide.
 *
 * This is NOT a generic recommendation engine - it uses real pipeline signals
 * to determine when additional photos would materially help vs. when they
 * would not change the estimate much.
 */

import type { AngleType, SourceType, LandmarksDetected, Measurements } from '@/lib/types'
import type {
  FamilyUncertainty,
  MeasurementFamily,
  SegmentConfidenceIntervalResult,
} from './segment-confidence-interval'
import type { GeometryConsistencyResult } from './geometry-consistency'
import type { TrustScoreResult } from './trust-score'

// ============================================================================
// TYPES
// ============================================================================

export type PhotoRecommendationType =
  | 'frontal_straight'
  | 'left_side'
  | 'right_side'
  | 'left_45'
  | 'right_45'
  | 'better_lighting'
  | 'uncropped_rack'
  | 'closer_face_reference'
  | 'none_needed'

export type PhotoRequestDecision =
  | 'proceed_current_only'
  | 'proceed_but_recommend'
  | 'strongly_recommend_before_finalize'

export interface NextPhotoRecommendation {
  // Primary recommendation
  recommendationType: PhotoRecommendationType
  recommendedAngle: AngleType | null

  // Decision policy
  decision: PhotoRequestDecision
  expectedGainDescription: string
  expectedConfidenceImprovement: number // 0-25 points potential gain

  // User-facing message
  userMessage: string
  userReason: string

  // Why this recommendation
  primaryReason: string
  targetFamily: MeasurementFamily | null
  targetWeakness: string | null

  // Estimated value of additional photo
  estimatedBenefit: 'high' | 'medium' | 'low' | 'minimal'
  shouldAsk: boolean
}

export interface PhotoGuidanceInput {
  // Current angles
  angleTypes: AngleType[]
  imageCount: number

  // Confidence interval result
  confidenceInterval: SegmentConfidenceIntervalResult

  // Geometry consistency
  geometryConsistency: GeometryConsistencyResult

  // Trust score
  trustScore: TrustScoreResult

  // Landmarks
  landmarks: LandmarksDetected

  // Optional: source type affects recommendations
  sourceType?: SourceType

  // Whether user has indicated they cannot provide more photos
  userCannotAddMore?: boolean
}

// ============================================================================
// CONSTANTS
// ============================================================================

// Minimum confidence improvement threshold to recommend asking
const MIN_IMPROVEMENT_TO_RECOMMEND = 5
const MIN_IMPROVEMENT_TO_STRONGLY_RECOMMEND = 12

// Family -> preferred angle mappings
const FAMILY_PREFERRED_ANGLES: Record<MeasurementFamily, {
  primary: PhotoRecommendationType
  secondary: PhotoRecommendationType
  angleMapping: AngleType
}> = {
  spread: {
    primary: 'frontal_straight',
    secondary: 'closer_face_reference',
    angleMapping: 'front',
  },
  beam: {
    primary: 'left_side',
    secondary: 'right_side',
    angleMapping: 'left',
  },
  tine: {
    primary: 'left_45',
    secondary: 'right_45',
    angleMapping: 'left',
  },
  mass: {
    primary: 'left_side',
    secondary: 'right_side',
    angleMapping: 'left',
  },
  deduction: {
    primary: 'frontal_straight',
    secondary: 'left_45',
    angleMapping: 'front',
  },
}

// Recommendation type -> user message mapping
const RECOMMENDATION_MESSAGES: Record<PhotoRecommendationType, {
  message: string
  reason: string
}> = {
  frontal_straight: {
    message: 'A straight-on front view would improve accuracy.',
    reason: 'Front angles provide the most accurate spread measurements and help verify symmetry.',
  },
  left_side: {
    message: 'A left-side profile photo would help.',
    reason: 'Side views allow accurate beam length and tine height measurements.',
  },
  right_side: {
    message: 'A right-side profile photo would help.',
    reason: 'Right side view helps verify symmetry and measure the right beam accurately.',
  },
  left_45: {
    message: 'A left 45-degree angle photo would improve tine measurements.',
    reason: '45-degree angles provide depth perspective for tine and beam measurements.',
  },
  right_45: {
    message: 'A right 45-degree angle photo would improve tine measurements.',
    reason: '45-degree angles from the right help verify left-side measurements.',
  },
  better_lighting: {
    message: 'A photo with better lighting would improve detail detection.',
    reason: 'Current photos have low-light conditions that reduce landmark detection accuracy.',
  },
  uncropped_rack: {
    message: 'A photo showing the full rack including beam tips would help.',
    reason: 'Some beam tips appear cropped, preventing accurate main beam measurements.',
  },
  closer_face_reference: {
    message: 'A clearer photo with both ears visible would improve scaling.',
    reason: 'Ears are the primary scaling reference - clearer ear visibility improves all measurements.',
  },
  none_needed: {
    message: 'Current images are sufficient for a reliable estimate.',
    reason: 'Additional photos are unlikely to significantly change the estimate.',
  },
}

// ============================================================================
// MAIN FUNCTION
// ============================================================================

export function computeNextPhotoGuidance(input: PhotoGuidanceInput): NextPhotoRecommendation {
  // If user explicitly cannot add more, don't recommend
  if (input.userCannotAddMore) {
    return createNoRecommendation('User indicated they cannot add more photos')
  }

  // 1. Analyze current coverage
  const coverageAnalysis = analyzeCoverage(input)

  // 2. Find the weakest family and determine if a photo would help
  const weakestFamilyAnalysis = analyzeWeakestFamily(input)

  // 3. Check for quality issues that could be fixed with a new photo
  const qualityAnalysis = analyzeQualityIssues(input)

  // 4. Determine the best recommendation
  const recommendation = selectBestRecommendation(
    input,
    coverageAnalysis,
    weakestFamilyAnalysis,
    qualityAnalysis
  )

  return recommendation
}

// ============================================================================
// ANALYSIS FUNCTIONS
// ============================================================================

interface CoverageAnalysis {
  hasFront: boolean
  hasLeft: boolean
  hasRight: boolean
  hasBack: boolean
  missingCritical: AngleType[]
  coverageScore: number
  mostValueableMissingAngle: AngleType | null
}

function analyzeCoverage(input: PhotoGuidanceInput): CoverageAnalysis {
  const angles = input.angleTypes
  const hasFront = angles.includes('front')
  const hasLeft = angles.includes('left')
  const hasRight = angles.includes('right')
  const hasBack = angles.includes('back')

  const missingCritical: AngleType[] = []
  if (!hasFront) missingCritical.push('front')
  if (!hasLeft && !hasRight) missingCritical.push('left')
  else if (!hasLeft) missingCritical.push('left')
  else if (!hasRight) missingCritical.push('right')

  let coverageScore = 0
  if (hasFront) coverageScore += 35
  if (hasLeft) coverageScore += 25
  if (hasRight) coverageScore += 25
  if (hasBack) coverageScore += 15

  // Determine most valuable missing angle
  let mostValueableMissingAngle: AngleType | null = null
  if (!hasFront) {
    mostValueableMissingAngle = 'front'
  } else if (!hasLeft && !hasRight) {
    mostValueableMissingAngle = 'left'
  } else if (!hasRight && hasLeft) {
    mostValueableMissingAngle = 'right'
  } else if (!hasLeft && hasRight) {
    mostValueableMissingAngle = 'left'
  }

  return {
    hasFront,
    hasLeft,
    hasRight,
    hasBack,
    missingCritical,
    coverageScore,
    mostValueableMissingAngle,
  }
}

interface WeakestFamilyAnalysis {
  weakestFamily: MeasurementFamily | null
  weakestFamilyConfidence: number
  wouldPhotoHelp: boolean
  estimatedImprovement: number
  recommendedPhotoType: PhotoRecommendationType
  recommendedAngle: AngleType | null
}

function analyzeWeakestFamily(input: PhotoGuidanceInput): WeakestFamilyAnalysis {
  const families = input.confidenceInterval.familyUncertainty
  const weakest = families.reduce((min, f) =>
    f.confidenceScore < min.confidenceScore ? f : min
  )

  // Check if we already have the ideal angle for this family
  const familyPrefs = FAMILY_PREFERRED_ANGLES[weakest.family]
  const hasIdealAngle = input.angleTypes.includes(familyPrefs.angleMapping)
  const hasBothSides = input.angleTypes.includes('left') && input.angleTypes.includes('right')

  // Estimate how much a new photo would help
  let wouldPhotoHelp = false
  let estimatedImprovement = 0
  let recommendedPhotoType = familyPrefs.primary
  let recommendedAngle = familyPrefs.angleMapping

  if (weakest.confidenceScore < 40) {
    // Low confidence - check if photo would help
    if (!hasIdealAngle) {
      wouldPhotoHelp = true
      estimatedImprovement = 15
    } else if (!hasBothSides && (weakest.family === 'beam' || weakest.family === 'tine')) {
      wouldPhotoHelp = true
      estimatedImprovement = 10
      recommendedPhotoType = input.angleTypes.includes('left') ? 'right_side' : 'left_side'
      recommendedAngle = input.angleTypes.includes('left') ? 'right' : 'left'
    } else if (weakest.limitingFactors.some(f => f.includes('reference') || f.includes('scaling'))) {
      wouldPhotoHelp = true
      estimatedImprovement = 8
      recommendedPhotoType = 'closer_face_reference'
      recommendedAngle = 'front'
    }
  } else if (weakest.confidenceScore < 60) {
    // Medium confidence - might help
    if (!hasIdealAngle) {
      wouldPhotoHelp = true
      estimatedImprovement = 8
    } else if (weakest.limitingFactors.length > 0) {
      wouldPhotoHelp = true
      estimatedImprovement = 5
    }
  }

  return {
    weakestFamily: weakest.family,
    weakestFamilyConfidence: weakest.confidenceScore,
    wouldPhotoHelp,
    estimatedImprovement,
    recommendedPhotoType,
    recommendedAngle,
  }
}

interface QualityAnalysis {
  hasLowLightIssue: boolean
  hasCroppedTips: boolean
  hasBlurIssue: boolean
  hasWeakReference: boolean
  recommendedFix: PhotoRecommendationType | null
  estimatedImprovement: number
}

function analyzeQualityIssues(input: PhotoGuidanceInput): QualityAnalysis {
  const trustComponents = input.trustScore.components
  const geometryFlags = input.geometryConsistency.flags

  // Check for low light
  const hasLowLightIssue = trustComponents.some(
    c => c.name.includes('Quality') && c.score < 40 && c.description.includes('light')
  )

  // Check for cropped beam tips
  const hasCroppedTips = geometryFlags.some(
    f => f.message.includes('cropped') || f.message.includes('cut off')
  )

  // Check for blur
  const hasBlurIssue = trustComponents.some(
    c => c.name.includes('Quality') && c.score < 40 && c.description.includes('blur')
  )

  // Check for weak reference
  const hasWeakReference = !input.landmarks.ears_visible ||
    input.trustScore.components.find(c => c.name.includes('Landmark'))?.score! < 50

  let recommendedFix: PhotoRecommendationType | null = null
  let estimatedImprovement = 0

  if (hasWeakReference && !input.landmarks.ears_visible) {
    recommendedFix = 'closer_face_reference'
    estimatedImprovement = 12
  } else if (hasCroppedTips) {
    recommendedFix = 'uncropped_rack'
    estimatedImprovement = 8
  } else if (hasLowLightIssue) {
    recommendedFix = 'better_lighting'
    estimatedImprovement = 6
  } else if (hasBlurIssue && input.imageCount === 1) {
    recommendedFix = 'frontal_straight' // Just ask for a sharper photo
    estimatedImprovement = 5
  }

  return {
    hasLowLightIssue,
    hasCroppedTips,
    hasBlurIssue,
    hasWeakReference,
    recommendedFix,
    estimatedImprovement,
  }
}

// ============================================================================
// RECOMMENDATION SELECTION
// ============================================================================

function selectBestRecommendation(
  input: PhotoGuidanceInput,
  coverage: CoverageAnalysis,
  weakestFamily: WeakestFamilyAnalysis,
  quality: QualityAnalysis
): NextPhotoRecommendation {
  // Collect all potential recommendations with their expected value
  const candidates: Array<{
    type: PhotoRecommendationType
    angle: AngleType | null
    improvement: number
    reason: string
    targetFamily: MeasurementFamily | null
    targetWeakness: string | null
  }> = []

  // Coverage-based recommendations
  if (coverage.mostValueableMissingAngle && coverage.coverageScore < 70) {
    const improvement = coverage.mostValueableMissingAngle === 'front' ? 15 : 10
    candidates.push({
      type: coverage.mostValueableMissingAngle === 'front' ? 'frontal_straight' : `${coverage.mostValueableMissingAngle}_side` as PhotoRecommendationType,
      angle: coverage.mostValueableMissingAngle,
      improvement,
      reason: `Missing ${coverage.mostValueableMissingAngle} view limits measurement accuracy`,
      targetFamily: coverage.mostValueableMissingAngle === 'front' ? 'spread' : 'beam',
      targetWeakness: 'missing_angle',
    })
  }

  // Family weakness recommendations
  if (weakestFamily.wouldPhotoHelp) {
    candidates.push({
      type: weakestFamily.recommendedPhotoType,
      angle: weakestFamily.recommendedAngle,
      improvement: weakestFamily.estimatedImprovement,
      reason: `${weakestFamily.weakestFamily} confidence is only ${weakestFamily.weakestFamilyConfidence.toFixed(0)}%`,
      targetFamily: weakestFamily.weakestFamily,
      targetWeakness: 'low_family_confidence',
    })
  }

  // Quality-based recommendations
  if (quality.recommendedFix) {
    candidates.push({
      type: quality.recommendedFix,
      angle: quality.recommendedFix === 'closer_face_reference' ? 'front' : null,
      improvement: quality.estimatedImprovement,
      reason: quality.hasWeakReference ? 'Weak scaling reference (ears not clearly visible)'
        : quality.hasCroppedTips ? 'Beam tips appear cropped in current images'
        : 'Image quality issues detected',
      targetFamily: quality.hasWeakReference ? 'spread' : 'beam',
      targetWeakness: quality.hasWeakReference ? 'weak_reference' : 'quality_issue',
    })
  }

  // Sort by expected improvement
  candidates.sort((a, b) => b.improvement - a.improvement)

  // If no candidates or best improvement is minimal
  if (candidates.length === 0 || candidates[0].improvement < 3) {
    return createNoRecommendation('Current images provide sufficient coverage')
  }

  const best = candidates[0]

  // Determine decision policy
  let decision: PhotoRequestDecision = 'proceed_current_only'
  let shouldAsk = false
  let estimatedBenefit: 'high' | 'medium' | 'low' | 'minimal' = 'minimal'

  if (best.improvement >= MIN_IMPROVEMENT_TO_STRONGLY_RECOMMEND) {
    decision = 'strongly_recommend_before_finalize'
    shouldAsk = true
    estimatedBenefit = 'high'
  } else if (best.improvement >= MIN_IMPROVEMENT_TO_RECOMMEND) {
    decision = 'proceed_but_recommend'
    shouldAsk = true
    estimatedBenefit = best.improvement >= 8 ? 'medium' : 'low'
  } else {
    decision = 'proceed_current_only'
    shouldAsk = false
    estimatedBenefit = 'minimal'
  }

  // Don't annoy users who already have 4+ images with good confidence
  if (input.imageCount >= 4 && input.confidenceInterval.calibratedConfidencePercent >= 70) {
    shouldAsk = false
    decision = 'proceed_current_only'
    estimatedBenefit = 'minimal'
  }

  const messageInfo = RECOMMENDATION_MESSAGES[best.type]

  return {
    recommendationType: best.type,
    recommendedAngle: best.angle,
    decision,
    expectedGainDescription: best.improvement >= 10
      ? 'Could significantly tighten the estimate'
      : best.improvement >= 5
        ? 'Would moderately improve confidence'
        : 'Minor improvement expected',
    expectedConfidenceImprovement: best.improvement,
    userMessage: messageInfo.message,
    userReason: messageInfo.reason,
    primaryReason: best.reason,
    targetFamily: best.targetFamily,
    targetWeakness: best.targetWeakness,
    estimatedBenefit,
    shouldAsk,
  }
}

function createNoRecommendation(reason: string): NextPhotoRecommendation {
  return {
    recommendationType: 'none_needed',
    recommendedAngle: null,
    decision: 'proceed_current_only',
    expectedGainDescription: 'Additional photos unlikely to change estimate much',
    expectedConfidenceImprovement: 0,
    userMessage: RECOMMENDATION_MESSAGES.none_needed.message,
    userReason: RECOMMENDATION_MESSAGES.none_needed.reason,
    primaryReason: reason,
    targetFamily: null,
    targetWeakness: null,
    estimatedBenefit: 'minimal',
    shouldAsk: false,
  }
}

// ============================================================================
// EXPORT FOR STORAGE
// ============================================================================

export interface PhotoGuidanceMetadata {
  recommendationType: PhotoRecommendationType
  recommendedAngle: AngleType | null
  decision: PhotoRequestDecision
  expectedConfidenceImprovement: number
  estimatedBenefit: string
  shouldAsk: boolean
  primaryReason: string
  targetFamily: MeasurementFamily | null
}

export function extractPhotoGuidanceMetadata(
  recommendation: NextPhotoRecommendation
): PhotoGuidanceMetadata {
  return {
    recommendationType: recommendation.recommendationType,
    recommendedAngle: recommendation.recommendedAngle,
    decision: recommendation.decision,
    expectedConfidenceImprovement: recommendation.expectedConfidenceImprovement,
    estimatedBenefit: recommendation.estimatedBenefit,
    shouldAsk: recommendation.shouldAsk,
    primaryReason: recommendation.primaryReason,
    targetFamily: recommendation.targetFamily,
  }
}

// ============================================================================
// LIGHTWEIGHT WRAPPER (no segment confidence dependency)
// ============================================================================

/**
 * Computes photo guidance without requiring the full segment-confidence pipeline.
 * Uses overall confidence percent as a proxy for per-family confidence so the
 * coverage + quality recommendations still surface meaningfully.
 *
 * This is the integration point for /api/score, which does not run the
 * segment-confidence engine on every request.
 */
export interface LightweightPhotoGuidanceInput {
  angleTypes: AngleType[]
  imageCount: number
  confidencePercent: number
  landmarks: LandmarksDetected
  geometryConsistency?: GeometryConsistencyResult | null
  trustScore?: TrustScoreResult | null
  sourceType?: SourceType
  userCannotAddMore?: boolean
}

export function computeLightweightPhotoGuidance(
  input: LightweightPhotoGuidanceInput
): NextPhotoRecommendation {
  if (input.userCannotAddMore) {
    return createNoRecommendation('User indicated they cannot add more photos')
  }

  const confidence = Math.max(0, Math.min(100, input.confidencePercent))

  // Build a synthesized FamilyUncertainty array: every family inherits the
  // overall confidence percent. The recommendation engine then uses coverage
  // and quality signals as the primary differentiator, which is the part
  // that doesn't require the heavy segment pipeline.
  const families: FamilyUncertainty[] = (['spread', 'beam', 'tine', 'mass', 'deduction'] as MeasurementFamily[]).map(
    (family) => ({
      family,
      confidenceScore: confidence,
      expectedErrorBand: 0,
      tier: confidence >= 75 ? 'high' : confidence >= 60 ? 'medium' : confidence >= 40 ? 'low' : 'very_low',
      contributingFactors: [],
      limitingFactors: confidence < 60 ? ['overall_confidence_low'] : [],
    })
  )

  const syntheticConfidenceInterval: SegmentConfidenceIntervalResult = {
    grossScoreExpectedErrorBand: { low: 0, high: 0, expectedValue: 0, width: 0 },
    netScoreExpectedErrorBand: { low: 0, high: 0, expectedValue: 0, width: 0 },
    calibratedConfidenceTier:
      confidence >= 85 ? 'very_high' : confidence >= 70 ? 'high' : confidence >= 55 ? 'medium' : confidence >= 40 ? 'low' : 'very_low',
    calibratedConfidencePercent: confidence,
    trustTier: input.trustScore?.tier ?? 'fair',
    familyUncertainty: families,
    weakestFamily: families[0].family,
    strongestFamily: families[0].family,
    confidenceExplanationSummary: '',
    detailedExplanation: [],
    intervalProfileUsed: {
      profileType: 'global_default',
      segmentName: null,
      sampleCount: 0,
      shrinkageFactor: 0,
    },
    inputSignals: {
      segmentTotalSamples: 0,
      geometryConsistencyScore: input.geometryConsistency?.consistencyScore ?? 1,
      referenceQuality: input.landmarks.ears_visible ? 1 : 0,
      angleDiversity: input.angleTypes.length / 4,
      imageCount: input.imageCount,
    },
  }

  const syntheticGeometry: GeometryConsistencyResult = input.geometryConsistency ?? {
    consistencyScore: 1,
    tier: 'good',
    flags: [],
    refinements: [],
    refinedMeasurements: {} as Measurements,
    confidenceAdjustment: 0,
    measurementTrustPenalties: {},
    summary: '',
    explanation: [],
    asymmetryAnalysis: {
      isLikelyReal: false,
      apparentCause: 'unknown',
      leftRightDivergence: 0,
      recommendation: '',
    },
    referenceContributions: {},
  }

  const syntheticTrust: TrustScoreResult = input.trustScore ?? {
    overallScore: confidence,
    tier: confidence >= 70 ? 'good' : confidence >= 50 ? 'fair' : 'limited',
    tierLabel: '',
    components: [],
    positiveFactors: [],
    negativeFactors: [],
    primaryConcerns: [],
    summary: '',
    recommendations: [],
  }

  return computeNextPhotoGuidance({
    angleTypes: input.angleTypes,
    imageCount: input.imageCount,
    confidenceInterval: syntheticConfidenceInterval,
    geometryConsistency: syntheticGeometry,
    trustScore: syntheticTrust,
    landmarks: input.landmarks,
    sourceType: input.sourceType,
    userCannotAddMore: input.userCannotAddMore,
  })
}

// ============================================================================
// USER-FRIENDLY MESSAGE GENERATORS
// ============================================================================

/**
 * Generate a concise user-facing message based on the recommendation
 */
export function getUserFriendlyPhotoGuidance(
  recommendation: NextPhotoRecommendation,
  currentConfidence: number
): {
  shouldShow: boolean
  headline: string
  detail: string
  actionText: string
  dismissText: string
} {
  if (!recommendation.shouldAsk) {
    return {
      shouldShow: false,
      headline: '',
      detail: '',
      actionText: '',
      dismissText: '',
    }
  }

  let headline: string
  let actionText: string

  switch (recommendation.decision) {
    case 'strongly_recommend_before_finalize':
      headline = 'One more photo could significantly improve accuracy'
      actionText = 'Add Photo'
      break
    case 'proceed_but_recommend':
      headline = 'Want a tighter estimate?'
      actionText = 'Add Photo (Optional)'
      break
    default:
      headline = 'Additional photo available'
      actionText = 'Add Photo'
  }

  return {
    shouldShow: true,
    headline,
    detail: recommendation.userMessage,
    actionText,
    dismissText: 'Continue with current score',
  }
}
