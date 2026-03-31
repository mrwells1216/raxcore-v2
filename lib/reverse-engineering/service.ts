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
import { evaluateHypothesis } from './evaluate'
import { buildErrorDecomposition } from './error-decomposition'
import { onReversePassComplete } from '@/lib/supervision/hooks'
import type { Measurements, Prediction, Buck, BuckImage } from '@/lib/types'

/**
 * Build a fallback Measurements object estimated from the prediction score.
 * Used when vision did not produce structured measurements (heuristic or fallback path).
 * All estimates are keyed to the gross score using typical B&C proportions.
 * source field on the returned object is set to "fallback_estimated" for traceability.
 */
function buildFallbackMeasurements(pred: Prediction): Measurements {
  const gross = pred.predicted_gross ?? 100
  // Typical B&C proportions: spread ~15%, main beam ~25%, G1 ~8%, G2 ~10%, G3 ~9%, G4 ~6%
  const spread       = Math.round((gross * 0.15) * 10) / 10
  const beam         = Math.round((gross * 0.25) * 10) / 10
  const g1           = Math.round((gross * 0.08) * 10) / 10
  const g2           = Math.round((gross * 0.10) * 10) / 10
  const g3           = Math.round((gross * 0.09) * 10) / 10
  const g4           = Math.round((gross * 0.06) * 10) / 10
  const h1           = Math.round((gross * 0.045) * 10) / 10

  console.warn('[precision-pass] Using fallback measurements for prediction', pred.id, {
    grossScore: gross,
    source: 'fallback_estimated',
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
    // Extended traceability field (not in Measurements interface but stored in raw_response)
    ...(({ source: 'fallback_estimated' }) as Record<string, unknown>),
  } as Measurements
}

function pickMeasurements(pred: Prediction): Measurements {
  // 1. Prefer canonical measurements JSON on the prediction row
  if (pred.measurements) return pred.measurements
  // 2. Fall back to raw_response.measurements if vision stored them there
  const rr = (pred as Record<string, unknown>).raw_response as Record<string, unknown> | undefined
  if (rr?.measurements) return rr.measurements as Measurements
  // 3. Last resort: build estimated fallback measurements from the score
  //    Never throw — precision pass must always be able to run.
  return buildFallbackMeasurements(pred)
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
      payload: { reverseRunId: run.id },
      priority: 'high',
      max_retries: 1,
      requested_by_user_id: params.requestedByUserId,
      buck_id: pred.buck_id,
      status: 'pending',
    })
    .select()
    .single()

  if (jobErr || !job) throw new Error(`Failed to create job: ${jobErr?.message ?? 'unknown'}`)

  // Link reverse run to job
  await supabase.from('reverse_jobs').insert({
    reverse_run_id: run.id,
    job_id: job.id,
    job_type: 'reverse_precision_pass',
  })

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

    const measurements = pickMeasurements(pred as Prediction)
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

    const { data: insertedCandidates, error: candErr } = await supabase
      .from('hypothesis_candidates')
      .insert(candidateRows)
      .select()

    if (candErr) throw new Error(`Insert candidates failed: ${candErr.message}`)

    // Step 3: Evaluate candidates
    const evalRows: unknown[] = []
    let best: { candidateId: string; score: number; summary: Record<string, unknown> } | null = null

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

    // Step 4: Finalize
    await supabase.from('reverse_runs').update({
      best_hypothesis_id: best.candidateId,
      best_summary: best.summary,
      status: 'completed',
      completed_at: new Date().toISOString(),
    }).eq('id', reverseRunId)

    // Step 5: Phase 52 Supervision Hook
    // Create supervision event if result changed meaningfully
    const bestCandidate = (insertedCandidates as HypothesisCandidateRow[])?.find(
      c => c.id === best.candidateId
    )
    const bestEval = evalRows.find(
      (e: { candidate_id: string }) => e.candidate_id === best.candidateId
    ) as { predicted_gross: number; predicted_net: number; delta_gross: number; delta_net: number } | undefined

    if (bestEval) {
      try {
        await onReversePassComplete({
          reverseRunId,
          predictionId: run.prediction_id,
          buckId: run.buck_id,
          baselineGross: baseGross,
          baselineNet: baseNet,
          refinedGross: bestEval.predicted_gross,
          refinedNet: bestEval.predicted_net,
          winningHypothesisType: bestCandidate?.hypothesis_type ?? null,
          errorDecompositionCauses: decomposition.causes,
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
