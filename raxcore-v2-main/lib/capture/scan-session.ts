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
// Optical-quality analysis only.
// This must NOT claim deer/rack detection.

export function analyseFrame(canvas: HTMLCanvasElement): SubjectValidation {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })

  let avgBrightness = 0
  let contrast = 0
  let edgeEnergy = 0
  let overexposedRatio = 0
  let underexposedRatio = 0

  if (ctx && canvas.width > 0 && canvas.height > 0) {
    try {
      const sampleW = Math.min(96, Math.max(24, Math.round(canvas.width / 12)))
      const sampleH = Math.min(96, Math.max(24, Math.round(canvas.height / 12)))
      const scratch = document.createElement('canvas')
      scratch.width = sampleW
      scratch.height = sampleH

      const sctx = scratch.getContext('2d', { willReadFrequently: true })
      if (sctx) {
        sctx.drawImage(canvas, 0, 0, sampleW, sampleH)
        const imageData = sctx.getImageData(0, 0, sampleW, sampleH)
        const data = imageData.data
        const lumas = new Float32Array(sampleW * sampleH)

        let sum = 0
        let over = 0
        let under = 0

        for (let i = 0, p = 0; i < data.length; i += 4, p++) {
          const r = data[i]
          const g = data[i + 1]
          const b = data[i + 2]
          const luma = 0.299 * r + 0.587 * g + 0.114 * b
          lumas[p] = luma
          sum += luma
          if (luma > 245) over++
          if (luma < 10) under++
        }

        const total = lumas.length
        avgBrightness = sum / total

        let variance = 0
        let edges = 0

        for (let y = 0; y < sampleH; y++) {
          for (let x = 0; x < sampleW; x++) {
            const idx = y * sampleW + x
            const luma = lumas[idx]
            variance += (luma - avgBrightness) ** 2
            if (x > 0) edges += Math.abs(luma - lumas[idx - 1])
            if (y > 0) edges += Math.abs(luma - lumas[idx - sampleW])
          }
        }

        contrast = Math.sqrt(variance / total)
        edgeEnergy = edges / Math.max(1, (sampleW - 1) * sampleH + (sampleH - 1) * sampleW)
        overexposedRatio = over / total
        underexposedRatio = under / total
      }
    } catch {
      // Canvas may be temporarily unreadable. Do not crash scan mode.
    }
  }

  const brightnessOk = avgBrightness >= 32 && avgBrightness <= 225
  const isClipped = overexposedRatio > 0.22 || underexposedRatio > 0.35
  const isSharp = edgeEnergy >= 3.25 && contrast >= 10

  let rejectionReason: string | null = null
  if (!brightnessOk) rejectionReason = avgBrightness < 32 ? 'Too dark for a reliable photo' : 'Too bright / washed out'
  else if (isClipped) rejectionReason = 'Exposure is clipping detail'
  else if (!isSharp) rejectionReason = 'Frame looks soft — hold steadier or move closer'

  const brightnessScore = brightnessOk ? 0.34 : 0.1
  const sharpScore = isSharp ? 0.38 : Math.max(0.08, Math.min(0.24, edgeEnergy / 18))
  const clippingScore = isClipped ? 0.05 : 0.2
  const confidence = Math.max(0.05, Math.min(0.92, brightnessScore + sharpScore + clippingScore))

  return {
    hasDeer: false,
    hasRack: false,
    isSharp,
    isClipped,
    brightnessOk,
    confidence,
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

  const requiredFilled = [zones.full_rack, zones.left_antler, zones.right_antler].filter(Boolean).length
  const percent = Math.round((requiredFilled / 3) * 100)
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

  if (validation?.rejectionReason) {
    return {
      status: 'invalid',
      headline: validation.rejectionReason,
      subtext: 'Fix the frame before capturing this view.',
    }
  }

  if (progress.satisfied) {
    return {
      status: 'valid',
      headline: 'Front, left, and right views captured',
      subtext: 'Continue to AI validation and scoring.',
    }
  }

  if (!progress.zones.full_rack) {
    return {
      status: 'valid',
      headline: 'Manually capture the full front rack',
      subtext: 'Both beams and inside spread should be visible.',
    }
  }

  if (!progress.zones.left_antler) {
    return {
      status: 'valid',
      headline: 'Capture the left antler view',
      subtext: 'Angle for beam curve and tine heights.',
    }
  }

  if (!progress.zones.right_antler) {
    return {
      status: 'valid',
      headline: 'Capture the right antler view',
      subtext: 'Match distance and framing when possible.',
    }
  }

  return {
    status: 'valid',
    headline: 'Optional detail shot',
    subtext: 'Use only for abnormal points or unclear tines.',
  }
}

// ─── shouldAutoCaptureFrame ───────────────────────────────────────────────────
// Kept only for backward compatibility.
// ScanModePanel must not call this for live auto-capture anymore.

export function shouldAutoCaptureFrame(
  validationOrInput: SubjectValidation | ScanAutoCaptureInput,
  zones?: CoverageZones,
  progress?: CoverageProgress,
  stableCount?: number,
): boolean {
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

  const validation = validationOrInput as SubjectValidation
  if (!validation.hasDeer || !validation.hasRack || !validation.isSharp || validation.isClipped || !validation.brightnessOk) {
    return false
  }

  if ((stableCount ?? 0) < 3) return false

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
