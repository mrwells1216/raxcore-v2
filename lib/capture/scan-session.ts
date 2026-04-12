export type ScanAngle = 'front' | 'left' | 'right' | 'detail'

// ─── Frame analysis types ──────────────────────────────────────────────────────

export type SubjectValidation = {
  hasDeer: boolean
  hasRack: boolean
  isSharp: boolean
  isClipped: boolean
  brightnessOk: boolean
  confidence: number
  rejectionReason: string | null
}

export type CoverageZones = {
  full_rack: boolean
  left_antler: boolean
  right_antler: boolean
  beam_tine_detail: boolean
}

export type CoverageProgress = {
  zones: CoverageZones
  percent: number
  satisfied: boolean
}

export type SmartScanFrame = {
  id: string
  file: File
  previewUrl: string
  capturedAt: string
  zones: CoverageZones
  validation: SubjectValidation
  angle: ScanAngle
}

export type GuidanceState = {
  status: 'idle' | 'valid' | 'invalid'
  headline: string
  subtext: string | null
}

// ─── Legacy compat ────────────────────────────────────────────────────────────

export type ScanAutoCaptureInput = {
  hasRackDetected?: boolean
  hasDeerDetected?: boolean
  isBlurry?: boolean
  isClipped?: boolean
  addsNewCoverage?: boolean
  isStable?: boolean
}

// ─── analyseFrame ─────────────────────────────────────────────────────────────
// Lightweight canvas-based heuristic — real ML inference is done server-side.

export function analyseFrame(canvas: HTMLCanvasElement): SubjectValidation {
  const ctx = canvas.getContext('2d')

  let blurScore = 0
  let clippingScore = 0
  let brightnessOk = true

  if (ctx && canvas.width > 0 && canvas.height > 0) {
    try {
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const data = imageData.data
      const total = data.length / 4
      let sum = 0
      let overexposed = 0

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2]
        const luma = 0.299 * r + 0.587 * g + 0.114 * b
        sum += luma
        if (luma > 240) overexposed++
      }

      const avgBrightness = sum / total
      brightnessOk = avgBrightness > 20 && avgBrightness < 235
      clippingScore = overexposed / total
      blurScore = avgBrightness < 30 ? 0.8 : 0.1 // very rough proxy
    } catch {
      // canvas tainted by CORS — treat as unknown
    }
  }

  const isSharp = blurScore < 0.4
  const isClipped = clippingScore > 0.15

  let rejectionReason: string | null = null
  if (!brightnessOk) rejectionReason = 'Poor lighting'
  else if (!isSharp) rejectionReason = 'Image too blurry'
  else if (isClipped) rejectionReason = 'Subject clipped'

  return {
    hasDeer: true,       // can't determine without ML — assume true for manual flow
    hasRack: true,
    isSharp,
    isClipped,
    brightnessOk,
    confidence: rejectionReason ? 0.3 : 0.75,
    rejectionReason,
  }
}

// ─── detectCoverageZones ──────────────────────────────────────────────────────

export function detectCoverageZones(
  validation: SubjectValidation,
  angle: ScanAngle,
): CoverageZones {
  const valid = !validation.rejectionReason
  return {
    full_rack:        valid && angle === 'front',
    left_antler:      valid && angle === 'left',
    right_antler:     valid && angle === 'right',
    beam_tine_detail: valid && angle === 'detail',
  }
}

// ─── buildCoverageProgress ────────────────────────────────────────────────────

export function buildCoverageProgress(frames: SmartScanFrame[]): CoverageProgress {
  const zones: CoverageZones = {
    full_rack: false,
    left_antler: false,
    right_antler: false,
    beam_tine_detail: false,
  }

  for (const f of frames) {
    if (f.zones.full_rack)        zones.full_rack        = true
    if (f.zones.left_antler)      zones.left_antler      = true
    if (f.zones.right_antler)     zones.right_antler     = true
    if (f.zones.beam_tine_detail) zones.beam_tine_detail = true
  }

  const filled = Object.values(zones).filter(Boolean).length
  const percent = Math.round((filled / 4) * 100)
  const satisfied = zones.full_rack && zones.left_antler && zones.right_antler

  return { zones, percent, satisfied }
}

// ─── buildGuidanceState ───────────────────────────────────────────────────────

export function buildGuidanceState(
  validation: SubjectValidation | null,
  progress: CoverageProgress,
  isStreaming: boolean,
): GuidanceState {
  if (!isStreaming) {
    return { status: 'idle', headline: 'Starting camera…', subtext: null }
  }

  if (!validation) {
    return { status: 'idle', headline: 'Point at the rack', subtext: null }
  }

  if (validation.rejectionReason) {
    return {
      status: 'invalid',
      headline: validation.rejectionReason,
      subtext: 'Adjust and try again',
    }
  }

  if (progress.satisfied) {
    return {
      status: 'valid',
      headline: 'Coverage complete',
      subtext: 'Tap Continue to score',
    }
  }

  if (!progress.zones.full_rack) {
    return { status: 'valid', headline: 'Capture front view', subtext: 'Hold steady' }
  }
  if (!progress.zones.left_antler) {
    return { status: 'valid', headline: 'Move left, capture left antler', subtext: null }
  }
  if (!progress.zones.right_antler) {
    return { status: 'valid', headline: 'Move right, capture right antler', subtext: null }
  }

  return { status: 'valid', headline: 'Hold steady', subtext: null }
}

// ─── shouldAutoCaptureFrame ───────────────────────────────────────────────────
// Overloaded to support both the new 4-arg call in scan-mode-panel and the
// original 1-arg ScanAutoCaptureInput form.

export function shouldAutoCaptureFrame(
  validationOrInput: SubjectValidation | ScanAutoCaptureInput,
  zones?: CoverageZones,
  progress?: CoverageProgress,
  stableCount?: number,
): boolean {
  // Legacy 1-arg form
  if ('hasRackDetected' in validationOrInput || 'hasDeerDetected' in validationOrInput) {
    const input = validationOrInput as ScanAutoCaptureInput
    return (
      !!input.hasRackDetected &&
      !!input.hasDeerDetected &&
      !input.isBlurry &&
      !input.isClipped &&
      !!input.addsNewCoverage &&
      !!input.isStable
    )
  }

  // New 4-arg form from scan-mode-panel
  const val = validationOrInput as SubjectValidation
  if (!val.hasDeer || !val.hasRack || !val.isSharp || val.isClipped || !val.brightnessOk) {
    return false
  }
  if ((stableCount ?? 0) < 3) return false

  // Only auto-capture if this frame adds new zone coverage
  if (zones && progress) {
    const addsNew =
      (zones.full_rack        && !progress.zones.full_rack)        ||
      (zones.left_antler      && !progress.zones.left_antler)      ||
      (zones.right_antler     && !progress.zones.right_antler)     ||
      (zones.beam_tine_detail && !progress.zones.beam_tine_detail)
    if (!addsNew) return false
  }

  return true
}

// ─── framesToLegacySlots ──────────────────────────────────────────────────────

export function framesToLegacySlots(frames: SmartScanFrame[]): {
  files: File[]
  angles: ScanAngle[]
} {
  // Deduplicate by angle, keeping highest-confidence frame per angle
  const best = new Map<ScanAngle, SmartScanFrame>()
  for (const f of frames) {
    const existing = best.get(f.angle)
    if (!existing || f.validation.confidence > existing.validation.confidence) {
      best.set(f.angle, f)
    }
  }
  const sorted = Array.from(best.values()).sort((a, b) => {
    const order: ScanAngle[] = ['front', 'left', 'right', 'detail']
    return order.indexOf(a.angle) - order.indexOf(b.angle)
  })
  return {
    files: sorted.map(f => f.file),
    angles: sorted.map(f => f.angle),
  }
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
