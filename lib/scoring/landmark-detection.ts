/** Every scoreable antler landmark that can be located in a photo */
export type AntlerLandmarkId =
  // Skull references
  | 'eye_left' | 'eye_right'
  | 'pedicle_left' | 'pedicle_right'
  | 'nose_tip' | 'nose_bridge_top'
  // Ear references — ear_base_* is skull-fixed, ear_tip_* is mobile
  | 'ear_base_left' | 'ear_base_right'
  | 'ear_tip_left'  | 'ear_tip_right'
  // Beam landmarks
  | 'burr_left' | 'burr_right'
  | 'beam_tip_left' | 'beam_tip_right'
  // Spread
  | 'spread_anchor_left' | 'spread_anchor_right'
  // Tines (base + tip per tine per side)
  | 'g1_base_left' | 'g1_tip_left'
  | 'g2_base_left' | 'g2_tip_left'
  | 'g3_base_left' | 'g3_tip_left'
  | 'g4_base_left' | 'g4_tip_left'
  | 'g5_base_left' | 'g5_tip_left'
  | 'g1_base_right' | 'g1_tip_right'
  | 'g2_base_right' | 'g2_tip_right'
  | 'g3_base_right' | 'g3_tip_right'
  | 'g4_base_right' | 'g4_tip_right'
  | 'g5_base_right' | 'g5_tip_right'
  // Circumference positions (center of the measurement plane)
  | 'h1_center_left' | 'h1_center_right'
  | 'h2_center_left' | 'h2_center_right'
  | 'h3_center_left' | 'h3_center_right'
  | 'h4_center_left' | 'h4_center_right'

export interface LandmarkDetection {
  id: AntlerLandmarkId
  /** Pixel X coordinate (0 = left edge of image) */
  px: number | null
  /** Pixel Y coordinate (0 = top edge of image) */
  py: number | null
  /** AI's confidence in this detection, 0..1 */
  confidence: number
  visibility: 'clear' | 'partially_visible' | 'occluded' | 'not_visible'
  sourceAngle: 'front' | 'left' | 'right' | 'unknown'
  /** 'ai' for initial detection, 'human' after user drag-to-correct */
  source: 'ai' | 'human'
}

export interface LandmarkDetectionResult {
  landmarks: LandmarkDetection[]
  imageWidth: number
  imageHeight: number
  modelUsed: string
  detectionTimestamp: string
  locatedCount: number
  requestedCount: number
}

/**
 * Eye iris radii observed in a single image (in pixels). Used by the
 * eye-circle anatomical calibration source. Either side may be null when the
 * iris is partly occluded, only the pupil is visible, or the eye is closed.
 */
export interface EyeCircleObservation {
  /** Pixel radius of the left-side iris when distinguishable, else null. */
  leftRadiusPx: number | null
  /** Pixel radius of the right-side iris when distinguishable, else null. */
  rightRadiusPx: number | null
}

/** Background parallel-line pair (vanishing-point cross-check, §4.7). */
export interface ParallelLinePairObservation {
  label?: string
  line1: [{ x: number; y: number }, { x: number; y: number }]
  line2: [{ x: number; y: number }, { x: number; y: number }]
}

/**
 * Result of running landmark detection on a single image.
 * Used by detectLandmarkPositionsPerImage to keep per-image observations
 * unambiguous (no risk of the model mixing up which image is which).
 */
export interface PerImageLandmarkResult {
  imageIndex: number
  imageUrl: string
  angleType: 'front' | 'left' | 'right' | 'unknown'
  landmarks: LandmarkDetection[]
  imageWidth: number
  imageHeight: number
  modelUsed: string
  detectionTimestamp: string
  locatedCount: number
  requestedCount: number
  /** Iris radii observed by the same per-image call. Eye-circle calibration
   * (§4.3) uses this alongside the canonical IRIS_RADIUS constant. */
  eyeCircles?: EyeCircleObservation
  /** Optional background parallel-line pairs (§4.7) for vanishing-point
   *  perspective cross-check. Absent ⇒ no VP analysis on this image. */
  parallelLinePairs?: ParallelLinePairObservation[]
  /** When the per-image call failed but the run continued. */
  failed?: boolean
  /** Free-text reason when failed === true. */
  failureReason?: string
}

export const LANDMARK_ZONE_COLORS: Record<string, string> = {
  skull:         '#9ca3af',
  beam:          '#3b82f6',
  tine:          '#f59e0b',
  circumference: '#ef4444',
  spread:        '#22c55e',
}

export function getLandmarkZone(id: AntlerLandmarkId): keyof typeof LANDMARK_ZONE_COLORS {
  if (id.startsWith('eye_') || id.startsWith('pedicle_') || id.startsWith('nose_') || id.startsWith('ear_')) return 'skull'
  if (id.startsWith('burr_') || id.startsWith('beam_')) return 'beam'
  if (id.startsWith('g')) return 'tine'
  if (id.startsWith('h')) return 'circumference'
  if (id.startsWith('spread_')) return 'spread'
  return 'skull'
}
