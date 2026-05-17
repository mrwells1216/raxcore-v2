/** Every scoreable antler landmark that can be located in a photo */
export type AntlerLandmarkId =
  // Skull references
  | 'eye_left' | 'eye_right'
  | 'pedicle_left' | 'pedicle_right'
  | 'nose_tip' | 'nose_bridge_top'
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

  // ── Eye circle fields (only populated for eye_left / eye_right) ──
  /** Radius of the visible iris circle in pixels, null if not estimated */
  radiusPx?: number | null
  /** Longer radius when iris appears elliptical (side profile); same as radiusPx for circular eyes */
  radiusMajorPx?: number | null
  /** True when the iris appears elliptical (side profile angle) */
  isElliptical?: boolean
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

export const LANDMARK_ZONE_COLORS: Record<string, string> = {
  skull:         '#9ca3af',
  beam:          '#3b82f6',
  tine:          '#f59e0b',
  circumference: '#ef4444',
  spread:        '#22c55e',
}

export function getLandmarkZone(id: AntlerLandmarkId): keyof typeof LANDMARK_ZONE_COLORS {
  if (id.startsWith('eye_') || id.startsWith('pedicle_') || id.startsWith('nose_')) return 'skull'
  if (id.startsWith('burr_') || id.startsWith('beam_')) return 'beam'
  if (id.startsWith('g')) return 'tine'
  if (id.startsWith('h')) return 'circumference'
  if (id.startsWith('spread_')) return 'spread'
  return 'skull'
}
