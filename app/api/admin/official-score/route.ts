/**
 * /api/admin/official-score
 *
 * GET  ?buck_id=<id>   — load existing official score + latest AI + graph scores
 * POST { buck_id, entry: OfficialScoreEntry } — upsert official score, return comparison
 *
 * Build D: uses existing ground_truth_scores table via storage/service.ts helpers.
 * No schema changes required.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServiceSupabase } from '@/lib/supabase/admin'
import { upsertGroundTruth, getGroundTruthByBuckId } from '@/lib/storage/service'
import { loadEffectiveMeasurementGraph } from '@/lib/scoring/load-effective-measurement-graph'
import {
  buildBenchmarkComparison,
  type OfficialScoreEntry,
} from '@/lib/scoring/official-score'

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const buckId = request.nextUrl.searchParams.get('buck_id')
  if (!buckId) {
    return NextResponse.json({ error: 'buck_id is required' }, { status: 400 })
  }

  try {
    const supabase = await getServiceSupabase()

    // Load official ground-truth record (may be null if not entered yet)
    const groundTruth = await getGroundTruthByBuckId(buckId).catch(() => null)

    // Load latest prediction for AI gross/net
    const { data: prediction } = await supabase
      .from('predictions')
      .select('id, score, score_data, raw_response, measurement_graph, created_at')
      .eq('buck_id', buckId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const aiGross =
      (prediction?.score_data as Record<string, unknown> | null)?.predictedGross as number | null ??
      (prediction?.score as number | null)

    const aiNet =
      (prediction?.score_data as Record<string, unknown> | null)?.predictedNet as number | null ??
      null

    // Load canonical measurement graph
    const effectiveGraphResult = await loadEffectiveMeasurementGraph(buckId).catch(() => null)
    const graph =
      effectiveGraphResult && effectiveGraphResult.source !== 'fallback'
        ? effectiveGraphResult.graph
        : null

    return NextResponse.json({
      buckId,
      groundTruth,
      predictionId: prediction?.id ?? null,
      aiGross: aiGross ?? null,
      aiNet: aiNet ?? null,
      graphSource: effectiveGraphResult?.source ?? null,
      graphVersion: effectiveGraphResult?.version ?? null,
      hasOfficialScore: groundTruth != null,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load official score'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  let body: { buck_id: string; entry: OfficialScoreEntry }

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { buck_id: buckId, entry } = body
  if (!buckId || !entry) {
    return NextResponse.json({ error: 'buck_id and entry are required' }, { status: 400 })
  }

  try {
    const supabase = await getServiceSupabase()

    // Build the flat ground_truth_scores record from the OfficialScoreEntry
    const tineLookup: Record<string, number | null> = {}
    for (const t of entry.tines ?? []) {
      tineLookup[`${t.label.toLowerCase()}_${t.side}`] = t.value
    }
    const circLookup: Record<string, number | null> = {}
    for (const c of entry.circumferences ?? []) {
      circLookup[`${c.label.toLowerCase()}_${c.side}`] = c.value
    }

    // Helper: strip null to undefined so GroundTruthData (all-optional) types correctly
    const n2u = (v: number | null | undefined): number | undefined =>
      v == null ? undefined : v
    const s2u = (v: string | null | undefined): string | undefined =>
      v == null ? undefined : v

    await upsertGroundTruth(buckId, {
      officialScore: n2u(entry.grossScore),
      mainBeamLeft: n2u(entry.mainBeamLeft),
      mainBeamRight: n2u(entry.mainBeamRight),
      insideSpread: n2u(entry.insideSpread),
      g1Left: n2u(tineLookup['g1_left']),
      g1Right: n2u(tineLookup['g1_right']),
      g2Left: n2u(tineLookup['g2_left']),
      g2Right: n2u(tineLookup['g2_right']),
      g3Left: n2u(tineLookup['g3_left']),
      g3Right: n2u(tineLookup['g3_right']),
      g4Left: n2u(tineLookup['g4_left']),
      g4Right: n2u(tineLookup['g4_right']),
      h1Left: n2u(circLookup['h1_left']),
      h1Right: n2u(circLookup['h1_right']),
      h2Left: n2u(circLookup['h2_left']),
      h2Right: n2u(circLookup['h2_right']),
      h3Left: n2u(circLookup['h3_left']),
      h3Right: n2u(circLookup['h3_right']),
      h4Left: n2u(circLookup['h4_left']),
      h4Right: n2u(circLookup['h4_right']),
      scoringMethod: entry.scoringSystem,
      scorerNotes: s2u(entry.notes),
    })

    // Load current AI gross/net and effective graph for comparison
    const { data: prediction } = await supabase
      .from('predictions')
      .select('score, score_data')
      .eq('buck_id', buckId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const aiGross =
      (prediction?.score_data as Record<string, unknown> | null)?.predictedGross as number | null ??
      (prediction?.score as number | null)
    const aiNet =
      (prediction?.score_data as Record<string, unknown> | null)?.predictedNet as number | null ??
      null

    const effectiveGraphResult = await loadEffectiveMeasurementGraph(buckId).catch(() => null)
    const graph =
      effectiveGraphResult && effectiveGraphResult.source !== 'fallback'
        ? effectiveGraphResult.graph
        : null

    const comparison = buildBenchmarkComparison({
      official: entry,
      aiGross: aiGross ?? null,
      aiNet: aiNet ?? null,
      graph,
      correctedGraph: null, // corrected graph would come from a later version
    })

    return NextResponse.json({ success: true, comparison })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save official score'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
