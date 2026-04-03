/**
 * Intake Quality Scoring Module (Phase 15)
 * 
 * Evaluates the quality of submitted image sets before scoring
 * to guide users toward better photos and adjust confidence accordingly.
 */

import type { AngleType, SourceType, CaptureDevice } from '@/lib/types'

// Quality tier definitions
export type IntakeQualityTier = 'excellent' | 'good' | 'fair' | 'poor'

// Individual factor scores
export interface IntakeQualityFactors {
  imageCount: {
    score: number // 0-1
    value: number
    recommendation: string | null
  }
  angleDiversity: {
    score: number
    angles: AngleType[]
    missingCritical: AngleType[]
    recommendation: string | null
  }
  earsVisible: {
    score: number
    declared: boolean
    recommendation: string | null
  }
  sourceType: {
    score: number
    type: SourceType | null
    recommendation: string | null
  }
  imageDimensions: {
    score: number
    avgWidth: number
    avgHeight: number
    recommendation: string | null
  }
  lowLightFlag: {
    score: number
    detected: boolean
    recommendation: string | null
  }
  blurFlag: {
    score: number
    detected: boolean
    recommendation: string | null
  }
  croppedBeamTips: {
    score: number
    detected: boolean
    recommendation: string | null
  }
}

// Complete intake quality assessment
export interface IntakeQualityAssessment {
  tier: IntakeQualityTier
  overallScore: number // 0-100
  factors: IntakeQualityFactors
  strongestFactors: string[]
  weakestFactors: string[]
  recommendations: BetterAngleRecommendation[]
  confidenceAdjustment: number // -20 to +10
  errorBandWidening: number // multiplier 1.0 to 2.0
  summary: string
  canProceed: boolean // false only if truly unusable
  warningMessage: string | null
}

// Recommendation for better photos
export interface BetterAngleRecommendation {
  type: 'add_angle' | 'retake' | 'improve_quality'
  priority: 'high' | 'medium' | 'low'
  angle?: AngleType
  message: string
  reason: string
}

// Input for quality assessment
export interface IntakeQualityInput {
  images: {
    angleType: AngleType
    width: number
    height: number
    // Optional quality signals from vision analysis
    lowLightDetected?: boolean
    blurDetected?: boolean
    beamTipsCropped?: boolean
    landmarksDetected?: {
      ears_visible?: boolean
      eyes_visible?: boolean
      antlers_visible?: boolean
    }
  }[]
  earsFullyVisible?: boolean
  sourceType?: SourceType
  captureDevice?: CaptureDevice
}

// Weights for overall score calculation
const FACTOR_WEIGHTS = {
  angleDiversity: 0.30,
  imageCount: 0.15,
  earsVisible: 0.20,
  imageDimensions: 0.10,
  sourceType: 0.10,
  lowLightFlag: 0.05,
  blurFlag: 0.05,
  croppedBeamTips: 0.05,
}

// Minimum resolution for good quality
const MIN_GOOD_WIDTH = 800
const MIN_GOOD_HEIGHT = 600
const MIN_EXCELLENT_WIDTH = 1200
const MIN_EXCELLENT_HEIGHT = 900

/**
 * Main function to compute intake quality score
 */
export function computeIntakeQuality(input: IntakeQualityInput): IntakeQualityAssessment {
  const factors = assessFactors(input)
  const overallScore = calculateOverallScore(factors)
  const tier = scoreTierFromScore(overallScore)
  const { strongestFactors, weakestFactors } = categorizeFactors(factors)
  const recommendations = generateRecommendations(factors, input)
  const { confidenceAdjustment, errorBandWidening } = calculateAdjustments(tier, factors)
  const canProceed = overallScore >= 15 && input.images.length >= 1
  
  return {
    tier,
    overallScore,
    factors,
    strongestFactors,
    weakestFactors,
    recommendations,
    confidenceAdjustment,
    errorBandWidening,
    summary: generateSummary(tier, factors),
    canProceed,
    warningMessage: !canProceed 
      ? 'Image quality is too low for reliable scoring. Please add clearer photos.'
      : tier === 'poor'
        ? 'Low quality images may result in less accurate estimates.'
        : null,
  }
}

function assessFactors(input: IntakeQualityInput): IntakeQualityFactors {
  const angles = input.images.map(img => img.angleType)
  
  // Image count factor
  const imageCount = input.images.length
  let imageCountScore = 0
  let imageCountRec: string | null = null
  if (imageCount >= 4) imageCountScore = 1.0
  else if (imageCount >= 3) imageCountScore = 0.85
  else if (imageCount >= 2) imageCountScore = 0.6
  else if (imageCount >= 1) {
    imageCountScore = 0.3
    imageCountRec = 'Add more photos for better accuracy'
  }
  else {
    imageCountScore = 0
    imageCountRec = 'At least one photo is required'
  }

  // Angle diversity factor
  const hasFront = angles.includes('front')
  const hasLeft = angles.includes('left')
  const hasRight = angles.includes('right')
  const hasBack = angles.includes('back')
  const hasSideAngle = hasLeft || hasRight
  
  let angleDiversityScore = 0
  const missingCritical: AngleType[] = []
  let angleRec: string | null = null
  
  if (hasFront) angleDiversityScore += 0.35
  else missingCritical.push('front')
  
  if (hasLeft) angleDiversityScore += 0.25
  else missingCritical.push('left')
  
  if (hasRight) angleDiversityScore += 0.25
  else missingCritical.push('right')
  
  if (hasBack) angleDiversityScore += 0.15
  
  if (!hasFront && !hasSideAngle) {
    angleRec = 'Add a front view for best results'
  } else if (!hasSideAngle) {
    angleRec = 'Add a left or right side angle'
  } else if (!hasFront) {
    angleRec = 'A front view would improve accuracy'
  }

  // Ears visible factor
  const earsFromImages = input.images.some(img => img.landmarksDetected?.ears_visible)
  const earsDeclared = input.earsFullyVisible ?? false
  const earsVisible = earsDeclared || earsFromImages
  const earsScore = earsVisible ? 1.0 : 0.3
  const earsRec = !earsVisible ? 'Photos with visible ears improve scaling accuracy' : null

  // Source type factor
  let sourceScore = 0.6 // default/unknown
  let sourceRec: string | null = null
  switch (input.sourceType) {
    case 'european_mount':
    case 'mounted_photo':
      sourceScore = 1.0
      break
    case 'harvest_photo':
      sourceScore = 0.85
      break
    case 'live_deer':
      sourceScore = 0.7
      sourceRec = 'Live deer photos can have pose distortion'
      break
    case 'trail_cam':
      sourceScore = 0.5
      sourceRec = 'Trail cam perspective may affect accuracy'
      break
    default:
      sourceScore = 0.6
  }

  // Image dimensions factor
  let totalWidth = 0
  let totalHeight = 0
  input.images.forEach(img => {
    totalWidth += img.width || 0
    totalHeight += img.height || 0
  })
  const avgWidth = input.images.length > 0 ? totalWidth / input.images.length : 0
  const avgHeight = input.images.length > 0 ? totalHeight / input.images.length : 0
  
  let dimScore = 0
  let dimRec: string | null = null
  if (avgWidth >= MIN_EXCELLENT_WIDTH && avgHeight >= MIN_EXCELLENT_HEIGHT) {
    dimScore = 1.0
  } else if (avgWidth >= MIN_GOOD_WIDTH && avgHeight >= MIN_GOOD_HEIGHT) {
    dimScore = 0.7
  } else if (avgWidth > 0) {
    dimScore = 0.4
    dimRec = 'Higher resolution photos would improve detail detection'
  }

  // Low light flag
  const lowLightDetected = input.images.some(img => img.lowLightDetected)
  const lowLightScore = lowLightDetected ? 0.3 : 1.0
  const lowLightRec = lowLightDetected ? 'Retake photos in better lighting if possible' : null

  // Blur flag
  const blurDetected = input.images.some(img => img.blurDetected)
  const blurScore = blurDetected ? 0.3 : 1.0
  const blurRec = blurDetected ? 'Some photos appear blurry - sharper images help' : null

  // Cropped beam tips
  const beamTipsCropped = input.images.some(img => img.beamTipsCropped)
  const croppedScore = beamTipsCropped ? 0.4 : 1.0
  const croppedRec = beamTipsCropped ? 'Ensure full rack is visible including beam tips' : null

  return {
    imageCount: {
      score: imageCountScore,
      value: imageCount,
      recommendation: imageCountRec,
    },
    angleDiversity: {
      score: angleDiversityScore,
      angles,
      missingCritical,
      recommendation: angleRec,
    },
    earsVisible: {
      score: earsScore,
      declared: earsDeclared,
      recommendation: earsRec,
    },
    sourceType: {
      score: sourceScore,
      type: input.sourceType || null,
      recommendation: sourceRec,
    },
    imageDimensions: {
      score: dimScore,
      avgWidth,
      avgHeight,
      recommendation: dimRec,
    },
    lowLightFlag: {
      score: lowLightScore,
      detected: lowLightDetected,
      recommendation: lowLightRec,
    },
    blurFlag: {
      score: blurScore,
      detected: blurDetected,
      recommendation: blurRec,
    },
    croppedBeamTips: {
      score: croppedScore,
      detected: beamTipsCropped,
      recommendation: croppedRec,
    },
  }
}

function calculateOverallScore(factors: IntakeQualityFactors): number {
  const weighted = 
    factors.angleDiversity.score * FACTOR_WEIGHTS.angleDiversity +
    factors.imageCount.score * FACTOR_WEIGHTS.imageCount +
    factors.earsVisible.score * FACTOR_WEIGHTS.earsVisible +
    factors.imageDimensions.score * FACTOR_WEIGHTS.imageDimensions +
    factors.sourceType.score * FACTOR_WEIGHTS.sourceType +
    factors.lowLightFlag.score * FACTOR_WEIGHTS.lowLightFlag +
    factors.blurFlag.score * FACTOR_WEIGHTS.blurFlag +
    factors.croppedBeamTips.score * FACTOR_WEIGHTS.croppedBeamTips
  
  return Math.round(weighted * 100)
}

function scoreTierFromScore(score: number): IntakeQualityTier {
  if (score >= 80) return 'excellent'
  if (score >= 60) return 'good'
  if (score >= 40) return 'fair'
  return 'poor'
}

function categorizeFactors(factors: IntakeQualityFactors): {
  strongestFactors: string[]
  weakestFactors: string[]
} {
  const factorList = [
    { name: 'Multi-angle coverage', score: factors.angleDiversity.score },
    { name: 'Image count', score: factors.imageCount.score },
    { name: 'Ears visible for scaling', score: factors.earsVisible.score },
    { name: 'Image resolution', score: factors.imageDimensions.score },
    { name: 'Photo source type', score: factors.sourceType.score },
    { name: 'Good lighting', score: factors.lowLightFlag.score },
    { name: 'Image sharpness', score: factors.blurFlag.score },
    { name: 'Full rack visible', score: factors.croppedBeamTips.score },
  ]
  
  const sorted = [...factorList].sort((a, b) => b.score - a.score)
  const strongestFactors = sorted.filter(f => f.score >= 0.7).slice(0, 3).map(f => f.name)
  const weakestFactors = sorted.filter(f => f.score < 0.5).slice(-3).map(f => f.name)
  
  return { strongestFactors, weakestFactors }
}

function generateRecommendations(
  factors: IntakeQualityFactors,
  input: IntakeQualityInput
): BetterAngleRecommendation[] {
  const recommendations: BetterAngleRecommendation[] = []
  const angles = input.images.map(img => img.angleType)
  
  // Missing critical angles
  if (!angles.includes('front')) {
    recommendations.push({
      type: 'add_angle',
      priority: 'high',
      angle: 'front',
      message: 'Add a front view',
      reason: 'Front angles provide the most accurate spread and symmetry data',
    })
  }
  
  if (!angles.includes('left') && !angles.includes('right')) {
    recommendations.push({
      type: 'add_angle',
      priority: 'high',
      angle: 'left',
      message: 'Add a side angle (left or right)',
      reason: 'Side views help measure beam length and tine heights',
    })
  } else if (!angles.includes('left')) {
    recommendations.push({
      type: 'add_angle',
      priority: 'medium',
      angle: 'left',
      message: 'Add a left side angle',
      reason: 'Both sides help verify symmetry and measure both beams accurately',
    })
  } else if (!angles.includes('right')) {
    recommendations.push({
      type: 'add_angle',
      priority: 'medium',
      angle: 'right',
      message: 'Add a right side angle',
      reason: 'Both sides help verify symmetry and measure both beams accurately',
    })
  }
  
  // Ears not visible
  if (!factors.earsVisible.declared && factors.earsVisible.score < 0.5) {
    recommendations.push({
      type: 'retake',
      priority: 'high',
      message: 'Retake with ears visible',
      reason: 'Ears are the primary scaling reference for accurate measurements',
    })
  }
  
  // Quality issues
  if (factors.blurFlag.detected) {
    recommendations.push({
      type: 'improve_quality',
      priority: 'medium',
      message: 'Add a sharper photo',
      reason: 'Blurry images reduce landmark detection accuracy',
    })
  }
  
  if (factors.lowLightFlag.detected) {
    recommendations.push({
      type: 'improve_quality',
      priority: 'medium',
      message: 'Add a photo with better lighting',
      reason: 'Low light conditions make it harder to detect antler features',
    })
  }
  
  if (factors.croppedBeamTips.detected) {
    recommendations.push({
      type: 'improve_quality',
      priority: 'medium',
      message: 'Ensure beam tips are fully visible',
      reason: 'Cropped beam tips prevent accurate main beam measurements',
    })
  }
  
  // Low image count
  if (input.images.length < 2) {
    recommendations.push({
      type: 'add_angle',
      priority: 'high',
      message: 'Add at least one more photo',
      reason: 'Multiple angles significantly improve scoring accuracy',
    })
  }
  
  return recommendations.slice(0, 4) // Limit to top 4 recommendations
}

function calculateAdjustments(
  tier: IntakeQualityTier,
  factors: IntakeQualityFactors
): { confidenceAdjustment: number; errorBandWidening: number } {
  let confidenceAdjustment = 0
  let errorBandWidening = 1.0
  
  switch (tier) {
    case 'excellent':
      confidenceAdjustment = 5
      errorBandWidening = 0.9
      break
    case 'good':
      confidenceAdjustment = 0
      errorBandWidening = 1.0
      break
    case 'fair':
      confidenceAdjustment = -10
      errorBandWidening = 1.3
      break
    case 'poor':
      confidenceAdjustment = -20
      errorBandWidening = 1.8
      break
  }
  
  // Additional adjustments for specific issues
  if (!factors.earsVisible.declared && factors.earsVisible.score < 0.5) {
    confidenceAdjustment -= 5
    errorBandWidening += 0.1
  }
  
  if (factors.angleDiversity.missingCritical.includes('front')) {
    confidenceAdjustment -= 5
    errorBandWidening += 0.15
  }
  
  return {
    confidenceAdjustment: Math.max(-25, Math.min(10, confidenceAdjustment)),
    errorBandWidening: Math.min(2.0, errorBandWidening),
  }
}

function generateSummary(tier: IntakeQualityTier, factors: IntakeQualityFactors): string {
  switch (tier) {
    case 'excellent':
      return 'Great photo set! Multiple angles with good quality and visible scaling references.'
    case 'good':
      return 'Good photo coverage. Adding more angles could further improve accuracy.'
    case 'fair':
      return 'Limited photo quality or coverage may affect estimate accuracy.'
    case 'poor':
      return 'Low quality images will result in a wider error range. Consider adding better photos.'
    default:
      return 'Photo quality assessment complete.'
  }
}

/**
 * Get the single most important next photo to add
 */
export function getBestNextPhoto(
  assessment: IntakeQualityAssessment
): BetterAngleRecommendation | null {
  const highPriority = assessment.recommendations.find(r => r.priority === 'high')
  if (highPriority) return highPriority
  
  const mediumPriority = assessment.recommendations.find(r => r.priority === 'medium')
  if (mediumPriority) return mediumPriority
  
  return assessment.recommendations[0] || null
}

/**
 * Get tier display configuration
 */
export function getQualityTierConfig(tier: IntakeQualityTier): {
  label: string
  color: string
  bgColor: string
  borderColor: string
  icon: 'check' | 'info' | 'warning' | 'error'
} {
  switch (tier) {
    case 'excellent':
      return {
        label: 'Excellent',
        color: 'text-primary',
        bgColor: 'bg-primary/10',
        borderColor: 'border-primary/30',
        icon: 'check',
      }
    case 'good':
      return {
        label: 'Good',
        color: 'text-primary',
        bgColor: 'bg-primary/5',
        borderColor: 'border-primary/20',
        icon: 'check',
      }
    case 'fair':
      return {
        label: 'Fair',
        color: 'text-amber-600 dark:text-amber-400',
        bgColor: 'bg-amber-500/10',
        borderColor: 'border-amber-500/30',
        icon: 'warning',
      }
    case 'poor':
      return {
        label: 'Poor',
        color: 'text-red-600 dark:text-red-400',
        bgColor: 'bg-red-500/10',
        borderColor: 'border-red-500/30',
        icon: 'error',
      }
  }
}
