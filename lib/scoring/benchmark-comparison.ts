/**
 * Server-side benchmark comparison aggregator.
 *
 * Build D: Fetch all bucks with both a ground_truth_scores record AND a
 * prediction, run buildBenchmarkComparison for each, and return aggregated
 * calibration stats.
 *
 * This file never runs in the browser — all imports are server-only.
 */

import 'server-only'
import { getServiceSupabase } from '@/lib/supabase/admin'
import {
  buildBenchmarkComparison,
  computeBenchmarkStats,
  type BenchmarkComparison,
  type BenchmarkStats,
} from '@/lib/scoring/official-score'
import { loadEffectiveMeasurementGraph } from '@/lib/scoring/load-effective-measurement-graph'

interface GroundTruthRow {
  id: string
  buck_id: string
  official_score: number | null
  main_beam_left: number | null
  main_beam_right: number | null
  inside_spread: number | null
  g1_left: number | null
  g1_right: number | null
  g2_left: number | null
  g2_right: number | null
  g3_left: number | null
  g3_right: number | null
  g4_left: number | null
  g4_right: number | null
  h1_left: number | null
  h1_right: number | null
  h2_left: number | null
  h2_right: number | null
  h3_left: number | null
  h3_right: number | null
  h4_left: number | null
  h4_right: number | null
  scoring_method: string | null
  scorer_notes: string | null
}

interface PredictionRow {
  buck_id: string
  score: number | null
  score_data: Record<string, unknown> | null
}

/**
 * Fetch all ground-truth records (with a matching prediction) and compute
 * benchmark stats in one pass.  Graphs are loaded in parallel with a
 * concurrency cap to avoid exhausting the DB connection pool.
 */
export async function fetchBenchmarkStats(limit = 200): Promise<{
  stats: BenchmarkStats
  comparisons: BenchmarkComparison[]
  sampleBuckIds: string[]
}> {
  const supabase = await getServiceSupabase()

  // 1. Load ground truth records
  const { data: groundTruths, error: gtError } = await supabase
    .from('ground_truth_scores')
    .select('*')
    .not('official_score', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(limit)

  if (gtError) throw new Error(`Failed to fetch ground truth scores: ${gtError.message}`)
  if (!groundTruths || groundTruths.length === 0) {
    return {
      stats: { sampleCount: 0, grossMAE: null, netMAE: null, averageBias: null, perMeasurementMAE: {} },
      comparisons: [],
      sampleBuckIds: [],
    }
  }

  const buckIds = (groundTruths as GroundTruthRow[]).map((r) => r.buck_id)

  // 2. Load predictions for those bucks
  const { data: predictions } = await supabase
    .from('predictions')
    .select('buck_id, score, score_data')
    .in('buck_id', buckIds)
    .order('created_at', { ascending: false })

  const predictionsByBuck = new Map<string, PredictionRow>()
  for (const p of (predictions ?? []) as PredictionRow[]) {
    // Keep only the most recent prediction per buck (already ordered desc)
    if (!predictionsByBuck.has(p.buck_id)) {
      predictionsByBuck.set(p.buck_id, p)
    }
  }

  // 3. Load effective graphs with a concurrency cap of 8
  const graphsByBuck = new Map<string, ReturnType<typeof loadEffectiveMeasurementGraph> extends Promise<infer T> ? T : never>()
  const CONCURRENCY = 8
  for (let i = 0; i < buckIds.length; i += CONCURRENCY) {
    const batch = buckIds.slice(i, i + CONCURRENCY)
    const results = await Promise.allSettled(batch.map((id) => loadEffectiveMeasurementGraph(id)))
    for (let j = 0; j < batch.length; j++) {
      const result = results[j]
      if (result.status === 'fulfilled' && result.value) {
        graphsByBuck.set(batch[j], result.value)
      }
    }
  }

  // 4. Build comparisons
  const comparisons: BenchmarkComparison[] = []
  for (const gt of groundTruths as GroundTruthRow[]) {
    const pred = predictionsByBuck.get(gt.buck_id)
    const aiGross =
      (pred?.score_data?.predictedGross as number | null) ?? pred?.score ?? null
    const aiNet =
      (pred?.score_data?.predictedNet as number | null) ?? null

    const graphResult = graphsByBuck.get(gt.buck_id)
    const graph =
      graphResult && graphResult.source !== 'fallback' ? graphResult.graph : null

    // Reconstruct OfficialScoreEntry shape from the flat DB record
    const official = {
      scoringSystem: (gt.scoring_method as 'boone_and_crockett' | 'pope_and_young') ?? 'boone_and_crockett',
      rackType: 'typical' as const,
      mainBeamLeft: gt.main_beam_left,
      mainBeamRight: gt.main_beam_right,
      insideSpread: gt.inside_spread,
      tines: [
        { label: 'G1', side: 'left' as const, value: gt.g1_left },
        { label: 'G1', side: 'right' as const, value: gt.g1_right },
        { label: 'G2', side: 'left' as const, value: gt.g2_left },
        { label: 'G2', side: 'right' as const, value: gt.g2_right },
        { label: 'G3', side: 'left' as const, value: gt.g3_left },
        { label: 'G3', side: 'right' as const, value: gt.g3_right },
        { label: 'G4', side: 'left' as const, value: gt.g4_left },
        { label: 'G4', side: 'right' as const, value: gt.g4_right },
      ],
      circumferences: [
        { label: 'H1', side: 'left' as const, value: gt.h1_left },
        { label: 'H1', side: 'right' as const, value: gt.h1_right },
        { label: 'H2', side: 'left' as const, value: gt.h2_left },
        { label: 'H2', side: 'right' as const, value: gt.h2_right },
        { label: 'H3', side: 'left' as const, value: gt.h3_left },
        { label: 'H3', side: 'right' as const, value: gt.h3_right },
        { label: 'H4', side: 'left' as const, value: gt.h4_left },
        { label: 'H4', side: 'right' as const, value: gt.h4_right },
      ],
      deductions: null,
      grossScore: gt.official_score,
      netScore: null,
      notes: gt.scorer_notes,
    }

    comparisons.push(
      buildBenchmarkComparison({
        official,
        aiGross,
        aiNet,
        graph,
        correctedGraph: null,
      }),
    )
  }

  const stats = computeBenchmarkStats(comparisons)

  return { stats, comparisons, sampleBuckIds: buckIds }
}
