export interface ParallelFeatureLine {
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface ParallelFeature {
  feature_type: string
  line_a: ParallelFeatureLine
  line_b: ParallelFeatureLine
  /** AI confidence that the two lines are truly parallel in the scene */
  confidence: number
  /** Real-world spacing between the lines, when the feature type implies a known size */
  known_spacing_inches: number | null
}

export interface VanishingPointResult {
  /** Vanishing point pixel coordinates (may lie outside the image) */
  vanishingPoint: { x: number; y: number } | null
  /** Camera tilt in degrees relative to horizontal */
  tiltAngleDeg: number | null
  /** pixelsPerInch derived from known spacing — null if not derivable */
  pixelsPerInch: number | null
  /** Feature type used to derive scale (e.g. "fence_rail") */
  scaleSource: string | null
  /** Overall confidence in this vanishing-point analysis, capped at 0.55 */
  confidence: number
  warnings: string[]
}
