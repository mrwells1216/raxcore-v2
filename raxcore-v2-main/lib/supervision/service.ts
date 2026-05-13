import 'server-only'

/**
 * Phase 52: Structured Supervision Service
 * 
 * Core service for creating, querying, and managing supervision events,
 * labels, evidence, and feedback.
 */

import { getServiceSupabase } from '@/lib/supabase/admin'
import type {
  SupervisionEventRow,
  SupervisionEventWithLabels,
  SupervisionLabelRow,
  SupervisionEvidenceRow,
  SupervisionFeedbackRow,
  ConfidenceLearningSignalRow,
  SupervisionExportReadinessRow,
  CreateSupervisionEventInput,
  UpdateSupervisionLabelInput,
  SupervisionQueryFilters,
  SupervisionDashboardStats,
  SupervisionTrend,
  CaseSupervisionTrail,
  FailureCauseLabel,
  LabelStatus,
  SupervisionType,
  SupervisionSource,
} from './types'
import { SUPERVISION_SETTINGS, inferFailureCauses, SUPERVISION_TYPE_INFO } from './config'

// ============================================================================
// SUPERVISION EVENTS - CREATE
// ============================================================================

/**
 * Create a new supervision event with optional labels and evidence
 */
export async function createSupervisionEvent(
  input: CreateSupervisionEventInput
): Promise<SupervisionEventRow> {
  const supabase = await getServiceSupabase()
  
  // Determine initial label status
  const typeInfo = SUPERVISION_TYPE_INFO[input.supervision_type]
  const initialStatus = typeInfo.auto_confirm ? 'confirmed' : 'pending'
  
  // Insert the event
  const { data: event, error: eventError } = await supabase
    .from('supervision_events')
    .insert({
      supervision_type: input.supervision_type,
      source: input.source,
      confidence: input.confidence ?? SUPERVISION_SETTINGS.min_auto_event_confidence,
      label_status: initialStatus,
      prediction_id: input.prediction_id ?? null,
      buck_id: input.buck_id ?? null,
      reverse_run_id: input.reverse_run_id ?? null,
      structural_hypothesis_run_id: input.structural_hypothesis_run_id ?? null,
      evaluation_run_id: input.evaluation_run_id ?? null,
      benchmark_run_id: input.benchmark_run_id ?? null,
      variant_id: input.variant_id ?? null,
      metadata_json: input.metadata_json ?? {},
      delta_gross: input.delta_gross ?? null,
      delta_net: input.delta_net ?? null,
      delta_confidence: input.delta_confidence ?? null,
      confirmed_at: typeInfo.auto_confirm ? new Date().toISOString() : null,
    })
    .select()
    .single()
  
  if (eventError || !event) {
    throw new Error(`Failed to create supervision event: ${eventError?.message ?? 'unknown'}`)
  }
  
  // Insert labels if provided
  if (input.labels && input.labels.length > 0) {
    const labelRows = input.labels.map(l => ({
      supervision_event_id: event.id,
      label: l.label,
      confidence: l.confidence,
      source: l.source,
      evidence_summary: l.evidence_summary ?? null,
      status: initialStatus,
    }))
    
    const { error: labelError } = await supabase
      .from('supervision_labels')
      .insert(labelRows)
    
    if (labelError) {
      console.error('Failed to insert supervision labels:', labelError)
    }
  } else {
    // Auto-infer labels if none provided
    const inferredCauses = inferFailureCauses(input.supervision_type, input.metadata_json ?? {})
    if (inferredCauses.length > 0) {
      const labelRows = inferredCauses.map(c => ({
        supervision_event_id: event.id,
        label: c.label,
        confidence: c.confidence,
        source: 'auto' as const,
        status: 'pending' as const,
      }))
      
      await supabase.from('supervision_labels').insert(labelRows)
    }
  }
  
  // Insert evidence if provided
  if (input.evidence && input.evidence.length > 0) {
    const evidenceRows = input.evidence.map(e => ({
      supervision_event_id: event.id,
      evidence_type: e.evidence_type,
      evidence_data: e.evidence_data,
      strength: e.strength,
      source_image_id: e.source_image_id ?? null,
    }))
    
    const { error: evidenceError } = await supabase
      .from('supervision_evidence')
      .insert(evidenceRows)
    
    if (evidenceError) {
      console.error('Failed to insert supervision evidence:', evidenceError)
    }
  }
  
  // Update prediction metadata if prediction_id is provided
  if (input.prediction_id) {
    await supabase
      .from('predictions')
      .update({
        supervision_event_count: supabase.rpc('increment_int', { row_id: input.prediction_id, column_name: 'supervision_event_count' }) || 1,
        supervision_metadata: {
          last_event_id: event.id,
          last_event_type: input.supervision_type,
          last_event_at: new Date().toISOString(),
        },
      })
      .eq('id', input.prediction_id)
      .catch(() => {
        // Ignore - prediction table may not have these columns yet
      })
  }
  
  return event as SupervisionEventRow
}

/**
 * Create supervision event from a reverse pass run
 */
export async function createReversePassSupervisionEvent(params: {
  reverseRunId: string
  predictionId: string
  buckId: string
  bestHypothesisType: string | null
  deltaGross: number | null
  deltaNet: number | null
  errorDecomposition?: { causes: Array<{ cause: string; confidence: number }> }
}): Promise<SupervisionEventRow> {
  // Determine supervision type based on hypothesis
  let supervisionType: SupervisionType = 'reverse_pass_improved_result'
  
  if (params.bestHypothesisType?.includes('scale')) {
    supervisionType = 'reverse_pass_found_scale_issue'
  } else if (params.bestHypothesisType?.includes('asymmetry')) {
    supervisionType = 'reverse_pass_found_asymmetry_issue'
  }
  
  // Build labels from error decomposition
  const labels: Array<{ label: FailureCauseLabel; confidence: number; source: 'reverse-pass-derived' }> = []
  
  if (params.errorDecomposition?.causes) {
    for (const cause of params.errorDecomposition.causes) {
      const mappedLabel = mapCauseToLabel(cause.cause)
      if (mappedLabel) {
        labels.push({
          label: mappedLabel,
          confidence: cause.confidence,
          source: 'reverse-pass-derived',
        })
      }
    }
  }
  
  const event = await createSupervisionEvent({
    supervision_type: supervisionType,
    source: 'reverse_pass',
    confidence: 0.75,
    prediction_id: params.predictionId,
    buck_id: params.buckId,
    reverse_run_id: params.reverseRunId,
    delta_gross: params.deltaGross,
    delta_net: params.deltaNet,
    metadata_json: {
      best_hypothesis_type: params.bestHypothesisType,
      error_decomposition: params.errorDecomposition,
    },
    labels,
  })
  
  // Link supervision event to reverse run
  const supabase = await getServiceSupabase()
  await supabase
    .from('reverse_runs')
    .update({ supervision_event_id: event.id })
    .eq('id', params.reverseRunId)
  
  return event
}

/**
 * Create supervision event from structural solving
 */
export async function createStructuralSolvingSupervisionEvent(params: {
  structuralRunId: string
  predictionId: string
  buckId: string
  winningCandidateType: string | null
  primaryReason: string | null
  deltaGross: number | null
  deltaNet: number | null
  topologyChanges?: string[]
}): Promise<SupervisionEventRow> {
  const event = await createSupervisionEvent({
    supervision_type: 'structural_solver_corrected_topology',
    source: 'structural_solver',
    confidence: 0.7,
    prediction_id: params.predictionId,
    buck_id: params.buckId,
    structural_hypothesis_run_id: params.structuralRunId,
    delta_gross: params.deltaGross,
    delta_net: params.deltaNet,
    metadata_json: {
      winning_candidate_type: params.winningCandidateType,
      primary_reason: params.primaryReason,
      topology_changes: params.topologyChanges,
    },
  })
  
  // Link supervision event to structural run
  const supabase = await getServiceSupabase()
  await supabase
    .from('structural_hypothesis_runs')
    .update({ supervision_event_id: event.id })
    .eq('id', params.structuralRunId)
  
  return event
}

/**
 * Create confidence learning signal
 */
export async function createConfidenceLearningSignal(params: {
  predictionId: string
  signalType: 'interval_miss' | 'overclaim' | 'underclaim' | 'accurate_high_confidence' | 'accurate_low_confidence'
  predictedConfidence: number | null
  predictedErrorBandLow: number | null
  predictedErrorBandHigh: number | null
  actualError: number
  state?: string
  rackType?: string
  sourceType?: string
  imageCount?: number
}): Promise<ConfidenceLearningSignalRow> {
  const supabase = await getServiceSupabase()
  
  const wasWithinInterval = params.predictedErrorBandLow !== null && 
    params.predictedErrorBandHigh !== null &&
    params.actualError >= params.predictedErrorBandLow &&
    params.actualError <= params.predictedErrorBandHigh
  
  const { data, error } = await supabase
    .from('confidence_learning_signals')
    .insert({
      prediction_id: params.predictionId,
      signal_type: params.signalType,
      predicted_confidence: params.predictedConfidence,
      predicted_error_band_low: params.predictedErrorBandLow,
      predicted_error_band_high: params.predictedErrorBandHigh,
      actual_error: params.actualError,
      was_within_interval: wasWithinInterval,
      state: params.state ?? null,
      rack_type: params.rackType ?? null,
      source_type: params.sourceType ?? null,
      image_count: params.imageCount ?? null,
    })
    .select()
    .single()
  
  if (error || !data) {
    throw new Error(`Failed to create confidence signal: ${error?.message ?? 'unknown'}`)
  }
  
  // Create supervision event for significant signals
  if (params.signalType === 'interval_miss' || params.signalType === 'overclaim' || params.signalType === 'underclaim') {
    await createSupervisionEvent({
      supervision_type: params.signalType === 'interval_miss' ? 'interval_miss' :
                        params.signalType === 'overclaim' ? 'confidence_overclaim' : 'confidence_underclaim',
      source: 'auto',
      confidence: 0.8,
      prediction_id: params.predictionId,
      metadata_json: {
        predicted_confidence: params.predictedConfidence,
        actual_error: params.actualError,
        was_within_interval: wasWithinInterval,
      },
    })
  }
  
  return data as ConfidenceLearningSignalRow
}

// ============================================================================
// SUPERVISION EVENTS - READ
// ============================================================================

/**
 * Get a supervision event by ID
 */
export async function getSupervisionEvent(eventId: string): Promise<SupervisionEventWithLabels | null> {
  const supabase = await getServiceSupabase()
  
  const { data, error } = await supabase
    .from('supervision_events_with_labels')
    .select('*')
    .eq('id', eventId)
    .single()
  
  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to get supervision event: ${error.message}`)
  }
  
  return data as SupervisionEventWithLabels | null
}

/**
 * List supervision events with filters
 */
export async function listSupervisionEvents(
  filters?: SupervisionQueryFilters
): Promise<{ data: SupervisionEventWithLabels[]; count: number }> {
  const supabase = await getServiceSupabase()
  
  let query = supabase
    .from('supervision_events_with_labels')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
  
  if (filters?.supervision_type) {
    const types = Array.isArray(filters.supervision_type) ? filters.supervision_type : [filters.supervision_type]
    query = query.in('supervision_type', types)
  }
  
  if (filters?.source) {
    const sources = Array.isArray(filters.source) ? filters.source : [filters.source]
    query = query.in('source', sources)
  }
  
  if (filters?.label_status) {
    const statuses = Array.isArray(filters.label_status) ? filters.label_status : [filters.label_status]
    query = query.in('label_status', statuses)
  }
  
  if (filters?.prediction_id) {
    query = query.eq('prediction_id', filters.prediction_id)
  }
  
  if (filters?.buck_id) {
    query = query.eq('buck_id', filters.buck_id)
  }
  
  if (filters?.date_from) {
    query = query.gte('created_at', filters.date_from)
  }
  
  if (filters?.date_to) {
    query = query.lte('created_at', filters.date_to)
  }
  
  if (filters?.min_confidence !== undefined) {
    query = query.gte('confidence', filters.min_confidence)
  }
  
  if (filters?.limit) {
    query = query.limit(filters.limit)
  }
  
  if (filters?.offset) {
    query = query.range(filters.offset, filters.offset + (filters.limit || 50) - 1)
  }
  
  const { data, error, count } = await query
  
  if (error) {
    throw new Error(`Failed to list supervision events: ${error.message}`)
  }
  
  return {
    data: (data || []) as SupervisionEventWithLabels[],
    count: count || 0,
  }
}

/**
 * Get supervision events for a specific prediction
 */
export async function getPredictionSupervisionEvents(
  predictionId: string
): Promise<SupervisionEventWithLabels[]> {
  const { data } = await listSupervisionEvents({ prediction_id: predictionId, limit: 100 })
  return data
}

// ============================================================================
// SUPERVISION LABELS - UPDATE
// ============================================================================

/**
 * Update a supervision label (admin confirmation/rejection)
 */
export async function updateSupervisionLabel(
  labelId: string,
  input: UpdateSupervisionLabelInput,
  reviewedByUserId?: string
): Promise<SupervisionLabelRow> {
  const supabase = await getServiceSupabase()
  
  const updates: Record<string, unknown> = {}
  
  if (input.status !== undefined) {
    updates.status = input.status
  }
  
  if (input.confidence !== undefined) {
    updates.confidence = input.confidence
  }
  
  if (input.review_notes !== undefined) {
    updates.review_notes = input.review_notes
  }
  
  if (reviewedByUserId) {
    updates.reviewed_by_user_id = reviewedByUserId
    updates.reviewed_at = new Date().toISOString()
  }
  
  const { data, error } = await supabase
    .from('supervision_labels')
    .update(updates)
    .eq('id', labelId)
    .select()
    .single()
  
  if (error || !data) {
    throw new Error(`Failed to update supervision label: ${error?.message ?? 'unknown'}`)
  }
  
  return data as SupervisionLabelRow
}

/**
 * Add feedback to a supervision event
 */
export async function addSupervisionFeedback(params: {
  supervisionEventId: string
  userId: string
  feedbackType: 'confirm' | 'reject' | 'override' | 'note'
  overrideLabel?: FailureCauseLabel
  overrideConfidence?: number
  notes?: string
}): Promise<SupervisionFeedbackRow> {
  const supabase = await getServiceSupabase()
  
  const { data, error } = await supabase
    .from('supervision_feedback')
    .insert({
      supervision_event_id: params.supervisionEventId,
      user_id: params.userId,
      feedback_type: params.feedbackType,
      override_label: params.overrideLabel ?? null,
      override_confidence: params.overrideConfidence ?? null,
      notes: params.notes ?? null,
    })
    .select()
    .single()
  
  if (error || !data) {
    throw new Error(`Failed to add supervision feedback: ${error?.message ?? 'unknown'}`)
  }
  
  // Update event status based on feedback type
  if (params.feedbackType === 'confirm') {
    await supabase
      .from('supervision_events')
      .update({
        label_status: 'confirmed',
        confirmed_by_user_id: params.userId,
        confirmed_at: new Date().toISOString(),
      })
      .eq('id', params.supervisionEventId)
    
    // Also update all pending labels to confirmed
    await supabase
      .from('supervision_labels')
      .update({
        status: 'confirmed',
        reviewed_by_user_id: params.userId,
        reviewed_at: new Date().toISOString(),
      })
      .eq('supervision_event_id', params.supervisionEventId)
      .eq('status', 'pending')
  } else if (params.feedbackType === 'reject') {
    await supabase
      .from('supervision_events')
      .update({
        label_status: 'rejected',
        confirmed_by_user_id: params.userId,
        confirmed_at: new Date().toISOString(),
      })
      .eq('id', params.supervisionEventId)
    
    // Also update all pending labels to rejected
    await supabase
      .from('supervision_labels')
      .update({
        status: 'rejected',
        reviewed_by_user_id: params.userId,
        reviewed_at: new Date().toISOString(),
      })
      .eq('supervision_event_id', params.supervisionEventId)
      .eq('status', 'pending')
  } else if (params.feedbackType === 'override' && params.overrideLabel) {
    // Create new label with override
    await supabase
      .from('supervision_labels')
      .insert({
        supervision_event_id: params.supervisionEventId,
        label: params.overrideLabel,
        confidence: params.overrideConfidence ?? 0.9,
        source: 'admin-confirmed',
        status: 'confirmed',
        reviewed_by_user_id: params.userId,
        reviewed_at: new Date().toISOString(),
        review_notes: params.notes,
      })
    
    // Create admin supervision event
    await createSupervisionEvent({
      supervision_type: 'admin_confirmed_failure_cause',
      source: 'admin',
      confidence: 0.95,
      metadata_json: {
        original_event_id: params.supervisionEventId,
        override_label: params.overrideLabel,
        admin_notes: params.notes,
      },
    })
  }
  
  return data as SupervisionFeedbackRow
}

// ============================================================================
// DASHBOARD STATS
// ============================================================================

/**
 * Get supervision dashboard statistics
 */
export async function getSupervisionDashboardStats(): Promise<SupervisionDashboardStats> {
  const supabase = await getServiceSupabase()
  
  // Get total events count
  const { count: totalEvents } = await supabase
    .from('supervision_events')
    .select('*', { count: 'exact', head: true })
  
  // Get events by type
  const { data: byType } = await supabase
    .from('supervision_events')
    .select('supervision_type')
  
  const eventsByType: Record<SupervisionType, number> = {} as Record<SupervisionType, number>
  for (const row of byType || []) {
    const t = row.supervision_type as SupervisionType
    eventsByType[t] = (eventsByType[t] || 0) + 1
  }
  
  // Get events by source
  const { data: bySource } = await supabase
    .from('supervision_events')
    .select('source')
  
  const eventsBySource: Record<SupervisionSource, number> = {} as Record<SupervisionSource, number>
  for (const row of bySource || []) {
    const s = row.source as SupervisionSource
    eventsBySource[s] = (eventsBySource[s] || 0) + 1
  }
  
  // Get events by status
  const { data: byStatus } = await supabase
    .from('supervision_events')
    .select('label_status')
  
  const eventsByStatus: Record<LabelStatus, number> = {} as Record<LabelStatus, number>
  for (const row of byStatus || []) {
    const s = row.label_status as LabelStatus
    eventsByStatus[s] = (eventsByStatus[s] || 0) + 1
  }
  
  // Get recent events (last 7 days)
  const sevenDaysAgo = new Date()
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
  
  const { count: recentCount } = await supabase
    .from('supervision_events')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', sevenDaysAgo.toISOString())
  
  // Get pending review count
  const pendingReviewCount = eventsByStatus['pending'] || 0
  
  // Get top failure causes
  const { data: labelCounts } = await supabase
    .from('supervision_labels')
    .select('label, status')
  
  const labelMap: Map<FailureCauseLabel, { count: number; confirmed: number }> = new Map()
  for (const row of labelCounts || []) {
    const l = row.label as FailureCauseLabel
    const existing = labelMap.get(l) || { count: 0, confirmed: 0 }
    existing.count++
    if (row.status === 'confirmed') existing.confirmed++
    labelMap.set(l, existing)
  }
  
  const topFailureCauses = Array.from(labelMap.entries())
    .map(([label, data]) => ({
      label,
      count: data.count,
      confirmed_count: data.confirmed,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
  
  // Get hard case patterns count
  const { count: patternsCount } = await supabase
    .from('hard_case_patterns')
    .select('*', { count: 'exact', head: true })
  
  // Get pending learning actions
  const { count: pendingActions } = await supabase
    .from('learning_actions')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending')
  
  return {
    total_events: totalEvents || 0,
    events_by_type: eventsByType,
    events_by_source: eventsBySource,
    events_by_status: eventsByStatus,
    recent_events_count: recentCount || 0,
    pending_review_count: pendingReviewCount,
    top_failure_causes: topFailureCauses,
    hard_case_patterns_count: patternsCount || 0,
    learning_actions_pending: pendingActions || 0,
  }
}

/**
 * Get supervision trends over time
 */
export async function getSupervisionTrends(days: number = 30): Promise<SupervisionTrend[]> {
  const supabase = await getServiceSupabase()
  
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - days)
  
  const { data } = await supabase
    .from('supervision_events')
    .select('created_at, supervision_type, source, label_status')
    .gte('created_at', startDate.toISOString())
    .order('created_at', { ascending: true })
  
  // Group by date
  const byDate: Map<string, SupervisionTrend> = new Map()
  
  for (let i = 0; i < days; i++) {
    const date = new Date()
    date.setDate(date.getDate() - (days - 1 - i))
    const dateStr = date.toISOString().split('T')[0]
    byDate.set(dateStr, {
      date: dateStr,
      total_events: 0,
      confirmed_events: 0,
      reverse_pass_events: 0,
      structural_solver_events: 0,
      benchmark_events: 0,
      admin_events: 0,
    })
  }
  
  for (const row of data || []) {
    const dateStr = row.created_at.split('T')[0]
    const trend = byDate.get(dateStr)
    if (!trend) continue
    
    trend.total_events++
    if (row.label_status === 'confirmed') trend.confirmed_events++
    if (row.source === 'reverse_pass') trend.reverse_pass_events++
    if (row.source === 'structural_solver') trend.structural_solver_events++
    if (row.source === 'benchmark') trend.benchmark_events++
    if (row.source === 'admin') trend.admin_events++
  }
  
  return Array.from(byDate.values())
}

/**
 * Get full supervision trail for a case (prediction)
 */
export async function getCaseSupervisionTrail(predictionId: string): Promise<CaseSupervisionTrail | null> {
  const supabase = await getServiceSupabase()
  
  // Get prediction
  const { data: pred } = await supabase
    .from('predictions')
    .select('id, buck_id, predicted_gross, predicted_net, confidence_percent')
    .eq('id', predictionId)
    .single()
  
  if (!pred) return null
  
  // Get supervision events
  const { data: events } = await supabase
    .from('supervision_events_with_labels')
    .select('*')
    .eq('prediction_id', predictionId)
    .order('created_at', { ascending: false })
  
  // Get reverse pass outcomes
  const { data: reverseRuns } = await supabase
    .from('reverse_runs')
    .select('id, best_summary, completed_at')
    .eq('prediction_id', predictionId)
    .order('created_at', { ascending: false })
  
  const reversePassOutcomes = (reverseRuns || []).map(r => ({
    run_id: r.id,
    best_hypothesis_type: (r.best_summary as Record<string, unknown>)?.hypothesis_type as string | null ?? null,
    delta_gross: (r.best_summary as Record<string, unknown>)?.delta_gross as number | null ?? null,
    delta_net: (r.best_summary as Record<string, unknown>)?.delta_net as number | null ?? null,
    completed_at: r.completed_at,
  }))
  
  // Get structural solving outcomes
  const { data: structuralRuns } = await supabase
    .from('structural_hypothesis_runs')
    .select('id, winning_structure, primary_structural_reason, gross_delta, net_delta, completed_at')
    .eq('prediction_id', predictionId)
    .order('created_at', { ascending: false })
  
  const structuralSolvingOutcomes = (structuralRuns || []).map(r => ({
    run_id: r.id,
    winning_candidate_type: (r.winning_structure as Record<string, unknown>)?.type as string | null ?? null,
    primary_reason: r.primary_structural_reason,
    delta_gross: r.gross_delta,
    delta_net: r.net_delta,
    completed_at: r.completed_at,
  }))
  
  // Get all labels from events
  const allLabels: Array<{
    label: FailureCauseLabel
    confidence: number
    source: string
    status: LabelStatus
  }> = []
  
  for (const event of (events || []) as SupervisionEventWithLabels[]) {
    if (event.labels) {
      for (const l of event.labels) {
        allLabels.push({
          label: l.label,
          confidence: l.confidence,
          source: l.source,
          status: l.status,
        })
      }
    }
  }
  
  // Get feedback
  const eventIds = (events || []).map(e => e.id)
  let feedback: SupervisionFeedbackRow[] = []
  if (eventIds.length > 0) {
    const { data: fb } = await supabase
      .from('supervision_feedback')
      .select('*')
      .in('supervision_event_id', eventIds)
      .order('created_at', { ascending: false })
    feedback = (fb || []) as SupervisionFeedbackRow[]
  }
  
  // Get associated hard case patterns
  const { data: patternExamples } = await supabase
    .from('hard_case_pattern_examples')
    .select('pattern_id, match_confidence, hard_case_patterns(pattern_name)')
    .eq('prediction_id', predictionId)
  
  const associatedPatterns = (patternExamples || []).map(pe => ({
    pattern_id: pe.pattern_id,
    pattern_name: (pe.hard_case_patterns as { pattern_name: string })?.pattern_name ?? 'Unknown',
    match_confidence: pe.match_confidence,
  }))
  
  // Get learning actions related to this case
  const { data: actions } = await supabase
    .from('learning_actions')
    .select('*')
    .contains('supervision_event_ids', eventIds)
  
  return {
    prediction_id: predictionId,
    buck_id: pred.buck_id,
    original_score: {
      gross: pred.predicted_gross,
      net: pred.predicted_net,
      confidence: pred.confidence_percent,
    },
    supervision_events: (events || []) as SupervisionEventWithLabels[],
    reverse_pass_outcomes: reversePassOutcomes,
    structural_solving_outcomes: structuralSolvingOutcomes,
    inferred_failure_causes: allLabels,
    confirmation_history: feedback,
    associated_hard_case_patterns: associatedPatterns,
    suggested_learning_actions: (actions || []) as CaseSupervisionTrail['suggested_learning_actions'],
  }
}

// ============================================================================
// EXPORT READINESS
// ============================================================================

/**
 * Mark supervision event as ready for export
 */
export async function markSupervisionExportReady(params: {
  supervisionEventId?: string
  hardCasePatternId?: string
  readyForWeakLabel?: boolean
  readyForConfirmedLabel?: boolean
  readyForFineTuning?: boolean
  readyForBenchmarkPack?: boolean
  trainingQualityScore?: number
}): Promise<SupervisionExportReadinessRow> {
  const supabase = await getServiceSupabase()
  
  // Check if record exists
  let query = supabase.from('supervision_export_readiness').select('id')
  
  if (params.supervisionEventId) {
    query = query.eq('supervision_event_id', params.supervisionEventId)
  } else if (params.hardCasePatternId) {
    query = query.eq('hard_case_pattern_id', params.hardCasePatternId)
  } else {
    throw new Error('Must provide supervisionEventId or hardCasePatternId')
  }
  
  const { data: existing } = await query.single()
  
  const updateData = {
    supervision_event_id: params.supervisionEventId ?? null,
    hard_case_pattern_id: params.hardCasePatternId ?? null,
    ready_for_weak_label: params.readyForWeakLabel ?? false,
    ready_for_confirmed_label: params.readyForConfirmedLabel ?? false,
    ready_for_fine_tuning: params.readyForFineTuning ?? false,
    ready_for_benchmark_pack: params.readyForBenchmarkPack ?? false,
    training_quality_score: params.trainingQualityScore ?? null,
  }
  
  if (existing) {
    const { data, error } = await supabase
      .from('supervision_export_readiness')
      .update(updateData)
      .eq('id', existing.id)
      .select()
      .single()
    
    if (error) throw new Error(`Failed to update export readiness: ${error.message}`)
    return data as SupervisionExportReadinessRow
  } else {
    const { data, error } = await supabase
      .from('supervision_export_readiness')
      .insert(updateData)
      .select()
      .single()
    
    if (error) throw new Error(`Failed to create export readiness: ${error.message}`)
    return data as SupervisionExportReadinessRow
  }
}

// ============================================================================
// HELPERS
// ============================================================================

function mapCauseToLabel(cause: string): FailureCauseLabel | null {
  const mapping: Record<string, FailureCauseLabel> = {
    'scale': 'scale_reference_failure',
    'scale_reference': 'scale_reference_failure',
    'frontal': 'weak_front_reference',
    'weak_frontal': 'weak_front_reference',
    'side': 'weak_side_reference',
    'weak_side': 'weak_side_reference',
    'beam': 'beam_tip_misread',
    'beam_tip': 'beam_tip_misread',
    'tine': 'tine_occlusion',
    'tine_occlusion': 'tine_occlusion',
    'topology': 'tine_topology_confusion',
    'asymmetry': 'asymmetry_perspective_confound',
    'left_right': 'left_right_association_error',
    'multi_view': 'weak_multi_view_agreement',
    'crop': 'crop_or_occlusion_failure',
    'lighting': 'lighting_quality_failure',
  }
  
  const lowerCause = cause.toLowerCase()
  for (const [key, label] of Object.entries(mapping)) {
    if (lowerCause.includes(key)) {
      return label
    }
  }
  
  return null
}
