/**
 * Graph-native scoring module.
 *
 * This scorer treats the MeasurementGraph as the structural truth while staying
 * honest about missing measurements. It never invents circumference values and
 * never returns NaN.
 */

import { getGraphConfidence } from '@/lib/scoring'
import type { MeasurementGraph, Vec2 } from '@/lib/types'

export type { ScoreBreakdown } from '@/lib/scoring'

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
  confidence: number
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function finitePositive(value: unknown): value is number {
  return finiteNumber(value) && value > 0
}

function safeValue(value: unknown): number {
  return finitePositive(value) ? value : 0
}

function isPoint(point: unknown): point is Vec2 {
  return (
    !!point &&
    typeof point === 'object' &&
    finiteNumber((point as Vec2).x) &&
    finiteNumber((point as Vec2).y)
  )
}

function dist(a: unknown, b: unknown): number {
  if (!isPoint(a) || !isPoint(b)) return 0
  const dx = b.x - a.x
  const dy = b.y - a.y
  return Math.sqrt(dx * dx + dy * dy)
}

function polylineLength(points: unknown): number {
  if (!Array.isArray(points) || points.length < 2) return 0
  let total = 0
  for (let i = 1; i < points.length; i++) {
    total += dist(points[i - 1], points[i])
  }
  return Number.isFinite(total) ? total : 0
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function resolveBeamLength(
  storedLength: unknown,
  points: unknown,
  warningLabel: string,
  warnings: string[],
): number {
  if (finitePositive(storedLength)) return storedLength
  const fallback = polylineLength(points)
  if (finitePositive(fallback)) {
    warnings.push(`${warningLabel} length derived from beam polyline fallback`)
    return fallback
  }
  return 0
}

function resolveTineLength(tine: { length?: unknown; basePoint?: unknown; tipPoint?: unknown }): number {
  if (finitePositive(tine.length)) return tine.length
  return dist(tine.basePoint, tine.tipPoint)
}

function calculatePairedDeduction(
  left: number | null,
  right: number | null,
  label: string,
  warnings: string[],
): number {
  if (finitePositive(left) && finitePositive(right)) {
    return Math.abs(left - right)
  }
  if (finitePositive(left) || finitePositive(right)) {
    warnings.push(`${label} deduction incomplete because one side is missing`)
  }
  return 0
}

export function scoreFromGraph(graph: MeasurementGraph): GraphScoreResult {
  const warnings: string[] = []
  const missingMeasurements: string[] = []
  const measurements: GraphScoreResult['measurements'] = []

  const leftBeam = resolveBeamLength(
    graph.beams?.left?.length,
    graph.beams?.left?.points,
    'Left main beam',
    warnings,
  )
  const leftBeamMissing = !finitePositive(leftBeam)
  if (leftBeamMissing) missingMeasurements.push('beam-left')
  measurements.push({
    id: 'beam-left',
    label: 'Left Main Beam',
    side: 'left',
    type: 'beam',
    value: safeValue(leftBeam),
    isMissing: leftBeamMissing,
  })

  const rightBeam = resolveBeamLength(
    graph.beams?.right?.length,
    graph.beams?.right?.points,
    'Right main beam',
    warnings,
  )
  const rightBeamMissing = !finitePositive(rightBeam)
  if (rightBeamMissing) missingMeasurements.push('beam-right')
  measurements.push({
    id: 'beam-right',
    label: 'Right Main Beam',
    side: 'right',
    type: 'beam',
    value: safeValue(rightBeam),
    isMissing: rightBeamMissing,
  })

  const insideSpread = finitePositive(graph.spread?.distance)
    ? graph.spread.distance
    : dist(graph.spread?.leftPoint, graph.spread?.rightPoint)
  const spreadMissing = !finitePositive(insideSpread)
  if (spreadMissing) missingMeasurements.push('spread')
  if (!finitePositive(graph.spread?.distance) && finitePositive(insideSpread)) {
    warnings.push('Inside spread derived from anchor-point fallback')
  }
  measurements.push({
    id: 'spread',
    label: 'Inside Spread',
    side: 'n/a',
    type: 'spread',
    value: safeValue(insideSpread),
    isMissing: spreadMissing,
  })

  const corePresent = [!leftBeamMissing, !rightBeamMissing, !spreadMissing].filter(Boolean).length
  const coreScore = corePresent / 3

  let tineTotal = 0
  let tinePresent = 0
  const tineBySide = new Map<string, { left?: number; right?: number }>()

  for (const tine of graph.tines ?? []) {
    const length = resolveTineLength(tine)
    const isMissing = !finitePositive(length)
    if (isMissing) {
      missingMeasurements.push(tine.id)
    } else {
      tineTotal += length
      tinePresent++
    }

    const pair = tineBySide.get(tine.label) ?? {}
    pair[tine.side] = finitePositive(length) ? length : undefined
    tineBySide.set(tine.label, pair)

    measurements.push({
      id: tine.id,
      label: `${tine.label} ${tine.side.charAt(0).toUpperCase()}${tine.side.slice(1)}`,
      side: tine.side,
      type: 'tine',
      value: safeValue(length),
      isMissing,
    })
  }

  const tineCount = graph.tines?.length ?? 0
  const tineScore = tineCount > 0 ? tinePresent / tineCount : 1

  let circumferenceTotal = 0
  let circumferencePresent = 0
  const circumferenceBySide = new Map<string, { left?: number; right?: number }>()

  for (const circumference of graph.circumferences ?? []) {
    const value = circumference.circumference
    const isMissing = !finitePositive(value)
    if (isMissing) {
      missingMeasurements.push(circumference.id)
    } else {
      circumferenceTotal += value
      circumferencePresent++
    }

    const pair = circumferenceBySide.get(circumference.label) ?? {}
    pair[circumference.side] = finitePositive(value) ? value : undefined
    circumferenceBySide.set(circumference.label, pair)

    measurements.push({
      id: circumference.id,
      label: `${circumference.label} ${circumference.side.charAt(0).toUpperCase()}${circumference.side.slice(1)}`,
      side: circumference.side,
      type: 'circumference',
      value: safeValue(value),
      isMissing,
    })
  }

  const circumferenceCount = graph.circumferences?.length ?? 0
  const circumferenceScore =
    circumferenceCount > 0 ? circumferencePresent / circumferenceCount : 0
  if (circumferenceCount === 0) {
    warnings.push('Graph has no circumference measurements; completeness reduced')
  } else if (circumferencePresent === 0) {
    warnings.push('No circumference values present; circumferences excluded from gross score')
  }

  let abnormalTotal = 0
  const graphRecord = graph as unknown as Record<string, unknown>
  if ('abnormalPoints' in graphRecord) {
    const abnormalPoints = graphRecord.abnormalPoints
    if (Array.isArray(abnormalPoints)) {
      for (const point of abnormalPoints) {
        const length = (point as { length?: unknown })?.length
        if (finitePositive(length)) abnormalTotal += length
      }
    }
  } else {
    warnings.push('Abnormal point graph support not present')
  }

  let deductionTotal = 0
  deductionTotal += calculatePairedDeduction(
    leftBeamMissing ? null : leftBeam,
    rightBeamMissing ? null : rightBeam,
    'Main beam',
    warnings,
  )

  for (const [label, pair] of tineBySide) {
    deductionTotal += calculatePairedDeduction(
      pair.left ?? null,
      pair.right ?? null,
      `${label} tine`,
      warnings,
    )
  }

  for (const [label, pair] of circumferenceBySide) {
    deductionTotal += calculatePairedDeduction(
      pair.left ?? null,
      pair.right ?? null,
      `${label} circumference`,
      warnings,
    )
  }

  const grossScore =
    safeValue(leftBeam) +
    safeValue(rightBeam) +
    safeValue(insideSpread) +
    safeValue(tineTotal) +
    safeValue(circumferenceTotal) +
    safeValue(abnormalTotal)

  const safeDeductionTotal = safeValue(deductionTotal)
  const netScore = grossScore - safeDeductionTotal
  const completeness = clamp01(coreScore * 0.4 + tineScore * 0.35 + circumferenceScore * 0.25)
  const confidence = getGraphConfidence(graph)

  return {
    grossScore,
    netScore: Number.isFinite(netScore) ? netScore : 0,
    deductionTotal: safeDeductionTotal,
    abnormalTotal: safeValue(abnormalTotal),
    leftBeam: safeValue(leftBeam),
    rightBeam: safeValue(rightBeam),
    insideSpread: safeValue(insideSpread),
    tineTotal: safeValue(tineTotal),
    circumferenceTotal: safeValue(circumferenceTotal),
    measurements,
    completeness,
    missingMeasurements,
    warnings,
    confidence: Number.isFinite(confidence) ? confidence : 0,
  }
}
