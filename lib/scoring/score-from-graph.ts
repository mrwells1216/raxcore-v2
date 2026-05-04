/**
 * score-from-graph.ts
 *
 * Phase 3: Graph-native scoring pipeline.
 *
 * Derives a score from a MeasurementGraph and produces:
 *   - A fully structured score result in the same shape as the legacy output.
 *   - Graph score metadata (source, completeness, missing measurements).
 *   - A ScoreComparison comparing legacy vs graph-native values.
 *
 * Rollout rule (conservative):
 *   - graphCompleteness >= 0.8  AND  |grossDelta| <= 3  →  prefer graph-native
 *   - otherwise keep legacy score as active, expose comparison metadata only
 */

import type { MeasurementGraph } from '@/lib/types'
import type { Measurements } from '@/lib/types'
import {
  derivePixelToInchScale,
  computeGraphCompleteness,
  extractGraphMeasurements,
} from '@/lib/scoring/graph-measurement-extraction'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface GraphScoreMeta {
  source: 'graph_native'
  completeness: number
  missingMeasurements: string[]
  pixelToInchScale: number
}

export interface ScoreComparison {
  /** Which source is considered authoritative for this score event */
  activeSource: 'legacy' | 'graph_native'
  legacyGross: number | null
  graphGross: number | null
  legacyNet: number | null
  graphNet: number | null
  grossDelta: number | null
  netDelta: number | null
  graphCompleteness: number
}

export interface GraphNativeScoreResult {
  leftBeam: number
  rightBeam: number
  insideSpread: number
  tines: Record<string, number>
  circumferences: Record<string, number>
  gross: number
  net: number
  deductions: number
  meta: GraphScoreMeta
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GRAPH_NATIVE_COMPLETENESS_THRESHOLD = 0.8
const GRAPH_NATIVE_GROSS_DELTA_THRESHOLD = 3.0

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

/**
 * Compute a graph-native score from a MeasurementGraph.
 *
 * @param graph              The resolved MeasurementGraph.
 * @param legacyMeasurements Legacy vision measurements (in inches) used to
 *                           derive a pixel-to-inch scale factor.  May be null
 *                           when the graph is from a persisted (already-scaled)
 *                           source — in that case pass scale=1.
 */
export function computeGraphNativeScore(
  graph: MeasurementGraph,
  legacyMeasurements: Partial<Measurements> | null | undefined
): GraphNativeScoreResult {
  const scale = derivePixelToInchScale(graph, legacyMeasurements)
  const { completeness, missingMeasurements } = computeGraphCompleteness(graph, scale)
  const extracted = extractGraphMeasurements(graph, scale)

  // Flatten tine map  e.g.  { g1_left: 5.2, g1_right: 5.0, … }
  const tines: Record<string, number> = {}
  extracted.tines.forEach((t) => {
    const key = `${t.label.toLowerCase()}_${t.side}`
    tines[key] = t.inches
  })

  // Flatten circumference map  e.g.  { h1_left: 4.1, … }
  const circumferences: Record<string, number> = {}
  extracted.circumferences.forEach((c) => {
    const key = `${c.label.toLowerCase()}_${c.side}`
    circumferences[key] = c.inches
  })

  return {
    leftBeam: extracted.leftBeam,
    rightBeam: extracted.rightBeam,
    insideSpread: extracted.spread,
    tines,
    circumferences,
    gross: extracted.grossScore,
    net: extracted.netScore,
    deductions: extracted.deductions,
    meta: {
      source: 'graph_native',
      completeness,
      missingMeasurements,
      pixelToInchScale: scale,
    },
  }
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

/**
 * Build the side-by-side comparison between legacy and graph-native scores.
 *
 * Rollout rule applied here:
 *   completeness >= 0.8 AND |grossDelta| <= 3  →  activeSource = 'graph_native'
 *   otherwise                                  →  activeSource = 'legacy'
 */
export function buildScoreComparison(
  legacyGross: number | null,
  legacyNet: number | null,
  graphScore: GraphNativeScoreResult | null
): ScoreComparison {
  const graphGross = graphScore?.gross ?? null
  const graphNet = graphScore?.net ?? null
  const graphCompleteness = graphScore?.meta.completeness ?? 0

  const grossDelta =
    typeof legacyGross === 'number' && typeof graphGross === 'number'
      ? Number((graphGross - legacyGross).toFixed(1))
      : null

  const netDelta =
    typeof legacyNet === 'number' && typeof graphNet === 'number'
      ? Number((graphNet - legacyNet).toFixed(1))
      : null

  const meetsCompletenessThreshold = graphCompleteness >= GRAPH_NATIVE_COMPLETENESS_THRESHOLD
  const meetsGrossDeltaThreshold =
    grossDelta !== null && Math.abs(grossDelta) <= GRAPH_NATIVE_GROSS_DELTA_THRESHOLD

  const activeSource: ScoreComparison['activeSource'] =
    meetsCompletenessThreshold && meetsGrossDeltaThreshold ? 'graph_native' : 'legacy'

  return {
    activeSource,
    legacyGross,
    graphGross,
    legacyNet,
    graphNet,
    grossDelta,
    netDelta,
    graphCompleteness,
  }
}
