/**
 * Weighted Multi-Reference Consensus Engine
 *
 * Replaces the single-reference (ear-dominant) scaling model with a system
 * that collects independent scale estimates from every detectable anatomical
 * reference, weights them by quality and distortion, detects agreement /
 * conflict, and dynamically adjusts the error range accordingly.
 *
 * Reference priority (highest → lowest):
 *   Top-tier:   eye box, antler base (pedicle) spacing, eye-to-pedicle, skull width
 *   Secondary:  nose bridge, muzzle width, ear base spacing
 *   Bonus:      ear base-to-tip (only when ears are confirmed visible)
 *   Fallback:   statistical prior (no anatomical reference available)
 *
 * Anti-clustering safeguard:
 *   When overall reference quality is low (weak fallback), structural
 *   variance is injected from tine / beam / spread ratios to widen the
 *   output range and prevent collapse into the 160–175 clustering band.
 */

import { ANATOMICAL_REFERENCES } from '@/lib/constants'
import type { LandmarksDetected, AngleType, Measurements } from '@/lib/types'

// ============================================================================
// TYPES
// ============================================================================

export type ReferenceLabel =
  | 'eye_box'
  | 'pedicle_spacing'
  | 'eye_to_pedicle'
  | 'skull_width'
  | 'nose_bridge'
  | 'muzzle_width'
  | 'ear_base_spacing'
  | 'ear_base_to_tip'
  | 'statistical_prior'

export interface ReferenceObservation {
  /** Human-readable label (used in explanation strings) */
  label: ReferenceLabel
  /** Was this reference actually visible in the image? */
  visibility: boolean
  /** 0–1 quality of the detection (sharpness, occlusion-free, angle clarity) */
  quality: number
  /** 0–1 perspective / lens distortion affecting this reference */
  distortion: number
  /** Computed blend weight = quality * (1 - distortion) */
  weight: number
  /** Scaling factor this reference implies (realWorldSize / detectedPixelSize) */
  scalingFactor: number
  /** Gross score estimate derived solely from this reference */
  estimatedGross: number
}

export type AgreementTier = 'high' | 'medium' | 'low' | 'fallback'

export interface ReferenceConsensusOutput {
  /** Final blended gross score from all contributing references */
  consensusGross: number
  /** Blended confidence 0–1 */
  consensusConfidence: number
  /** Spread (stddev) across reference estimates — low = tight agreement */
  estimateSpread: number
  /** Weighted variance across reference gross estimates */
  weightedVariance: number
  /** Agreement tier drives range width */
  agreementTier: AgreementTier
  /** Fractional error half-band applied symmetrically around consensusGross */
  errorHalfBand: number
  /** Whether the anti-clustering variance injection was triggered */
  antiClusteringApplied: boolean
  /** References that had weight > 0 and contributed to the blend */
  dominantReferences: ReferenceLabel[]
  /** References that were visible but had weight too low to contribute */
  ignoredReferences: ReferenceLabel[]
  /** All per-reference observations for debugging */
  referenceWeights: ReferenceObservation[]
  /** Per-reference gross estimates for debugging */
  referenceEstimates: Array<{ label: ReferenceLabel; estimatedGross: number; weight: number }>
  /** 0–1 overall agreement score */
  agreementScore: number
  /** 0–1 conflict score (1 = maximum disagreement) */
  conflictScore: number
  /** Human-readable explanation lines */
  explanation: string[]
}

export interface ReferenceConsensusInput {
  /** Raw gross score from vision model (used as seed for estimates) */
  visionGross: number
  /** Confidence percent from vision model (0–100) */
  visionConfidencePercent: number
  /** Detected landmarks from vision output */
  landmarks: LandmarksDetected
  /** Angle types present in the submission */
  angleTypes: AngleType[]
  /** Whether the user confirmed ears are fully visible */
  earsFullyVisible?: boolean
  /** Per-reference quality/distortion data from vision model (Steps 1–2) */
  referenceQualityData?: Partial<Record<ReferenceLabel, { quality: number; distortion: number }>>
  /** Raw measurements for anti-clustering structural variance */
  measurements?: Partial<Measurements>
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Expected real-world anatomical sizes (inches) */
const REAL_WORLD_SIZE: Record<ReferenceLabel, number> = {
  eye_box:          ANATOMICAL_REFERENCES.EYE_BOX_WIDTH,
  pedicle_spacing:  ANATOMICAL_REFERENCES.PEDICLE_SPACING,
  eye_to_pedicle:   ANATOMICAL_REFERENCES.EYE_TO_PEDICLE,
  skull_width:      ANATOMICAL_REFERENCES.SKULL_FOREHEAD_WIDTH,
  nose_bridge:      ANATOMICAL_REFERENCES.NOSE_BRIDGE_LENGTH,
  muzzle_width:     ANATOMICAL_REFERENCES.MUZZLE_WIDTH,
  ear_base_spacing: ANATOMICAL_REFERENCES.EAR_BASE_SPACING,
  ear_base_to_tip:  ANATOMICAL_REFERENCES.EAR_BASE_TO_TIP,
  statistical_prior: 1.0, // no geometric meaning — weight is always 0
}

/** Base quality ceiling per reference type (cap applied before user-provided data) */
const BASE_QUALITY_CEILING: Record<ReferenceLabel, number> = {
  eye_box:          0.92,
  pedicle_spacing:  0.88,
  eye_to_pedicle:   0.85,
  skull_width:      0.83,
  nose_bridge:      0.68,
  muzzle_width:     0.65,
  ear_base_spacing: 0.60,
  ear_base_to_tip:  0.72, // bonus only when user-confirmed
  statistical_prior: 0.0,
}

/** Minimum weight for a reference to be considered "dominant" */
const DOMINANT_WEIGHT_THRESHOLD = 0.08

/** Agreement tiers → error half-bands (fraction of gross score) */
const AGREEMENT_HALF_BAND: Record<AgreementTier, number> = {
  high:     0.045,  // ±4.5%  → e.g. ±7.4" on a 165" buck
  medium:   0.075,  // ±7.5%  → ±12.4"
  low:      0.120,  // ±12%   → ±19.8"
  fallback: 0.160,  // ±16%   → ±26.4"
}

/** stddev thresholds (in gross-score units) for agreement tier classification */
const SPREAD_THRESHOLDS = {
  high:   5.0,   // < 5" spread → high agreement
  medium: 12.0,  // < 12" spread → medium
  low:    22.0,  // < 22" spread → low
  // >= 22" → fallback
} as const

// ============================================================================
// MAIN ENGINE
// ============================================================================

/**
 * Compute a weighted multi-reference consensus from all available anatomical
 * references in a single scoring pass.
 */
export function computeReferenceConsensus(
  input: ReferenceConsensusInput
): ReferenceConsensusOutput {
  const {
    visionGross,
    visionConfidencePercent,
    landmarks,
    angleTypes,
    earsFullyVisible,
    referenceQualityData = {},
    measurements,
  } = input

  const hasFront = angleTypes.includes('front')
  const rawConf  = visionConfidencePercent / 100

  // ── Step 1 + 2: Build per-reference observations ───────────────────────────
  const observations = buildObservations(
    visionGross,
    landmarks,
    hasFront,
    earsFullyVisible,
    referenceQualityData
  )

  // ── Step 3: Each reference generates its own gross estimate ────────────────
  // The scaling factor encodes how much the vision model's pixel-space estimate
  // should be scaled to align with this reference's real-world anchor.
  // consensusGross from each reference = visionGross * scalingFactor.
  // (scalingFactor is already set in buildObservations)

  // ── Step 4: Weighted average ───────────────────────────────────────────────
  const activeObs = observations.filter(o => o.visibility && o.weight > 0)
  const totalWeight = activeObs.reduce((s, o) => s + o.weight, 0)

  let consensusGross: number
  let consensusConfidence: number

  if (totalWeight < 0.01) {
    // Pure fallback — no usable reference detected
    consensusGross      = visionGross
    consensusConfidence = rawConf * 0.65
  } else {
    consensusGross      = activeObs.reduce((s, o) => s + o.estimatedGross * o.weight, 0) / totalWeight
    // Blend confidence: top-tier references lift it; low total weight deflates it
    const weightedConf  = activeObs.reduce((s, o) => s + (o.quality * (1 - o.distortion)) * o.weight, 0) / totalWeight
    consensusConfidence = Math.min(0.95, rawConf * 0.4 + weightedConf * 0.6)
  }

  // ── Step 5: Agreement detection ────────────────────────────────────────────
  const estimates = activeObs.map(o => o.estimatedGross)
  const { spread, weightedVariance, agreementScore, conflictScore } =
    computeAgreementStats(activeObs, consensusGross)

  // ── Step 6: Range logic ────────────────────────────────────────────────────
  let agreementTier: AgreementTier
  if (totalWeight < 0.01) {
    agreementTier = 'fallback'
  } else if (spread < SPREAD_THRESHOLDS.high && agreementScore >= 0.80) {
    agreementTier = 'high'
  } else if (spread < SPREAD_THRESHOLDS.medium && agreementScore >= 0.60) {
    agreementTier = 'medium'
  } else if (spread < SPREAD_THRESHOLDS.low) {
    agreementTier = 'low'
  } else {
    agreementTier = 'fallback'
  }

  let errorHalfBand = AGREEMENT_HALF_BAND[agreementTier]

  // ── Step 7: Anti-clustering safeguard ─────────────────────────────────────
  // If the overall reference quality is low (fallback/low tier) AND the vision
  // gross is in the clustering band (155–180), inject structural variance from
  // the measurement ratios to widen the range and break false confidence.
  let antiClusteringApplied = false
  const inClusterBand = consensusGross >= 155 && consensusGross <= 180
  if ((agreementTier === 'fallback' || agreementTier === 'low') && inClusterBand) {
    const structuralVariance = computeStructuralVariance(measurements)
    if (structuralVariance > 0.02) {
      errorHalfBand = Math.max(errorHalfBand, errorHalfBand + structuralVariance * 0.5)
      antiClusteringApplied = true
    }
  }

  // ── Step 8: Explanation output ─────────────────────────────────────────────
  const dominantReferences = observations
    .filter(o => o.visibility && o.weight >= DOMINANT_WEIGHT_THRESHOLD)
    .map(o => o.label)

  const ignoredReferences = observations
    .filter(o => o.visibility && o.weight > 0 && o.weight < DOMINANT_WEIGHT_THRESHOLD)
    .map(o => o.label)

  const explanation = buildExplanation({
    activeObs,
    consensusGross,
    visionGross,
    agreementTier,
    spread,
    antiClusteringApplied,
    totalWeight,
    dominantReferences,
    estimates,
  })

  return {
    consensusGross:     Number(consensusGross.toFixed(1)),
    consensusConfidence: Number(consensusConfidence.toFixed(3)),
    estimateSpread:     Number(spread.toFixed(2)),
    weightedVariance:   Number(weightedVariance.toFixed(2)),
    agreementTier,
    errorHalfBand:      Number(errorHalfBand.toFixed(4)),
    antiClusteringApplied,
    dominantReferences,
    ignoredReferences,
    referenceWeights: observations,
    referenceEstimates: observations.map(o => ({
      label: o.label,
      estimatedGross: Number(o.estimatedGross.toFixed(1)),
      weight: Number(o.weight.toFixed(3)),
    })),
    agreementScore:  Number(agreementScore.toFixed(3)),
    conflictScore:   Number(conflictScore.toFixed(3)),
    explanation,
  }
}

// ============================================================================
// STEP 1 + 2: OBSERVATION BUILDER
// ============================================================================

function buildObservations(
  visionGross: number,
  landmarks: LandmarksDetected,
  hasFront: boolean,
  earsFullyVisible: boolean | undefined,
  qualityData: Partial<Record<ReferenceLabel, { quality: number; distortion: number }>>
): ReferenceObservation[] {
  const obs: ReferenceObservation[] = []

  function make(
    label: ReferenceLabel,
    visible: boolean,
    defaultQuality: number,
    defaultDistortion: number,
    scalingFactor: number
  ): ReferenceObservation {
    const qd       = qualityData[label]
    const quality  = Math.min(BASE_QUALITY_CEILING[label], qd?.quality   ?? defaultQuality)
    const distortion = qd?.distortion ?? defaultDistortion
    const weight   = visible ? quality * (1 - distortion) : 0
    return {
      label,
      visibility: visible,
      quality,
      distortion,
      weight,
      scalingFactor,
      estimatedGross: visionGross * scalingFactor,
    }
  }

  // ── Top-tier references ────────────────────────────────────────────────────

  // Eye box — needs eyes visible + front angle
  const eyeBoxVisible = !!(landmarks.eyes_visible && hasFront && landmarks.eye_box_detected)
  const eyeBoxScaling = eyeBoxVisible && landmarks.eye_width
    ? ANATOMICAL_REFERENCES.EYE_BOX_WIDTH / landmarks.eye_width
    : 1.0
  obs.push(make('eye_box', eyeBoxVisible, 0.80, 0.12, eyeBoxScaling))

  // Pedicle / antler base spacing
  const pedicleVisible = !!(landmarks.pedicle_visible && hasFront && landmarks.pedicle_spacing)
  const pedicleScaling = pedicleVisible && landmarks.pedicle_spacing
    ? ANATOMICAL_REFERENCES.PEDICLE_SPACING / landmarks.pedicle_spacing
    : 1.0
  obs.push(make('pedicle_spacing', pedicleVisible, 0.78, 0.10, pedicleScaling))

  // Eye-to-pedicle structural proportion
  const e2pVisible = !!(landmarks.eyes_visible && landmarks.pedicle_visible && landmarks.eye_to_pedicle_distance)
  const e2pScaling = e2pVisible && landmarks.eye_to_pedicle_distance
    ? ANATOMICAL_REFERENCES.EYE_TO_PEDICLE / landmarks.eye_to_pedicle_distance
    : 1.0
  obs.push(make('eye_to_pedicle', e2pVisible, 0.76, 0.10, e2pScaling))

  // Skull / forehead width
  const skullVisible = !!(hasFront && landmarks.skull_width_visible && landmarks.skull_forehead_width)
  const skullScaling = skullVisible && landmarks.skull_forehead_width
    ? ANATOMICAL_REFERENCES.SKULL_FOREHEAD_WIDTH / landmarks.skull_forehead_width
    : 1.0
  obs.push(make('skull_width', skullVisible, 0.74, 0.11, skullScaling))

  // ── Secondary references ───────────────────────────────────────────────────

  // Nose bridge
  const noseVisible = !!(hasFront && landmarks.nose_bridge_length)
  const noseScaling = noseVisible && landmarks.nose_bridge_length
    ? ANATOMICAL_REFERENCES.NOSE_BRIDGE_LENGTH / landmarks.nose_bridge_length
    : 1.0
  obs.push(make('nose_bridge', noseVisible, 0.60, 0.15, noseScaling))

  // Muzzle width
  const muzzleVisible = !!(hasFront && landmarks.muzzle_width)
  const muzzleScaling = muzzleVisible && landmarks.muzzle_width
    ? ANATOMICAL_REFERENCES.MUZZLE_WIDTH / landmarks.muzzle_width
    : 1.0
  obs.push(make('muzzle_width', muzzleVisible, 0.57, 0.16, muzzleScaling))

  // Ear base spacing
  const earBaseVisible = !!(landmarks.ears_visible && hasFront && landmarks.ear_base_spacing)
  const earBaseScaling = earBaseVisible && landmarks.ear_base_spacing
    ? ANATOMICAL_REFERENCES.EAR_BASE_SPACING / landmarks.ear_base_spacing
    : 1.0
  obs.push(make('ear_base_spacing', earBaseVisible, 0.55, 0.13, earBaseScaling))

  // ── Bonus: ear base-to-tip (only when explicitly confirmed) ───────────────
  const earTipVisible = !!(landmarks.ears_visible && earsFullyVisible && landmarks.ear_base_to_tip)
  const earTipScaling = earTipVisible && landmarks.ear_base_to_tip
    ? ANATOMICAL_REFERENCES.EAR_BASE_TO_TIP / landmarks.ear_base_to_tip
    : 1.0
  obs.push(make('ear_base_to_tip', earTipVisible, 0.68, 0.14, earTipScaling))

  // ── Statistical prior — always present, zero weight ───────────────────────
  obs.push({
    label: 'statistical_prior',
    visibility: true,
    quality: 0,
    distortion: 0,
    weight: 0,
    scalingFactor: 1.0,
    estimatedGross: visionGross,
  })

  return obs
}

// ============================================================================
// STEP 5: AGREEMENT STATISTICS
// ============================================================================

function computeAgreementStats(
  activeObs: ReferenceObservation[],
  consensusGross: number
): { spread: number; weightedVariance: number; agreementScore: number; conflictScore: number } {
  if (activeObs.length === 0) {
    return { spread: 0, weightedVariance: 0, agreementScore: 0.5, conflictScore: 0.5 }
  }

  const estimates = activeObs.map(o => o.estimatedGross)
  const mean      = estimates.reduce((a, b) => a + b, 0) / estimates.length

  // Unweighted stddev (spread)
  const variance  = estimates.reduce((s, e) => s + Math.pow(e - mean, 2), 0) / estimates.length
  const spread    = Math.sqrt(variance)

  // Weighted variance
  const totalW    = activeObs.reduce((s, o) => s + o.weight, 0) || 1
  const weightedVariance = activeObs.reduce(
    (s, o) => s + o.weight * Math.pow(o.estimatedGross - consensusGross, 2), 0
  ) / totalW

  // Agreement score: 1 when spread == 0, falls toward 0 as spread → 25"
  const agreementScore = Math.max(0, 1 - spread / 25)
  const conflictScore  = 1 - agreementScore

  return { spread, weightedVariance, agreementScore, conflictScore }
}

// ============================================================================
// STEP 7: STRUCTURAL VARIANCE (anti-clustering)
// ============================================================================

/**
 * Compute structural variance from measurement ratios.
 * Returns a fractional variance value (0–0.15) that is added to the error
 * band when reference quality is too weak to discriminate accurately.
 */
function computeStructuralVariance(measurements?: Partial<Measurements>): number {
  if (!measurements) return 0.04 // default injection when no measurements

  const {
    inside_spread,
    main_beam_left,
    main_beam_right,
    g2_left, g2_right,
    g3_left, g3_right,
  } = measurements

  let variance = 0.0
  let factors  = 0

  // Spread-to-beam ratio: typical mature buck ~0.7–0.85
  if (inside_spread && main_beam_left && main_beam_right) {
    const avgBeam = (main_beam_left + main_beam_right) / 2
    const ratio   = inside_spread / avgBeam
    // Deviation from typical 0.75 midpoint
    variance += Math.abs(ratio - 0.75) * 0.3
    factors++
  }

  // Tine symmetry: high asymmetry → more uncertainty
  if (g2_left && g2_right) {
    const sym = Math.min(g2_left, g2_right) / Math.max(g2_left, g2_right)
    variance += (1 - sym) * 0.08
    factors++
  }
  if (g3_left && g3_right) {
    const sym = Math.min(g3_left, g3_right) / Math.max(g3_left, g3_right)
    variance += (1 - sym) * 0.06
    factors++
  }

  return factors > 0 ? variance / factors : 0.04
}

// ============================================================================
// STEP 8: EXPLANATION BUILDER
// ============================================================================

function buildExplanation(params: {
  activeObs: ReferenceObservation[]
  consensusGross: number
  visionGross: number
  agreementTier: AgreementTier
  spread: number
  antiClusteringApplied: boolean
  totalWeight: number
  dominantReferences: ReferenceLabel[]
  estimates: number[]
}): string[] {
  const {
    activeObs, consensusGross, visionGross, agreementTier,
    spread, antiClusteringApplied, totalWeight, dominantReferences,
  } = params

  const lines: string[] = []

  if (totalWeight < 0.01) {
    lines.push('No anatomical reference detected — statistical prior used for scoring.')
    return lines
  }

  const domLabels = dominantReferences
    .map(l => formatLabel(l))
    .join(', ')

  lines.push(`Reference consensus used ${activeObs.length} reference(s): ${domLabels || 'none dominant'}.`)

  const delta = consensusGross - visionGross
  if (Math.abs(delta) >= 1.0) {
    lines.push(
      `Consensus adjusted gross by ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}" ` +
      `(${visionGross.toFixed(1)}" → ${consensusGross.toFixed(1)}").`
    )
  }

  lines.push(
    `Reference agreement: ${agreementTier} (spread ±${spread.toFixed(1)}"). ` +
    `Error band ${agreementTier === 'high' ? 'tightened' : agreementTier === 'fallback' ? 'widened (weak references)' : 'standard'}.`
  )

  if (antiClusteringApplied) {
    lines.push(
      'Anti-clustering variance injected: weak reference quality detected in 160–180 range — range widened.'
    )
  }

  // List dominant reference weights
  for (const obs of activeObs.filter(o => o.weight >= DOMINANT_WEIGHT_THRESHOLD)) {
    lines.push(
      `  ${formatLabel(obs.label)}: weight ${(obs.weight * 100).toFixed(0)}%, ` +
      `estimate ${obs.estimatedGross.toFixed(1)}", ` +
      `quality ${(obs.quality * 100).toFixed(0)}%, ` +
      `distortion ${(obs.distortion * 100).toFixed(0)}%.`
    )
  }

  return lines
}

function formatLabel(label: ReferenceLabel): string {
  return label.replace(/_/g, ' ')
}

// ============================================================================
// UTILITY: convert consensus output to error band bounds
// ============================================================================

/**
 * Given a consensus result, compute the final low/high error band values.
 * The band is symmetric around consensusGross unless agreement is very high,
 * in which case the low side is slightly tighter (bucks don't shrink as often
 * as they grow from perspective).
 */
export function consensusToErrorBands(
  result: ReferenceConsensusOutput
): { low: number; high: number } {
  const half = result.errorHalfBand * result.consensusGross
  const low  = Number((result.consensusGross - half).toFixed(1))
  const high = Number((result.consensusGross + half).toFixed(1))
  return { low, high }
}
