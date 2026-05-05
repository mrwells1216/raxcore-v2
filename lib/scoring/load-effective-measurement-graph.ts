import 'server-only'
import { getServiceSupabase, isOptionalTableError } from '@/lib/supabase/admin'
import { convertDetectionGraphToMeasurementGraph } from '@/lib/scoring/graph-conversion'
import type { MeasurementGraph } from '@/lib/types'
import type { AntlerMeasurementGraph } from '@/lib/detection/types'

// ── Result type ───────────────────────────────────────────────────────────────

export type EffectiveGraphSource =
  | 'persisted_graph'   // Loaded from measurement_graphs table
  | 'prediction_graph'  // Converted from AntlerMeasurementGraph in prediction JSON
  | 'fallback'          // No usable graph found; caller should use legacy AI values

export interface EffectiveGraphResult {
  graph: MeasurementGraph
  source: EffectiveGraphSource
  /** Version number when source is persisted_graph */
  version: number | null
  /** measurement_graphs row id when source is persisted_graph */
  graphId: string | null
  /** prediction row id when source is prediction_graph */
  predictionId: string | null
  /** Whether the measurement_graphs table was reachable */
  measurementGraphsAvailable: boolean
}

// ── Minimal fallback graph ────────────────────────────────────────────────────

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

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Try to extract an AntlerMeasurementGraph from a raw prediction record.
 * Handles several field-naming conventions used across scoring versions.
 */
function extractDetectionGraph(
  raw: Record<string, unknown> | null,
): AntlerMeasurementGraph | null {
  if (!raw) return null

  // Direct field on the prediction row
  const direct = raw.measurementGraph ?? raw.measurement_graph
  if (direct && typeof direct === 'object' && 'nodes' in (direct as Record<string, unknown>)) {
    return direct as AntlerMeasurementGraph
  }

  // Nested inside raw_response / rawResponse
  for (const key of ['raw_response', 'rawResponse', 'raw_ai_response']) {
    const nested = raw[key]
    if (nested && typeof nested === 'object') {
      const inner = (nested as Record<string, unknown>).measurementGraph
        ?? (nested as Record<string, unknown>).measurement_graph
      if (inner && typeof inner === 'object' && 'nodes' in (inner as Record<string, unknown>)) {
        return inner as AntlerMeasurementGraph
      }
    }
  }

  // Inside detection summary
  const detection = raw.detection
  if (detection && typeof detection === 'object') {
    const graph = (detection as Record<string, unknown>).graph
    if (graph && typeof graph === 'object' && 'nodes' in (graph as Record<string, unknown>)) {
      return graph as AntlerMeasurementGraph
    }
  }

  return null
}

// ── Primary loader ────────────────────────────────────────────────────────────

/**
 * Load the best available MeasurementGraph for a buck.
 *
 * Priority:
 *  1. Latest persisted row in measurement_graphs (highest version first)
 *  2. AntlerMeasurementGraph from the latest prediction JSON, converted on-the-fly
 *  3. Zero-value fallback graph (caller should prefer legacy AI values in this case)
 *
 * This function NEVER throws; all errors are caught and logged.
 */
export async function loadEffectiveMeasurementGraph(
  buckId: string,
): Promise<EffectiveGraphResult> {
  try {
    const supabase = await getServiceSupabase()
    let measurementGraphsAvailable = true

    // ── 1. Try persisted measurement_graphs row ──────────────────────────────

    // Try buck_id column first
    const { data: graphRows, error: graphError } = await supabase
      .from('measurement_graphs')
      .select('id, graph, version, confidence')
      .eq('buck_id', buckId)
      .order('version', { ascending: false })
      .limit(1)

    if (!graphError && graphRows && graphRows.length > 0) {
      return {
        graph: graphRows[0].graph as MeasurementGraph,
        source: 'persisted_graph',
        version: graphRows[0].version,
        graphId: graphRows[0].id,
        predictionId: null,
        measurementGraphsAvailable: true,
      }
    }

    if (graphError) {
      if (isOptionalTableError(graphError)) {
        measurementGraphsAvailable = false
        console.warn('[load-graph] measurement_graphs table unavailable, falling back to prediction')
      } else {
        // Try rack_id column as legacy fallback
        const { data: rackRows, error: rackError } = await supabase
          .from('measurement_graphs')
          .select('id, graph, version')
          .eq('rack_id', buckId)
          .order('version', { ascending: false })
          .limit(1)

        if (!rackError && rackRows && rackRows.length > 0) {
          return {
            graph: rackRows[0].graph as MeasurementGraph,
            source: 'persisted_graph',
            version: rackRows[0].version,
            graphId: rackRows[0].id,
            predictionId: null,
            measurementGraphsAvailable: true,
          }
        }
      }
    }

    // ── 2. Fall back to latest prediction JSON ───────────────────────────────

    // Try bucks/predictions join (modern schema)
    const { data: predRows, error: predError } = await supabase
      .from('predictions')
      .select('id, raw_response, result')
      .eq('buck_id', buckId)
      .order('created_at', { ascending: false })
      .limit(1)

    if (!predError && predRows && predRows.length > 0) {
      const row = predRows[0] as Record<string, unknown>
      const detGraph = extractDetectionGraph(row)
      if (detGraph) {
        return {
          graph: convertDetectionGraphToMeasurementGraph(detGraph),
          source: 'prediction_graph',
          version: null,
          graphId: null,
          predictionId: String(row.id),
          measurementGraphsAvailable,
        }
      }
    }

    // Try rack_id column on predictions (legacy schema)
    if (predError || !predRows?.length) {
      const { data: legacyRows } = await supabase
        .from('predictions')
        .select('id, raw_response, result')
        .eq('rack_id', buckId)
        .order('created_at', { ascending: false })
        .limit(1)

      if (legacyRows && legacyRows.length > 0) {
        const row = legacyRows[0] as Record<string, unknown>
        const detGraph = extractDetectionGraph(row)
        if (detGraph) {
          return {
            graph: convertDetectionGraphToMeasurementGraph(detGraph),
            source: 'prediction_graph',
            version: null,
            graphId: null,
            predictionId: String(row.id),
            measurementGraphsAvailable,
          }
        }
      }
    }

    // ── 3. Fallback ──────────────────────────────────────────────────────────
    return {
      graph: FALLBACK_GRAPH,
      source: 'fallback',
      version: null,
      graphId: null,
      predictionId: null,
      measurementGraphsAvailable,
    }
  } catch (err) {
    console.error('[load-graph] unexpected error:', err instanceof Error ? err.message : String(err))
    return {
      graph: FALLBACK_GRAPH,
      source: 'fallback',
      version: null,
      graphId: null,
      predictionId: null,
      measurementGraphsAvailable: false,
    }
  }
}
