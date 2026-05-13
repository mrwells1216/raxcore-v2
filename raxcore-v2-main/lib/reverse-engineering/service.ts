import 'server-only'
import { getServiceSupabase } from '@/lib/supabase/admin'
import type { 
  ReverseRunRow, 
  ReverseBaselineBundle, 
  HypothesisCandidateRow,
  HypothesisEvaluationRow,
  ErrorDecompositionRow,
  ReverseRunDetail
} from './types'
import { generateHypotheses, calculateGrossNet } from './hypotheses'
import { findInvalidHypothesisTypes } from './hypothesis-types'
import { evaluateHypothesis } from './evaluate'
import { buildErrorDecomposition } from './error-decomposition'
import { onReversePassComplete } from '@/lib/supervision/hooks'
import type { Measurements, Prediction, Buck, BuckImage } from '@/lib/types'
import { buildFieldProvenanceFromMeasurements } from '@/lib/rules-engine/field-provenance'
import { buildScoreSheet } from '@/lib/scoring/score-sheet'

/**
 * Build a fallback Measurements object estimated from the prediction score.
 * Used when vision did not produce structured measurements (heuristic or fallback path).
 * All estimates are keyed to the gross score using typical B&C proportions.
 * source field on the returned object is set to "fallback_estimated" for traceability.
 */
function buildFallbackMeasurements(pred: Prediction): Measurements {
  // Require the actual saved gross from the prediction row — never synthesize
  // from a hardcoded value like 100. If the prediction has no gross score, the
  // precision pass cannot produce a meaningful baseline and must fail clearly.
  const predRecord = pred as unknown as Record<string, unknown>
  const gross =
    pred.predicted_gross ??
    (typeof predRecord.estimated_score === 'number' ? predRecord.estimated_score : null)
  if (!gross) {
    throw new Error(
      `[precision-pass] Cannot build fallback measurements: prediction ${pred.id} ` +
      `has no predicted_gross or estimated_score saved. ` +
      `The precision pass requires a real scoring baseline to operate.`
    )
  }

  // Typical B&C proportions: spread ~15%, main beam ~25%, G1 ~8%, G2 ~10%, G3 ~9%, G4 ~6%
  const spread = Math.round((gross * 0.15) * 10) / 10
  const beam   = Math.round((gross * 0.25) * 10) / 10
  const g1     = Math.round((gross * 0.08) * 10) / 10
  const g2     = Math.round((gross * 0.10) * 10) / 10
  const g3     = Math.round((gross * 0.09) * 10) / 10
  const g4     = Math.round((gross * 0.06) * 10) / 10
  const h1     = Math.round((gross * 0.045) * 10) / 10

  console.warn('[precision-pass] Using proportion-derived fallback measurements for prediction', pred.id, {
    grossScore: gross,
    source: 'fallback_estimated_from_saved_gross',
  })

  return {
    inside_spread:   spread,
    main_beam_left:  beam,
    main_beam_right: beam,
    g1_left: g1,  g1_right: g1,
    g2_left: g2,  g2_right: g2,
    g3_left: g3,  g3_right: g3,
    g4_left: g4,  g4_right: g4,
    g5_left: null, g5_right: null,
    h1_left: h1,  h1_right: h1,
    h2_left: null, h2_right: null,
    h3_left: null, h3_right: null,
    h4_left: null, h4_right: null,
    abnormal_points: 0,
    deductions: 0,
  } as Measurements
}

function logMeasurementFields(m: Measurements, source: string): void {
  console.log(`[precision-pass] Measurement source: ${source}`)
  console.log(`[precision-pass] Fields consumed:`)
  console.log(`  - inside_spread: ${m.inside_spread ?? 'missing'}`)
  console.log(`  - main_beam_left: ${m.main_beam_left ?? 'missing'}, main_beam_right: ${m.main_beam_right ?? 'missing'}`)
  console.log(`  - G1: L=${m.g1_left ?? 'missing'} R=${m.g1_right ?? 'missing'}`)
  console.log(`  - G2: L=${m.g2_left ?? 'missing'} R=${m.g2_right ?? 'missing'}`)
  console.log(`  - G3: L=${m.g3_left ?? 'missing'} R=${m.g3_right ?? 'missing'}`)
  console.log(`  - G4: L=${m.g4_left ?? 'missing'} R=${m.g4_right ?? 'missing'}`)
  console.log(`  - G5: L=${m.g5_left ?? 'missing'} R=${m.g5_right ?? 'missing'}`)
  console.log(`  - H1: L=${m.h1_left ?? 'missing'} R=${m.h1_right ?? 'missing'}`)
  console.log(`  - H2: L=${m.h2_left ?? 'missing'} R=${m.h2_right ?? 'missing'}`)
  console.log(`  - H3: L=${m.h3_left ?? 'missing'} R=${m.h3_right ?? 'missing'}`)
  console.log(`  - H4: L=${m.h4_left ?? 'missing'} R=${m.h4_right ?? 'missing'}`)
  console.log(`  - abnormal_points: ${m.abnormal_points ?? 'missing'}`)
  console.log(`  - deductions: ${m.deductions ?? 'missing'}`)
}

function pickMeasurements(pred: Prediction): Measurements {
  // 1. Prefer canonical measurements JSON on the prediction row
  if (pred.measurements) {
    logMeasurementFields(pred.measurements, 'prediction.measurements (canonical)')
    return pred.measurements
  }
  
  // Cast to unknown first to safely access dynamic properties
  const predRecord = pred as unknown as Record<string, unknown>
  
  // 2. Fall back to raw_response.measurements if vision stored them there
  const rr = predRecord.raw_response as Record<string, unknown> | undefined
  if (rr?.measurements) {
    const m = rr.measurements as Measurements
    logMeasurementFields(m, 'raw_response.measurements')
    return m
  }
  
  // 3. Check raw_ai_response.measurements (where score route actually stores them)
  const rar = predRecord.raw_ai_response as Record<string, unknown> | undefined
  if (rar?.measurements) {
    const m = rar.measurements as Measurements
    logMeasurementFields(m, 'raw_ai_response.measurements (AI vision)')
    return m
  }
  
  // 4. Last resort: build estimated fallback measurements from the score
  //    Never throw — precision pass must always be able to run.
  const fallback = buildFallbackMeasurements(pred)
  logMeasurementFields(fallback, 'FALLBACK (proportion-derived, NOT real AI data)')
  return fallback
}

// Check for development: NODE_ENV=development OR Vercel preview (not production deployment)
// VERCEL_ENV can be 'development', 'preview', or 'production'
const IS_DEV = process.env.NODE_ENV === 'development' || 
  process.env.VERCEL_ENV === 'preview' || 
  process.env.VERCEL_ENV === 'development'
const DEV_ANON_USER_ID = 'dev-anonymous-user'

/**
 * Start a precision pass for a prediction
 */
export async function startPrecisionPass(params: {
  predictionId: string
  requestedByUserId: string
  /** Optional manual overrides — fields corrected by the user before re-running. */
  manualOverrides?: Record<string, unknown> | null
  /** Part 6: scoreComparison from the original scoring run, if available */
  scoreComparison?: {
    activeSource: 'graph_native' | 'legacy'
    legacyGross: number | null
    graphGross: number | null
    legacyNet: number | null
    graphNet: number | null
    grossDelta: number | null
    graphCompleteness: number
    graphSource: string
    reason: string
  } | null
}): Promise<{ run: ReverseRunRow; jobId: string }> {
  const supabase = await getServiceSupabase()

  // Load prediction and buck ownership
  const { data: pred, error: pErr } = await supabase
    .from('predictions')
    .select('*, bucks!inner(id, user_id)')
    .eq('id', params.predictionId)
    .single()

  if (pErr || !pred) {
    console.error('[precision-pass] Prediction not found:', { predictionId: params.predictionId, error: pErr?.message })
    throw new Error(`Prediction not found: ${pErr?.message ?? 'unknown'}`)
  }
  
  const buckData = (pred as Record<string, unknown>).bucks as Record<string, unknown>
  const isDevBypass = IS_DEV && params.requestedByUserId === DEV_ANON_USER_ID
  const isOwner = buckData?.user_id === params.requestedByUserId
  
  console.log('[precision-pass] Permission check:', {
    NODE_ENV: process.env.NODE_ENV,
    VERCEL_ENV: process.env.VERCEL_ENV,
    IS_DEV,
    isDevBypass,
    isOwner,
    requesterId: params.requestedByUserId,
    buckUserId: buckData?.user_id,
  })
  
  // In development with dev-anonymous-user, bypass ownership check
  // In production, require ownership
  if (!isOwner && !isDevBypass) {
    console.error('[precision-pass] Forbidden: ownership mismatch', {
      buckUserId: buckData?.user_id,
      requesterId: params.requestedByUserId,
      isDev: IS_DEV,
      isDevBypass,
    })
    throw new Error('Forbidden')
  }
  
  if (isDevBypass) {
    console.log('[precision-pass] DEV BYPASS: allowing anonymous precision pass', {
      predictionId: params.predictionId,
      buckId: buckData?.id,
    })
  }

  const predRecord = pred as Record<string, unknown>

  // Create reverse run
  const { data: run, error: rErr } = await supabase
    .from('reverse_runs')
    .insert({
      prediction_id: params.predictionId,
      buck_id: pred.buck_id,
      requested_by_user_id: params.requestedByUserId,
      mode: 'precision_pass',
      status: 'queued',
      settings: null,
      baseline_snapshot: {
        predicted_gross: predRecord.predicted_gross ?? null,
        predicted_net: predRecord.predicted_net ?? null,
        confidence_percent: predRecord.confidence_percent ?? null,
        error_band_low: predRecord.error_band_low ?? null,
        error_band_high: predRecord.error_band_high ?? null,
        active_source: params.scoreComparison?.activeSource ?? null,
        legacy_gross: params.scoreComparison?.legacyGross ?? null,
        graph_gross: params.scoreComparison?.graphGross ?? null,
        legacy_net: params.scoreComparison?.legacyNet ?? null,
        graph_net: params.scoreComparison?.graphNet ?? null,
        graph_completeness: params.scoreComparison?.graphCompleteness ?? null,
        graph_source: params.scoreComparison?.graphSource ?? null,
        score_comparison_reason: params.scoreComparison?.reason ?? null,
      },
    })
    .select()
    .single()

  if (rErr || !run) throw new Error(`Failed to create reverse run: ${rErr?.message ?? 'unknown'}`)

  // Create durable job
  const { data: job, error: jobErr } = await supabase
    .from('durable_jobs')
    .insert({
      job_type: 'reverse_precision_pass',
      payload: {
        reverseRunId: run.id,
        ...(params.manualOverrides && Object.keys(params.manualOverrides).length > 0
          ? { manualOverrides: params.manualOverrides }
          : {}),
        // Part 6: pass scoreComparison so precision pass knows active source + graph values
        ...(params.scoreComparison
          ? {
              activeSource: params.scoreComparison.activeSource,
              legacyGross: params.scoreComparison.legacyGross,
              graphGross: params.scoreComparison.graphGross,
              legacyNet: params.scoreComparison.legacyNet,
              graphNet: params.scoreComparison.graphNet,
              graphCompleteness: params.scoreComparison.graphCompleteness,
              graphSource: params.scoreComparison.graphSource,
            }
          : {}),
      },
      priority: 'high',
      max_retries: 1,
      requested_by_user_id: params.requestedByUserId,
      buck_id: pred.buck_id,
      status: 'queued',
    })
    .select()
    .single()

  if (jobErr || !job) throw new Error(`Failed to create job: ${jobErr?.message ?? 'unknown'}`)

  // Optionally link reverse run to a reverse_jobs bridge table if it exists.
  // This table is legacy/redundant (job_id is already on reverse_runs) so we
  // silently skip if the table is missing rather than letting a 404 surface.
  {
    const { error: rjErr } = await supabase.from('reverse_jobs').insert({
      reverse_run_id: run.id,
      job_id: job.id,
      job_type: 'reverse_precision_pass',
    })
    if (rjErr && !rjErr.message.includes('schema cache')) {
      // Only log unexpected errors — schema-cache miss just means table doesn't exist yet
      console.warn('[precision-pass] reverse_jobs insert skipped:', rjErr.message)
    }
  }

  return { run: run as ReverseRunRow, jobId: job.id }
}

/**
 * Get a reverse run by ID
 */
export async function getReverseRun(runId: string): Promise<ReverseRunRow | null> {
  const supabase = await getServiceSupabase()
  const { data } = await supabase.from('reverse_runs').select('*').eq('id', runId).single()
  return (data as ReverseRunRow) ?? null
}

/**
 * Get detailed reverse run with candidates, evaluations, and decomposition
 */
export async function getReverseRunDetail(runId: string): Promise<ReverseRunDetail> {
  const supabase = await getServiceSupabase()

  const [{ data: run }, { data: cand }, { data: evals }, { data: decomp }] = await Promise.all([
    supabase.from('reverse_runs').select('*').eq('id', runId).single(),
    supabase
      .from('hypothesis_candidates')
      .select('*')
      .eq('reverse_run_id', runId)
      .order('hypothesis_rank', { ascending: true }),
    supabase
      .from('hypothesis_evaluations')
      .select('*, hypothesis_candidates!inner(reverse_run_id)')
      .eq('hypothesis_candidates.reverse_run_id', runId),
    supabase
      .from('error_decompositions')
      .select('*')
      .eq('reverse_run_id', runId)
      .order('created_at', { ascending: false })
      .limit(1),
  ])

  if (!run) throw new Error('Run not found')

  // Map evaluations by candidate_id
  const byCand: Record<string, HypothesisEvaluationRow> = {}
  for (const e of (evals as unknown[]) ?? []) {
    const evalRow = e as HypothesisEvaluationRow
    byCand[evalRow.candidate_id] = evalRow
  }

  return {
    run: run as ReverseRunRow,
    candidates: (cand as HypothesisCandidateRow[]) ?? [],
    evaluations: byCand,
    decomposition: (decomp as ErrorDecompositionRow[])?.[0] ?? null,
  }
}

/**
 * Execute the precision pass pipeline (called by worker)
 */
export async function executePrecisionPass(reverseRunId: string): Promise<void> {
  const supabase = await getServiceSupabase()

  // Load run
  const { data: run } = await supabase
    .from('reverse_runs')
    .select('*')
    .eq('id', reverseRunId)
    .single()
  
  if (!run) throw new Error('Reverse run not found')

  // Update status to running
  await supabase.from('reverse_runs').update({
    status: 'running',
    started_at: new Date().toISOString(),
  }).eq('id', reverseRunId)

  try {
    // Load prediction, buck, and images
    const [{ data: pred }, { data: buck }, { data: images }] = await Promise.all([
      supabase.from('predictions').select('*').eq('id', run.prediction_id).single(),
      supabase.from('bucks').select('*').eq('id', run.buck_id).single(),
      supabase
        .from('buck_images')
        .select('*')
        .eq('buck_id', run.buck_id)
        .order('created_at', { ascending: true }),
    ])

    if (!pred || !buck) throw new Error('Missing prediction or buck')

    let measurements = pickMeasurements(pred as Prediction)

    // ── Apply manual overrides if present in the job payload ────────────────
    // Look up the durable_job for this run to retrieve any manualOverrides that
    // were submitted with the precision-pass request.
    {
      const { data: jobRow } = await supabase
        .from('durable_jobs')
        .select('payload')
        .contains('payload', { reverseRunId })
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

      const overrides =
        (jobRow?.payload as Record<string, unknown> | undefined)?.manualOverrides as
          | Record<string, unknown>
          | undefined

      if (overrides && Object.keys(overrides).length > 0) {
        console.log('[precision-pass] Measurement source: manual_override + raw_ai_response.measurements')
        const overrideKeys = Object.keys(overrides)
        const allKeys = Object.keys(measurements) as Array<keyof Measurements>

        for (const k of allKeys) {
          const source = overrideKeys.includes(k) ? 'manual_override' : 'raw_ai_response'
          console.log(`[precision-pass]   - ${k}: ${source}`)
        }

        // Apply overrides to the baseline measurements object
        for (const [key, entry] of Object.entries(overrides)) {
          const overrideValue =
            entry !== null && typeof entry === 'object' && 'value' in (entry as object)
              ? (entry as { value: unknown }).value
              : entry
          if (typeof overrideValue === 'number' && key in measurements) {
            ;(measurements as unknown as Record<string, unknown>)[key] = overrideValue
          }
        }
      }
    }

    const { gross: baseGross, net: baseNet } = calculateGrossNet(measurements)

    // Build baseline bundle
    const bundle: ReverseBaselineBundle = {
      buck: buck as Buck,
      images: (images as BuckImage[]) ?? [],
      prediction: pred as Prediction,
      measurements,
      baseGross,
      baseNet,
    }

    // Step 1: Error decomposition
    const decomposition = await buildErrorDecomposition(bundle)
    
    await supabase.from('error_decompositions').insert({
      reverse_run_id: reverseRunId,
      causes: decomposition.causes,
      primary_cause: decomposition.causes[0]?.cause ?? null,
    })

    // Step 2: Generate hypotheses
    const predRecord = pred as Record<string, unknown>
    const baseConfidence = (predRecord.confidence_percent as number) ?? 70
    
    const hyps = generateHypotheses({
      base: measurements,
      baseConfidence,
      referenceQuality: decomposition.referenceQuality,
    })

    const candidateRows = hyps.map((h, idx) => ({
      reverse_run_id: reverseRunId,
      hypothesis_rank: idx,
      hypothesis_type: h.type,
      params: h.params,
    }))

    // Pre-insert validation: catch constraint violations before they hit the DB.
    // If any type is not in the allowed set, throw immediately with a clear message
    // that includes the run ID, the offending types, and the full batch — no silent
    // downgrade to generic names.
    const invalidTypes = findInvalidHypothesisTypes(
      candidateRows.map(r => r.hypothesis_type)
    )
    if (invalidTypes.length > 0) {
      throw new Error(
        `[precision-pass] Invalid hypothesis_type values detected before insert | ` +
        `runId=${reverseRunId} | ` +
        `invalid=[${invalidTypes.join(', ')}] | ` +
        `all attempted=[${candidateRows.map(r => r.hypothesis_type).join(', ')}] | ` +
        `Check hypothesis_candidates_hypothesis_type_check constraint and update it using ` +
        `the SQL in lib/reverse-engineering/hypothesis-types.ts`
      )
    }

    // Diagnostic: log every hypothesis_type before inserting so we can identify
    // any value that violates the DB hypothesis_type check constraint.
    console.log('[precision-pass] Inserting candidates', {
      runId: reverseRunId,
      hypothesisTypes: candidateRows.map(r => r.hypothesis_type),
    })

    const { data: insertedCandidates, error: candErr } = await supabase
      .from('hypothesis_candidates')
      .insert(candidateRows)
      .select()

    if (candErr) {
      const types = candidateRows.map(r => r.hypothesis_type).join(', ')
      throw new Error(
        `[precision-pass] Insert hypothesis_candidates failed | ` +
        `runId=${reverseRunId} | ` +
        `dbError=${candErr.message} | ` +
        `attempted hypothesis_types=[${types}]`
      )
    }

    // Step 3: Evaluate candidates
    const evalRows: unknown[] = []
    let best: { candidateId: string; score: number; summary: Record<string, unknown> } | null = null
    let bestMeasurements: Measurements | null = null

    for (const c of (insertedCandidates ?? []) as HypothesisCandidateRow[]) {
      const res = evaluateHypothesis({
        base: measurements,
        params: c.params,
        baseGross,
        baseNet,
        baseConfidence,
        isNoop: c.hypothesis_type === 'noop',
      })

      const deltaGross = Number((res.gross - baseGross).toFixed(1))
      const deltaNet = Number((res.net - baseNet).toFixed(1))

      evalRows.push({
        candidate_id: c.id,
        total_score: res.totalScore,
        geometry_score: res.geometryScore,
        change_penalty: res.changePenalty,
        plausibility_penalty: res.plausibilityPenalty,
        predicted_gross: res.gross,
        predicted_net: res.net,
        delta_gross: deltaGross,
        delta_net: deltaNet,
        est_error_band_width: null,
        flags: res.flags,
      })

      if (!best || res.totalScore > best.score) {
        bestMeasurements = res.measurements
        best = {
          candidateId: c.id,
          score: res.totalScore,
          summary: {
            hypothesis_type: c.hypothesis_type,
            hypothesis_rank: c.hypothesis_rank,
            predicted_gross: res.gross,
            predicted_net: res.net,
            delta_gross: deltaGross,
            delta_net: deltaNet,
            geometry_score: res.geometryScore,
            flags: res.flags,
          }
        }
      }
    }

    // Batch insert evaluations
    const { error: evalErr } = await supabase.from('hypothesis_evaluations').insert(evalRows)
    if (evalErr) throw new Error(`Insert evaluations failed: ${evalErr.message}`)

    if (!best) throw new Error('No best hypothesis found')

    if (!bestMeasurements) {
      console.warn('[precision-pass] no bestMeasurements found, falling back to base measurements')
      bestMeasurements = measurements
    }

    const precisionPassProvenance = bestMeasurements
      ? buildFieldProvenanceFromMeasurements({
          measurements: bestMeasurements,
          source: 'precision_pass',
          grossScore: Number(best.summary.predicted_gross ?? baseGross),
          netScore: Number(best.summary.predicted_net ?? baseNet),
          confidence: 'medium',
          confidenceScore: null,
        })
      : null

    const precisionPassScoreSheet = bestMeasurements
      ? buildScoreSheet(bestMeasurements, {
          scalingReference: 'precision_pass_refinement',
          rackType: ((buck as Buck)?.rack_type as 'typical' | 'non-typical') ?? 'typical',
          confidenceNotes: ['Generated from winning precision-pass hypothesis'],
          mainFramePoints:
            typeof (pred as unknown as Record<string, unknown>).main_frame_points === 'number'
              ? ((pred as unknown as Record<string, unknown>).main_frame_points as number)
              : 10,
        })
      : null

    // Step 4: Finalize
    await supabase.from('reverse_runs').update({
      best_hypothesis_id: best.candidateId,
      best_summary: {
        ...best.summary,
        measurements: bestMeasurements,
        provenance: precisionPassProvenance,
        scoreSheet: precisionPassScoreSheet,
      },
      status: 'completed',
      completed_at: new Date().toISOString(),
    }).eq('id', reverseRunId)

    // Step 5: Phase 52 Supervision Hook
    // Create supervision event if result changed meaningfully
    const bestCandidate = (insertedCandidates as HypothesisCandidateRow[])?.find(
      c => c.id === best.candidateId
    )
    const bestEval = (evalRows as Array<{
      candidate_id: string
      predicted_gross: number
      predicted_net: number
      delta_gross: number
      delta_net: number
    }>).find((e) => e.candidate_id === best.candidateId)

    if (bestEval) {
      try {
        await onReversePassComplete({
          reverseRunId,
          predictionId: String(run.prediction_id),
          buckId: String(run.buck_id),
          baselineGross: baseGross,
          baselineNet: baseNet,
          refinedGross: bestEval.predicted_gross,
          refinedNet: bestEval.predicted_net,
          winningHypothesisType: bestCandidate?.hypothesis_type ?? null,
          errorDecompositionCauses: decomposition.causes.map((cause) => ({
            cause: cause.cause,
            confidence: cause.weight,
          })),
        })
      } catch (hookError) {
        // Log but don't fail the main operation
        console.error('[Phase 52] Reverse pass supervision hook failed:', hookError)
      }
    }

  } catch (error) {
    // Mark as failed
    await supabase.from('reverse_runs').update({
      status: 'failed',
      failed_at: new Date().toISOString(),
      failure_reason: error instanceof Error ? error.message : 'Unknown error',
    }).eq('id', reverseRunId)
    
    throw error
  }
}

/**
 * List reverse runs for admin
 */
export async function listReverseRuns(limit = 200): Promise<ReverseRunRow[]> {
  const supabase = await getServiceSupabase()
  const { data, error } = await supabase
    .from('reverse_runs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw new Error(error.message)
  return (data as ReverseRunRow[]) ?? []
}
