/**
 * load-effective-measurement-graph.ts
 *
 * Phase 2 canonical loader — single source of truth for resolving the
 * effective MeasurementGraph for any buck.
 *
 * Resolution order:
 *   1. Latest persisted row from measurement_graphs (highest version)
 *   2. MeasurementGraph derived from the detection graph in the latest prediction
 *   3. Safe fallback graph
 *
 * Never throws for missing tables, missing rows, or missing graph payloads.
 */

import { createClient } from '@/lib/supabase/server'
import type { MeasurementGraph } from '@/lib/types'
import type { AntlerMeasurementGraph } from '@/lib/detection/types'
import {
  extractPredictionDetectionGraph,
  convertDetectionGraphToMeasurementGraph,
} from '@/lib/scoring/graph-conversion'

// ---------------------------------------------------------------------------
// Public result type (matches spec exactly)
// ---------------------------------------------------------------------------

export interface EffectiveMeasurementGraphResult {
  graph: MeasurementGraph
  source: 'persisted_graph' | 'prediction_graph' | 'fallback'
  version: number | null
  graphId: string | null
  predictionId: string | null
  measurementGraphsAvailable: boolean
}

// ---------------------------------------------------------------------------
// Fallback graph — safe minimal geometry used when no data exists
// ---------------------------------------------------------------------------

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
      confidence: 0.25,
      source: 'fused',
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
      confidence: 0.25,
      source: 'fused',
    },
  },
  tines: [],
  spread: {
    leftPoint: { x: 160, y: 430 },
    rightPoint: { x: 340, y: 430 },
    distance: 0,
    confidence: 0.25,
  },
  circumferences: [],
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

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

/**
 * Probe measurement_graphs with buck_id first, then rack_id as a legacy fallback.
 * Returns the highest-version row, the table availability flag, and the graph id.
 */
async function fetchLatestPersistedGraph(
  supabase: Awaited<ReturnType<typeof createClient>>,
  buckId: string
): Promise<{
  record: { id: string; graph: MeasurementGraph; version: number } | null
  available: boolean
}> {
  for (const fk of ['buck_id', 'rack_id'] as const) {
    const { data, error } = await supabase
      .from('measurement_graphs')
      .select('id, graph, version')
      .eq(fk, buckId)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!error) {
      return {
        record: (data as { id: string; graph: MeasurementGraph; version: number } | null) ?? null,
        available: true,
      }
    }

    if (isMissingTableError(error)) {
      return { record: null, available: false }
    }

    if (!isMissingColumnError(error)) {
      // Unexpected error on this fk — treat as unavailable, don't try the other key
      return { record: null, available: true }
    }

    // 42703 → this foreign key column doesn't exist, try the other one
  }

  return { record: null, available: true }
}

/**
 * Extract AntlerMeasurementGraph from a raw prediction record.
 * Probes all known storage shapes; returns null if none found.
 * Re-exported from graph-conversion but kept as a local alias for clarity.
 */
function extractPredictionMeasurementGraph(
  prediction: Record<string, unknown> | null | undefined
): AntlerMeasurementGraph | null {
  return extractPredictionDetectionGraph(prediction)
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Resolve the effective MeasurementGraph for a buck.
 *
 * @param buckId           The buck UUID.
 * @param hint             Optional pre-fetched data to skip extra DB round-trips.
 *                         Pass latestPrediction as a plain object to avoid re-fetching.
 */
export async function loadEffectiveMeasurementGraph(
  buckId: string,
  hint?: { latestPrediction?: Record<string, unknown> | null }
): Promise<EffectiveMeasurementGraphResult> {
  const supabase = await createClient()

  // ── Step 1: persisted graph ──────────────────────────────────────────────
  const { record: persisted, available: measurementGraphsAvailable } =
    await fetchLatestPersistedGraph(supabase, buckId)

  if (persisted) {
    const source = 'persisted_graph' as const
    console.log('[graph-loader] resolved', {
      buckId,
      source,
      version: persisted.version,
      predictionId: null,
      measurementGraphsAvailable,
    })
    return {
      graph: persisted.graph,
      source,
      version: persisted.version,
      graphId: persisted.id,
      predictionId: null,
      measurementGraphsAvailable,
    }
  }

  // ── Step 2: derive from latest prediction detection graph ────────────────
  let predictionRaw: Record<string, unknown> | null = null
  let predictionId: string | null = null

  if (hint?.latestPrediction !== undefined) {
    predictionRaw = hint.latestPrediction
    predictionId = (hint.latestPrediction?.id as string | null) ?? null
  } else {
    const { data, error } = await supabase
      .from('predictions')
      .select('*')
      .eq('buck_id', buckId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!error && data) {
      predictionRaw = data as Record<string, unknown>
      predictionId = (data as { id?: string }).id ?? null
    }
  }

  const detectionGraph = extractPredictionMeasurementGraph(predictionRaw)

  if (detectionGraph) {
    const derived = convertDetectionGraphToMeasurementGraph(detectionGraph)
    const source = 'prediction_graph' as const
    console.log('[graph-loader] resolved', {
      buckId,
      source,
      version: null,
      predictionId,
      measurementGraphsAvailable,
    })
    return {
      graph: derived,
      source,
      version: null,
      graphId: null,
      predictionId,
      measurementGraphsAvailable,
    }
  }

  // ── Step 3: fallback ─────────────────────────────────────────────────────
  const source = 'fallback' as const
  console.log('[graph-loader] resolved', {
    buckId,
    source,
    version: null,
    predictionId,
    measurementGraphsAvailable,
  })
  return {
    graph: FALLBACK_GRAPH,
    source,
    version: null,
    graphId: null,
    predictionId,
    measurementGraphsAvailable,
  }
}
