import 'server-only'
import { getServiceSupabase } from '@/lib/supabase/admin'
import { convertDetectionGraphToMeasurementGraph } from '@/lib/scoring/graph-conversion'
import type { MeasurementGraph } from '@/lib/types'
import type { AntlerMeasurementGraph } from '@/lib/detection/types'

export type EffectiveGraphSource =
  | 'persisted_graph'
  | 'prediction_graph'
  | 'fallback'

export interface EffectiveGraphResult {
  graph: MeasurementGraph
  source: EffectiveGraphSource
  version: number | null
  graphId: string | null
  predictionId: string | null
  measurementGraphsAvailable: boolean
}

const FALLBACK_GRAPH: MeasurementGraph = {
  beams: {
    left: {
      id: 'beam-left',
      points: [
        { x: 160, y: 430 },
        { x: 170, y: 340 },
        { x: 185, y: 255 },
        { x: 200, y: 180 },
      ],
      length: 0,
      confidence: 0,
      source: 'fused',
      provenance: { origin: 'ai', visibility: 'inferred' },
    },
    right: {
      id: 'beam-right',
      points: [
        { x: 340, y: 430 },
        { x: 330, y: 340 },
        { x: 315, y: 255 },
        { x: 300, y: 180 },
      ],
      length: 0,
      confidence: 0,
      source: 'fused',
      provenance: { origin: 'ai', visibility: 'inferred' },
    },
  },
  tines: [],
  spread: {
    leftPoint: { x: 160, y: 430 },
    rightPoint: { x: 340, y: 430 },
    distance: 0,
    confidence: 0,
    provenance: { origin: 'ai', visibility: 'inferred' },
  },
  circumferences: [],
}

function isMissingSchemaError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as Record<string, unknown>
  const code = String(e.code ?? '')
  const message = String(e.message ?? e.error ?? '').toLowerCase()
  return (
    code === '42P01' ||
    code === '42703' ||
    code === 'PGRST116' ||
    message.includes('schema cache') ||
    message.includes('does not exist') ||
    message.includes('undefined table') ||
    message.includes('undefined column') ||
    message.includes('column') ||
    (message.includes('relation') && message.includes('not exist'))
  )
}

function isMissingTableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as Record<string, unknown>
  const code = String(e.code ?? '')
  const message = String(e.message ?? e.error ?? '').toLowerCase()
  return (
    code === '42P01' ||
    message.includes('schema cache') ||
    message.includes('undefined table') ||
    (message.includes('relation') && message.includes('not exist'))
  )
}

function isMeasurementGraph(value: unknown): value is MeasurementGraph {
  if (!value || typeof value !== 'object') return false
  const graph = value as Partial<MeasurementGraph>
  return (
    !!graph.beams &&
    !!graph.beams.left &&
    !!graph.beams.right &&
    !!graph.spread &&
    Array.isArray(graph.tines) &&
    Array.isArray(graph.circumferences)
  )
}

function isDetectionGraph(value: unknown): value is AntlerMeasurementGraph {
  if (!value || typeof value !== 'object') return false
  const graph = value as Partial<AntlerMeasurementGraph>
  return Array.isArray(graph.nodes) && Array.isArray(graph.edges)
}

function extractDetectionGraph(raw: unknown, depth = 0): AntlerMeasurementGraph | null {
  if (!raw || typeof raw !== 'object' || depth > 4) return null
  if (isDetectionGraph(raw)) return raw

  const record = raw as Record<string, unknown>
  const candidateKeys = [
    'measurementGraph',
    'measurement_graph',
    'graph',
    'detection',
    'raw_response',
    'rawResponse',
    'raw_ai_response',
    'result',
    'response',
  ]

  for (const key of candidateKeys) {
    const found = extractDetectionGraph(record[key], depth + 1)
    if (found) return found
  }

  return null
}

async function queryPersistedGraph(
  supabase: Awaited<ReturnType<typeof getServiceSupabase>>,
  buckId: string,
  key: 'buck_id' | 'rack_id',
) {
  return supabase
    .from('measurement_graphs')
    .select('id, graph, version, confidence')
    .eq(key, buckId)
    .order('version', { ascending: false })
    .limit(1)
}

async function queryLatestPrediction(
  supabase: Awaited<ReturnType<typeof getServiceSupabase>>,
  buckId: string,
  key: 'buck_id' | 'rack_id',
) {
  return supabase
    .from('predictions')
    .select('*')
    .eq(key, buckId)
    .order('created_at', { ascending: false })
    .limit(1)
}

function fallbackResult(measurementGraphsAvailable: boolean): EffectiveGraphResult {
  return {
    graph: FALLBACK_GRAPH,
    source: 'fallback',
    version: null,
    graphId: null,
    predictionId: null,
    measurementGraphsAvailable,
  }
}

export async function loadEffectiveMeasurementGraph(
  buckId: string,
): Promise<EffectiveGraphResult> {
  try {
    const supabase = await getServiceSupabase()
    let measurementGraphsAvailable = true

    for (const key of ['buck_id', 'rack_id'] as const) {
      const { data, error } = await queryPersistedGraph(supabase, buckId, key)

      if (!error && data && data.length > 0) {
        const row = data[0] as Record<string, unknown>
        if (isMeasurementGraph(row.graph)) {
          return {
            graph: row.graph,
            source: 'persisted_graph',
            version: typeof row.version === 'number' ? row.version : null,
            graphId: typeof row.id === 'string' ? row.id : null,
            predictionId: null,
            measurementGraphsAvailable: true,
          }
        }
        console.warn('[load-graph] malformed persisted graph skipped', { buckId, key })
      }

      if (error) {
        if (isMissingSchemaError(error)) {
          if (isMissingTableError(error)) measurementGraphsAvailable = false
          continue
        }
        console.warn('[load-graph] persisted graph query failed, trying next source', {
          buckId,
          key,
          error: error.message,
        })
      }
    }

    for (const key of ['buck_id', 'rack_id'] as const) {
      const { data, error } = await queryLatestPrediction(supabase, buckId, key)

      if (!error && data && data.length > 0) {
        const row = data[0] as Record<string, unknown>
        const detectionGraph = extractDetectionGraph(row)
        if (detectionGraph) {
          try {
            return {
              graph: convertDetectionGraphToMeasurementGraph(detectionGraph),
              source: 'prediction_graph',
              version: null,
              graphId: null,
              predictionId: typeof row.id === 'string' ? row.id : null,
              measurementGraphsAvailable,
            }
          } catch (convertError) {
            console.warn('[load-graph] prediction graph conversion failed', {
              buckId,
              key,
              error: convertError instanceof Error ? convertError.message : String(convertError),
            })
          }
        }
      }

      if (error && !isMissingSchemaError(error)) {
        console.warn('[load-graph] prediction graph query failed, trying next source', {
          buckId,
          key,
          error: error.message,
        })
      }
    }

    return fallbackResult(measurementGraphsAvailable)
  } catch (error) {
    console.error('[load-graph] unexpected error:', error instanceof Error ? error.message : String(error))
    return fallbackResult(false)
  }
}
