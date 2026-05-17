/**
 * Published B&C circumference taper ratios for typical whitetail.
 *
 * H1 is the smallest circumference between the burr and G1 (reference).
 * H2 is widest (between G1 and G2). H3 is between G2 and G3. H4 tapers
 * toward the beam tip. These ratios are anchored to H1 = 1.000 so the
 * other three are derived by simple multiplication.
 *
 * Source: B&C scoring methodology + published whitetail beam-taper
 * studies. They are approximations — they describe the AVERAGE rack
 * and should be tagged `derived_taper` (never `measured`) whenever
 * they are used as a substitute for a real tape measurement.
 */
export const WHITETAIL_TAPER_RATIOS = {
  h1: 1.000,
  h2: 1.150,
  h3: 1.045,
  h4: 0.895,
} as const

/**
 * Confidence when deriving from H1 alone — drops one step per H index
 * away from the anchor.
 */
export const TAPER_CONFIDENCE_FROM_H1: Record<'h1' | 'h2' | 'h3' | 'h4', number> = {
  h1: 1.00,
  h2: 0.72,
  h3: 0.65,
  h4: 0.58,
}

/**
 * Confidence boost when two anchors (H1 + H2) are known. The H1→H2
 * slope is real, so H3/H4 extrapolations tighten.
 */
export const TAPER_CONFIDENCE_FROM_H1_H2: Record<'h1' | 'h2' | 'h3' | 'h4', number> = {
  h1: 1.00,
  h2: 1.00,
  h3: 0.80,
  h4: 0.70,
}

/** Avg left/right symmetry ratio when only one side measured. */
export const DEFAULT_SYMMETRY_RATIO = 1.00

/** Sanity bounds for ANY user-entered circumference (inches). */
export const CIRCUMFERENCE_PLAUSIBLE_RANGE = { min: 2.5, max: 8.0 }
/** Tighter range for H1 specifically (typical whitetail). */
export const H1_TYPICAL_RANGE = { min: 3.0, max: 6.5 }

export type CircumferenceField = 'h1' | 'h2' | 'h3' | 'h4'
export type CircumferenceSide = 'left' | 'right'

export interface DerivedCircumference {
  field: CircumferenceField
  side: CircumferenceSide
  valueInches: number
  /** 'measured' when the user supplied the value directly, otherwise 'derived_taper'. */
  source: 'measured' | 'derived_taper'
  /** 0..1 — 1.00 only for fields the user actually measured. */
  confidence: number
}

export interface DeriveResult {
  values: DerivedCircumference[]
  warnings: string[]
}

function isFiniteInches(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0
}

/**
 * Derive all 8 H-fields from the user's H1 measurement(s).
 *
 * - h1Right is optional. When omitted, the right side mirrors the left
 *   via DEFAULT_SYMMETRY_RATIO and inherits the same per-field confidence.
 * - h2/h3/h4 on each side are computed via WHITETAIL_TAPER_RATIOS and
 *   tagged `derived_taper` with TAPER_CONFIDENCE_FROM_H1 confidence.
 */
export function deriveCircumferencesFromH1(
  h1LeftInches: number,
  h1RightInches?: number,
): DeriveResult {
  const warnings: string[] = []
  const values: DerivedCircumference[] = []

  if (!isFiniteInches(h1LeftInches)) {
    return { values, warnings: ['H1 left must be a positive number'] }
  }
  const h1L = h1LeftInches
  const h1R = isFiniteInches(h1RightInches) ? h1RightInches : h1L * DEFAULT_SYMMETRY_RATIO

  if (!isFiniteInches(h1RightInches)) {
    warnings.push('H1 right inferred from H1 left via symmetry (1.00× ratio)')
  }

  const sides: Array<{ side: CircumferenceSide; h1: number; rightInferred: boolean }> = [
    { side: 'left', h1: h1L, rightInferred: false },
    { side: 'right', h1: h1R, rightInferred: !isFiniteInches(h1RightInches) },
  ]

  for (const { side, h1, rightInferred } of sides) {
    for (const field of ['h1', 'h2', 'h3', 'h4'] as const) {
      const ratio = WHITETAIL_TAPER_RATIOS[field]
      const value = h1 * ratio
      const isUserMeasured = field === 'h1' && !rightInferred
      values.push({
        field,
        side,
        valueInches: round2(value),
        source: isUserMeasured ? 'measured' : 'derived_taper',
        confidence: isUserMeasured
          ? TAPER_CONFIDENCE_FROM_H1.h1
          // Right-side H1 inferred from left gets a one-step penalty too
          : rightInferred && field === 'h1'
            ? TAPER_CONFIDENCE_FROM_H1.h2
            : TAPER_CONFIDENCE_FROM_H1[field],
      })
    }
  }

  return { values, warnings }
}

/**
 * Two-anchor derivation: fit an exponential through H1 and H2, then
 * extrapolate H3 and H4. Falls back to deriveCircumferencesFromH1 when
 * H2 is missing.
 */
export function deriveCircumferencesFromH1H2(
  h1LeftInches: number,
  h2LeftInches: number,
  h1RightInches?: number,
  h2RightInches?: number,
): DeriveResult {
  if (!isFiniteInches(h1LeftInches) || !isFiniteInches(h2LeftInches)) {
    return deriveCircumferencesFromH1(h1LeftInches, h1RightInches)
  }

  const warnings: string[] = []
  const values: DerivedCircumference[] = []

  function deriveOneSide(
    side: CircumferenceSide,
    h1: number,
    h2: number,
    h1Measured: boolean,
    h2Measured: boolean,
  ) {
    // Exponential through two points (x = 1, 2): y = h1 * k^(x-1) where k = h2/h1
    if (h1 <= 0 || h2 <= 0) return
    const k = h2 / h1
    if (!Number.isFinite(k) || k <= 0) return

    const projections = {
      h1,
      h2,
      h3: h1 * Math.pow(k, 2),
      h4: h1 * Math.pow(k, 3),
    }

    for (const field of ['h1', 'h2', 'h3', 'h4'] as const) {
      const userMeasured =
        (field === 'h1' && h1Measured) || (field === 'h2' && h2Measured)
      values.push({
        field,
        side,
        valueInches: round2(projections[field]),
        source: userMeasured ? 'measured' : 'derived_taper',
        confidence: userMeasured ? 1.0 : TAPER_CONFIDENCE_FROM_H1_H2[field],
      })
    }
  }

  deriveOneSide('left', h1LeftInches, h2LeftInches, true, true)

  const h1R = isFiniteInches(h1RightInches) ? h1RightInches : h1LeftInches
  const h2R = isFiniteInches(h2RightInches) ? h2RightInches : h2LeftInches
  if (!isFiniteInches(h1RightInches) || !isFiniteInches(h2RightInches)) {
    warnings.push('Right-side circumferences inferred from left via symmetry')
  }
  deriveOneSide(
    'right',
    h1R,
    h2R,
    isFiniteInches(h1RightInches),
    isFiniteInches(h2RightInches),
  )

  return { values, warnings }
}

/**
 * Validate one user-entered circumference. Returns a warning string
 * if the value looks implausible, otherwise null.
 */
export function validateCircumferenceEntry(
  field: CircumferenceField,
  valueInches: number,
  otherKnownValues?: Partial<Record<CircumferenceField, number>>,
): string | null {
  if (!isFiniteInches(valueInches)) {
    return `${field.toUpperCase()} must be a positive number of inches`
  }
  const range = field === 'h1' ? H1_TYPICAL_RANGE : CIRCUMFERENCE_PLAUSIBLE_RANGE
  if (valueInches < range.min || valueInches > range.max) {
    return `${field.toUpperCase()} of ${valueInches}" is outside the typical range (${range.min}–${range.max}")`
  }

  if (field === 'h1' && otherKnownValues) {
    for (const other of ['h2', 'h3', 'h4'] as const) {
      const v = otherKnownValues[other]
      if (isFiniteInches(v) && v < valueInches) {
        return `H1 should be the smallest circumference but is larger than ${other.toUpperCase()} (${v}") — did you measure at the right location?`
      }
    }
  }
  return null
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Sum the gross-score contribution of all 8 H-fields from a derive
 * result (each side, h1..h4). Returns null if the result is empty.
 */
export function sumCircumferenceContribution(values: DerivedCircumference[]): number | null {
  if (values.length === 0) return null
  return round2(values.reduce((s, v) => s + v.valueInches, 0))
}
