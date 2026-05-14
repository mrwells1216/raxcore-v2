import 'server-only'

/**
 * Phase 51: Structural Hypothesis Service
 * Database operations and pipeline execution for structural solving
 */

import { getServiceSupabase } from '@/lib/supabase/admin'
import { onStructuralSolverComplete } from '@/lib/supervision/hooks'
import type { Measurements, Prediction, Buck, BuckImage, MeasurementFamily } from '@/lib/types'
import type {
  StructuralHypothesisRunRow,
  StructuralHypothesisCandidateRow,
  StructuralHypothesisEvaluationRow,
  StructuralTopologySnapshotRow,
  StructuralSolvingInput,
  StructuralSolvingResult,
  StructuralRunDetail,
  TopologyInterpretation,
  StructuralChangeReason,
} from './types'
import { DEFAULT_STRUCTURAL_SETTINGS, shouldTriggerStructuralSolving } from './config'
import { extractTopologyInterpretation } from './topology-extractor'
import { generateStructuralHypotheses } from './hypothesis-generator'
import { evaluateStructuralCandidate, rankCandidates, selectWinningCandidate } from './structural-scorer'
import type { CandidateEvaluation } from './structural-scorer'

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Start a structural solving run for a prediction
 */
export async function startStructuralSolving(params: {
  predictionId: string
  requestedByUserId: string
  reverseRunId?: string
  analysisMode?: 'structural' | 'hybrid'
}): Promise<{ run: StructuralHypothesisRunRow; jobId: string }> {
  const supabase = await getServiceSupabase()

  // Load prediction and validate ownership
  const { data: pred, error: pErr } = await supabase
    .from('predictions')
    .select('*, bucks!inner(id, user_id)')
    .eq('id', params.predictionId)
    .single()

  if (pErr || !pred) {
    throw new Error(`Prediction not found: ${pErr?.message ?? 'unknown'}`)
  }

  const buckData = (pred as Record<string, unknown>).bucks as Record<string, unknown>
  if (buckData?.user_id !== params.requestedByUserId) {
    // Allow admins
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', params.requestedByUserId)
      .single()
    
    if (profile?.role !== 'admin') {
      throw new Error('Forbidden')
    }
  }

  const predRecord = pred as Record<string, unknown>

  // Create structural run
  const { data: run, error: rErr } = await supabase
    .from('structural_hypothesis_runs')
    .insert({
      prediction_id: params.predictionId,
      buck_id: pred.buck_id,
      reverse_run_id: params.reverseRunId ?? null,
      requested_by_user_id: params.requestedByUserId,
      analysis_mode: params.analysisMode ?? 'structural',
      structural_mode_enabled: true,
      status: 'queued',
      baseline_gross: predRecord.predicted_gross ?? null,
      baseline_net: predRecord.predicted_net ?? null,
    })
    .select()
    .single()

  if (rErr || !run) {
    throw new Error(`Failed to create structural run: ${rErr?.message ?? 'unknown'}`)
  }

  // Create durable job
  const { data: job, error: jobErr } = await supabase
    .from('durable_jobs')
    .insert({
      job_type: 'structural_hypothesis_solve',
      payload: { structuralRunId: run.id },
      priority: 'high',
      max_retries: 1,
      requested_by_user_id: params.requestedByUserId,
      buck_id: pred.buck_id,
      status: 'queued',
    })
    .select()
    .single()

  if (jobErr || !job) {
    throw new Error(`Failed to create job: ${jobErr?.message ?? 'unknown'}`)
  }

  // Link run to job
  await supabase.from('structural_jobs').insert({
    structural_run_id: run.id,
    job_id: job.id,
    job_type: 'structural_hypothesis_solve',
  })

  return { run: run as StructuralHypothesisRunRow, jobId: job.id }
}

/**
 * Get a structural run by ID
 */
export async function getStructuralRun(runId: string): Promise<StructuralHypothesisRunRow | null> {
  const supabase = await getServiceSupabase()
  const { data } = await supabase
    .from('structural_hypothesis_runs')
    .select('*')
    .eq('id', runId)
    .single()
  return (data as StructuralHypothesisRunRow) ?? null
}

/**
 * Get detailed structural run with candidates and evaluations
 */
export async function getStructuralRunDetail(runId: string): Promise<StructuralRunDetail> {
  const supabase = await getServiceSupabase()

  const [{ data: run }, { data: cand }, { data: evals }, { data: snaps }] = await Promise.all([
    supabase.from('structural_hypothesis_runs').select('*').eq('id', runId).single(),
    supabase
      .from('structural_hypothesis_candidates')
      .select('*')
      .eq('structural_run_id', runId)
      .order('candidate_rank', { ascending: true }),
    supabase
      .from('structural_hypothesis_evaluations')
      .select('*, structural_hypothesis_candidates!inner(structural_run_id)')
      .eq('structural_hypothesis_candidates.structural_run_id', runId),
    supabase
      .from('structural_topology_snapshots')
      .select('*')
      .eq('structural_run_id', runId),
  ])

  if (!run) throw new Error('Run not found')

  // Map evaluations by candidate_id
  const byCand: Record<string, StructuralHypothesisEvaluationRow> = {}
  for (const e of (evals as unknown[]) ?? []) {
    const evalRow = e as StructuralHypothesisEvaluationRow
    byCand[evalRow.candidate_id] = evalRow
  }

  // Find baseline and winner topology snapshots
  const snapshots = (snaps as StructuralTopologySnapshotRow[]) ?? []
  const baselineTopology = snapshots.find(s => s.snapshot_type === 'baseline') ?? null
  const winningTopology = snapshots.find(s => s.snapshot_type === 'winner') ?? null

  return {
    run: run as StructuralHypothesisRunRow,
    candidates: (cand as StructuralHypothesisCandidateRow[]) ?? [],
    evaluations: byCand,
    baselineTopology,
    winningTopology,
  }
}

/**
 * Execute the structural solving pipeline (called by worker)
 */
export async function executeStructuralSolving(structuralRunId: string): Promise<StructuralSolvingResult> {
  const supabase = await getServiceSupabase()
  const startTime = Date.now()

  // Load run
  const { data: run } = await supabase
    .from('structural_hypothesis_runs')
    .select('*')
    .eq('id', structuralRunId)
    .single()

  if (!run) throw new Error('Structural run not found')

  // Update status to running
  await supabase.from('structural_hypothesis_runs').update({
    status: 'running',
    started_at: new Date().toISOString(),
  }).eq('id', structuralRunId)

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

    const predRecord = pred as Record<string, unknown>
    const measurements = pickMeasurements(pred as Prediction)
    const baseGross = (predRecord.predicted_gross as number) ?? 0
    const baseNet = (predRecord.predicted_net as number) ?? 0
    const baseConfidence = (predRecord.confidence_percent as number) ?? 70

    // Build input from prediction data
    const perImageLandmarks = buildPerImageLandmarks(images as BuckImage[])
    const crossViewConflict = extractCrossViewConflict(predRecord)
    const multiViewData = extractMultiViewData(predRecord)

    const settings = { ...DEFAULT_STRUCTURAL_SETTINGS, ...(run.settings ?? {}) }

    const input: StructuralSolvingInput = {
      predictionId: run.prediction_id,
      buckId: run.buck_id ?? '',
      userId: run.requested_by_user_id ?? '',
      baseMeasurements: measurements,
      baseGross,
      baseNet,
      baseConfidence,
      perImageLandmarks,
      crossViewConflict,
      multiViewData,
      settings,
    }

    // Step 1: Extract baseline topology
    const baseTopology = extractTopologyInterpretation({
      measurements,
      perImageLandmarks,
      crossViewData: multiViewData,
    })

    // Save baseline topology snapshot
    await saveTopologySnapshot(supabase, structuralRunId, null, 'baseline', baseTopology)

    // Update run with baseline topology
    await supabase.from('structural_hypothesis_runs').update({
      baseline_topology: baseTopology,
      baseline_landmarks: {}, // Would be populated from Phase 45 data
    }).eq('id', structuralRunId)

    // Step 2: Generate structural hypotheses
    const hypotheses = generateStructuralHypotheses({
      baseMeasurements: measurements,
      baseTopology,
      perImageLandmarks,
      crossViewConflict,
      multiViewData,
      settings,
    })

    // Step 3: Insert candidates
    const candidateRows = hypotheses.map((h, idx) => ({
      structural_run_id: structuralRunId,
      candidate_rank: idx,
      candidate_type: h.type,
      structural_params: h.params,
      affected_families: h.affectedFamilies,
      generation_reason: h.generationReason,
      triggering_signals: h.triggeringSignals,
    }))

    const { data: insertedCandidates, error: candErr } = await supabase
      .from('structural_hypothesis_candidates')
      .insert(candidateRows)
      .select()

    if (candErr) throw new Error(`Insert candidates failed: ${candErr.message}`)

    const candidates = (insertedCandidates ?? []) as StructuralHypothesisCandidateRow[]

    // Step 4: Evaluate candidates
    const evaluations: CandidateEvaluation[] = []

    for (const candidate of candidates) {
      const hypothesis = hypotheses.find((_, idx) => idx === candidate.candidate_rank)
      if (!hypothesis) continue

      const evaluation = evaluateStructuralCandidate({
        candidate: hypothesis,
        candidateId: candidate.id,
        baseMeasurements: measurements,
        baseGross,
        baseNet,
        baseTopology,
        perImageLandmarks,
        crossViewConflict,
        multiViewData,
      })

      evaluations.push(evaluation)
    }

    // Step 5: Rank candidates
    const rankedEvaluations = rankCandidates(evaluations)

    // Step 6: Insert evaluations
    const evalRows = rankedEvaluations.map(e => ({
      candidate_id: e.candidateId,
      total_score: e.totalScore,
      candidate_rank_final: e.rankFinal,
      is_winning_candidate: false,
      geometry_consistency_score: e.geometryConsistencyScore,
      cross_view_consistency_score: e.crossViewConsistencyScore,
      landmark_agreement_score: e.landmarkAgreementScore,
      family_plausibility_score: e.familyPlausibilityScore,
      asymmetry_plausibility_score: e.asymmetryPlausibilityScore,
      structural_simplicity_score: e.structuralSimplicityScore,
      baseline_deviation_penalty: e.baselineDeviationPenalty,
      uncertainty_reduction_benefit: e.uncertaintyReductionBenefit,
      per_view_support: e.perViewSupport,
      views_supporting: e.viewsSupporting,
      views_contradicting: e.viewsContradicting,
      predicted_measurements: e.predictedMeasurements,
      predicted_gross: e.predictedGross,
      predicted_net: e.predictedNet,
      reason_summary: e.reasonSummary,
      evaluation_flags: e.evaluationFlags,
    }))

    const { error: evalErr } = await supabase.from('structural_hypothesis_evaluations').insert(evalRows)
    if (evalErr) throw new Error(`Insert evaluations failed: ${evalErr.message}`)

    // Step 7: Select winner
    const winner = selectWinningCandidate(rankedEvaluations)

    if (!winner) throw new Error('No winning candidate found')

    // Mark winner
    await supabase
      .from('structural_hypothesis_evaluations')
      .update({ is_winning_candidate: true })
      .eq('candidate_id', winner.candidateId)

    // Get winning candidate details
    const winningCandidate = candidates.find(c => c.id === winner.candidateId)!
    const winningHypothesis = hypotheses.find((_, idx) => idx === winningCandidate.candidate_rank)!

    // Determine structural change reasons
    const structuralChangeReasons: StructuralChangeReason[] = []
    let primaryReason: StructuralChangeReason | null = null
    let confidenceShiftReason: string | null = null

    if (winningCandidate.candidate_type !== 'baseline_structure') {
      const reason = mapCandidateTypeToReason(winningCandidate.candidate_type, winningHypothesis.triggeringSignals)
      if (reason) {
        structuralChangeReasons.push(reason)
        primaryReason = reason
      }
      confidenceShiftReason = `Structural solving selected ${winningCandidate.candidate_type} over baseline`
    }

    // Save winning topology
    const winningTopology = extractTopologyInterpretation({
      measurements: winner.predictedMeasurements,
      perImageLandmarks,
      crossViewData: multiViewData,
    })

    await saveTopologySnapshot(supabase, structuralRunId, winningCandidate.id, 'winner', winningTopology)

    // Step 8: Finalize run
    const processingTimeMs = Date.now() - startTime

    await supabase.from('structural_hypothesis_runs').update({
      status: 'completed',
      winning_candidate_id: winner.candidateId,
      winning_structure: { type: winningCandidate.candidate_type, params: winningCandidate.structural_params },
      winning_topology: winningTopology,
      structural_change_reasons: structuralChangeReasons,
      primary_structural_reason: primaryReason,
      confidence_shift_reason: confidenceShiftReason,
      final_gross: winner.predictedGross,
      final_net: winner.predictedNet,
      gross_delta: Number((winner.predictedGross - baseGross).toFixed(2)),
      net_delta: Number((winner.predictedNet - baseNet).toFixed(2)),
      processing_time_ms: processingTimeMs,
      completed_at: new Date().toISOString(),
    }).eq('id', structuralRunId)

    // Update prediction with structural metadata
    await supabase.from('predictions').update({
      structural_metadata: {
        structural_run_id: structuralRunId,
        winning_candidate_type: winningCandidate.candidate_type,
        structural_change_reasons: structuralChangeReasons,
        primary_structural_reason: primaryReason,
        gross_delta: winner.predictedGross - baseGross,
        net_delta: winner.predictedNet - baseNet,
      },
      structural_solving_used: winningCandidate.candidate_type !== 'baseline_structure',
    }).eq('id', run.prediction_id)

    // Phase 52 Supervision Hook
    // Create supervision event if structure changed meaningfully
    try {
      await onStructuralSolverComplete({
        structuralRunId,
        predictionId: run.prediction_id,
        buckId: run.buck_id ?? '',
        baselineGross: baseGross,
        baselineNet: baseNet,
        finalGross: winner.predictedGross,
        finalNet: winner.predictedNet,
        winningCandidateType: winningCandidate.candidate_type,
        primaryReason,
        structuralChangeReasons: structuralChangeReasons.map(r => String(r)),
        confidenceShiftReason,
        baselineStructureSummary: { topology: baseTopology },
        winningStructureSummary: { topology: winningTopology, params: winningCandidate.structural_params },
      })
    } catch (hookError) {
      // Log but don't fail the main operation
      console.error('[Phase 52] Structural solver supervision hook failed:', hookError)
    }

    return {
      structuralRunId,
      status: 'completed',
      winningCandidate,
      winningEvaluation: rankedEvaluations.find(e => e.candidateId === winner.candidateId) as unknown as StructuralHypothesisEvaluationRow | null,
      winningTopology,
      structuralChangeReasons,
      primaryReason,
      confidenceShiftReason,
      finalMeasurements: winner.predictedMeasurements,
      finalGross: winner.predictedGross,
      finalNet: winner.predictedNet,
      grossDelta: winner.predictedGross - baseGross,
      netDelta: winner.predictedNet - baseNet,
      allCandidates: candidates,
      allEvaluations: rankedEvaluations as unknown as StructuralHypothesisEvaluationRow[],
      processingTimeMs,
      candidatesGenerated: hypotheses.length,
      candidatesEvaluated: evaluations.length,
    }

  } catch (error) {
    // Mark as failed
    await supabase.from('structural_hypothesis_runs').update({
      status: 'failed',
      failed_at: new Date().toISOString(),
      failure_reason: error instanceof Error ? error.message : 'Unknown error',
    }).eq('id', structuralRunId)

    throw error
  }
}

/**
 * List structural runs for admin
 */
export async function listStructuralRuns(limit = 100): Promise<StructuralHypothesisRunRow[]> {
  const supabase = await getServiceSupabase()
  const { data, error } = await supabase
    .from('structural_hypothesis_runs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw new Error(error.message)
  return (data as StructuralHypothesisRunRow[]) ?? []
}

/**
 * Check if structural solving should be triggered for a prediction
 */
export async function checkStructuralSolvingTrigger(predictionId: string): Promise<{
  shouldTrigger: boolean
  reasons: string[]
}> {
  const supabase = await getServiceSupabase()

  const { data: pred } = await supabase
    .from('predictions')
    .select('*')
    .eq('id', predictionId)
    .single()

  if (!pred) return { shouldTrigger: false, reasons: ['Prediction not found'] }

  const predRecord = pred as Record<string, unknown>
  const crossViewConflict = extractCrossViewConflict(predRecord)
  
  if (!crossViewConflict) {
    return { shouldTrigger: false, reasons: ['No cross-view conflict data'] }
  }

  return shouldTriggerStructuralSolving({
    crossViewDisagreement: crossViewConflict.disagreementScore,
    highDisagreementFamilies: crossViewConflict.highDisagreementFamilies,
    asymmetryPercent: 0.1, // Would extract from prediction
    landmarkConfidenceVariance: 0.15, // Would extract from prediction
    settings: DEFAULT_STRUCTURAL_SETTINGS,
  })
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function buildFallbackMeasurements(pred: Prediction): Measurements {
  const gross = pred.predicted_gross ?? 100
  const spread = Math.round((gross * 0.15) * 10) / 10
  const beam   = Math.round((gross * 0.25) * 10) / 10
  const g1     = Math.round((gross * 0.08) * 10) / 10
  const g2     = Math.round((gross * 0.10) * 10) / 10
  const g3     = Math.round((gross * 0.09) * 10) / 10
  const g4     = Math.round((gross * 0.06) * 10) / 10
  const h1     = Math.round((gross * 0.045) * 10) / 10

  console.warn('[structural-hypothesis] Using fallback measurements for prediction', pred.id, {
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
  } as Measurements
}

function pickMeasurements(pred: Prediction): Measurements {
  if (pred.measurements) return pred.measurements
  const rr = (pred as unknown as Record<string, unknown>).raw_response as Record<string, unknown> | undefined
  if (rr?.measurements) return rr.measurements as Measurements
  // Never throw — return estimated fallback measurements from the score instead
  return buildFallbackMeasurements(pred)
}

function buildPerImageLandmarks(images: BuckImage[]): StructuralSolvingInput['perImageLandmarks'] {
  return images.map((img, idx) => ({
    imageIndex: idx,
    angleType: (img.angle_type ?? 'other') as StructuralSolvingInput['perImageLandmarks'][number]['angleType'],
    landmarks: {
      ears_visible: true,
      eyes_visible: true,
      antlers_visible: true,
    },
    landmarkConfidence: 0.7, // Would be populated from Phase 45 data
    referenceQuality: 0.7,
  }))
}

function extractCrossViewConflict(predRecord: Record<string, unknown>): StructuralSolvingInput['crossViewConflict'] {
  const mv = predRecord.multi_view_result as Record<string, unknown> | undefined
  const cvConflict = predRecord.cross_view_conflict as Record<string, unknown> | undefined

  if (cvConflict) {
    return {
      disagreementScore: (cvConflict.disagreement_score as number) ?? 0,
      highDisagreementFamilies: ((cvConflict.high_disagreement_families as string[]) ?? []).map(f => f as MeasurementFamily),
      reverseEngineeringRecommended: (cvConflict.reverse_engineering_recommended as boolean) ?? false,
      rejectedViews: (cvConflict.rejected_views as Array<{ imageIndex: number; reason: string }>) ?? [],
    }
  }

  if (mv?.disagreement_summary) {
    const ds = mv.disagreement_summary as Record<string, unknown>
    return {
      disagreementScore: (ds.avg_family_disagreement as number) ?? 0,
      highDisagreementFamilies: ((ds.high_disagreement_families as string[]) ?? []).map(f => f as MeasurementFamily),
      reverseEngineeringRecommended: false,
      rejectedViews: [],
    }
  }

  return null
}

function extractMultiViewData(predRecord: Record<string, unknown>): StructuralSolvingInput['multiViewData'] {
  const mv = predRecord.multi_view_result as Record<string, unknown> | undefined
  if (!mv) return null

  return {
    viewGraphConnectivity: (mv.graph_connectivity as number) ?? 0.5,
    familyAgreement: (mv.family_agreement as Record<string, number>) ?? {},
    dominantViewPerFamily: (mv.dominant_view_per_family as Record<string, number>) ?? {},
  }
}

async function saveTopologySnapshot(
  supabase: Awaited<ReturnType<typeof getServiceSupabase>>,
  runId: string,
  candidateId: string | null,
  snapshotType: 'baseline' | 'candidate' | 'winner',
  topology: TopologyInterpretation
): Promise<void> {
  await supabase.from('structural_topology_snapshots').insert({
    structural_run_id: runId,
    candidate_id: candidateId,
    snapshot_type: snapshotType,
    beam_path_left: topology.beamPathLeft,
    beam_path_right: topology.beamPathRight,
    beam_continuity_score: topology.beamContinuityScore,
    tine_sequence_left: topology.tineSequenceLeft,
    tine_sequence_right: topology.tineSequenceRight,
    tine_ordering_confidence: topology.tineOrderingConfidence,
    missing_tines_left: topology.missingTinesLeft,
    missing_tines_right: topology.missingTinesRight,
    spread_anchor_interpretation: topology.spreadAnchor,
    spread_anchor_confidence: topology.spreadAnchor.confidence,
    mass_progression_left: topology.massProgressionLeft,
    mass_progression_right: topology.massProgressionRight,
    asymmetry_interpretation: topology.asymmetry,
    asymmetry_cause: topology.asymmetry.cause,
    asymmetry_magnitude: topology.asymmetry.overallAsymmetryPercent,
  })
}

function mapCandidateTypeToReason(
  candidateType: StructuralHypothesisCandidateRow['candidate_type'],
  triggeringSignals: string[]
): StructuralChangeReason | null {
  switch (candidateType) {
    case 'spread_anchor_shift':
      if (triggeringSignals.some(s => s.includes('front_reference'))) {
        return 'spread_anchor_shift_due_to_front_reference_conflict'
      }
      return 'spread_reference_conflict_resolved'
    
    case 'beam_tip_reassignment':
      return 'beam_tip_reassigned_due_to_cross_view_conflict'
    
    case 'tine_topology_variant':
      if (triggeringSignals.some(s => s.includes('occlusion'))) {
        return 'tine_topology_reordered_due_to_occlusion'
      }
      return 'tine_grouping_corrected'
    
    case 'asymmetry_rebalanced':
      return 'asymmetry_reinterpreted_as_perspective'
    
    case 'occlusion_recovery_variant':
      return 'occlusion_recovered_from_alternate_view'
    
    case 'left_right_association_variant':
      return 'left_right_landmark_association_corrected'
    
    case 'combo_structure_variant':
      return 'beam_continuity_enforced'
    
    default:
      return null
  }
}
