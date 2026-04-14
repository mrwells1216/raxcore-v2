/**
 * load-effective-measurement-graph.ts
 *
 * Phase 2 canonical loader — single source of truth for resolving the
 * "effective" MeasurementGraph for any buck.
 *
 * Resolution order:
 *   1. Latest persisted row from measurement_graphs (highest version)
 *   2. MeasurementGraph derived from the detection graph in the latest prediction
 *   3. null (caller decides how to handle absence)
 *
 * This loader is safe to call from server components, API routes, and
 * server actions. It never throws — errors produce a null graph + reason.
 */

import { createClient } from '@/lib/supabase/server'
import type { MeasurementGraph } from '@/lib/types'
import type { AntlerMeasurementGraph } from '@/lib/detection/types'
import {
  extractPredictionDetectionGraph,
  convertDetectionGraphToMeasurementGraph,
} from '@/lib/scoring/graph-conversion'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EffectiveGraphSource =
  | 'persisted'         // came from measurement_graphs table
  | 'derived'           // derived from latest prediction detection graph
  | 'none'              // no graph available for this buck

export interface EffectiveMeasurementGraph {
  graph: MeasurementGraph | null
  source: EffectiveGraphSource
  /** Set when source === 'persisted' */
  persistedVersion?: number
  /** Set when source === 'persisted' */
  persistedId?: string
  /** Set when source === 'derived' */
  detectionGraphConfidence?: number | null
  /** Non-null when we fell back due to an error; for debug/logging only */
  fallbackReason?: string
}

// ---------------------------------------------------------------------------
// Internal helpers — foreign key probe (matches pattern in mesh-adjustments)
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

async function fetchPersistedGraph(
  supabase: Awaited<ReturnType<typeof createClient>>,
  buckId: string
): Promise<{
  graph: { id: string; graph: MeasurementGraph; version: number } | null
  available: boolean
}> {
  // Try buck_id first, fall back to rack_id for legacy rows
  for (const fk of ['buck_id', 'rack_id'] as const) {
    const { data, error } = await supabase
      .from('measurement_graphs')
      .select('id, graph, version')
      .eq(fk, buckId)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!error) {
      return { graph: (data as { id: string; graph: MeasurementGraph; version: number } | null) ?? null, available: true }
    }

    if (isMissingTableError(error)) {
      return { graph: null, available: false }
    }

    if (!isMissingColumnError(error)) {
      // Unexpected error on buck_id — don't try rack_id, surface absence
      return { graph: null, available: true }
    }

    // isMissingColumnError → this fk doesn't exist, try the other one
  }

  return { graph: null, available: true }
}

async function fetchLatestPredictionRaw(
  supabase: Awaited<ReturnType<typeof createClient>>,
  buckId: string
): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase
    .from('predictions')
    .select('*')
    .eq('buck_id', buckId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error || !data) return null
  return data as Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Resolve the effective MeasurementGraph for a given buckId.
 *
 * Always returns an EffectiveMeasurementGraph — never throws.
 *
 * @param buckId  The buck UUID to resolve.
 * @param hint    Optional pre-fetched latest prediction to avoid an extra DB round-trip.
 *                Pass the full prediction record as a plain object.
 */
export async function loadEffectiveMeasurementGraph(
  buckId: string,
  hint?: { latestPrediction?: Record<string, unknown> | null }
): Promise<EffectiveMeasurementGraph> {
  try {
    const supabase = await createClient()

    // 1. Try persisted graph
    const { graph: persisted } = await fetchPersistedGraph(supabase, buckId)

    if (persisted) {
      return {
        graph: persisted.graph,
        source: 'persisted',
        persistedVersion: persisted.version,
        persistedId: persisted.id,
      }
    }

    // 2. Derive from latest prediction detection graph
    const predictionRaw =
      hint?.latestPrediction !== undefined
        ? hint.latestPrediction
        : await fetchLatestPredictionRaw(supabase, buckId)

    const detectionGraph: AntlerMeasurementGraph | null =
      extractPredictionDetectionGraph(predictionRaw)

    if (detectionGraph) {
      const derived = convertDetectionGraphToMeasurementGraph(detectionGraph)
      return {
        graph: derived,
        source: 'derived',
        detectionGraphConfidence: detectionGraph.graphConfidence ?? null,
      }
    }

    // 3. No graph available
    return { graph: null, source: 'none' }
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'Unknown error in loadEffectiveMeasurementGraph'
    console.error('[load-effective-graph] error:', reason)
    return { graph: null, source: 'none', fallbackReason: reason }
  }
}
