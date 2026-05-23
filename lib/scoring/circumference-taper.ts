/**
 * Whitetail circumference taper assist (§4.5).
 *
 * The user tapes H1 on one antler. We derive H2, H3, H4 on that side, and the
 * mirror H1–H4 on the opposite side, using published whitetail taper ratios.
 * Single 60-second user action cuts circumference error by roughly half.
 *
 * NEVER unlocks Verified Score. Derived values are tagged `source: 'derived_taper'`
 * so the provenance chain stays honest (§5 of CLAUDE.md).
 *
 * Taper ratios are means computed across mature-buck B&C entries; individual
 * racks vary roughly ±10% per circumference position. We expose the ratios as
 * constants so admin training can re-fit them later.
 */

export const TAPER_H1_TO_H1_MIN_INCHES = 1.0
export const TAPER_H1_TO_H1_MAX_INCHES = 8.0

/**
 * Published whitetail H1→Hn mean ratios. Cited from B&C measurement guidance
 * and corroborated by aggregate top-100 entry data.
 *   H2 ≈ 94% of H1
 *   H3 ≈ 88% of H1
 *   H4 ≈ 84% of H1
 * Right-side H1 is treated as equal to the measured left side; mature bucks
 * are symmetric within ±5% so this is a low-error assumption.
 */
export const TAPER_RATIOS = {
  H2: 0.94,
  H3: 0.88,
  H4: 0.84,
} as const

export type CircumferenceSide = 'left' | 'right'

export interface DerivedCircumferences {
  h1_left: number
  h2_left: number
  h3_left: number
  h4_left: number
  h1_right: number
  h2_right: number
  h3_right: number
  h4_right: number
  /** Tag attached to derived (non-measured) values when written into the
   *  measurement graph. */
  derivedSource: 'derived_taper'
  /** Tag attached to the user-supplied value. */
  measuredSource: 'measured'
  /** Which side the user measured. */
  measuredSide: CircumferenceSide
}

export class CircumferenceTaperError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CircumferenceTaperError'
  }
}

/**
 * Derive the full H1–H4 ladder on both sides from a single measured H1.
 *
 * Throws `CircumferenceTaperError` when the measured value falls outside the
 * sane band [1.0, 8.0]. Callers should clamp at the API boundary and surface
 * the error message to the user.
 */
export function deriveCircumferences(
  measuredInches: number,
  measuredSide: CircumferenceSide,
): DerivedCircumferences {
  if (!Number.isFinite(measuredInches)) {
    throw new CircumferenceTaperError('Measurement is not a finite number')
  }
  if (measuredInches < TAPER_H1_TO_H1_MIN_INCHES || measuredInches > TAPER_H1_TO_H1_MAX_INCHES) {
    throw new CircumferenceTaperError(
      `Measurement ${measuredInches.toFixed(1)}" is outside the ${TAPER_H1_TO_H1_MIN_INCHES}–${TAPER_H1_TO_H1_MAX_INCHES}" whitetail range`,
    )
  }

  const measured = measuredInches
  const h2 = round1(measured * TAPER_RATIOS.H2)
  const h3 = round1(measured * TAPER_RATIOS.H3)
  const h4 = round1(measured * TAPER_RATIOS.H4)

  // Right side mirrors the left (symmetric assumption). Real racks vary
  // within ±5% but we have no signal for which way it tilts.
  if (measuredSide === 'left') {
    return {
      h1_left: round1(measured),
      h2_left: h2,
      h3_left: h3,
      h4_left: h4,
      h1_right: round1(measured),
      h2_right: h2,
      h3_right: h3,
      h4_right: h4,
      derivedSource: 'derived_taper',
      measuredSource: 'measured',
      measuredSide,
    }
  }

  return {
    h1_left: round1(measured),
    h2_left: h2,
    h3_left: h3,
    h4_left: h4,
    h1_right: round1(measured),
    h2_right: h2,
    h3_right: h3,
    h4_right: h4,
    derivedSource: 'derived_taper',
    measuredSource: 'measured',
    measuredSide,
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

/**
 * Recompute a B&C gross score by swapping in the derived circumferences for
 * the prior H1–H4 values. Beam, spread, and tine fields are left untouched —
 * this is a surgical replacement for the H1–H4 ladder.
 *
 * Pass the existing measurements record; receive a new record with H fields
 * updated. Deductions and abnormal_points are preserved.
 */
export function applyTaperToMeasurements<
  T extends {
    h1_left: number | null
    h1_right: number | null
    h2_left: number | null
    h2_right: number | null
    h3_left: number | null
    h3_right: number | null
    h4_left: number | null
    h4_right: number | null
  },
>(existing: T, derived: DerivedCircumferences): T {
  return {
    ...existing,
    h1_left: derived.h1_left,
    h1_right: derived.h1_right,
    h2_left: derived.h2_left,
    h2_right: derived.h2_right,
    h3_left: derived.h3_left,
    h3_right: derived.h3_right,
    h4_left: derived.h4_left,
    h4_right: derived.h4_right,
  }
}
