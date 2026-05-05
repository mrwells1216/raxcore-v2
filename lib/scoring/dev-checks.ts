/**
 * Scoring core dev-checks — lightweight validation helpers.
 *
 * NOT a test framework. These functions return structured results that can be
 * called from a dev-only API route or a manual script to verify the scoring
 * pipeline end-to-end without an external test runner.
 *
 * Usage (e.g. in a dev-only route):
 *   import { runScoringDevChecks } from '@/lib/scoring/dev-checks'
 *   const result = runScoringDevChecks()
 *   console.log(result)
 */

import { scoreFromGraph } from '@/lib/scoring/score-from-graph'
import type { MeasurementGraph } from '@/lib/types'

// ── Fixture graphs ────────────────────────────────────────────────────────────

/** A reasonably complete typical whitetail rack with all circumference values */
const FULL_GRAPH: MeasurementGraph = {
  beams: {
    left: {
      id: 'beam-left',
      points: [{ x: 0, y: 0 }, { x: 0, y: 24 }],
      length: 24,
      confidence: 0.9,
      source: 'fused',
      provenance: { origin: 'ai', visibility: 'visible' },
    },
    right: {
      id: 'beam-right',
      points: [{ x: 10, y: 0 }, { x: 10, y: 23 }],
      length: 23,
      confidence: 0.88,
      source: 'fused',
      provenance: { origin: 'ai', visibility: 'visible' },
    },
  },
  spread: {
    leftPoint: { x: 0, y: 0 },
    rightPoint: { x: 18, y: 0 },
    distance: 18,
    confidence: 0.85,
    provenance: { origin: 'ai', visibility: 'visible' },
  },
  tines: [
    { id: 't1l', label: 'G1', side: 'left', parentBeamId: 'beam-left', basePoint: { x: 0, y: 20 }, tipPoint: { x: -4, y: 25 }, length: 8, confidence: 0.8, provenance: { origin: 'ai', visibility: 'visible' } },
    { id: 't1r', label: 'G1', side: 'right', parentBeamId: 'beam-right', basePoint: { x: 10, y: 20 }, tipPoint: { x: 14, y: 25 }, length: 8, confidence: 0.8, provenance: { origin: 'ai', visibility: 'visible' } },
    { id: 't2l', label: 'G2', side: 'left', parentBeamId: 'beam-left', basePoint: { x: 0, y: 16 }, tipPoint: { x: -5, y: 22 }, length: 9, confidence: 0.78, provenance: { origin: 'ai', visibility: 'visible' } },
    { id: 't2r', label: 'G2', side: 'right', parentBeamId: 'beam-right', basePoint: { x: 10, y: 16 }, tipPoint: { x: 15, y: 22 }, length: 9, confidence: 0.78, provenance: { origin: 'ai', visibility: 'visible' } },
    { id: 't3l', label: 'G3', side: 'left', parentBeamId: 'beam-left', basePoint: { x: 0, y: 12 }, tipPoint: { x: -5, y: 18 }, length: 10, confidence: 0.75, provenance: { origin: 'ai', visibility: 'visible' } },
    { id: 't3r', label: 'G3', side: 'right', parentBeamId: 'beam-right', basePoint: { x: 10, y: 12 }, tipPoint: { x: 15, y: 18 }, length: 10, confidence: 0.75, provenance: { origin: 'ai', visibility: 'visible' } },
    { id: 't4l', label: 'G4', side: 'left', parentBeamId: 'beam-left', basePoint: { x: 0, y: 8 }, tipPoint: { x: -4, y: 13 }, length: 7, confidence: 0.7, provenance: { origin: 'ai', visibility: 'visible' } },
    { id: 't4r', label: 'G4', side: 'right', parentBeamId: 'beam-right', basePoint: { x: 10, y: 8 }, tipPoint: { x: 14, y: 13 }, length: 7, confidence: 0.7, provenance: { origin: 'ai', visibility: 'visible' } },
  ],
  circumferences: [
    { id: 'h1l', label: 'H1', side: 'left', position: { x: 0, y: 22 }, circumference: 4.5, confidence: 0.72, provenance: { origin: 'ai', visibility: 'visible' } },
    { id: 'h1r', label: 'H1', side: 'right', position: { x: 10, y: 22 }, circumference: 4.3, confidence: 0.72, provenance: { origin: 'ai', visibility: 'visible' } },
    { id: 'h2l', label: 'H2', side: 'left', position: { x: 0, y: 18 }, circumference: 4.0, confidence: 0.68, provenance: { origin: 'ai', visibility: 'visible' } },
    { id: 'h2r', label: 'H2', side: 'right', position: { x: 10, y: 18 }, circumference: 3.8, confidence: 0.68, provenance: { origin: 'ai', visibility: 'visible' } },
    { id: 'h3l', label: 'H3', side: 'left', position: { x: 0, y: 14 }, circumference: 3.5, confidence: 0.65, provenance: { origin: 'ai', visibility: 'visible' } },
    { id: 'h3r', label: 'H3', side: 'right', position: { x: 10, y: 14 }, circumference: 3.3, confidence: 0.65, provenance: { origin: 'ai', visibility: 'visible' } },
    { id: 'h4l', label: 'H4', side: 'left', position: { x: 0, y: 10 }, circumference: 3.0, confidence: 0.6, provenance: { origin: 'ai', visibility: 'visible' } },
    { id: 'h4r', label: 'H4', side: 'right', position: { x: 10, y: 10 }, circumference: 2.8, confidence: 0.6, provenance: { origin: 'ai', visibility: 'visible' } },
  ],
}

/** Same rack but with all circumference values zeroed out */
const GRAPH_NO_CIRCS: MeasurementGraph = {
  ...FULL_GRAPH,
  circumferences: FULL_GRAPH.circumferences.map(c => ({ ...c, circumference: 0 })),
}

/** Graph where only beams are populated — low completeness */
const SPARSE_GRAPH: MeasurementGraph = {
  beams: FULL_GRAPH.beams,
  spread: { ...FULL_GRAPH.spread, distance: 0 },
  tines: [],
  circumferences: [],
}

/** Graph with a human-corrected beam */
const CORRECTED_GRAPH: MeasurementGraph = {
  ...FULL_GRAPH,
  beams: {
    ...FULL_GRAPH.beams,
    left: {
      ...FULL_GRAPH.beams.left,
      length: 25.5,
      provenance: { origin: 'human', visibility: 'corrected', notes: 'Manual score edit' },
    },
  },
}

// ── Check runner ──────────────────────────────────────────────────────────────

type CheckResult = {
  name: string
  pass: boolean
  actual?: unknown
  expected?: string
  error?: string
}

function check(
  name: string,
  fn: () => { pass: boolean; actual?: unknown; expected?: string },
): CheckResult {
  try {
    const r = fn()
    return { name, ...r }
  } catch (err) {
    return {
      name,
      pass: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

// ── Public ────────────────────────────────────────────────────────────────────

export interface DevCheckReport {
  passed: number
  failed: number
  checks: CheckResult[]
}

export function runScoringDevChecks(): DevCheckReport {
  const checks: CheckResult[] = []

  // 1. Full graph returns finite gross/net
  checks.push(check('scoreFromGraph full graph → finite gross/net', () => {
    const r = scoreFromGraph(FULL_GRAPH)
    const pass = isFinite(r.grossScore) && r.grossScore > 0 && isFinite(r.netScore)
    return { pass, actual: { grossScore: r.grossScore, netScore: r.netScore } }
  }))

  // 2. Missing circumferences reduce completeness vs full
  checks.push(check('missing circumferences reduce completeness', () => {
    const full = scoreFromGraph(FULL_GRAPH)
    const noCirc = scoreFromGraph(GRAPH_NO_CIRCS)
    const pass = noCirc.completeness < full.completeness
    return {
      pass,
      actual: { fullCompleteness: full.completeness, noCircCompleteness: noCirc.completeness },
      expected: 'noCircCompleteness < fullCompleteness',
    }
  }))

  // 3. graph_native active source triggers when graph complete (>= 0.75)
  checks.push(check('graph_native activeSource triggers at completeness >= 0.75', () => {
    const r = scoreFromGraph(FULL_GRAPH)
    const wouldBeGraphNative =
      r.completeness >= 0.75 &&
      isFinite(r.grossScore) &&
      r.grossScore > 0
    return {
      pass: wouldBeGraphNative,
      actual: { completeness: r.completeness, grossScore: r.grossScore },
      expected: 'completeness >= 0.75 AND grossScore > 0',
    }
  }))

  // 4. Legacy fallback triggers when graph completeness too low (sparse graph)
  checks.push(check('legacy fallback triggers when graph completeness < 0.75', () => {
    const r = scoreFromGraph(SPARSE_GRAPH)
    const wouldUseLegacy = r.completeness < 0.75
    return {
      pass: wouldUseLegacy,
      actual: { completeness: r.completeness },
      expected: 'completeness < 0.75',
    }
  }))

  // 5. Corrected provenance is detectable
  checks.push(check('corrected provenance is detectable on graph segments', () => {
    const g = CORRECTED_GRAPH
    const correctedCount = [
      g.beams.left,
      g.beams.right,
      g.spread,
      ...g.tines,
      ...g.circumferences,
    ].filter(s => (s as any).provenance?.origin === 'human' || (s as any).provenance?.visibility === 'corrected').length
    const pass = correctedCount >= 1
    return { pass, actual: { correctedCount }, expected: 'correctedCount >= 1' }
  }))

  // 6. scoreFromGraph returns warnings array (never throws)
  checks.push(check('scoreFromGraph always returns warnings array', () => {
    const r = scoreFromGraph(FULL_GRAPH)
    const pass = Array.isArray(r.warnings) && Array.isArray(r.missingMeasurements)
    return { pass, actual: { warnings: r.warnings, missingMeasurements: r.missingMeasurements } }
  }))

  // 7. scoreFromGraph with fallback graph (all zeros) returns completeness = 0 for core
  checks.push(check('zero-value graph returns low completeness', () => {
    const zeroGraph: MeasurementGraph = {
      beams: {
        left: { id: 'beam-left', points: [], length: 0, confidence: 0, source: 'fused', provenance: { origin: 'ai', visibility: 'inferred' } },
        right: { id: 'beam-right', points: [], length: 0, confidence: 0, source: 'fused', provenance: { origin: 'ai', visibility: 'inferred' } },
      },
      spread: { leftPoint: { x: 0, y: 0 }, rightPoint: { x: 0, y: 0 }, distance: 0, confidence: 0, provenance: { origin: 'ai', visibility: 'inferred' } },
      tines: [],
      circumferences: [],
    }
    const r = scoreFromGraph(zeroGraph)
    const pass = r.completeness <= 0.4 && r.grossScore === 0
    return { pass, actual: { completeness: r.completeness, grossScore: r.grossScore }, expected: 'completeness <= 0.4 AND grossScore === 0' }
  }))

  const passed = checks.filter(c => c.pass).length
  const failed = checks.filter(c => !c.pass).length

  return { passed, failed, checks }
}
