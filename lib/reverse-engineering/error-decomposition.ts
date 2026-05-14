import type { ErrorCauseItem, ReverseBaselineBundle } from './types'

/**
 * Builds error decomposition - root cause analysis for why a prediction
 * might have uncertainty or inaccuracy. This guides hypothesis generation.
 */
export async function buildErrorDecomposition(bundle: ReverseBaselineBundle): Promise<{
  causes: ErrorCauseItem[]
  referenceQuality: number
  notes: string[]
}> {
  const { buck, images, prediction } = bundle

  const causes: ErrorCauseItem[] = []
  const notes: string[] = []

  // Extract signals from prediction metadata
  const predMeta = prediction as unknown as Record<string, unknown>
  const landmarks = (predMeta.landmarks ?? {}) as Record<string, unknown>
  const rawResponse = (predMeta.raw_response ?? {}) as Record<string, unknown>
  
  // Reference quality estimation
  let referenceQuality = 0.7 // Default moderate quality

  // Check ear visibility
  const earsVisible = buck.ears_fully_visible ?? landmarks.ears_visible ?? true
  if (!earsVisible) {
    causes.push({
      cause: 'scale_reference_weak',
      weight: 0.85,
      evidence: ['ears not fully visible', 'primary scale reference unavailable'],
    })
    referenceQuality -= 0.2
  }

  // Analyze angle coverage
  const angleTypes = images.map(i => i.angle_type).filter(Boolean)
  const uniqueAngles = new Set(angleTypes)
  const hasFront = angleTypes.some(a => a === 'front')
  const hasLeft = angleTypes.some(a => a === 'left')
  const hasRight = angleTypes.some(a => a === 'right')

  if (!hasFront) {
    causes.push({
      cause: 'front_spread_weak',
      weight: 0.75,
      evidence: ['missing front angle', 'spread depends heavily on frontal reference'],
    })
    referenceQuality -= 0.1
  }

  if (!(hasLeft && hasRight)) {
    causes.push({
      cause: 'side_beams_weak',
      weight: 0.65,
      evidence: ['missing both left+right profiles', 'beam/tine reliability drops'],
    })
    referenceQuality -= 0.1
  }

  // Check for low image diversity
  if (uniqueAngles.size <= 1 || images.length <= 1) {
    causes.push({
      cause: 'few_images_low_diversity',
      weight: 0.55,
      evidence: [`images=${images.length}`, `unique_angles=${uniqueAngles.size}`],
    })
    referenceQuality -= 0.15
  }

  // Check source type for quality signals
  const sourceType = buck.source_type
  if ((sourceType as string) === 'trail_cam' || (sourceType as string) === 'trail_camera') {
    causes.push({
      cause: 'lighting_quality_poor',
      weight: 0.45,
      evidence: ['trail cam source typically has lower image quality', 'may have motion blur or low resolution'],
    })
    referenceQuality -= 0.1
  }

  // Check for tine visibility issues from landmarks
  const tineConfidence = (landmarks.tine_confidence as number | undefined) ?? 0.7
  if (tineConfidence < 0.5) {
    causes.push({
      cause: 'tine_visibility_low',
      weight: 0.7,
      evidence: ['tine_reference_score low across images', `tine_confidence=${tineConfidence.toFixed(2)}`],
    })
  }

  // Check confidence from prediction
  const confidence = (predMeta.confidence_percent as number | undefined) ?? 70
  if (confidence < 60) {
    causes.push({
      cause: 'domain_shift_risk',
      weight: 0.4,
      evidence: [`low confidence (${confidence}%)`, 'may indicate unusual rack characteristics'],
    })
  }

  // Check for asymmetry issues
  const asymmetryRatio = (rawResponse.asymmetry_ratio as number | undefined)
  if (asymmetryRatio && asymmetryRatio > 0.25) {
    // High asymmetry with limited angles could be perspective-confounded
    if (!hasLeft || !hasRight) {
      causes.push({
        cause: 'asymmetry_confounded',
        weight: 0.6,
        evidence: [
          `high asymmetry ratio (${(asymmetryRatio * 100).toFixed(0)}%)`,
          'limited angle coverage may confound perspective with real asymmetry',
        ],
      })
    }
  }

  // Normalize and sort by weight
  causes.sort((a, b) => b.weight - a.weight)
  const sum = causes.reduce((s, c) => s + c.weight, 0) || 1
  const normalized = causes.map(c => ({ ...c, weight: c.weight / sum }))

  // Clamp reference quality
  referenceQuality = Math.max(0.2, Math.min(1.0, referenceQuality))

  notes.push(`Reference quality: ${referenceQuality.toFixed(2)}`)
  notes.push(`Angles: ${Array.from(uniqueAngles).join(', ') || 'unknown'}`)
  notes.push(`Images: ${images.length}`)

  return { causes: normalized, referenceQuality, notes }
}

/**
 * Summarize error decomposition for display
 */
export function summarizeDecomposition(causes: ErrorCauseItem[]): string {
  if (causes.length === 0) return 'No significant error sources identified.'
  
  const top = causes.slice(0, 3)
  const parts = top.map(c => {
    const label = c.cause.replace(/_/g, ' ')
    const pct = Math.round(c.weight * 100)
    return `${label} (${pct}%)`
  })
  
  return `Primary factors: ${parts.join(', ')}`
}
