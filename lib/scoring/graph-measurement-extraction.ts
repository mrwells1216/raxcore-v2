/**
 * graph-measurement-extraction.ts
 *
 * Phase 3: Graph-native scoring extraction helpers.
 *
 * Responsibilities:
 * - Derive a pixel→inch scale factor by cross-referencing known legacy inch
 *   measurements against the corresponding graph pixel lengths.
 * - Compute graph completeness (fraction of expected segments present with
 *   meaningful values).
 * - Provide a calibrated graph measurement set (in inches) ready for scoring.
 */

import type { MeasurementGraph } from '@/lib/types'
import type { Measurements } from '@/lib/types'

// ---------------------------------------------------------------------------
// Scale factor derivation
// ---------------------------------------------------------------------------

/**
 * Estimate the pixel-to-inch scale factor for a graph using legacy
 * measurement values as ground truth anchors.
 *
 * Uses up to three anchors in priority order:
 *   1. main_beam_left  vs  graph.beams.left.length
 *   2. main_beam_right vs  graph.beams.right.length
 *   3. inside_spread   vs  graph.spread.distance
 *
 * Returns 1.0 (identity — no scaling) when no usable anchor exists.
 */
export function derivePixelToInchScale(
  graph: MeasurementGraph,
  legacyMeasurements: Partial<Measurements> | null | undefined
): number {
  if (!legacyMeasurements) return 1.0

  const anchors: Array<[number, number]> = []

  const beamLeftInches = legacyMeasurements.main_beam_left
  const beamRightInches = legacyMeasurements.main_beam_right
  const spreadInches = legacyMeasurements.inside_spread

  if (
    typeof beamLeftInches === 'number' &&
    beamLeftInches > 0 &&
    graph.beams.left.length > 0
  ) {
    anchors.push([beamLeftInches, graph.beams.left.length])
  }

  if (
    typeof beamRightInches === 'number' &&
    beamRightInches > 0 &&
    graph.beams.right.length > 0
  ) {
    anchors.push([beamRightInches, graph.beams.right.length])
  }

  if (
    typeof spreadInches === 'number' &&
    spreadInches > 0 &&
    graph.spread.distance > 0
  ) {
    anchors.push([spreadInches, graph.spread.distance])
  }

  if (anchors.length === 0) return 1.0

  // Compute per-anchor scale (inches / pixels) then average
  const scales = anchors.map(([inches, pixels]) => inches / pixels)
  const avgScale = scales.reduce((a, b) => a + b, 0) / scales.length

  // Sanity clamp: refuse wildly implausible scales (< 0.01 or > 10)
  if (avgScale < 0.01 || avgScale > 10) return 1.0

  return avgScale
}

// ---------------------------------------------------------------------------
// Graph completeness
// ---------------------------------------------------------------------------

/** Count of segments that are always expected in a complete graph */
const EXPECTED_SEGMENT_COUNT = 2 + 1 + 4 + 8
// beams(2) + spread(1) + tines per side up to 2 per side = 4 + circum per side up to 4 per side = 8
// More conservative definition: beams (2) + spread (1) + at least 1 tine per side (2) + at least 1 circ per side (2) = 7

const MINIMUM_EXPECTED = 7

export interface GraphCompleteness {
  /** 0–1 fraction: (present meaningful segments) / MINIMUM_EXPECTED */
  completeness: number
  /** Which measurement IDs are missing or have zero values */
  missingMeasurements: string[]
}

/**
 * Compute graph completeness and list missing measurements.
 * A segment is "present" if its primary length/distance value > 0 and
 * confidence > 0.
 */
export function computeGraphCompleteness(
  graph: MeasurementGraph,
  scale: number
): GraphCompleteness {
  const missing: string[] = []
  let present = 0

  // Beams
  const leftBeamInches = graph.beams.left.length * scale
  if (leftBeamInches > 0 && graph.beams.left.confidence > 0) {
    present++
  } else {
    missing.push('beam-left')
  }

  const rightBeamInches = graph.beams.right.length * scale
  if (rightBeamInches > 0 && graph.beams.right.confidence > 0) {
    present++
  } else {
    missing.push('beam-right')
  }

  // Spread
  const spreadInches = graph.spread.distance * scale
  if (spreadInches > 0 && graph.spread.confidence > 0) {
    present++
  } else {
    missing.push('spread')
  }

  // Tines — expect at least 1 per side
  const leftTines = graph.tines.filter((t) => t.side === 'left' && t.length > 0)
  const rightTines = graph.tines.filter((t) => t.side === 'right' && t.length > 0)

  if (leftTines.length > 0) {
    present++
  } else {
    missing.push('tine-left-any')
  }

  if (rightTines.length > 0) {
    present++
  } else {
    missing.push('tine-right-any')
  }

  // Circumferences — expect at least 1 per side (but they default to 0, so
  // treat as optional for completeness; only count present, never penalise)
  const leftCircs = graph.circumferences.filter((c) => c.side === 'left' && c.circumference > 0)
  const rightCircs = graph.circumferences.filter((c) => c.side === 'right' && c.circumference > 0)

  if (leftCircs.length > 0) present++
  if (rightCircs.length > 0) present++

  const completeness = Math.min(1, present / MINIMUM_EXPECTED)

  return { completeness, missingMeasurements: missing }
}

// ---------------------------------------------------------------------------
// Calibrated measurement set (graph → inches)
// ---------------------------------------------------------------------------

export interface GraphMeasurementSet {
  leftBeam: number
  rightBeam: number
  spread: number
  tines: Array<{ id: string; side: 'left' | 'right'; label: string; inches: number }>
  circumferences: Array<{ id: string; side: 'left' | 'right'; label: string; inches: number }>
  /** Gross B&C score computed from these measurements */
  grossScore: number
  /** Net score (gross minus deductions) */
  netScore: number
  /** Sum of symmetric deductions */
  deductions: number
  /** The scale factor used */
  pixelToInchScale: number
}

/**
 * Extract calibrated inch measurements from a graph.
 *
 * @param graph              The MeasurementGraph to extract from.
 * @param pixelToInchScale   Conversion factor (inches per pixel).
 */
export function extractGraphMeasurements(
  graph: MeasurementGraph,
  pixelToInchScale: number
): GraphMeasurementSet {
  const s = pixelToInchScale

  const leftBeam = round1(graph.beams.left.length * s)
  const rightBeam = round1(graph.beams.right.length * s)
  const spread = round1(graph.spread.distance * s)

  const tines = graph.tines.map((t) => ({
    id: t.id,
    side: t.side,
    label: t.label,
    inches: round1(t.length * s),
  }))

  const circumferences = graph.circumferences.map((c) => ({
    id: c.id,
    side: c.side,
    label: c.label,
    inches: round1(c.circumference * s), // circumference may already be 0 (not measured yet)
  }))

  // Gross = beams + spread + all tines + all circumferences
  let gross = leftBeam + rightBeam + spread
  tines.forEach((t) => { gross += t.inches })
  circumferences.forEach((c) => { gross += c.inches })

  // Deductions = beam diff + per-label tine diffs + per-label circ diffs
  const deductions = computeDeductions(leftBeam, rightBeam, tines, circumferences)
  const net = round1(gross - deductions)

  return {
    leftBeam,
    rightBeam,
    spread,
    tines,
    circumferences,
    grossScore: round1(gross),
    netScore: net,
    deductions: round1(deductions),
    pixelToInchScale: s,
  }
}

function round1(n: number): number {
  return Number(n.toFixed(1))
}

function computeDeductions(
  leftBeam: number,
  rightBeam: number,
  tines: Array<{ side: 'left' | 'right'; label: string; inches: number }>,
  circs: Array<{ side: 'left' | 'right'; label: string; inches: number }>
): number {
  let d = Math.abs(leftBeam - rightBeam)

  const leftTineMap = new Map<string, number>()
  const rightTineMap = new Map<string, number>()
  tines.forEach((t) => {
    if (t.side === 'left') leftTineMap.set(t.label, t.inches)
    else rightTineMap.set(t.label, t.inches)
  })
  const tineLabels = new Set([...leftTineMap.keys(), ...rightTineMap.keys()])
  tineLabels.forEach((label) => {
    d += Math.abs((leftTineMap.get(label) ?? 0) - (rightTineMap.get(label) ?? 0))
  })

  const leftCircMap = new Map<string, number>()
  const rightCircMap = new Map<string, number>()
  circs.forEach((c) => {
    if (c.side === 'left') leftCircMap.set(c.label, c.inches)
    else rightCircMap.set(c.label, c.inches)
  })
  const circLabels = new Set([...leftCircMap.keys(), ...rightCircMap.keys()])
  circLabels.forEach((label) => {
    d += Math.abs((leftCircMap.get(label) ?? 0) - (rightCircMap.get(label) ?? 0))
  })

  return d
}
