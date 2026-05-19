/**
 * Ear-position detection.
 *
 * Whitetail ears are mobile — they perch back when alarmed, swivel sideways
 * when listening, and only sit forward in the relaxed pose that mounted/posed
 * bucks display in trophy photos. ear_base_* landmarks are anatomically fixed
 * to the skull, but ear_tip_* landmarks move with the ear cup.
 *
 * When ear_tip_to_tip / ear_base_spacing falls outside the normal forward-pose
 * range, the ear_base_to_tip reference cannot be trusted and is demoted from
 * the reference consensus.
 */

import type { LandmarkDetection } from './landmark-detection'

export type EarPositionState = 'forward' | 'perked' | 'sideways' | 'unknown'

export interface EarPositionResult {
  state: EarPositionState
  /** ear_tip_to_tip / ear_base_spacing, in pixels. Null if either distance is unknown. */
  ratio: number | null
  /** Whether ear_base_to_tip should be used as a reference for this image. */
  earTipUsable: boolean
  /** Free-text reason populated when earTipUsable === false. */
  reason: string
}

/**
 * Forward-pose ratio band. A relaxed deer in a head-on photo has ears that
 * spread roughly 1.0–1.3× the inter-base distance (cups face the camera,
 * pinning tips wider than bases). Ratios well below 1.0 indicate ears perched
 * back along the neck. Ratios well above 1.3 indicate a sideways listening
 * pose where one ear is foreshortened.
 *
 * These bounds are conservative — borderline cases stay 'forward' so we don't
 * over-exclude.
 */
const FORWARD_RATIO_MIN = 0.7
const FORWARD_RATIO_MAX = 1.4

function distance(
  a: LandmarkDetection | undefined,
  b: LandmarkDetection | undefined,
): number | null {
  if (!a || !b) return null
  if (a.px == null || a.py == null || b.px == null || b.py == null) return null
  if (a.visibility === 'not_visible' || b.visibility === 'not_visible') return null
  const dx = a.px - b.px
  const dy = a.py - b.py
  const d = Math.sqrt(dx * dx + dy * dy)
  if (!Number.isFinite(d) || d <= 0) return null
  return d
}

/**
 * Determine ear position from a set of per-image landmarks.
 *
 * The detect-landmark prompt produces ear_base_left/right and ear_tip_left/right
 * coordinates. This helper does no AI work — pure geometry.
 */
export function detectEarPosition(
  landmarks: LandmarkDetection[],
): EarPositionResult {
  const earBaseLeft  = landmarks.find(l => l.id === ('ear_base_left'  as LandmarkDetection['id']))
  const earBaseRight = landmarks.find(l => l.id === ('ear_base_right' as LandmarkDetection['id']))
  const earTipLeft   = landmarks.find(l => l.id === ('ear_tip_left'   as LandmarkDetection['id']))
  const earTipRight  = landmarks.find(l => l.id === ('ear_tip_right'  as LandmarkDetection['id']))

  const baseSpacing = distance(earBaseLeft, earBaseRight)
  const tipSpacing  = distance(earTipLeft, earTipRight)

  if (baseSpacing == null) {
    return {
      state: 'unknown',
      ratio: null,
      earTipUsable: false,
      reason: 'ear-base landmarks not visible',
    }
  }

  if (tipSpacing == null) {
    return {
      state: 'unknown',
      ratio: null,
      earTipUsable: false,
      reason: 'ear-tip landmarks not visible',
    }
  }

  const ratio = tipSpacing / baseSpacing

  if (ratio < FORWARD_RATIO_MIN) {
    return {
      state: 'perked',
      ratio,
      earTipUsable: false,
      reason: 'ears perked back — ear-tip distance unreliable',
    }
  }

  if (ratio > FORWARD_RATIO_MAX) {
    return {
      state: 'sideways',
      ratio,
      earTipUsable: false,
      reason: 'ears positioned sideways — ear-tip distance distorted',
    }
  }

  return {
    state: 'forward',
    ratio,
    earTipUsable: true,
    reason: '',
  }
}
