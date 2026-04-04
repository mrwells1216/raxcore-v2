export type CaptureAngle = 'front' | 'left' | 'right' | 'detail' | 'unknown'

export type CaptureImageReview = {
  index: number
  filename?: string | null
  angle: CaptureAngle
  hasImage: boolean
}

export type CaptureCoverageSummary = {
  hasFront: boolean
  hasLeft: boolean
  hasRight: boolean
  distinctAngleCount: number
  coverageLabel: 'strong' | 'partial' | 'weak'
  missingAngles: CaptureAngle[]
}

export type CaptureQualitySummary = {
  images: CaptureImageReview[]
  coverage: CaptureCoverageSummary
  recommendation: 'good_to_score' | 'ok_lower_confidence' | 'needs_better_photos'
  recommendationReason: string
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

export function buildCaptureQualitySummary(params: {
  images: Array<{ name?: string | null } | null | undefined>
  selectedAngles?: Array<CaptureAngle | null | undefined>
}): CaptureQualitySummary {
  const imageReviews: CaptureImageReview[] = (params.images ?? []).map((img, index) => {
    const selectedAngle = params.selectedAngles?.[index] ?? null
    const angle =
      selectedAngle && selectedAngle !== 'unknown'
        ? selectedAngle
        : inferAngleFromFilename(img?.name ?? null)

    return {
      index,
      filename: img?.name ?? null,
      angle,
      hasImage: Boolean(img),
    }
  })

  const presentAngles = new Set(
    imageReviews
      .filter((img) => img.hasImage)
      .map((img) => img.angle)
      .filter((angle) => angle !== 'unknown' && angle !== 'detail')
  )

  const hasFront = presentAngles.has('front')
  const hasLeft = presentAngles.has('left')
  const hasRight = presentAngles.has('right')

  const missingAngles: CaptureAngle[] = []
  if (!hasFront) missingAngles.push('front')
  if (!hasLeft) missingAngles.push('left')
  if (!hasRight) missingAngles.push('right')

  const distinctAngleCount = presentAngles.size

  let coverageLabel: 'strong' | 'partial' | 'weak' = 'weak'
  if (hasFront && hasLeft && hasRight) {
    coverageLabel = 'strong'
  } else if (distinctAngleCount >= 2) {
    coverageLabel = 'partial'
  } else {
    coverageLabel = 'weak'
  }

  let recommendation: CaptureQualitySummary['recommendation'] = 'needs_better_photos'
  let recommendationReason = 'Add front, left, and right views for the strongest score.'

  if (coverageLabel === 'strong') {
    recommendation = 'good_to_score'
    recommendationReason = 'Good angle coverage for scoring.'
  } else if (coverageLabel === 'partial') {
    recommendation = 'ok_lower_confidence'
    recommendationReason =
      'Scoring can proceed, but missing one key angle may lower confidence.'
  } else {
    recommendation = 'needs_better_photos'
    recommendationReason =
      'Image set is missing too many key angles for reliable scoring.'
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
    },
    recommendation,
    recommendationReason,
  }
}
