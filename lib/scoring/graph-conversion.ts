import type { MeasurementGraph, Beam, CircumferencePoint, Tine, Vec2, MeasurementProvenance } from '@/lib/types'
import type { AntlerMeasurementGraph, MeasurementGraphNode } from '@/lib/detection/types'

const TINE_LABELS = ['G1', 'G2', 'G3', 'G4'] as const
const CIRCUMFERENCE_RATIOS = [0.15, 0.35, 0.6, 0.8]
const CIRCUMFERENCE_LABELS = ['H1', 'H2', 'H3', 'H4'] as const

// ── helpers ───────────────────────────────────────────────────────────────────

function average(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

function toVec2(node: MeasurementGraphNode | null | undefined, fallback: Vec2): Vec2 {
  if (node?.point) return { x: node.point.x, y: node.point.y }
  return fallback
}

function polylineLength(points: Vec2[]): number {
  let total = 0
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x
    const dy = points[i].y - points[i - 1].y
    total += Math.sqrt(dx * dx + dy * dy)
  }
  return total
}

function samplePointOnPolyline(points: Vec2[], ratio: number): Vec2 {
  if (points.length === 0) return { x: 0, y: 0 }
  if (points.length === 1) return points[0]

  const clamped = Math.max(0, Math.min(1, ratio))
  const segments: number[] = []
  let totalLength = 0

  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x
    const dy = points[i].y - points[i - 1].y
    const segLen = Math.sqrt(dx * dx + dy * dy)
    segments.push(segLen)
    totalLength += segLen
  }

  if (totalLength === 0) return points[0]

  const target = totalLength * clamped
  let traveled = 0

  for (let i = 0; i < segments.length; i++) {
    if (traveled + segments[i] >= target) {
      const t = (target - traveled) / segments[i]
      return {
        x: points[i].x + (points[i + 1].x - points[i].x) * t,
        y: points[i].y + (points[i + 1].y - points[i].y) * t,
      }
    }
    traveled += segments[i]
  }

  return points[points.length - 1]
}

function getNodesByType(
  graph: AntlerMeasurementGraph,
  type: MeasurementGraphNode['type'],
  side?: MeasurementGraphNode['side'],
): MeasurementGraphNode[] {
  return graph.nodes.filter(
    (node) => node.type === type && (!side || node.side === side),
  )
}

function getBestNode(
  graph: AntlerMeasurementGraph,
  type: MeasurementGraphNode['type'],
  side?: MeasurementGraphNode['side'],
): MeasurementGraphNode | null {
  const matches = getNodesByType(graph, type, side).filter((n) => !!n.point)
  if (matches.length === 0) return null
  return matches.sort((a, b) => b.confidence - a.confidence)[0]
}

function sourceIndexToAngle(index: number | null | undefined): 'front' | 'left' | 'right' | 'unknown' {
  if (index === 0) return 'front'
  if (index === 1) return 'left'
  if (index === 2) return 'right'
  return 'unknown'
}

// ── beam builder ──────────────────────────────────────────────────────────────

function buildBeam(
  graph: AntlerMeasurementGraph,
  side: 'left' | 'right',
  fallbackX: number,
): Beam {
  const burr = getBestNode(graph, side === 'left' ? 'burr_left' : 'burr_right', side)
  const tip = getBestNode(graph, side === 'left' ? 'beam_tip_left' : 'beam_tip_right', side)
  const curveNodes = getNodesByType(graph, 'beam_curve', side)
    .filter((n) => !!n.point)
    .sort((a, b) => (b.point?.y ?? 0) - (a.point?.y ?? 0))

  const fallbackBase: Vec2 = { x: fallbackX, y: 430 }
  const fallbackTip: Vec2 = { x: fallbackX + (side === 'left' ? 30 : -30), y: 180 }

  const rawPoints: Vec2[] = [
    toVec2(burr, fallbackBase),
    ...curveNodes.map((n) => toVec2(n, fallbackBase)),
    toVec2(tip, fallbackTip),
  ]

  // Deduplicate consecutive identical points
  const points = rawPoints.filter((pt, idx, arr) => {
    if (idx === 0) return true
    return arr[idx - 1].x !== pt.x || arr[idx - 1].y !== pt.y
  })

  const pointSources = [burr, ...curveNodes, tip].filter(
    (n): n is MeasurementGraphNode => n !== null,
  )

  const uniqueSourceIndexes = [
    ...new Set(
      pointSources
        .map((n) => n.sourceImageIndex)
        .filter((v): v is number => typeof v === 'number'),
    ),
  ]

  const sourceAngle =
    uniqueSourceIndexes.length === 1 ? sourceIndexToAngle(uniqueSourceIndexes[0]) : 'unknown'
  const source = sourceAngle === 'unknown' ? 'fused' : sourceAngle

  const confidence = average(pointSources.map((n) => n.confidence))
  const hasFallbackGeometry = !burr?.point || !tip?.point
  const hasVisibleBeamPath = !hasFallbackGeometry && pointSources.length >= 2

  const provenance: MeasurementProvenance = {
    origin: 'ai',
    visibility: hasVisibleBeamPath ? 'visible' : 'inferred',
    sourceImageIndex: uniqueSourceIndexes.length === 1 ? uniqueSourceIndexes[0] : null,
    sourceImageAngle:
      uniqueSourceIndexes.length === 1
        ? sourceIndexToAngle(uniqueSourceIndexes[0])
        : 'unknown',
    confidence,
    notes: hasFallbackGeometry ? 'Beam geometry contains inferred fallback endpoint(s)' : null,
  }

  return {
    id: `beam-${side}`,
    points,
    length: polylineLength(points),
    confidence,
    source,
    provenance,
  }
}

// ── tine builder ──────────────────────────────────────────────────────────────

function buildTines(graph: AntlerMeasurementGraph): Tine[] {
  const tines: Tine[] = []

  for (const side of ['left', 'right'] as const) {
    const baseNodes = getNodesByType(graph, 'tine_base', side)
      .filter((n) => !!n.point)
      .sort((a, b) => (b.point?.y ?? 0) - (a.point?.y ?? 0))

    const tipNodes = getNodesByType(graph, 'tine_tip', side)
      .filter((n) => !!n.point)
      .sort((a, b) => (b.point?.y ?? 0) - (a.point?.y ?? 0))

    const count = Math.min(baseNodes.length, tipNodes.length, TINE_LABELS.length)

    for (let i = 0; i < count; i++) {
      const base = toVec2(baseNodes[i], { x: side === 'left' ? 170 : 330, y: 360 - i * 45 })
      const tipPt = toVec2(tipNodes[i], { x: side === 'left' ? 130 : 370, y: 300 - i * 55 })
      const dx = tipPt.x - base.x
      const dy = tipPt.y - base.y
      const tineConf = average([baseNodes[i]?.confidence ?? 0, tipNodes[i]?.confidence ?? 0])
      const baseSrcIdx = typeof baseNodes[i]?.sourceImageIndex === 'number' ? baseNodes[i].sourceImageIndex : null

      const tineProvenance: MeasurementProvenance = {
        origin: 'ai',
        visibility: baseNodes[i]?.point && tipNodes[i]?.point ? 'visible' : 'inferred',
        sourceImageIndex: baseSrcIdx,
        sourceImageAngle: sourceIndexToAngle(baseSrcIdx),
        confidence: tineConf,
      }

      tines.push({
        id: `${TINE_LABELS[i].toLowerCase()}-${side}`,
        side,
        parentBeamId: `beam-${side}`,
        basePoint: base,
        tipPoint: tipPt,
        length: Math.sqrt(dx * dx + dy * dy),
        label: TINE_LABELS[i],
        confidence: tineConf,
        provenance: tineProvenance,
      })
    }
  }

  return tines
}

// ── spread builder ────────────────────────────────────────────────────────────

function buildSpread(
  graph: AntlerMeasurementGraph,
  leftBeam: Beam,
  rightBeam: Beam,
) {
  const leftAnchor =
    getBestNode(graph, 'spread_anchor_left', 'left') ??
    getBestNode(graph, 'burr_left', 'left')
  const rightAnchor =
    getBestNode(graph, 'spread_anchor_right', 'right') ??
    getBestNode(graph, 'burr_right', 'right')

  const fallbackLeft = leftBeam.points[0] ?? { x: 160, y: 430 }
  const fallbackRight = rightBeam.points[0] ?? { x: 340, y: 430 }

  const leftPoint = toVec2(leftAnchor, fallbackLeft)
  const rightPoint = toVec2(rightAnchor, fallbackRight)
  const dx = rightPoint.x - leftPoint.x
  const dy = rightPoint.y - leftPoint.y
  const spreadConf = average([
    leftAnchor?.confidence ?? leftBeam.confidence,
    rightAnchor?.confidence ?? rightBeam.confidence,
  ])

  const spreadProvenance: MeasurementProvenance = {
    origin: 'ai',
    visibility: leftAnchor?.point && rightAnchor?.point ? 'visible' : 'inferred',
    sourceImageAngle:
      leftAnchor?.sourceImageIndex === rightAnchor?.sourceImageIndex
        ? sourceIndexToAngle(leftAnchor?.sourceImageIndex)
        : 'unknown',
    confidence: spreadConf,
    notes:
      leftAnchor?.point && rightAnchor?.point
        ? null
        : 'Spread geometry contains inferred fallback anchor(s)',
  }

  return {
    leftPoint,
    rightPoint,
    distance: Math.sqrt(dx * dx + dy * dy),
    confidence: spreadConf,
    provenance: spreadProvenance,
  }
}

// ── circumference builder ─────────────────────────────────────────────────────

function buildCircumferences(leftBeam: Beam, rightBeam: Beam): CircumferencePoint[] {
  const circumferences: CircumferencePoint[] = []

  for (const side of ['left', 'right'] as const) {
    const beam = side === 'left' ? leftBeam : rightBeam

    CIRCUMFERENCE_RATIOS.forEach((ratio, index) => {
      const circConf = Math.max(0.2, beam.confidence * 0.7)
      circumferences.push({
        id: `${CIRCUMFERENCE_LABELS[index].toLowerCase()}-${side}`,
        side,
        label: CIRCUMFERENCE_LABELS[index],
        position: samplePointOnPolyline(beam.points, ratio),
        circumference: 0,
        confidence: circConf,
        provenance: {
          origin: 'ai',
          visibility: 'inferred',
          sourceImageAngle: beam.source === 'fused' ? 'unknown' : beam.source,
          confidence: circConf,
          notes: 'Sampled from beam polyline; not directly measured',
        },
      })
    })
  }

  return circumferences
}

// ── public API ────────────────────────────────────────────────────────────────

/**
 * Convert an AntlerMeasurementGraph produced by the detection pipeline into
 * the canonical MeasurementGraph used by the scoring engine, overlay editor,
 * and results display.
 */
export function convertDetectionGraphToMeasurementGraph(
  detectionGraph: AntlerMeasurementGraph,
): MeasurementGraph {
  const leftBeam = buildBeam(detectionGraph, 'left', 160)
  const rightBeam = buildBeam(detectionGraph, 'right', 340)
  const tines = buildTines(detectionGraph)
  const spread = buildSpread(detectionGraph, leftBeam, rightBeam)
  const circumferences = buildCircumferences(leftBeam, rightBeam)

  return {
    beams: { left: leftBeam, right: rightBeam },
    tines,
    spread,
    circumferences,
  }
}
