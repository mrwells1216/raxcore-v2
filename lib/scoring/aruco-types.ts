/**
 * ArUco marker calibration types.
 *
 * The user prints a free marker from arucogen.com, places it near the antler
 * (preferably on the same depth plane), and the GPT-4o detector returns the
 * marker's four corner pixel coordinates. We derive pixelsPerInch from the
 * average pixel side length divided by the user-supplied physical side length.
 *
 * Slot 3 in the §8 calibration hierarchy (confidence 0.55–0.72 depending on
 * perspective skew). Never unlocks Verified Score on its own.
 */

export interface ArucoCornerPx {
  x: number
  y: number
}

export interface ArucoDetection {
  /** Optional marker id if detectable; useful for debugging only. */
  markerId: number | null
  /** Four corner pixel coordinates in clockwise order starting top-left. */
  corners: [ArucoCornerPx, ArucoCornerPx, ArucoCornerPx, ArucoCornerPx]
  /** Average side length in pixels across the four edges. */
  avgSidePx: number
  /** Cosine of estimated perspective tilt, 0..1. 1.0 = orthogonal to camera. */
  cosTilt: number
  /** Best-effort image source URL the marker was detected on. */
  imageUrl: string
  /** Image index in the submission set. */
  imageIndex: number
  /** GPT-4o's self-reported confidence in the detection, 0..1. */
  confidence: number
  /** Any per-detection warnings (degenerate quadrilateral, etc.). */
  warnings: string[]
}

/**
 * What the user supplies alongside `reference_type: 'aruco_marker'`. The side
 * length is the printed physical edge in inches (default 2.0" per arucogen
 * defaults).
 */
export interface ArucoInput {
  /** Printed marker side length in inches. Clamped to [0.5, 12.0] server-side. */
  knownSideInches: number
}

export const ARUCO_SIDE_MIN_INCHES = 0.5
export const ARUCO_SIDE_MAX_INCHES = 12.0
