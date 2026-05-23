/**
 * §4.7 Vanishing-point types.
 *
 * Two background line pairs (fence rails, truck bed, barn boards, road
 * markings) drawn by the LLM landmark detector are used to compute the
 * camera's perspective tilt. The vanishing-point intersection of each pair,
 * fused across pairs, gives a tilt angle that we can compare against the
 * resolved primary calibration source.
 *
 * The standalone PPI derivation is only meaningful when the user identified
 * a known-length object along one of the line pairs (rare). The primary
 * value of this module is the **disagreement warning** surfaced when the
 * primary calibration source implies a perspective much milder than the
 * vanishing point says is actually present (per CLAUDE.md §4.7).
 */

export interface Point2D {
  x: number
  y: number
}

/**
 * A pair of pixel line segments the model believes are parallel in 3D.
 * Each segment is two endpoints; the pair intersects at the vanishing
 * point in the image plane.
 */
export interface ParallelLinePair {
  /** Optional label so the UI can say e.g. "fence rail" rather than "Pair 1". */
  label?: string
  /** First line segment: two endpoints. */
  line1: [Point2D, Point2D]
  /** Second line segment: two endpoints. */
  line2: [Point2D, Point2D]
}

/**
 * Output of `analyzeVanishingPoint`. `severity` is the qualitative bucket
 * the resolver uses to decide whether to surface a warning vs critical
 * warning per CLAUDE.md §4.7 risk register.
 */
export interface VanishingPointResult {
  /** Image-space vanishing point fused across all line pairs, or null if
   *  the model returned ≤1 pair or all pairs were degenerate. */
  vanishingPoint: Point2D | null
  /** Tilt angle in degrees from the image normal (perpendicular to the
   *  camera axis). 0° = perfectly orthogonal view; higher = more skewed. */
  tiltDegrees: number
  /** Qualitative severity bucket for surfacing in the UI. */
  severity: 'orthogonal' | 'mild' | 'moderate' | 'severe'
  /** How many parallel-line pairs survived the parsing + math. */
  contributingPairsCount: number
  /** Diagnostic notes; non-empty when something looked off. */
  warnings: string[]
}

export const VANISHING_POINT_TILT_BANDS = {
  /** ≤ 5° — basically orthogonal. */
  orthogonalMax: 5,
  /** ≤ 15° — mild perspective. */
  mildMax: 15,
  /** ≤ 30° — moderate perspective, expect ~10–20% measurement bias. */
  moderateMax: 30,
  /** > 30° — severe perspective. */
} as const

export const PERSPECTIVE_DISAGREEMENT_WARN_PCT = 0.35
export const PERSPECTIVE_DISAGREEMENT_CRIT_PCT = 0.50
