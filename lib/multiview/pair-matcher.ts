/**
 * Phase 49: View-Pair Matching Layer
 * 
 * Computes pairwise view compatibility for multi-image fusion.
 * Does not assume all images belong equally in the solve.
 */

import type { 
  PairMatchInput, 
  PairMatchResult, 
  AngleClass,
  MeasurementFamily 
} from './types'
import type { Measurements, LandmarksDetected } from '@/lib/types'

// ============================================================================
// CONSTANTS
// ============================================================================

const MEASUREMENT_FAMILIES: MeasurementFamily[] = ['spread', 'beam', 'tine', 'mass']

// Minimum thresholds for accepting a pair
const MIN_MATCH_QUALITY = 0.3
const MIN_LANDMARK_OVERLAP = 0.2
const MIN_GEOMETRIC_PLAUSIBILITY = 0.25

// Angle complementarity matrix - how well do angles complement each other?
const ANGLE_COMPLEMENTARITY: Record<AngleClass, Record<AngleClass, number>> = {
  front: { front: 0.3, left: 0.9, right: 0.9, back: 0.5, front_left: 0.7, front_right: 0.7, unknown: 0.3 },
  left: { front: 0.9, left: 0.2, right: 0.8, back: 0.7, front_left: 0.6, front_right: 0.8, unknown: 0.3 },
  right: { front: 0.9, left: 0.8, right: 0.2, back: 0.7, front_left: 0.8, front_right: 0.6, unknown: 0.3 },
  back: { front: 0.5, left: 0.7, right: 0.7, back: 0.2, front_left: 0.5, front_right: 0.5, unknown: 0.3 },
  front_left: { front: 0.7, left: 0.6, right: 0.8, back: 0.5, front_left: 0.3, front_right: 0.7, unknown: 0.3 },
  front_right: { front: 0.7, left: 0.8, right: 0.6, back: 0.5, front_left: 0.7, front_right: 0.3, unknown: 0.3 },
  unknown: { front: 0.3, left: 0.3, right: 0.3, back: 0.3, front_left: 0.3, front_right: 0.3, unknown: 0.1 },
}

// Family preference by angle - which angles are best for which families?
const FAMILY_ANGLE_PREFERENCE: Record<MeasurementFamily, Record<AngleClass, number>> = {
  spread: {
    front: 1.0, front_left: 0.7, front_right: 0.7, left: 0.3, right: 0.3, back: 0.2, unknown: 0.2,
  },
  beam: {
    left: 1.0, right: 1.0, front_left: 0.8, front_right: 0.8, front: 0.4, back: 0.5, unknown: 0.2,
  },
  tine: {
    left: 0.9, right: 0.9, front_left: 0.8, front_right: 0.8, front: 0.7, back: 0.4, unknown: 0.2,
  },
  mass: {
    left: 0.9, right: 0.9, front_left: 0.7, front_right: 0.7, front: 0.5, back: 0.6, unknown: 0.2,
  },
  deduction: {
    left: 0.5, right: 0.5, front_left: 0.5, front_right: 0.5, front: 0.5, back: 0.3, unknown: 0.2,
  },
}

// ============================================================================
// LANDMARK OVERLAP COMPUTATION
// ============================================================================

interface LandmarkKey {
  name: string
  family: MeasurementFamily | 'reference' | 'structural'
}

const LANDMARK_KEYS: LandmarkKey[] = [
  // Spread landmarks
  { name: 'inside_spread_left', family: 'spread' },
  { name: 'inside_spread_right', family: 'spread' },
  { name: 'outside_spread_left', family: 'spread' },
  { name: 'outside_spread_right', family: 'spread' },
  // Beam landmarks
  { name: 'main_beam_left_base', family: 'beam' },
  { name: 'main_beam_left_tip', family: 'beam' },
  { name: 'main_beam_right_base', family: 'beam' },
  { name: 'main_beam_right_tip', family: 'beam' },
  // Tine landmarks
  { name: 'g1_left', family: 'tine' },
  { name: 'g1_right', family: 'tine' },
  { name: 'g2_left', family: 'tine' },
  { name: 'g2_right', family: 'tine' },
  { name: 'g3_left', family: 'tine' },
  { name: 'g3_right', family: 'tine' },
  { name: 'g4_left', family: 'tine' },
  { name: 'g4_right', family: 'tine' },
  // Mass landmarks
  { name: 'h1_left', family: 'mass' },
  { name: 'h1_right', family: 'mass' },
  { name: 'h2_left', family: 'mass' },
  { name: 'h2_right', family: 'mass' },
  // Reference landmarks
  { name: 'ear_tip_left', family: 'reference' },
  { name: 'ear_tip_right', family: 'reference' },
  { name: 'ear_base_left', family: 'reference' },
  { name: 'ear_base_right', family: 'reference' },
  // Structural landmarks
  { name: 'skull_top', family: 'structural' },
  { name: 'burr_left', family: 'structural' },
  { name: 'burr_right', family: 'structural' },
]

/**
 * Compute landmark overlap between two views
 */
function computeLandmarkOverlap(
  landmarksA: LandmarksDetected,
  landmarksB: LandmarksDetected
): { overlap: number; perFamily: Record<MeasurementFamily, number> } {
  const detectedA = new Set<string>()
  const detectedB = new Set<string>()

  // Extract detected landmarks from each view
  for (const key of LANDMARK_KEYS) {
    const valueA = (landmarksA as unknown as Record<string, unknown>)[key.name]
    const valueB = (landmarksB as unknown as Record<string, unknown>)[key.name]
    
    if (valueA !== null && valueA !== undefined) {
      detectedA.add(key.name)
    }
    if (valueB !== null && valueB !== undefined) {
      detectedB.add(key.name)
    }
  }

  // Compute intersection
  const intersection = [...detectedA].filter(k => detectedB.has(k))
  const union = new Set([...detectedA, ...detectedB])

  const overlap = union.size > 0 ? intersection.length / union.size : 0

  // Per-family overlap
  const perFamily: Record<MeasurementFamily, number> = { spread: 0, beam: 0, tine: 0, mass: 0, deduction: 0 }
  
  for (const family of MEASUREMENT_FAMILIES) {
    const familyKeys = LANDMARK_KEYS.filter(k => k.family === family)
    const familyA = familyKeys.filter(k => detectedA.has(k.name))
    const familyB = familyKeys.filter(k => detectedB.has(k.name))
    const familyIntersection = familyA.filter(k => detectedB.has(k.name))
    const familyUnion = new Set([...familyA.map(k => k.name), ...familyB.map(k => k.name)])
    perFamily[family] = familyUnion.size > 0 ? familyIntersection.length / familyUnion.size : 0
  }

  return { overlap, perFamily }
}

// ============================================================================
// REFERENCE COMPATIBILITY
// ============================================================================

/**
 * Compute reference compatibility between two views
 */
function computeReferenceCompatibility(
  viewA: PairMatchInput['viewA'],
  viewB: PairMatchInput['viewB']
): number {
  const qualityA = viewA.referenceQuality
  const qualityB = viewB.referenceQuality

  // If both have strong references, high compatibility
  if (qualityA >= 0.7 && qualityB >= 0.7) {
    return 1.0
  }

  // If one has strong and one has moderate, good compatibility
  if ((qualityA >= 0.7 && qualityB >= 0.4) || (qualityB >= 0.7 && qualityA >= 0.4)) {
    return 0.8
  }

  // If both have moderate references
  if (qualityA >= 0.4 && qualityB >= 0.4) {
    return 0.6
  }

  // If one has weak reference
  if (qualityA < 0.3 || qualityB < 0.3) {
    return 0.3
  }

  return 0.5
}

// ============================================================================
// GEOMETRIC PLAUSIBILITY
// ============================================================================

/**
 * Compute geometric plausibility between two views
 * Checks if measurements from both views are structurally consistent
 */
function computeGeometricPlausibility(
  measurementsA: Partial<Measurements>,
  measurementsB: Partial<Measurements>,
  angleA: AngleClass,
  angleB: AngleClass
): { plausibility: number; inliers: number; outliers: number } {
  const comparisons: { family: MeasurementFamily; isInlier: boolean; deviation: number }[] = []

  // Compare spread
  if (measurementsA.inside_spread !== null && measurementsB.inside_spread !== null &&
      measurementsA.inside_spread !== undefined && measurementsB.inside_spread !== undefined) {
    const deviation = Math.abs(measurementsA.inside_spread - measurementsB.inside_spread)
    // Spread tolerance depends on angle - frontal views should agree more closely
    const tolerance = (angleA === 'front' || angleB === 'front') ? 2.0 : 4.0
    comparisons.push({
      family: 'spread',
      isInlier: deviation <= tolerance,
      deviation,
    })
  }

  // Compare beam lengths (average of left and right)
  const beamA = computeAverageBeam(measurementsA)
  const beamB = computeAverageBeam(measurementsB)
  if (beamA !== null && beamB !== null) {
    const deviation = Math.abs(beamA - beamB)
    const tolerance = 3.0
    comparisons.push({
      family: 'beam',
      isInlier: deviation <= tolerance,
      deviation,
    })
  }

  // Compare tine totals
  const tineA = computeTineTotal(measurementsA)
  const tineB = computeTineTotal(measurementsB)
  if (tineA !== null && tineB !== null) {
    const deviation = Math.abs(tineA - tineB)
    const tolerance = 4.0
    comparisons.push({
      family: 'tine',
      isInlier: deviation <= tolerance,
      deviation,
    })
  }

  // Compare mass totals
  const massA = computeMassTotal(measurementsA)
  const massB = computeMassTotal(measurementsB)
  if (massA !== null && massB !== null) {
    const deviation = Math.abs(massA - massB)
    const tolerance = 2.0
    comparisons.push({
      family: 'mass',
      isInlier: deviation <= tolerance,
      deviation,
    })
  }

  if (comparisons.length === 0) {
    return { plausibility: 0.5, inliers: 0, outliers: 0 }
  }

  const inliers = comparisons.filter(c => c.isInlier).length
  const outliers = comparisons.filter(c => !c.isInlier).length
  const plausibility = inliers / comparisons.length

  return { plausibility, inliers, outliers }
}

function computeAverageBeam(m: Partial<Measurements>): number | null {
  const left = m.main_beam_left
  const right = m.main_beam_right
  if (left !== null && left !== undefined && right !== null && right !== undefined) {
    return (left + right) / 2
  }
  if (left !== null && left !== undefined) return left
  if (right !== null && right !== undefined) return right
  return null
}

function computeTineTotal(m: Partial<Measurements>): number | null {
  const tines = [m.g1_left, m.g1_right, m.g2_left, m.g2_right, m.g3_left, m.g3_right, m.g4_left, m.g4_right]
  const valid = tines.filter((t): t is number => t !== null && t !== undefined)
  return valid.length >= 4 ? valid.reduce((a, b) => a + b, 0) : null
}

function computeMassTotal(m: Partial<Measurements>): number | null {
  const masses = [m.h1_left, m.h1_right, m.h2_left, m.h2_right, m.h3_left, m.h3_right, m.h4_left, m.h4_right]
  const valid = masses.filter((t): t is number => t !== null && t !== undefined)
  return valid.length >= 4 ? valid.reduce((a, b) => a + b, 0) : null
}

// ============================================================================
// FAMILY AGREEMENT
// ============================================================================

/**
 * Compute per-family agreement between two views
 */
function computeFamilyAgreement(
  measurementsA: Partial<Measurements>,
  measurementsB: Partial<Measurements>
): Record<MeasurementFamily, number> {
  const agreement: Record<MeasurementFamily, number> = { spread: 0, beam: 0, tine: 0, mass: 0, deduction: 0 }

  // Spread agreement
  if (measurementsA.inside_spread !== null && measurementsA.inside_spread !== undefined &&
      measurementsB.inside_spread !== null && measurementsB.inside_spread !== undefined) {
    const deviation = Math.abs(measurementsA.inside_spread - measurementsB.inside_spread)
    agreement.spread = Math.max(0, 1 - deviation / 6) // 6" deviation = 0 agreement
  }

  // Beam agreement
  const beamA = computeAverageBeam(measurementsA)
  const beamB = computeAverageBeam(measurementsB)
  if (beamA !== null && beamB !== null) {
    const deviation = Math.abs(beamA - beamB)
    agreement.beam = Math.max(0, 1 - deviation / 5)
  }

  // Tine agreement
  const tineA = computeTineTotal(measurementsA)
  const tineB = computeTineTotal(measurementsB)
  if (tineA !== null && tineB !== null) {
    const deviation = Math.abs(tineA - tineB)
    agreement.tine = Math.max(0, 1 - deviation / 8)
  }

  // Mass agreement
  const massA = computeMassTotal(measurementsA)
  const massB = computeMassTotal(measurementsB)
  if (massA !== null && massB !== null) {
    const deviation = Math.abs(massA - massB)
    agreement.mass = Math.max(0, 1 - deviation / 4)
  }

  return agreement
}

// ============================================================================
// MAIN PAIR MATCHING FUNCTION
// ============================================================================

/**
 * Match a pair of views and compute compatibility metrics
 */
export function matchViewPair(input: PairMatchInput): PairMatchResult {
  const { viewA, viewB } = input

  // 1. Compute angle complementarity
  const angleComplementarity = ANGLE_COMPLEMENTARITY[viewA.angleClass][viewB.angleClass]

  // 2. Compute landmark overlap
  const { overlap: landmarkOverlap, perFamily: landmarkOverlapPerFamily } = 
    computeLandmarkOverlap(viewA.landmarks, viewB.landmarks)

  // 3. Compute reference compatibility
  const referenceCompatibility = computeReferenceCompatibility(viewA, viewB)

  // 4. Compute geometric plausibility
  const { plausibility: geometricPlausibility, inliers: inlierCount, outliers: outlierCount } = 
    computeGeometricPlausibility(viewA.measurements, viewB.measurements, viewA.angleClass, viewB.angleClass)

  // 5. Compute per-family agreement
  const familyAgreement = computeFamilyAgreement(viewA.measurements, viewB.measurements)

  // 6. Compute overall match quality
  const matchQuality = (
    angleComplementarity * 0.2 +
    landmarkOverlap * 0.2 +
    referenceCompatibility * 0.2 +
    geometricPlausibility * 0.4
  )

  // 7. Determine if usable for fusion
  let isUsableForFusion = true
  let rejectionReason: string | null = null

  if (matchQuality < MIN_MATCH_QUALITY) {
    isUsableForFusion = false
    rejectionReason = `Match quality ${matchQuality.toFixed(2)} below threshold ${MIN_MATCH_QUALITY}`
  } else if (landmarkOverlap < MIN_LANDMARK_OVERLAP) {
    isUsableForFusion = false
    rejectionReason = `Landmark overlap ${landmarkOverlap.toFixed(2)} below threshold ${MIN_LANDMARK_OVERLAP}`
  } else if (geometricPlausibility < MIN_GEOMETRIC_PLAUSIBILITY) {
    isUsableForFusion = false
    rejectionReason = `Geometric plausibility ${geometricPlausibility.toFixed(2)} below threshold ${MIN_GEOMETRIC_PLAUSIBILITY}`
  }

  return {
    matchQuality,
    landmarkOverlap,
    referenceCompatibility,
    angleComplementarity,
    geometricPlausibility,
    familyAgreement,
    inlierCount,
    outlierCount,
    isUsableForFusion,
    rejectionReason,
  }
}

/**
 * Score all pairs in a multi-view set
 */
export function scoreAllPairs(
  views: Array<{
    imageIndex: number
    angleClass: AngleClass
    landmarks: LandmarksDetected
    measurements: Partial<Measurements>
    referenceQuality: number
  }>
): Array<{
  viewAIndex: number
  viewBIndex: number
  result: PairMatchResult
}> {
  const results: Array<{
    viewAIndex: number
    viewBIndex: number
    result: PairMatchResult
  }> = []

  // Score all unique pairs
  for (let i = 0; i < views.length; i++) {
    for (let j = i + 1; j < views.length; j++) {
      const result = matchViewPair({
        viewA: views[i],
        viewB: views[j],
      })
      results.push({
        viewAIndex: i,
        viewBIndex: j,
        result,
      })
    }
  }

  return results
}

/**
 * Get the best angle preference score for a family given available angles
 */
export function getFamilyAnglePreference(family: MeasurementFamily, angleClass: AngleClass): number {
  return FAMILY_ANGLE_PREFERENCE[family][angleClass]
}
