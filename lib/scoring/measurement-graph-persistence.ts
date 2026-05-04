import { createClient } from '@/lib/supabase/server'
import type {
  MeasurementGraph,
  Beam,
  CircumferencePoint,
  Tine,
  Vec2,
  GraphSource,
} from '@/lib/types'
import type {
  AntlerMeasurementGraph,
  MeasurementGraphNode,
} from '@/lib/detection/types'

type GraphPersistenceStatus =
  | 'stored'
  | 'skipped_no_graph'
  | 'skipped_existing'
  | 'skipped_missing_table'
  | 'skipped_insert_failed'

interface PersistInitialMeasurementGraphParams {
  buckId: string
  detectionGraph: AntlerMeasurementGraph | null
}

interface PersistInitialMeasurementGraphResult {
  status: GraphPersistenceStatus
  version?: number
  detail?: string
}

function isMissingTableError(error: unknown): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: string }).code === '42P01'
  )
}

function isMissingColumnError(error: unknown): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: string }).code === '42703'
  )
}

function average(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function polylineLength(points: Vec2[]): number {
  let total = 0
  for (let i = 1; i < points.length; i += 1) {
    const dx = points[i].x - points[i - 1].x
    const dy = points[i].y - points[i - 1].y
    total += Math.sqrt(dx * dx + dy * dy)
  }
  return total
}

function calculateDistance(a: Vec2, b: Vec2): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  return Math.sqrt(dx * dx + dy * dy)
}

function samplePointOnPolyline(points: Vec2[], ratio: number): Vec2 {
  if (points.length === 0) return { x: 0, y: 0 }
  if (points.length === 1) return points[0]

  const clampedRatio = Math.max(0, Math.min(1, ratio))
  const segmentLengths: number[] = []
  let totalLength = 0

  for (let i = 1; i < points.length; i += 1) {
    const length = calculateDistance(points[i - 1], points[i])
    segmentLengths.push(length)
    totalLength += length
  }

  if (totalLength === 0) return points[0]

  const target = totalLength * clampedRatio
  let traveled = 0

  for (let i = 0; i < segmentLengths.length; i += 1) {
    const segmentLength = segmentLengths[i]
    if (traveled + segmentLength >= target) {
      const localRatio = (target - traveled) / segmentLength
      return {
        x: points[i].x + (points[i + 1].x - points[i].x) * localRatio,
        y: points[i].y + (points[i + 1].y - points[i].y) * localRatio,
      }
    }
    traveled += segmentLength
  }

  return points[points.length - 1]
}

function toVec2(node: MeasurementGraphNode | null | undefined, fallback: Vec2): Vec2 {
  if (!node?.point) return fallback
  return { x: node.point.x, y: node.point.y }
}

function getNodesByType(
  graph: AntlerMeasurementGraph,
  type: MeasurementGraphNode['type'],
  side?: MeasurementGraphNode['side']
): MeasurementGraphNode[] {
  return graph.nodes.filter(
    (node) => node.type === type && (!side || node.side === side)
  )
}

function getBestNode(
  graph: AntlerMeasurementGraph,
  type: MeasurementGraphNode['type'],
  side?: MeasurementGraphNode['side']
): MeasurementGraphNode | null {
  const matches = getNodesByType(graph, type, side).filter((node) => !!node.point)
  if (matches.length === 0) return null
  return matches.sort((a, b) => b.confidence - a.confidence)[0]
}

function sourceFromImageIndexes(indexes: number[]): GraphSource {
  if (indexes.length !== 1) return 'fused'
  const index = indexes[0]
  if (index === 0) return 'front'
  if (index === 1) return 'left'
  if (index === 2) return 'right'
  return 'fused'
}

function buildBeam(
  graph: AntlerMeasurementGraph,
  side: 'left' | 'right',
  fallbackX: number
): Beam {
  const burr = getBestNode(graph, side === 'left' ? 'burr_left' : 'burr_right', side)
  const tip = getBestNode(graph, side === 'left' ? 'beam_tip_left' : 'beam_tip_right', side)
  const curveNodes = getNodesByType(graph, 'beam_curve', side)
    .filter((node) => !!node.point)
    .sort((a, b) => (b.point?.y ?? 0) - (a.point?.y ?? 0))

  const fallbackBase = { x: fallbackX, y: 430 }
  const fallbackTip = { x: fallbackX + (side === 'left' ? 30 : -30), y: 180 }

  const points = [
    toVec2(burr, fallbackBase),
    ...curveNodes.map((node) => toVec2(node, fallbackBase)),
    toVec2(tip, fallbackTip),
  ].filter((point, index, array) => {
    if (index === 0) return true
    const prev = array[index - 1]
    return prev.x !== point.x || prev.y !== point.y
  })

  const pointSources = [burr, ...curveNodes, tip].filter(Boolean) as MeasurementGraphNode[]
  const sourceImageIndexes = [
    ...new Set(
      pointSources
        .map((node) => node.sourceImageIndex)
        .filter((value): value is number => typeof value === 'number')
    ),
  ]

  return {
    id: `beam-${side}`,
    points,
    length: polylineLength(points),
    confidence: average(pointSources.map((node) => node.confidence)),
    source: sourceFromImageIndexes(sourceImageIndexes),
  }
}

function buildTines(graph: AntlerMeasurementGraph): Tine[] {
  const tineLabels = ['G1', 'G2', 'G3', 'G4'] as const
  const tines: Tine[] = []

  ;(['left', 'right'] as const).forEach((side) => {
    const baseNodes = getNodesByType(graph, 'tine_base', side)
      .filter((node) => !!node.point)
      .sort((a, b) => (b.point?.y ?? 0) - (a.point?.y ?? 0))

    const tipNodes = getNodesByType(graph, 'tine_tip', side)
      .filter((node) => !!node.point)
      .sort((a, b) => (b.point?.y ?? 0) - (a.point?.y ?? 0))

    const count = Math.min(baseNodes.length, tipNodes.length, tineLabels.length)

    for (let i = 0; i < count; i += 1) {
      const base = toVec2(baseNodes[i], {
        x: side === 'left' ? 170 : 330,
        y: 360 - i * 45,
      })
      const tip = toVec2(tipNodes[i], {
        x: side === 'left' ? 130 : 370,
        y: 300 - i * 55,
      })

      tines.push({
        id: `${tineLabels[i].toLowerCase()}-${side}`,
        side,
        parentBeamId: `beam-${side}`,
        basePoint: base,
        tipPoint: tip,
        length: calculateDistance(base, tip),
        label: tineLabels[i],
        confidence: average([
          baseNodes[i]?.confidence ?? 0,
          tipNodes[i]?.confidence ?? 0,
        ]),
      })
    }
  })

  return tines
}

function buildSpread(
  graph: AntlerMeasurementGraph,
  leftBeam: Beam,
  rightBeam: Beam
): MeasurementGraph['spread'] {
  const leftAnchor =
    getBestNode(graph, 'spread_anchor_left', 'left') ??
    getBestNode(graph, 'burr_left', 'left')

  const rightAnchor =
    getBestNode(graph, 'spread_anchor_right', 'right') ??
    getBestNode(graph, 'burr_right', 'right')

  const leftPoint = toVec2(leftAnchor, leftBeam.points[0] ?? { x: 160, y: 430 })
  const rightPoint = toVec2(rightAnchor, rightBeam.points[0] ?? { x: 340, y: 430 })

  return {
    leftPoint,
    rightPoint,
    distance: calculateDistance(leftPoint, rightPoint),
    confidence: average([
      leftAnchor?.confidence ?? leftBeam.confidence,
      rightAnchor?.confidence ?? rightBeam.confidence,
    ]),
  }
}

function buildCircumferences(leftBeam: Beam, rightBeam: Beam): CircumferencePoint[] {
  const labels = ['H1', 'H2', 'H3', 'H4'] as const
  const ratios = [0.15, 0.35, 0.6, 0.8]
  const circumferences: CircumferencePoint[] = []

  ;(['left', 'right'] as const).forEach((side) => {
    const beam = side === 'left' ? leftBeam : rightBeam

    ratios.forEach((ratio, index) => {
      circumferences.push({
        id: `${labels[index].toLowerCase()}-${side}`,
        side,
        label: labels[index],
        position: samplePointOnPolyline(beam.points, ratio),
        circumference: 0,
        confidence: Math.max(0.2, beam.confidence * 0.7),
      })
    })
  })

  return circumferences
}

function convertDetectionGraphToMeasurementGraph(
  detectionGraph: AntlerMeasurementGraph
): MeasurementGraph {
  const leftBeam = buildBeam(detectionGraph, 'left', 160)
  const rightBeam = buildBeam(detectionGraph, 'right', 340)
  const tines = buildTines(detectionGraph)
  const spread = buildSpread(detectionGraph, leftBeam, rightBeam)
  const circumferences = buildCircumferences(leftBeam, rightBeam)

  return {
    beams: {
      left: leftBeam,
      right: rightBeam,
    },
    tines,
    spread,
    circumferences,
  }
}

function calculateGraphConfidence(
  graph: MeasurementGraph,
  detectionGraph: AntlerMeasurementGraph
): number {
  if (Number.isFinite(detectionGraph.graphConfidence)) {
    return detectionGraph.graphConfidence
  }

  const confidences = [
    graph.beams.left.confidence,
    graph.beams.right.confidence,
    graph.spread.confidence,
    ...graph.tines.map((t) => t.confidence),
    ...graph.circumferences.map((c) => c.confidence),
  ].filter((value) => Number.isFinite(value))

  return confidences.length > 0 ? average(confidences) : 0
}

async function detectForeignKeyMode(
  supabase: Awaited<ReturnType<typeof createClient>>,
  buckId: string
): Promise<
  | { ok: true; foreignKey: 'buck_id' | 'rack_id'; existingCount: number }
  | { ok: false; reason: 'missing_table' | 'query_failed'; detail?: string }
> {
  const buckQuery = await supabase
    .from('measurement_graphs')
    .select('id', { count: 'exact', head: true })
    .eq('buck_id', buckId)

  if (!buckQuery.error) {
    return {
      ok: true,
      foreignKey: 'buck_id',
      existingCount: buckQuery.count ?? 0,
    }
  }

  if (isMissingTableError(buckQuery.error)) {
    return { ok: false, reason: 'missing_table' }
  }

  if (!isMissingColumnError(buckQuery.error)) {
    return {
      ok: false,
      reason: 'query_failed',
      detail: buckQuery.error.message,
    }
  }

  const rackQuery = await supabase
    .from('measurement_graphs')
    .select('id', { count: 'exact', head: true })
    .eq('rack_id', buckId)

  if (!rackQuery.error) {
    return {
      ok: true,
      foreignKey: 'rack_id',
      existingCount: rackQuery.count ?? 0,
    }
  }

  if (isMissingTableError(rackQuery.error)) {
    return { ok: false, reason: 'missing_table' }
  }

  return {
    ok: false,
    reason: 'query_failed',
    detail: rackQuery.error.message,
  }
}

async function insertInitialGraph(
  supabase: Awaited<ReturnType<typeof createClient>>,
  foreignKey: 'buck_id' | 'rack_id',
  buckId: string,
  graph: MeasurementGraph,
  confidence: number
): Promise<{ ok: true; version: number } | { ok: false; detail: string }> {
  const payload =
    foreignKey === 'buck_id'
      ? { buck_id: buckId, graph, confidence, version: 1 }
      : { rack_id: buckId, graph, confidence, version: 1 }

  const { data, error } = await supabase
    .from('measurement_graphs')
    .insert(payload)
    .select('version')
    .single()

  if (error) {
    return { ok: false, detail: error.message }
  }

  return { ok: true, version: data.version as number }
}

export async function persistInitialMeasurementGraph(
  params: PersistInitialMeasurementGraphParams
): Promise<PersistInitialMeasurementGraphResult> {
  if (!params.detectionGraph) {
    return {
      status: 'skipped_no_graph',
      detail: 'No detection graph was available during scoring.',
    }
  }

  try {
    const supabase = await createClient()

    const mode = await detectForeignKeyMode(supabase, params.buckId)

    if (!mode.ok) {
      if (mode.reason === 'missing_table') {
        return {
          status: 'skipped_missing_table',
          detail: 'measurement_graphs table is not available.',
        }
      }

      return {
        status: 'skipped_insert_failed',
        detail: mode.detail ?? 'Failed to query measurement_graphs.',
      }
    }

    if (mode.existingCount > 0) {
      return {
        status: 'skipped_existing',
        detail: 'A measurement graph already exists for this buck.',
      }
    }

    const graph = convertDetectionGraphToMeasurementGraph(params.detectionGraph)
    const confidence = calculateGraphConfidence(graph, params.detectionGraph)

    const inserted = await insertInitialGraph(
      supabase,
      mode.foreignKey,
      params.buckId,
      graph,
      confidence
    )

    if (!inserted.ok) {
      return {
        status: 'skipped_insert_failed',
        detail: inserted.detail,
      }
    }

    return {
      status: 'stored',
      version: inserted.version,
      detail: `Initial graph stored using ${mode.foreignKey}.`,
    }
  } catch (error) {
    return {
      status: 'skipped_insert_failed',
      detail: error instanceof Error ? error.message : 'Unknown graph persistence error.',
    }
  }
}
