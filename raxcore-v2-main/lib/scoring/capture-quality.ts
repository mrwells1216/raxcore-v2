export type CaptureAngle = 'front' | 'left' | 'right' | 'detail' | 'unknown'

export type CaptureImageReview = {
  index: number
  filename?: string | null
  angle: CaptureAngle
  hasImage: boolean
  /** Visibility scores from AI analysis (0-1 scale) */
  visibilityScores?: ImageVisibilityScores | null
  /** Overall quality score for this image (0-1) */
  qualityScore?: number | null
}

/** Per-image visibility scores from AI analysis */
export type ImageVisibilityScores = {
  /** How well the spread (inside width) can be measured from this angle */
  spreadVisibility: number
  /** How well the left beam can be measured */
  leftBeamVisibility: number
  /** How well the right beam can be measured */
  rightBeamVisibility: number
  /** How well left tines are visible */
  leftTineVisibility: number
  /** How well right tines are visible */
  rightTineVisibility: number
  /** Overall sharpness/focus (0-1) */
  imageSharpness: number
  /** Lighting quality (0-1) */
  lightingQuality: number
  /** Whether scale reference (ears) is visible */
  scaleReferenceVisible: boolean
  /** Raw angle classification confidence from AI */
  angleConfidence: number
}

/** AI analysis input for a single image */
export type ImageAnalysisInput = {
  name?: string | null
  /** AI-detected visibility scores (if available) */
  visibilityScores?: ImageVisibilityScores | null
  /** AI-predicted angle (if available) */
  predictedAngle?: CaptureAngle | null
  /** AI confidence in the predicted angle (0-1) */
  angleConfidence?: number | null
}

export type CaptureCoverageSummary = {
  hasFront: boolean
  hasLeft: boolean
  hasRight: boolean
  distinctAngleCount: number
  coverageLabel: 'strong' | 'partial' | 'weak'
  missingAngles: CaptureAngle[]
  /** Best image index for each measurement type */
  bestImageForMeasurement: {
    spread: number | null
    leftBeam: number | null
    rightBeam: number | null
  }
}

export type CaptureQualitySummary = {
  images: CaptureImageReview[]
  coverage: CaptureCoverageSummary
  recommendation: 'good_to_score' | 'ok_lower_confidence' | 'needs_better_photos'
  recommendationReason: string
  /** Overall image set quality score (0-1) */
  overallQuality: number
  /** Explanation of quality assessment */
  qualityExplanation: string[]
}

function inferAngleFromFilename(name?: string | null): CaptureAngle {
  const value = (name ?? '').toLowerCase()

  if (!value) return 'unknown'
  if (value.includes('front')) return 'front'
  if (value.includes('left')) return 'left'
  if (value.includes('right')) return 'right'
  if (value.includes('detail')) return 'detail'

  return 'unknown'
}

/**
 * Score an image for how well it captures each angle's key measurements
 * This replaces naive filename-based angle detection with actual visibility analysis
 */
export function scoreImageForAngle(visibilityScores: ImageVisibilityScores): {
  front: number
  left: number
  right: number
} {
  return {
    // Front images are best for spread measurement
    front: visibilityScores.spreadVisibility * 0.6 + 
           Math.min(visibilityScores.leftTineVisibility, visibilityScores.rightTineVisibility) * 0.2 +
           visibilityScores.imageSharpness * 0.1 +
           visibilityScores.lightingQuality * 0.1,
    
    // Left images are best for left beam and left tine visibility
    left: visibilityScores.leftBeamVisibility * 0.5 +
          visibilityScores.leftTineVisibility * 0.3 +
          visibilityScores.imageSharpness * 0.1 +
          visibilityScores.lightingQuality * 0.1,
    
    // Right images are best for right beam and right tine visibility  
    right: visibilityScores.rightBeamVisibility * 0.5 +
           visibilityScores.rightTineVisibility * 0.3 +
           visibilityScores.imageSharpness * 0.1 +
           visibilityScores.lightingQuality * 0.1,
  }
}

/**
 * Select the best image for each measurement type based on visibility scores
 */
export function selectBestImagesForMeasurements(
  images: CaptureImageReview[]
): {
  bestFront: CaptureImageReview | null
  bestLeft: CaptureImageReview | null
  bestRight: CaptureImageReview | null
  imageAssignments: Map<string, number[]>
} {
  const imagesWithScores = images
    .filter(img => img.hasImage && img.visibilityScores)
    .map(img => ({
      ...img,
      angleScores: scoreImageForAngle(img.visibilityScores!)
    }))

  // Sort by each angle score to find best
  const bestFront = [...imagesWithScores]
    .sort((a, b) => b.angleScores.front - a.angleScores.front)[0] || null
  
  const bestLeft = [...imagesWithScores]
    .sort((a, b) => b.angleScores.left - a.angleScores.left)[0] || null
  
  const bestRight = [...imagesWithScores]
    .sort((a, b) => b.angleScores.right - a.angleScores.right)[0] || null

  // Build assignment map: which images are best for which measurements
  const imageAssignments = new Map<string, number[]>()
  
  if (bestFront) {
    imageAssignments.set('spread', [bestFront.index])
  }
  if (bestLeft) {
    imageAssignments.set('leftBeam', [bestLeft.index])
    imageAssignments.set('leftTines', [bestLeft.index])
  }
  if (bestRight) {
    imageAssignments.set('rightBeam', [bestRight.index])
    imageAssignments.set('rightTines', [bestRight.index])
  }

  return {
    bestFront: bestFront ? images[bestFront.index] : null,
    bestLeft: bestLeft ? images[bestLeft.index] : null,
    bestRight: bestRight ? images[bestRight.index] : null,
    imageAssignments,
  }
}

/**
 * Determine the effective angle of an image using both AI analysis and filename fallback
 */
function determineImageAngle(
  img: ImageAnalysisInput,
  selectedAngle?: CaptureAngle | null
): { angle: CaptureAngle; confidence: number; source: 'selected' | 'ai' | 'filename' | 'visibility' } {
  // 1. User-selected angle takes priority
  if (selectedAngle && selectedAngle !== 'unknown') {
    return { angle: selectedAngle, confidence: 1.0, source: 'selected' }
  }
  
  // 2. If we have visibility scores, use them to determine best angle
  if (img.visibilityScores) {
    const scores = scoreImageForAngle(img.visibilityScores)
    const maxScore = Math.max(scores.front, scores.left, scores.right)
    
    if (maxScore >= 0.4) { // Minimum threshold to classify
      if (scores.front === maxScore) {
        return { angle: 'front', confidence: scores.front, source: 'visibility' }
      } else if (scores.left === maxScore) {
        return { angle: 'left', confidence: scores.left, source: 'visibility' }
      } else {
        return { angle: 'right', confidence: scores.right, source: 'visibility' }
      }
    }
  }
  
  // 3. AI-predicted angle (from model output)
  if (img.predictedAngle && img.predictedAngle !== 'unknown' && (img.angleConfidence ?? 0) >= 0.5) {
    return { 
      angle: img.predictedAngle, 
      confidence: img.angleConfidence ?? 0.5, 
      source: 'ai' 
    }
  }
  
  // 4. Filename inference as last resort
  const filenameAngle = inferAngleFromFilename(img.name)
  return { 
    angle: filenameAngle, 
    confidence: filenameAngle !== 'unknown' ? 0.3 : 0, 
    source: 'filename' 
  }
}

export function buildCaptureQualitySummary(params: {
  images: Array<ImageAnalysisInput | null | undefined>
  selectedAngles?: Array<CaptureAngle | null | undefined>
}): CaptureQualitySummary {
  const qualityExplanation: string[] = []
  
  const imageReviews: CaptureImageReview[] = (params.images ?? []).map((img, index) => {
    const selectedAngle = params.selectedAngles?.[index] ?? null
    const { angle, confidence, source } = determineImageAngle(
      img ?? { name: null },
      selectedAngle
    )
    
    // Calculate per-image quality score
    let qualityScore = 0.5 // Default moderate quality
    if (img?.visibilityScores) {
      qualityScore = (
        img.visibilityScores.imageSharpness * 0.3 +
        img.visibilityScores.lightingQuality * 0.3 +
        (img.visibilityScores.scaleReferenceVisible ? 0.2 : 0) +
        confidence * 0.2
      )
    }

    return {
      index,
      filename: img?.name ?? null,
      angle,
      hasImage: Boolean(img),
      visibilityScores: img?.visibilityScores ?? null,
      qualityScore,
    }
  })

  // Use visibility-based scoring to determine angle coverage
  const imagesWithVisibility = imageReviews.filter(img => img.hasImage && img.visibilityScores)
  
  let hasFront = false
  let hasLeft = false
  let hasRight = false
  let bestSpreadIndex: number | null = null
  let bestLeftBeamIndex: number | null = null
  let bestRightBeamIndex: number | null = null
  
  if (imagesWithVisibility.length > 0) {
    // Use visibility scores to determine best images for each measurement
    const selection = selectBestImagesForMeasurements(imageReviews)
    
    // Consider we "have" an angle if the best image for it has a score >= 0.4
    if (selection.bestFront) {
      const scores = scoreImageForAngle(selection.bestFront.visibilityScores!)
      hasFront = scores.front >= 0.4
      if (hasFront) bestSpreadIndex = selection.bestFront.index
    }
    if (selection.bestLeft) {
      const scores = scoreImageForAngle(selection.bestLeft.visibilityScores!)
      hasLeft = scores.left >= 0.4
      if (hasLeft) bestLeftBeamIndex = selection.bestLeft.index
    }
    if (selection.bestRight) {
      const scores = scoreImageForAngle(selection.bestRight.visibilityScores!)
      hasRight = scores.right >= 0.4
      if (hasRight) bestRightBeamIndex = selection.bestRight.index
    }
    
    qualityExplanation.push(`Visibility-based angle detection used for ${imagesWithVisibility.length} image(s).`)
  } else {
    // Fallback to traditional angle-based detection
    const presentAngles = new Set(
      imageReviews
        .filter((img) => img.hasImage)
        .map((img) => img.angle)
        .filter((angle) => angle !== 'unknown' && angle !== 'detail')
    )
    
    hasFront = presentAngles.has('front')
    hasLeft = presentAngles.has('left')
    hasRight = presentAngles.has('right')
    
    qualityExplanation.push('Using filename/AI angle detection (no visibility scores available).')
  }

  const missingAngles: CaptureAngle[] = []
  if (!hasFront) missingAngles.push('front')
  if (!hasLeft) missingAngles.push('left')
  if (!hasRight) missingAngles.push('right')

  const distinctAngleCount = [hasFront, hasLeft, hasRight].filter(Boolean).length

  let coverageLabel: 'strong' | 'partial' | 'weak' = 'weak'
  if (hasFront && hasLeft && hasRight) {
    coverageLabel = 'strong'
    qualityExplanation.push('Full angle coverage: front, left, and right.')
  } else if (distinctAngleCount >= 2) {
    coverageLabel = 'partial'
    qualityExplanation.push(`Partial coverage: missing ${missingAngles.join(', ')}.`)
  } else {
    coverageLabel = 'weak'
    qualityExplanation.push(`Weak coverage: only ${distinctAngleCount} usable angle(s).`)
  }

  // Calculate overall quality score
  const avgQuality = imageReviews
    .filter(img => img.hasImage && img.qualityScore != null)
    .reduce((sum, img, _, arr) => sum + (img.qualityScore ?? 0) / arr.length, 0)
  
  const coverageBonus = coverageLabel === 'strong' ? 0.2 : coverageLabel === 'partial' ? 0.1 : 0
  const overallQuality = Math.min(1, avgQuality + coverageBonus)

  let recommendation: CaptureQualitySummary['recommendation'] = 'needs_better_photos'
  let recommendationReason = 'Add front, left, and right views for the strongest score.'

  if (coverageLabel === 'strong' && overallQuality >= 0.6) {
    recommendation = 'good_to_score'
    recommendationReason = 'Good angle coverage and image quality for scoring.'
  } else if (coverageLabel === 'strong') {
    recommendation = 'ok_lower_confidence'
    recommendationReason = 'Good angle coverage, but image quality could be improved.'
  } else if (coverageLabel === 'partial' && overallQuality >= 0.5) {
    recommendation = 'ok_lower_confidence'
    recommendationReason = `Scoring can proceed, but adding a ${missingAngles[0]} photo would improve confidence.`
  } else {
    recommendation = 'needs_better_photos'
    recommendationReason = 'Image set needs better angle coverage for reliable scoring.'
  }

  return {
    images: imageReviews,
    coverage: {
      hasFront,
      hasLeft,
      hasRight,
      distinctAngleCount,
      coverageLabel,
      missingAngles,
      bestImageForMeasurement: {
        spread: bestSpreadIndex,
        leftBeam: bestLeftBeamIndex,
        rightBeam: bestRightBeamIndex,
      },
    },
    recommendation,
    recommendationReason,
    overallQuality,
    qualityExplanation,
  }
}
