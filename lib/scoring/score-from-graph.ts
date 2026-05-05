/**
 * Graph-native scoring module.
 *
 * Wraps the core scoreFromGraph function from lib/scoring with additional
 * fields needed for Build B rollout comparison:
 *   - completeness  : fraction of non-zero measurements present (0–1)
 *   - missingMeasurements : human-readable list of absent/zero measurements
 *
 * Keeps the same B&C deduction formula as the base scorer so legacy and
 * graph-native numbers are directly comparable.
 */

import { scoreFromGraph as _scoreFromGraph, getGraphConfidence } from '@/lib/scoring'
import type { MeasurementGraph } from '@/lib/types'

export type { ScoreBreakdown } from '@/lib/scoring'

export interface GraphScoreResult {
  grossScore: number
  netScore: number
  deductions: number
  /** Fraction 0–1 of expected measurements that have non-zero values */
  completeness: number
  /** Identifiers for measurements that appear absent (length or distance = 0) */
  missingMeasurements: string[]
  /** Average confidence across all graph segments */
  confidence: number
}

// ── helpers ───────────────────────────────────────────────────────────────────

function countAndCollect(
  values: { id: string; value: number }[],
  missing: string[],
): { present: number; total: number } {
  let present = 0
  for (const { id, value } of values) {
    if (value > 0) {
      present++
    } else {
      missing.push(id)
    }
  }
  return { present, total: values.length }
}

// ── public API ────────────────────────────────────────────────────────────────

/**
 * Score a MeasurementGraph with completeness tracking.
 *
 * Expected measurements (for completeness denominator):
 *  - 2 beams (left + right)
 *  - 1 inside spread
 *  - all tines present in the graph
 *  - all circumferences present in the graph (if any)
 *
 * A measurement is "present" when its length/distance value is > 0.
 * Circumferences with value = 0 count as missing (they are not auto-generated).
 */
export function scoreFromGraph(graph: MeasurementGraph): GraphScoreResult {
  const base = _scoreFromGraph(graph)
  const missing: string[] = []

  const checks: { id: string; value: number }[] = [
    { id: 'beam-left', value: graph.beams.left.length },
    { id: 'beam-right', value: graph.beams.right.length },
    { id: 'spread', value: graph.spread.distance },
    ...graph.tines.map((t) => ({ id: t.id, value: t.length })),
    ...graph.circumferences.map((c) => ({ id: c.id, value: c.circumference })),
  ]

  const { present, total } = countAndCollect(checks, missing)
  const completeness = total > 0 ? present / total : 0

  return {
    grossScore: base.grossScore,
    netScore: base.netScore,
    deductions: base.deductions,
    completeness,
    missingMeasurements: missing,
    confidence: getGraphConfidence(graph),
  }
}
