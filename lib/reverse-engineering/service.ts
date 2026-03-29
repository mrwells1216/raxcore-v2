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
import type { Measurements, Prediction, Buck, BuckImage } from '@/lib/types'

function pickMeasurements(pred: Prediction): Measurements {
  // Prefer canonical measurements JSON; fallback to raw_response.measurements if present
  if (pred.measurements) return pred.measurements
  const rr = (pred as Record<string, unknown>).raw_response as Record<string, unknown> | undefined
  if (rr?.measurements) return rr.measurements as Measurements
  throw new Error('Prediction missing measurements')
}

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

  if (pErr || !pred) throw new Error(`Prediction not found: ${pErr?.message ?? 'unknown'}`)
  
  const buckData = (pred as Record<string, unknown>).bucks as Record<string, unknown>
  if (buckData?.user_id !== params.requestedByUserId) {
    throw new Error('Forbidden')
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
