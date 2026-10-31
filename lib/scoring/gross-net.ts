/**
 * Single source of truth for turning an AI measurement set into gross / net.
 *
 * This used to live as two private copies (ai-service.ts and second-pass.ts).
 * The first was corrected in §3.47 (abnormal points by rack type) and §3.54
 * (spread credit cap); the second-pass copy was not, so any buck that went
 * through the two-pass solver had its blended gross inflated by the abnormal
 * total and an uncapped spread. One implementation means they cannot drift.
 *
 * Pure and dependency-light on purpose: importable from tests with no
 * server-only or Supabase modules in the graph.
 */

import type { Measurements } from '@/lib/types'

export type RackType = 'typical' | 'non-typical'

/**
 * Credited inside spread, per the B&C chart: "spread credit may equal but not
 * exceed the length of the longer antler". A 22" spread on 21" beams is
 * credited 21", not 22".
 *
 * With no beam measured there is nothing to cap against, so the raw spread is
 * credited rather than zeroing it out.
 */
export function spreadCredit(measurements: Measurements): number {
  const spread = measurements.inside_spread
  if (typeof spread !== 'number' || !Number.isFinite(spread)) return 0

  const beams = [measurements.main_beam_left, measurements.main_beam_right]
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0)
  if (beams.length === 0) return spread

  return Math.min(spread, Math.max(...beams))
}

/**
 * Gross and net from a measurement set.
 *
 * Abnormal points are handled by rack type, which is how B&C actually works:
 *  - typical:     gross is the typical frame only. Abnormal points are a
 *                 deduction on the way to net.
 *  - non-typical: abnormal points count positively, so they belong in gross
 *                 and are not subtracted again.
 */
export function calculateScores(
  measurements: Measurements,
  rackType: RackType = 'typical',
): { gross: number; net: number } {
  const frame = [
    measurements.main_beam_left, measurements.main_beam_right,
    measurements.g1_left, measurements.g1_right,
    measurements.g2_left, measurements.g2_right,
    measurements.g3_left, measurements.g3_right,
    measurements.g4_left, measurements.g4_right,
    measurements.g5_left, measurements.g5_right,
    measurements.h1_left, measurements.h1_right,
    measurements.h2_left, measurements.h2_right,
    measurements.h3_left, measurements.h3_right,
    measurements.h4_left, measurements.h4_right,
  ].filter((v): v is number => typeof v === 'number' && Number.isFinite(v))

  const frameTotal =
    frame.reduce((sum, v) => sum + v, 0) + spreadCredit(measurements)
  const abnormal = measurements.abnormal_points || 0
  const deductions = measurements.deductions || 0

  const isNonTypical = rackType === 'non-typical'
  const gross = isNonTypical ? frameTotal + abnormal : frameTotal
  const net = isNonTypical ? gross - deductions : gross - deductions - abnormal

  return { gross: Number(gross.toFixed(1)), net: Number(net.toFixed(1)) }
}
