/**
 * Graph-native scoring module — production-grade.
 *
 * Wraps the base scoreFromGraph from lib/scoring.ts and adds:
 *  - polyline-length fallback when beam.length is missing/zero
 *  - anchor-distance fallback when spread.distance is missing/zero
 *  - per-tine length fallback via basePoint → tipPoint
 *  - circumference: real values only, no invented measurements
 *  - abnormal point passthrough (warns if schema doesn't support it yet)
 *  - weighted completeness: core 40% / tines 35% / circumferences 25%
 *  - structured warnings list
 *  - full ScoreBreakdown passthrough (left/right tines + circumferences)
 */

import { scoreFromGraph as _scoreFromGraph, getGraphConfidence } from '@/lib/scoring'
import type { MeasurementGraph } from '@/lib/types'

export type { ScoreBreakdown } from '@/lib/scoring'

// ── Output type ───────────────────────────────────────────────────────────────

export interface GraphScoreResult {
  grossScore: number
  netScore: number
  deductionTotal: number
  abnormalTotal: number
  leftBeam: number
  rightBeam: number
  insideSpread: number
  tineTotal: number
  circumferenceTotal: number
  measurements: {
    id: string
    label: string
    side: 'left' | 'right' | 'n/a'
    type: 'beam' | 'tine' | 'spread' | 'circumference'
    value: number
    isMissing: boolean
  }[]
  completeness: number
  missingMeasurements: string[]
  warnings: string[]
  /** Average confidence across all graph segments */
  confidence: number
}

// ── Geometry helpers ──────────────────────────────────────────────────────────

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  return Math.sqrt(dx * dx + dy * dy)
}

function polylineLength(pts: { x: number; y: number }[]): number {
  let total = 0
  for (let i = 1; i < pts.length; i++) total += dist(pts[i - 1], pts[i])
  return total
}

function finite(v: number): boolean {
  return typeof v === 'number' && isFinite(v) && v > 0
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Score a MeasurementGraph with full B&C rule logic.
 *
 * Completeness is weighted:
 *   core (beams + spread)  = 40%
 *   tines                  = 35%
 *   circumferences         = 25%
 *
 * Circumference values are never invented — if a position exists but the
 * circumference value is 0/missing it is counted as missing.
 */
export function scoreFromGraph(graph: MeasurementGraph): GraphScoreResult {
  const warnings: string[] = []
  const missing: string[] = []
  const measurements: GraphScoreResult['measurements'] = []

  // ── 1. Beams ───────────────────────────────────────────────────────────────

  let leftBeam = graph.beams.left.length
  if (!finite(leftBeam)) {
    leftBeam = polylineLength(graph.beams.left.points)
  }
  const leftBeamMissing = !finite(leftBeam)
  if (leftBeamMissing) missing.push('beam-left')
  measurements.push({
    id: 'beam-left',
    label: 'Left Main Beam',
    side: 'left',
    type: 'beam',
    value: leftBeam,
    isMissing: leftBeamMissing,
  })

  let rightBeam = graph.beams.right.length
  if (!finite(rightBeam)) {
    rightBeam = polylineLength(graph.beams.right.points)
  }
  const rightBeamMissing = !finite(rightBeam)
  if (rightBeamMissing) missing.push('beam-right')
  measurements.push({
    id: 'beam-right',
    label: 'Right Main Beam',
    side: 'right',
    type: 'beam',
    value: rightBeam,
    isMissing: rightBeamMissing,
  })

  // ── 2. Spread ─────────────────────────────────────────────────────────────

  let spread = graph.spread.distance
  if (!finite(spread)) {
    spread = dist(graph.spread.leftPoint, graph.spread.rightPoint)
  }
  const spreadMissing = !finite(spread)
  if (spreadMissing) missing.push('spread')
  measurements.push({
    id: 'spread',
    label: 'Inside Spread',
    side: 'n/a',
    type: 'spread',
    value: spread,
    isMissing: spreadMissing,
  })

  // Core completeness: beams + spread (40% weight)
  const corePresent = [!leftBeamMissing, !rightBeamMissing, !spreadMissing].filter(Boolean).length
  const coreTotal = 3
  const coreScore = corePresent / coreTotal

  // ── 3. Tines ───────────────────────────────────────────────────────────────

  let tineTotal = 0
  let tinePresent = 0

  for (const tine of graph.tines) {
    let len = tine.length
    if (!finite(len)) {
      len = dist(tine.basePoint, tine.tipPoint)
    }
    const isMissing = !finite(len)
    if (isMissing) {
      missing.push(tine.id)
    } else {
      tineTotal += len
      tinePresent++
    }
    measurements.push({
      id: tine.id,
      label: `${tine.label} ${tine.side.charAt(0).toUpperCase() + tine.side.slice(1)}`,
      side: tine.side,
      type: 'tine',
      value: len,
      isMissing,
    })
  }

  // Tine completeness relative to what's in the graph (35% weight)
  const tineTotal_ = graph.tines.length
  const tineScore = tineTotal_ > 0 ? tinePresent / tineTotal_ : 1

  // ── 4. Circumferences ─────────────────────────────────────────────────────
  // ONLY use real circumference values — never invent them from position points.

  let circumferenceTotal = 0
  let circPresent = 0

  for (const c of graph.circumferences) {
    const val = c.circumference
    // A circumference entry with value <= 0 is a position-only placeholder
    const isMissing = !finite(val)
    if (isMissing) {
      missing.push(c.id)
    } else {
      circumferenceTotal += val
      circPresent++
    }
    measurements.push({
      id: c.id,
      label: `${c.label} ${c.side.charAt(0).toUpperCase() + c.side.slice(1)}`,
      side: c.side,
      type: 'circumference',
      value: val,
      isMissing,
    })
  }

  // Circumference completeness (25% weight). Honest: zero present = 0.
  const circTotal_ = graph.circumferences.length
  const circScore = circTotal_ > 0 ? circPresent / circTotal_ : 0
  if (circTotal_ > 0 && circPresent === 0) {
    warnings.push('No circumference values present — circumferences excluded from gross score')
  }
  if (circTotal_ === 0) {
    warnings.push('Graph has no circumference measurements — completeness reduced accordingly')
  }

  // ── 5. Abnormal points ────────────────────────────────────────────────────

  let abnormalTotal = 0
  const graphAny = graph as unknown as Record<string, unknown>
  if (Array.isArray(graphAny.abnormalPoints) && (graphAny.abnormalPoints as unknown[]).length > 0) {
    for (const pt of graphAny.abnormalPoints as Array<Record<string, unknown>>) {
      const len = typeof pt.length === 'number' ? pt.length : 0
      abnormalTotal += len
    }
  } else {
    warnings.push('Abnormal point graph support not present — abnormalTotal = 0')
  }

  // ── 6. Gross / net / deductions ───────────────────────────────────────────

  // Use the base scorer so deduction formula stays consistent with legacy
  let grossScore = 0
  let deductionTotal = 0
  let netScore = 0

  try {
    const base = _scoreFromGraph(graph)
    grossScore = base.grossScore
    deductionTotal = base.deductions
    netScore = base.netScore
  } catch {
    // Manual fallback if base scorer fails (e.g. malformed graph)
    grossScore = leftBeam + rightBeam + spread + tineTotal + circumferenceTotal + abnormalTotal
    deductionTotal = 0
    netScore = grossScore
    warnings.push('Base scorer failed — deductions calculated as 0')
  }

  // ── 7. Weighted completeness ──────────────────────────────────────────────

  // core 40%, tines 35%, circumferences 25%
  const completeness = coreScore * 0.4 + tineScore * 0.35 + circScore * 0.25

  return {
    grossScore,
    netScore,
    deductionTotal,
    abnormalTotal,
    leftBeam,
    rightBeam,
    insideSpread: spread,
    tineTotal,
    circumferenceTotal,
    measurements,
    completeness,
    missingMeasurements: missing,
    warnings,
    confidence: getGraphConfidence(graph),
  }
}
