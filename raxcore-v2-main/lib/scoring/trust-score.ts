/**
 * Phase 25: Trust Score Module
 * 
 * Calculates a trust score that reflects input quality and runtime reliability,
 * separate from but related to confidence in the estimate itself.
 * 
 * Trust = "How reliable were the conditions for this scoring?"
 * Confidence = "How accurate is the estimate likely to be?"
 */

import type { 
  AngleType,
  SourceType,
  CaptureDevice,
  LandmarksDetected,
  FallbackReason,
  ImageValidationIssueType
} from '@/lib/types'

// ============================================================================
// TYPES
// ============================================================================

export type TrustTier = 'excellent' | 'good' | 'fair' | 'limited' | 'uncertain'

export interface TrustComponent {
  name: string
  score: number // 0-100
  weight: number
  contribution: number // Weighted score
  status: 'positive' | 'neutral' | 'negative'
  description: string
}

export interface TrustScoreResult {
  overallScore: number // 0-100
  tier: TrustTier
  tierLabel: string
  components: TrustComponent[]
  positiveFactors: string[]
  negativeFactors: string[]
  primaryConcerns: string[]
  summary: string
  // Recommendations based on low trust factors
  recommendations: string[]
}

export interface TrustScoreMetadata {
  overallScore: number
  tier: TrustTier
  componentScores: Record<string, number>
  positiveFactorCount: number
  negativeFactorCount: number
  primaryConcerns: string[]
}

// ============================================================================
// TRUST TIER DEFINITIONS
// ============================================================================

const TRUST_TIERS: Record<TrustTier, { 
  min: number
  max: number
  label: string
  description: string
  confidenceImpact: number // Multiplier applied to confidence
}> = {
  excellent: { 
    min: 85, 
    max: 100, 
    label: 'Excellent',
    description: 'Optimal conditions with high-quality inputs and reliable processing',
    confidenceImpact: 1.05
  },
  good: { 
    min: 70, 
    max: 84, 
    label: 'Good',
    description: 'Favorable conditions with minor limitations',
    confidenceImpact: 1.0
  },
  fair: { 
    min: 50, 
    max: 69, 
    label: 'Fair',
    description: 'Acceptable conditions with some notable limitations',
    confidenceImpact: 0.95
  },
  limited: { 
    min: 30, 
    max: 49, 
    label: 'Limited',
    description: 'Challenging conditions that reduce reliability',
    confidenceImpact: 0.85
  },
  uncertain: { 
    min: 0, 
    max: 29, 
    label: 'Uncertain',
    description: 'Difficult conditions with significant limitations',
    confidenceImpact: 0.70
  },
}

// ============================================================================
// COMPONENT WEIGHTS
// ============================================================================

const TRUST_WEIGHTS = {
  imageSetQuality: 0.25,      // Quality and consistency of images
  angleCoverage: 0.20,        // Diversity and completeness of viewing angles
  landmarkVisibility: 0.20,   // Anatomical reference availability
  runtimeReliability: 0.15,   // No fallbacks, retries, or errors
  metadataCompleteness: 0.10, // User-provided context
  processingStability: 0.10,  // Consistency of processing
} as const

// ============================================================================
// TRUST CALCULATION INPUT
// ============================================================================

export interface TrustScoreInput {
  // Image quality factors
  imageCount: number
  validImageCount: number
  angleTypes: AngleType[]
  angleDiversity: number
  imageValidationIssues: { issueType: ImageValidationIssueType; severity: 'error' | 'warning' | 'info' }[]
  
  // Landmark factors
  landmarks: LandmarksDetected
  landmarkConsistencyScore: number
  
  // Runtime factors
  usedFallback: boolean
  fallbackReason?: FallbackReason | null
  wasRetried: boolean
  totalAttempts: number
  timedOut: boolean
  
  // Processing factors
  normalizationAdjustments: number
  normalizationOutliers: number
  measurementConflicts: number
  secondPassRan: boolean
  
  // Metadata factors
  sourceType?: SourceType | string | null
  captureDevice?: CaptureDevice | string | null
  earsFullyVisible?: boolean | null
  mainFramePoints?: number | null
}

// ============================================================================
// TRUST SCORE CALCULATION
// ============================================================================

/**
 * Calculate trust score from input factors
 */
export function calculateTrustScore(input: TrustScoreInput): TrustScoreResult {
  const components: TrustComponent[] = []
  const positiveFactors: string[] = []
  const negativeFactors: string[] = []
  const primaryConcerns: string[] = []
  const recommendations: string[] = []

  // 1. Image Set Quality
  const imageQuality = calculateImageSetQuality(input)
  components.push(imageQuality.component)
  positiveFactors.push(...imageQuality.positives)
  negativeFactors.push(...imageQuality.negatives)
  if (imageQuality.component.score < 50) {
    primaryConcerns.push(imageQuality.concern)
    recommendations.push(...imageQuality.recommendations)
  }

  // 2. Angle Coverage
  const angleCoverage = calculateAngleCoverage(input)
  components.push(angleCoverage.component)
  positiveFactors.push(...angleCoverage.positives)
  negativeFactors.push(...angleCoverage.negatives)
  if (angleCoverage.component.score < 50) {
    primaryConcerns.push(angleCoverage.concern)
    recommendations.push(...angleCoverage.recommendations)
  }

  // 3. Landmark Visibility
  const landmarkVisibility = calculateLandmarkVisibility(input)
  components.push(landmarkVisibility.component)
  positiveFactors.push(...landmarkVisibility.positives)
  negativeFactors.push(...landmarkVisibility.negatives)
  if (landmarkVisibility.component.score < 50) {
    primaryConcerns.push(landmarkVisibility.concern)
    recommendations.push(...landmarkVisibility.recommendations)
  }

  // 4. Runtime Reliability
  const runtimeReliability = calculateRuntimeReliability(input)
  components.push(runtimeReliability.component)
  positiveFactors.push(...runtimeReliability.positives)
  negativeFactors.push(...runtimeReliability.negatives)
  if (runtimeReliability.component.score < 50) {
    primaryConcerns.push(runtimeReliability.concern)
  }

  // 5. Metadata Completeness
  const metadataCompleteness = calculateMetadataCompleteness(input)
  components.push(metadataCompleteness.component)
  positiveFactors.push(...metadataCompleteness.positives)
  negativeFactors.push(...metadataCompleteness.negatives)

  // 6. Processing Stability
  const processingStability = calculateProcessingStability(input)
  components.push(processingStability.component)
  positiveFactors.push(...processingStability.positives)
  negativeFactors.push(...processingStability.negatives)
  if (processingStability.component.score < 40) {
    primaryConcerns.push(processingStability.concern)
  }

  // Calculate overall weighted score
  const overallScore = Math.round(
    components.reduce((sum, c) => sum + c.contribution, 0)
  )

  // Determine tier
  const tier = getTrustTier(overallScore)
  const tierConfig = TRUST_TIERS[tier]

  // Build summary
  const summary = buildTrustSummary(overallScore, tier, primaryConcerns, positiveFactors)

  return {
    overallScore: Math.max(0, Math.min(100, overallScore)),
    tier,
    tierLabel: tierConfig.label,
    components,
    positiveFactors: positiveFactors.filter(Boolean),
    negativeFactors: negativeFactors.filter(Boolean),
    primaryConcerns: primaryConcerns.filter(Boolean),
    summary,
    recommendations: recommendations.filter(Boolean),
  }
}

// ============================================================================
// COMPONENT CALCULATORS
// ============================================================================

interface ComponentResult {
  component: TrustComponent
  positives: string[]
  negatives: string[]
  concern: string
  recommendations: string[]
}

function calculateImageSetQuality(input: TrustScoreInput): ComponentResult {
  let score = 50 // Base score
  const positives: string[] = []
  const negatives: string[] = []
  const recommendations: string[] = []

  // Valid image ratio
  const validRatio = input.imageCount > 0 ? input.validImageCount / input.imageCount : 0
  if (validRatio >= 1) {
    score += 25
    positives.push('All images validated successfully')
  } else if (validRatio >= 0.8) {
    score += 15
  } else if (validRatio < 0.5) {
    score -= 25
    negatives.push('Many images failed validation')
    recommendations.push('Re-upload clearer images with better lighting')
  }

  // Image count bonus
  if (input.validImageCount >= 4) {
    score += 20
    positives.push('Multiple clear images available')
  } else if (input.validImageCount >= 2) {
    score += 10
  } else {
    score -= 15
    negatives.push('Limited images available')
    recommendations.push('Add more images from different angles')
  }

  // Image validation issues penalty
  const errorIssues = input.imageValidationIssues.filter(i => i.severity === 'error').length
  const warningIssues = input.imageValidationIssues.filter(i => i.severity === 'warning').length
  
  if (errorIssues > 0) {
    score -= errorIssues * 10
    negatives.push('Image quality issues detected')
  }
  if (warningIssues > 2) {
    score -= 5
  }

  const finalScore = Math.max(0, Math.min(100, score))
  const weight = TRUST_WEIGHTS.imageSetQuality

  return {
    component: {
      name: 'Image Set Quality',
      score: finalScore,
      weight,
      contribution: finalScore * weight,
      status: finalScore >= 70 ? 'positive' : finalScore >= 40 ? 'neutral' : 'negative',
      description: getImageQualityDescription(finalScore),
    },
    positives,
    negatives,
    concern: finalScore < 50 ? 'Image quality concerns may affect accuracy' : '',
    recommendations,
  }
}

function calculateAngleCoverage(input: TrustScoreInput): ComponentResult {
  let score = 30 // Base score
  const positives: string[] = []
  const negatives: string[] = []
  const recommendations: string[] = []

  const uniqueAngles = new Set(input.angleTypes)
  const hasAngles = {
    front: uniqueAngles.has('front'),
    left: uniqueAngles.has('left'),
    right: uniqueAngles.has('right'),
    back: uniqueAngles.has('back'),
  }

  // Front view (most important for spread)
  if (hasAngles.front) {
    score += 25
    positives.push('Front view available for spread measurement')
  } else {
    negatives.push('No front view available')
    recommendations.push('Add a front-facing photo to improve spread accuracy')
  }

  // Side views (important for beam/tine)
  if (hasAngles.left && hasAngles.right) {
    score += 30
    positives.push('Both side views available for beam comparison')
  } else if (hasAngles.left || hasAngles.right) {
    score += 15
    negatives.push('Only one side view available')
    recommendations.push('Add the opposite side view to verify symmetry')
  } else {
    negatives.push('No side views available')
    recommendations.push('Add side profile photos for better beam measurement')
  }

  // Back view (supplementary)
  if (hasAngles.back) {
    score += 10
  }

  // Angle diversity bonus
  if (input.angleDiversity >= 0.8) {
    score += 10
    positives.push('Excellent angle diversity')
  } else if (input.angleDiversity < 0.4) {
    score -= 10
    negatives.push('Limited angle coverage')
  }

  const finalScore = Math.max(0, Math.min(100, score))
  const weight = TRUST_WEIGHTS.angleCoverage

  return {
    component: {
      name: 'Angle Coverage',
      score: finalScore,
      weight,
      contribution: finalScore * weight,
      status: finalScore >= 70 ? 'positive' : finalScore >= 40 ? 'neutral' : 'negative',
      description: getAngleCoverageDescription(finalScore),
    },
    positives,
    negatives,
    concern: finalScore < 50 ? 'Limited viewing angles reduce measurement reliability' : '',
    recommendations,
  }
}

function calculateLandmarkVisibility(input: TrustScoreInput): ComponentResult {
  let score = 20 // Base score
  const positives: string[] = []
  const negatives: string[] = []
  const recommendations: string[] = []

  const { landmarks, landmarkConsistencyScore } = input

  // Ear visibility (primary scaling reference)
  if (landmarks.ears_visible) {
    score += 35
    positives.push('Ears visible for primary scaling')
    
    if (input.earsFullyVisible) {
      score += 10
      positives.push('Ears fully visible base-to-tip')
    }
  } else {
    negatives.push('Ears not clearly visible')
    recommendations.push('Include images where both ears are fully visible')
  }

  // Eye visibility (secondary reference)
  if (landmarks.eyes_visible) {
    score += 15
    positives.push('Eyes visible for secondary scaling')
  }

  // Antler visibility
  if (landmarks.antlers_visible) {
    score += 15
    positives.push('Full antler structure visible')
  } else {
    score -= 10
    negatives.push('Antler structure partially obscured')
  }

  // Landmark consistency bonus
  if (landmarkConsistencyScore >= 0.9) {
    score += 10
    positives.push('Strong landmark agreement between images')
  } else if (landmarkConsistencyScore < 0.6) {
    score -= 15
    negatives.push('Inconsistent landmarks between images')
  }

  const finalScore = Math.max(0, Math.min(100, score))
  const weight = TRUST_WEIGHTS.landmarkVisibility

  return {
    component: {
      name: 'Landmark Visibility',
      score: finalScore,
      weight,
      contribution: finalScore * weight,
      status: finalScore >= 70 ? 'positive' : finalScore >= 40 ? 'neutral' : 'negative',
      description: getLandmarkDescription(finalScore),
    },
    positives,
    negatives,
    concern: finalScore < 50 ? 'Limited anatomical references for scaling' : '',
    recommendations,
  }
}

function calculateRuntimeReliability(input: TrustScoreInput): ComponentResult {
  let score = 100 // Start high, deduct for issues
  const positives: string[] = []
  const negatives: string[] = []

  // Fallback usage penalty
  if (input.usedFallback) {
    score -= 35
    negatives.push('Fallback scoring used')
    
    // Additional penalty for certain fallback reasons
    if (input.fallbackReason === 'vision_timeout') {
      score -= 10
      negatives.push('Vision processing timed out')
    } else if (input.fallbackReason === 'vision_validation_failed') {
      score -= 15
      negatives.push('Vision output validation failed')
    }
  } else {
    positives.push('Full vision scoring completed')
  }

  // Retry penalty
  if (input.wasRetried) {
    score -= 10
    negatives.push('Processing required retries')
  }

  // Multiple attempts penalty
  if (input.totalAttempts > 2) {
    score -= (input.totalAttempts - 2) * 5
  }

  // Timeout penalty
  if (input.timedOut) {
    score -= 20
    negatives.push('Processing timeout occurred')
  }

  if (!input.usedFallback && !input.wasRetried && !input.timedOut) {
    positives.push('Clean processing with no issues')
  }

  const finalScore = Math.max(0, Math.min(100, score))
  const weight = TRUST_WEIGHTS.runtimeReliability

  return {
    component: {
      name: 'Runtime Reliability',
      score: finalScore,
      weight,
      contribution: finalScore * weight,
      status: finalScore >= 70 ? 'positive' : finalScore >= 40 ? 'neutral' : 'negative',
      description: getRuntimeDescription(finalScore),
    },
    positives,
    negatives,
    concern: finalScore < 50 ? 'Processing encountered issues' : '',
    recommendations: [],
  }
}

function calculateMetadataCompleteness(input: TrustScoreInput): ComponentResult {
  let score = 40 // Base score
  const positives: string[] = []
  const negatives: string[] = []

  // Source type provided
  if (input.sourceType) {
    score += 20
    positives.push('Photo source type provided')
    
    // Bonus for stable sources
    if (input.sourceType === 'mounted_photo' || input.sourceType === 'european_mount') {
      score += 10
      positives.push('Stable mount positioning')
    }
  } else {
    negatives.push('Photo source type not specified')
  }

  // Capture device provided
  if (input.captureDevice) {
    score += 10
    
    // Quality device bonus
    if (input.captureDevice === 'digital_camera' || input.captureDevice === 'iphone') {
      score += 5
    }
    // Low quality penalty
    if (input.captureDevice === 'photo_of_photo' || input.captureDevice === 'vintage_photo') {
      score -= 10
      negatives.push('Lower quality image source')
    }
  }

  // Frame points provided
  if (input.mainFramePoints) {
    score += 15
    positives.push('Frame point count provided')
  }

  const finalScore = Math.max(0, Math.min(100, score))
  const weight = TRUST_WEIGHTS.metadataCompleteness

  return {
    component: {
      name: 'Metadata Completeness',
      score: finalScore,
      weight,
      contribution: finalScore * weight,
      status: finalScore >= 70 ? 'positive' : finalScore >= 40 ? 'neutral' : 'negative',
      description: getMetadataDescription(finalScore),
    },
    positives,
    negatives,
    concern: '',
    recommendations: [],
  }
}

function calculateProcessingStability(input: TrustScoreInput): ComponentResult {
  let score = 80 // Start high
  const positives: string[] = []
  const negatives: string[] = []

  // Normalization adjustments penalty
  if (input.normalizationAdjustments > 3) {
    score -= 15
    negatives.push('Multiple measurement normalizations required')
  } else if (input.normalizationAdjustments > 0) {
    score -= 5
  }

  // Outlier penalty
  if (input.normalizationOutliers > 1) {
    score -= 20
    negatives.push('Measurement outliers detected')
  } else if (input.normalizationOutliers > 0) {
    score -= 10
  }

  // Measurement conflicts penalty
  if (input.measurementConflicts > 2) {
    score -= 20
    negatives.push('Measurement conflicts between images')
  } else if (input.measurementConflicts > 0) {
    score -= 10
  }

  // Second pass indicator (could be good or bad)
  if (input.secondPassRan) {
    score -= 5 // Minor penalty - indicates initial uncertainty
    negatives.push('Additional processing pass required')
  }

  if (score >= 75) {
    positives.push('Consistent measurements across processing')
  }

  const finalScore = Math.max(0, Math.min(100, score))
  const weight = TRUST_WEIGHTS.processingStability

  return {
    component: {
      name: 'Processing Stability',
      score: finalScore,
      weight,
      contribution: finalScore * weight,
      status: finalScore >= 70 ? 'positive' : finalScore >= 40 ? 'neutral' : 'negative',
      description: getProcessingDescription(finalScore),
    },
    positives,
    negatives,
    concern: finalScore < 40 ? 'Measurement instability detected' : '',
    recommendations: [],
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function getTrustTier(score: number): TrustTier {
  for (const [tier, config] of Object.entries(TRUST_TIERS)) {
    if (score >= config.min && score <= config.max) {
      return tier as TrustTier
    }
  }
  return 'fair'
}

function buildTrustSummary(
  score: number, 
  tier: TrustTier, 
  concerns: string[], 
  positives: string[]
): string {
  const tierConfig = TRUST_TIERS[tier]
  
  if (concerns.length === 0 && positives.length > 0) {
    return `${tierConfig.label} trust conditions. ${positives[0]}.`
  }
  
  if (concerns.length > 0) {
    return `${tierConfig.label} trust conditions. ${concerns[0]}.`
  }
  
  return `${tierConfig.label} trust conditions. ${tierConfig.description}.`
}

function getImageQualityDescription(score: number): string {
  if (score >= 80) return 'Excellent image quality and validation'
  if (score >= 60) return 'Good image quality with minor issues'
  if (score >= 40) return 'Acceptable image quality'
  return 'Image quality concerns present'
}

function getAngleCoverageDescription(score: number): string {
  if (score >= 80) return 'Comprehensive angle coverage'
  if (score >= 60) return 'Good angle diversity'
  if (score >= 40) return 'Partial angle coverage'
  return 'Limited viewing angles'
}

function getLandmarkDescription(score: number): string {
  if (score >= 80) return 'Strong anatomical landmarks visible'
  if (score >= 60) return 'Adequate landmarks for scaling'
  if (score >= 40) return 'Partial landmark visibility'
  return 'Limited anatomical references'
}

function getRuntimeDescription(score: number): string {
  if (score >= 90) return 'Clean processing with no issues'
  if (score >= 70) return 'Processing completed successfully'
  if (score >= 50) return 'Processing completed with minor issues'
  return 'Processing encountered challenges'
}

function getMetadataDescription(score: number): string {
  if (score >= 80) return 'Complete context information provided'
  if (score >= 60) return 'Good context information'
  if (score >= 40) return 'Basic context provided'
  return 'Limited context information'
}

function getProcessingDescription(score: number): string {
  if (score >= 80) return 'Stable and consistent processing'
  if (score >= 60) return 'Generally stable processing'
  if (score >= 40) return 'Some processing adjustments needed'
  return 'Processing instability detected'
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Get trust tier configuration
 */
export function getTrustTierInfo(tier: TrustTier) {
  return TRUST_TIERS[tier]
}

/**
 * Get all trust tiers for UI display
 */
export function getAllTrustTiers() {
  return Object.entries(TRUST_TIERS).map(([tier, config]) => ({
    tier: tier as TrustTier,
    ...config,
  }))
}

/**
 * Get trust score metadata for storage
 */
export function getTrustScoreMetadata(result: TrustScoreResult): TrustScoreMetadata {
  const componentScores: Record<string, number> = {}
  for (const comp of result.components) {
    componentScores[comp.name.toLowerCase().replace(/\s+/g, '_')] = comp.score
  }

  return {
    overallScore: result.overallScore,
    tier: result.tier,
    componentScores,
    positiveFactorCount: result.positiveFactors.length,
    negativeFactorCount: result.negativeFactors.length,
    primaryConcerns: result.primaryConcerns,
  }
}

/**
 * Get confidence impact from trust tier
 */
export function getTrustConfidenceImpact(tier: TrustTier): number {
  return TRUST_TIERS[tier].confidenceImpact
}
