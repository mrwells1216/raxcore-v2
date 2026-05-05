/**
 * Official score entry types and the benchmark comparison engine.
 *
 * Build D: Gold-standard training + calibration foundation.
 *
 * No schema changes needed — `ground_truth_scores` already holds per-measurement
 * columns via upsertGroundTruth / getGroundTruthByBuckId in lib/storage/service.ts.
 */

import type { MeasurementGraph } from '@/lib/types'

// ── Scoring system ─────────────────────────────────────────────────────────────

export type ScoringSystem = 'boone_and_crockett' | 'pope_and_young'

export type RackType = 'typical' | 'non_typical'

// ── Official score entry form data ────────────────────────────────────────────

export interface OfficialScoreEntry {
  scoringSystem: ScoringSystem
  rackType: RackType
  // Main beams
  mainBeamLeft: number | null
  mainBeamRight: number | null
  // Spread
  insideSpread: number | null
  // Tines — each as (label, side, value)
  tines: { label: string; side: 'left' | 'right'; value: number | null }[]
  // Circumferences
  circumferences: { label: string; side: 'left' | 'right'; value: number | null }[]
  // Final scores
  deductions: number | null
  grossScore: number | null
  netScore: number | null
  notes: string | null
}

/** Default tine/circumference structure matching the B&C sheet */
export function defaultOfficialTines(): OfficialScoreEntry['tines'] {
  const labels = ['G1', 'G2', 'G3', 'G4']
  const sides: ('left' | 'right')[] = ['left', 'right']
  return sides.flatMap((side) => labels.map((label) => ({ label, side, value: null })))
}

export function defaultOfficialCircumferences(): OfficialScoreEntry['circumferences'] {
  const labels = ['H1', 'H2', 'H3', 'H4']
  const sides: ('left' | 'right')[] = ['left', 'right']
  return sides.flatMap((side) => labels.map((label) => ({ label, side, value: null })))
}

export function buildEmptyOfficialEntry(): OfficialScoreEntry {
  return {
    scoringSystem: 'boone_and_crockett',
    rackType: 'typical',
    mainBeamLeft: null,
    mainBeamRight: null,
    insideSpread: null,
    tines: defaultOfficialTines(),
    circumferences: defaultOfficialCircumferences(),
    deductions: null,
    grossScore: null,
    netScore: null,
    notes: null,
  }
}

// ── Measurement error row ─────────────────────────────────────────────────────

export interface MeasurementErrorRow {
  id: string
  label: string
  officialValue: number | null
  aiValue: number | null
  graphValue: number | null
  correctedValue: number | null
  absError: number | null
}

// ── Benchmark comparison ──────────────────────────────────────────────────────

export interface BenchmarkComparison {
  grossError: number | null
  netError: number | null
  aiGross: number | null
  graphGross: number | null
  correctedGross: number | null
  officialGross: number | null
  aiNet: number | null
  graphNet: number | null
  correctedNet: number | null
  officialNet: number | null
  measurementErrors: MeasurementErrorRow[]
}

/** Extract a value from a graph for a specific measurement id */
function graphValueForId(graph: MeasurementGraph | null, id: string): number | null {
  if (!graph) return null

  if (id === 'beam-left') return graph.beams.left.length || null
  if (id === 'beam-right') return graph.beams.right.length || null
  if (id === 'spread') return graph.spread.distance || null

  const tine = graph.tines.find((t) => t.id === id)
  if (tine) return tine.length || null

  const circ = graph.circumferences.find((c) => c.id === id)
  if (circ) return circ.circumference || null

  return null
}

/**
 * Build a full benchmark comparison between official, AI, graph-native,
 * and corrected scores for a given buck.
 *
 * Any value can be null — the comparison is best-effort.
 */
export function buildBenchmarkComparison(opts: {
  official: OfficialScoreEntry | null
  aiGross: number | null
  aiNet: number | null
  graph: MeasurementGraph | null
  correctedGraph: MeasurementGraph | null
}): BenchmarkComparison {
  const { official, aiGross, aiNet, graph, correctedGraph } = opts

  // Graph-native scores (computed from geometry)
  const graphGross = graph
    ? (graph.beams.left.length ?? 0) +
      (graph.beams.right.length ?? 0) +
      (graph.spread.distance ?? 0) +
      graph.tines.reduce((s, t) => s + (t.length ?? 0), 0)
    : null

  const correctedGross = correctedGraph
    ? (correctedGraph.beams.left.length ?? 0) +
      (correctedGraph.beams.right.length ?? 0) +
      (correctedGraph.spread.distance ?? 0) +
      correctedGraph.tines.reduce((s, t) => s + (t.length ?? 0), 0)
    : null

  const officialGross = official?.grossScore ?? null
  const officialNet = official?.netScore ?? null

  // Primary error: official vs AI gross
  const grossError =
    officialGross != null && aiGross != null ? Math.abs(aiGross - officialGross) : null
  const netError =
    officialNet != null && aiNet != null ? Math.abs(aiNet - officialNet) : null

  // Per-measurement rows
  const measurementErrors: MeasurementErrorRow[] = []

  // Beams
  const beamRows: { id: string; label: string; officialValue: number | null }[] = [
    { id: 'beam-left', label: 'Left Beam', officialValue: official?.mainBeamLeft ?? null },
    { id: 'beam-right', label: 'Right Beam', officialValue: official?.mainBeamRight ?? null },
    { id: 'spread', label: 'Inside Spread', officialValue: official?.insideSpread ?? null },
  ]

  for (const row of beamRows) {
    const gv = graphValueForId(graph, row.id)
    const cv = graphValueForId(correctedGraph, row.id)
    const absError =
      row.officialValue != null && gv != null ? Math.abs(gv - row.officialValue) : null
    measurementErrors.push({
      id: row.id,
      label: row.label,
      officialValue: row.officialValue,
      aiValue: null, // per-measurement AI values not available from bulk score
      graphValue: gv,
      correctedValue: cv,
      absError,
    })
  }

  // Tines
  if (official) {
    for (const tine of official.tines) {
      const id = `${tine.label.toLowerCase()}-${tine.side}`
      const gv = graphValueForId(graph, id)
      const cv = graphValueForId(correctedGraph, id)
      const absError =
        tine.value != null && gv != null ? Math.abs(gv - tine.value) : null
      measurementErrors.push({
        id,
        label: `${tine.label} ${tine.side.charAt(0).toUpperCase() + tine.side.slice(1)}`,
        officialValue: tine.value,
        aiValue: null,
        graphValue: gv,
        correctedValue: cv,
        absError,
      })
    }

    // Circumferences
    for (const circ of official.circumferences) {
      const id = `${circ.label.toLowerCase()}-${circ.side}`
      const gv = graphValueForId(graph, id)
      const cv = graphValueForId(correctedGraph, id)
      const absError =
        circ.value != null && gv != null ? Math.abs(gv - circ.value) : null
      measurementErrors.push({
        id,
        label: `${circ.label} ${circ.side.charAt(0).toUpperCase() + circ.side.slice(1)}`,
        officialValue: circ.value,
        aiValue: null,
        graphValue: gv,
        correctedValue: cv,
        absError,
      })
    }
  }

  return {
    grossError,
    netError,
    aiGross,
    graphGross,
    correctedGross,
    officialGross,
    aiNet,
    graphNet: graphGross != null ? graphGross - (official?.deductions ?? 0) : null,
    correctedNet:
      correctedGross != null ? correctedGross - (official?.deductions ?? 0) : null,
    officialNet,
    measurementErrors,
  }
}

// ── Calibration stats ─────────────────────────────────────────────────────────

export interface BenchmarkStats {
  sampleCount: number
  grossMAE: number | null
  netMAE: number | null
  averageBias: number | null
  perMeasurementMAE: Record<string, number>
}

/**
 * Aggregate multiple BenchmarkComparisons into calibration-ready stats.
 * Intended to be called over a batch of comparisons fetched from the database.
 */
export function computeBenchmarkStats(
  comparisons: BenchmarkComparison[],
): BenchmarkStats {
  const validGross = comparisons
    .map((c) => (c.officialGross != null && c.aiGross != null ? c.aiGross - c.officialGross : null))
    .filter((v): v is number => v != null)

  const validNet = comparisons
    .map((c) => (c.officialNet != null && c.aiNet != null ? c.aiNet - c.officialNet : null))
    .filter((v): v is number => v != null)

  const grossMAE =
    validGross.length > 0
      ? validGross.reduce((s, v) => s + Math.abs(v), 0) / validGross.length
      : null

  const netMAE =
    validNet.length > 0
      ? validNet.reduce((s, v) => s + Math.abs(v), 0) / validNet.length
      : null

  const averageBias =
    validGross.length > 0
      ? validGross.reduce((s, v) => s + v, 0) / validGross.length
      : null

  // Per-measurement MAE: collect abs errors by measurement id
  const perMeasurementAccum: Record<string, number[]> = {}
  for (const comp of comparisons) {
    for (const row of comp.measurementErrors) {
      if (row.absError != null) {
        if (!perMeasurementAccum[row.id]) perMeasurementAccum[row.id] = []
        perMeasurementAccum[row.id].push(row.absError)
      }
    }
  }

  const perMeasurementMAE: Record<string, number> = {}
  for (const [id, errors] of Object.entries(perMeasurementAccum)) {
    perMeasurementMAE[id] = errors.reduce((s, v) => s + v, 0) / errors.length
  }

  return {
    sampleCount: comparisons.length,
    grossMAE,
    netMAE,
    averageBias,
    perMeasurementMAE,
  }
}
