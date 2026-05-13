import { getServiceSupabase } from '@/lib/supabase/admin'
import { convertDetectionGraphToMeasurementGraph } from '@/lib/scoring/graph-conversion'
import type { MeasurementGraph } from '@/lib/types'
import type { AntlerMeasurementGraph } from '@/lib/detection/types'

// ── Result type ───────────────────────────────────────────────────────────────

export type GraphPersistenceStatus =
  | 'stored'
  | 'skipped_existing'
  | 'skipped_no_graph'
  | 'skipped_missing_table'
  | 'error'

export interface GraphPersistenceResult {
  status: GraphPersistenceStatus
  version: number | null
  detail: string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns true when a Supabase/PostgREST error indicates the table or column
 * does not exist (PostgreSQL error codes 42P01 = undefined_table,
 * 42703 = undefined_column, or the PGRST116 "not found" code).
 */
function isMissingTableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as Record<string, unknown>
  const code = String(e.code ?? '')
  const message = String(e.message ?? '').toLowerCase()
  return (
    code === '42P01' ||
    code === '42703' ||
    code === 'PGRST116' ||
    message.includes('does not exist') ||
    message.includes('relation') ||
    message.includes('column') ||
    message.includes('undefined table')
  )
}

function getGraphConfidence(graph: MeasurementGraph): number {
  const values = [
    graph.beams.left.confidence,
    graph.beams.right.confidence,
    graph.spread.confidence,
    ...graph.tines.map((t) => t.confidence),
    ...graph.circumferences.map((c) => c.confidence),
  ]
  if (values.length === 0) return 0
  return values.reduce((a, b) => a + b, 0) / values.length
}

// ── Public API ────────────────────────────────────────────────────────────────

interface PersistOptions {
  /** The canonical buck ID (`bucks.id`) */
  buckId: string
  /** Raw AntlerMeasurementGraph from the detection phase, or null */
  detectionGraph: AntlerMeasurementGraph | null
}

/**
 * Attempt to persist the version-1 canonical MeasurementGraph for a buck
 * immediately after scoring.
 *
 * Contract:
 * - Skips cleanly when detectionGraph is null.
 * - Skips cleanly when measurement_graphs table is absent.
 * - Skips cleanly when a graph row already exists for this buck.
 * - Falls back from buck_id column to rack_id column transparently.
 * - NEVER throws back into the calling route handler.
 */
export async function persistInitialMeasurementGraph(
  options: PersistOptions,
): Promise<GraphPersistenceResult> {
  const { buckId, detectionGraph } = options

  // 1. Nothing to persist
  if (!detectionGraph) {
    return { status: 'skipped_no_graph', version: null, detail: 'No detection graph available' }
  }

  try {
    const supabase = await getServiceSupabase()

    // 2. Convert detection graph → canonical measurement graph
    const measurementGraph: MeasurementGraph =
      convertDetectionGraphToMeasurementGraph(detectionGraph)

    const confidence = getGraphConfidence(measurementGraph)

    // 3. Check whether a graph row already exists for this buck (buck_id column)
    const { data: existingRows, error: checkError } = await supabase
      .from('measurement_graphs')
      .select('id, version')
      .eq('buck_id', buckId)
      .order('version', { ascending: false })
      .limit(1)

    if (checkError) {
      // Table missing or buck_id column missing — try rack_id fallback
      if (isMissingTableError(checkError)) {
        return await persistWithRackIdFallback(supabase, buckId, measurementGraph, confidence)
      }
      return {
        status: 'error',
        version: null,
        detail: `Check error: ${checkError.message}`,
      }
    }

    if (existingRows && existingRows.length > 0) {
      return {
        status: 'skipped_existing',
        version: existingRows[0].version,
        detail: `Graph version ${existingRows[0].version} already exists`,
      }
    }

    // 4. Insert version 1
    const { data: inserted, error: insertError } = await supabase
      .from('measurement_graphs')
      .insert({
        buck_id: buckId,
        graph: measurementGraph,
        confidence,
        version: 1,
      })
      .select('id, version')
      .single()

    if (insertError) {
      if (isMissingTableError(insertError)) {
        return await persistWithRackIdFallback(supabase, buckId, measurementGraph, confidence)
      }
      return {
        status: 'error',
        version: null,
        detail: `Insert error: ${insertError.message}`,
      }
    }

    return {
      status: 'stored',
      version: inserted?.version ?? 1,
      detail: null,
    }
  } catch (err) {
    // Never propagate — log and return error status
    const message = err instanceof Error ? err.message : String(err)
    console.error('[graph-persistence] unexpected error:', message)
    return { status: 'error', version: null, detail: message }
  }
}

// ── rack_id fallback ──────────────────────────────────────────────────────────

async function persistWithRackIdFallback(
  supabase: Awaited<ReturnType<typeof getServiceSupabase>>,
  buckId: string,
  measurementGraph: MeasurementGraph,
  confidence: number,
): Promise<GraphPersistenceResult> {
  // Try rack_id column as legacy fallback
  const { data: existingRows, error: checkError } = await supabase
    .from('measurement_graphs')
    .select('id, version')
    .eq('rack_id', buckId)
    .order('version', { ascending: false })
    .limit(1)

  if (checkError) {
    if (isMissingTableError(checkError)) {
      return {
        status: 'skipped_missing_table',
        version: null,
        detail: 'measurement_graphs table is not available in this deployment',
      }
    }
    return {
      status: 'error',
      version: null,
      detail: `rack_id fallback check error: ${checkError.message}`,
    }
  }

  if (existingRows && existingRows.length > 0) {
    return {
      status: 'skipped_existing',
      version: existingRows[0].version,
      detail: `Graph version ${existingRows[0].version} already exists (rack_id column)`,
    }
  }

  const { data: inserted, error: insertError } = await supabase
    .from('measurement_graphs')
    .insert({
      rack_id: buckId,
      graph: measurementGraph,
      confidence,
      version: 1,
    })
    .select('id, version')
    .single()

  if (insertError) {
    if (isMissingTableError(insertError)) {
      return {
        status: 'skipped_missing_table',
        version: null,
        detail: 'measurement_graphs table is not available in this deployment',
      }
    }
    return {
      status: 'error',
      version: null,
      detail: `rack_id insert error: ${insertError.message}`,
    }
  }

  return {
    status: 'stored',
    version: inserted?.version ?? 1,
    detail: 'Stored using rack_id column (legacy fallback)',
  }
}
