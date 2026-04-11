export type ScanAngle = 'front' | 'left' | 'right'

export type ScanAutoCaptureInput = {
  hasRackDetected?: boolean
  hasDeerDetected?: boolean
  isBlurry?: boolean
  isClipped?: boolean
  addsNewCoverage?: boolean
  isStable?: boolean
}

export function shouldAutoCaptureFrame(input: ScanAutoCaptureInput): boolean {
  const {
    hasRackDetected = false,
    hasDeerDetected = false,
    isBlurry = false,
    isClipped = false,
    addsNewCoverage = false,
    isStable = false,
  } = input

  if (!hasRackDetected) return false
  if (!hasDeerDetected) return false
  if (isBlurry) return false
  if (isClipped) return false
  if (!addsNewCoverage) return false
  if (!isStable) return false

  return true
}

export type ScanCaptureSlot = {
  angle: ScanAngle
  file: File | null
  previewUrl: string | null
  capturedAt: string | null
}

export type ScanCoverageSummary = {
  hasFront: boolean
  hasLeft: boolean
  hasRight: boolean
  distinctAngleCount: number
  coverageLabel: 'weak' | 'partial' | 'strong'
  missingAngles: ScanAngle[]
  satisfied: boolean
  recommendation: 'needs_more_photos' | 'ready_to_score'
  recommendationReason: string
}

export function createEmptyScanSlots(): ScanCaptureSlot[] {
  return [
    { angle: 'front', file: null, previewUrl: null, capturedAt: null },
    { angle: 'left', file: null, previewUrl: null, capturedAt: null },
    { angle: 'right', file: null, previewUrl: null, capturedAt: null },
  ]
}

export function buildScanCoverageSummary(
  slots: ScanCaptureSlot[],
): ScanCoverageSummary {
  const hasFront = Boolean(slots.find((s) => s.angle === 'front' && s.file))
  const hasLeft = Boolean(slots.find((s) => s.angle === 'left' && s.file))
  const hasRight = Boolean(slots.find((s) => s.angle === 'right' && s.file))

  const missingAngles: ScanAngle[] = []
  if (!hasFront) missingAngles.push('front')
  if (!hasLeft) missingAngles.push('left')
  if (!hasRight) missingAngles.push('right')

  const distinctAngleCount = [hasFront, hasLeft, hasRight].filter(Boolean).length

  let coverageLabel: 'weak' | 'partial' | 'strong' = 'weak'
  if (distinctAngleCount === 3) coverageLabel = 'strong'
  else if (distinctAngleCount === 2) coverageLabel = 'partial'

  const satisfied = distinctAngleCount === 3

  return {
    hasFront,
    hasLeft,
    hasRight,
    distinctAngleCount,
    coverageLabel,
    missingAngles,
    satisfied,
    recommendation: satisfied ? 'ready_to_score' : 'needs_more_photos',
    recommendationReason: satisfied
      ? 'Front, left, and right views captured.'
      : `Still needed: ${missingAngles.join(', ')}.`,
  }
}
