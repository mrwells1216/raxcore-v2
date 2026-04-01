/**
 * Phase 53: Auxiliary Labels Service
 * 
 * Creates and manages machine-readable labels for training data export.
 * Maps supervision events and artifacts to structured auxiliary labels.
 */

import { createClient } from '@/lib/supabase/server'
import { getServiceSupabase } from '@/lib/supabase/admin'
import type {
  AuxiliaryLabel,
  AuxiliaryLabelType,
  AuxiliaryLabelSource,
  AuxiliaryLabelStatus,
  CreateAuxiliaryLabelInput,
} from '@/lib/types'

// ============================================================================
// LABEL CRUD
// ============================================================================

/**
 * Create an auxiliary label
 */
export async function createAuxiliaryLabel(
  input: CreateAuxiliaryLabelInput
): Promise<AuxiliaryLabel> {
  const supabase = await getServiceSupabase()
  
  const { data, error } = await supabase
    .from('auxiliary_labels')
    .insert({
      training_pack_item_id: input.training_pack_item_id,
      supervision_label_id: input.supervision_label_id || null,
      auxiliary_label_type: input.auxiliary_label_type,
      confidence: input.confidence ?? 0.5,
      source: input.source ?? 'auto',
      status: 'pending',
      evidence_json: input.evidence_json || {},
    })
    .select()
    .single()
  
  if (error) {
    console.error('[auxiliary-labels] Error creating label:', error)
    throw new Error(`Failed to create auxiliary label: ${error.message}`)
  }
  
  return data as AuxiliaryLabel
}

/**
 * Create multiple auxiliary labels in batch
 */
export async function createAuxiliaryLabels(
  inputs: CreateAuxiliaryLabelInput[]
): Promise<AuxiliaryLabel[]> {
  if (inputs.length === 0) return []
  
  const supabase = await getServiceSupabase()
  
  const records = inputs.map(input => ({
    training_pack_item_id: input.training_pack_item_id,
    supervision_label_id: input.supervision_label_id || null,
    auxiliary_label_type: input.auxiliary_label_type,
    confidence: input.confidence ?? 0.5,
    source: input.source ?? 'auto',
    status: 'pending' as const,
    evidence_json: input.evidence_json || {},
  }))
  
  const { data, error } = await supabase
    .from('auxiliary_labels')
    .insert(records)
    .select()
  
  if (error) {
    console.error('[auxiliary-labels] Error creating labels:', error)
    throw new Error(`Failed to create auxiliary labels: ${error.message}`)
  }
  
  return data as AuxiliaryLabel[]
}

/**
 * Get labels for a training pack item
 */
export async function getLabelsForItem(
  itemId: string
): Promise<AuxiliaryLabel[]> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('auxiliary_labels')
    .select('*')
    .eq('training_pack_item_id', itemId)
    .order('confidence', { ascending: false })
  
  if (error) {
    console.error('[auxiliary-labels] Error fetching labels:', error)
    throw new Error(`Failed to fetch labels: ${error.message}`)
  }
  
  return data as AuxiliaryLabel[]
}

/**
 * Get labels for a training pack
 */
export async function getLabelsForPack(
  packId: string,
  options?: {
    label_type?: AuxiliaryLabelType
    status?: AuxiliaryLabelStatus
    min_confidence?: number
    limit?: number
    offset?: number
  }
): Promise<AuxiliaryLabel[]> {
  const supabase = await createClient()
  
  // First get item IDs for the pack
  const { data: items } = await supabase
    .from('training_pack_items')
    .select('id')
    .eq('training_pack_id', packId)
  
  const itemIds = (items || []).map(i => i.id)
  if (itemIds.length === 0) return []
  
  let query = supabase
    .from('auxiliary_labels')
    .select('*')
    .in('training_pack_item_id', itemIds)
  
  if (options?.label_type) {
    query = query.eq('auxiliary_label_type', options.label_type)
  }
  
  if (options?.status) {
    query = query.eq('status', options.status)
  }
  
  if (options?.min_confidence !== undefined) {
    query = query.gte('confidence', options.min_confidence)
  }
  
  query = query.order('confidence', { ascending: false })
  
  if (options?.limit) {
    query = query.limit(options.limit)
  }
  
  if (options?.offset) {
    query = query.range(options.offset, options.offset + (options.limit || 50) - 1)
  }
  
  const { data, error } = await query
  
  if (error) {
    console.error('[auxiliary-labels] Error fetching pack labels:', error)
    throw new Error(`Failed to fetch pack labels: ${error.message}`)
  }
  
  return data as AuxiliaryLabel[]
}

/**
 * Update label status
 */
export async function updateLabelStatus(
  labelId: string,
  status: AuxiliaryLabelStatus,
  confidence?: number
): Promise<AuxiliaryLabel> {
  const supabase = await getServiceSupabase()
  
  const updates: Record<string, unknown> = { status }
  if (confidence !== undefined) {
    updates.confidence = confidence
  }
  
  const { data, error } = await supabase
    .from('auxiliary_labels')
    .update(updates)
    .eq('id', labelId)
    .select()
    .single()
  
  if (error) {
    console.error('[auxiliary-labels] Error updating label:', error)
    throw new Error(`Failed to update label: ${error.message}`)
  }
  
  return data as AuxiliaryLabel
}

/**
 * Confirm a label
 */
export async function confirmLabel(
  labelId: string,
  confidence?: number
): Promise<AuxiliaryLabel> {
  return updateLabelStatus(labelId, 'confirmed', confidence ?? 0.9)
}

/**
 * Reject a label
 */
export async function rejectLabel(labelId: string): Promise<AuxiliaryLabel> {
  return updateLabelStatus(labelId, 'rejected')
}

/**
 * Delete labels for an item
 */
export async function deleteLabelsForItem(itemId: string): Promise<void> {
  const supabase = await getServiceSupabase()
  
  const { error } = await supabase
    .from('auxiliary_labels')
    .delete()
    .eq('training_pack_item_id', itemId)
  
  if (error) {
    console.error('[auxiliary-labels] Error deleting labels:', error)
    throw new Error(`Failed to delete labels: ${error.message}`)
  }
}

// ============================================================================
// LABEL INFERENCE
// ============================================================================

/**
 * Supervision event type to auxiliary label mapping
 */
const SUPERVISION_TYPE_TO_LABEL: Record<string, { label: AuxiliaryLabelType; confidence: number }> = {
  // Reverse pass outcomes
  'reverse_pass_found_scale_issue': { label: 'likely_scale_reference_failure', confidence: 0.8 },
  'reverse_pass_found_asymmetry_issue': { label: 'likely_angle_distortion', confidence: 0.75 },
  'reverse_pass_improved_result': { label: 'reverse_pass_changed_result', confidence: 0.85 },
  
  // Structural solver outcomes
  'structural_solver_corrected_topology': { label: 'structural_solver_changed_result', confidence: 0.8 },
  'structural_topology_change': { label: 'likely_structural_topology_error', confidence: 0.75 },
  
  // Multi-view outcomes
  'multi_view_inconsistency': { label: 'likely_multi_view_disagreement', confidence: 0.7 },
  
  // Confidence outcomes
  'confidence_overclaim': { label: 'likely_confidence_overclaim', confidence: 0.8 },
  'interval_miss': { label: 'likely_confidence_overclaim', confidence: 0.7 },
  
  // Benchmark outcomes
  'benchmark_failure_cluster': { label: 'benchmark_regression_signal', confidence: 0.85 },
  'segment_regression_detected': { label: 'likely_segment_calibration_miss', confidence: 0.8 },
}

/**
 * Failure cause label to auxiliary label mapping
 */
const FAILURE_CAUSE_TO_LABEL: Record<string, { label: AuxiliaryLabelType; confidence: number }> = {
  'scale_reference_failure': { label: 'likely_scale_reference_failure', confidence: 0.85 },
  'beam_tip_misread': { label: 'likely_beam_tip_misread', confidence: 0.8 },
  'tine_occlusion': { label: 'likely_tine_occlusion', confidence: 0.8 },
  'angle_distortion': { label: 'likely_angle_distortion', confidence: 0.8 },
  'width_estimation_error': { label: 'likely_width_estimation_error', confidence: 0.75 },
  'mass_deduction_error': { label: 'likely_mass_deduction_error', confidence: 0.75 },
  'confidence_overestimate': { label: 'likely_confidence_overclaim', confidence: 0.8 },
  'confidence_underestimate': { label: 'likely_confidence_underclaim', confidence: 0.8 },
  'weak_multi_view_agreement': { label: 'likely_multi_view_disagreement', confidence: 0.75 },
  'structural_topology_error': { label: 'likely_structural_topology_error', confidence: 0.8 },
  'input_quality_issue': { label: 'likely_input_quality_issue', confidence: 0.7 },
  'segment_calibration_miss': { label: 'likely_segment_calibration_miss', confidence: 0.8 },
}

/**
 * Infer auxiliary labels from a supervision event
 */
export function inferLabelsFromSupervisionEvent(
  supervisionType: string,
  metadata: Record<string, unknown>,
  supervisionLabels: string[]
): Array<{ label: AuxiliaryLabelType; confidence: number; source: AuxiliaryLabelSource }> {
  const results: Array<{ label: AuxiliaryLabelType; confidence: number; source: AuxiliaryLabelSource }> = []
  
  // Check supervision type mapping
  const typeMapping = SUPERVISION_TYPE_TO_LABEL[supervisionType]
  if (typeMapping) {
    results.push({
      label: typeMapping.label,
      confidence: typeMapping.confidence,
      source: 'auto',
    })
  }
  
  // Check failure cause labels
  for (const label of supervisionLabels) {
    const causeMapping = FAILURE_CAUSE_TO_LABEL[label]
    if (causeMapping) {
      // Don't add duplicate labels
      if (!results.some(r => r.label === causeMapping.label)) {
        results.push({
          label: causeMapping.label,
          confidence: causeMapping.confidence,
          source: 'auto',
        })
      }
    }
  }
  
  // Additional inference based on metadata
  if (metadata.disagreement_score && (metadata.disagreement_score as number) > 0.7) {
    if (!results.some(r => r.label === 'likely_multi_view_disagreement')) {
      results.push({
        label: 'likely_multi_view_disagreement',
        confidence: 0.75,
        source: 'auto',
      })
    }
  }
  
  if (metadata.high_confidence_miss_severity === 'severe') {
    if (!results.some(r => r.label === 'likely_confidence_overclaim')) {
      results.push({
        label: 'likely_confidence_overclaim',
        confidence: 0.85,
        source: 'auto',
      })
    }
  }
  
  return results
}

/**
 * Infer labels from reverse run outcome
 */
export function inferLabelsFromReverseRun(
  hypothesisType: string,
  improvement: number
): Array<{ label: AuxiliaryLabelType; confidence: number; source: AuxiliaryLabelSource }> {
  const results: Array<{ label: AuxiliaryLabelType; confidence: number; source: AuxiliaryLabelSource }> = []
  
  // Add general reverse pass label
  if (improvement > 0.5) {
    results.push({
      label: 'reverse_pass_changed_result',
      confidence: Math.min(0.95, 0.7 + (improvement / 10) * 0.25),
      source: 'reverse',
    })
  }
  
  // Add hypothesis-specific labels
  if (hypothesisType === 'scale_factor_bias') {
    results.push({
      label: 'likely_scale_reference_failure',
      confidence: 0.8,
      source: 'reverse',
    })
  } else if (hypothesisType === 'asymmetry_correction') {
    results.push({
      label: 'likely_angle_distortion',
      confidence: 0.75,
      source: 'reverse',
    })
  } else if (hypothesisType === 'beam_segment_reweight') {
    results.push({
      label: 'likely_beam_tip_misread',
      confidence: 0.7,
      source: 'reverse',
    })
  }
  
  return results
}

/**
 * Infer labels from structural solver outcome
 */
export function inferLabelsFromStructuralRun(
  topologyChanged: boolean,
  changeReason: string | null
): Array<{ label: AuxiliaryLabelType; confidence: number; source: AuxiliaryLabelSource }> {
  const results: Array<{ label: AuxiliaryLabelType; confidence: number; source: AuxiliaryLabelSource }> = []
  
  if (topologyChanged) {
    results.push({
      label: 'structural_solver_changed_result',
      confidence: 0.85,
      source: 'structural',
    })
    
    results.push({
      label: 'likely_structural_topology_error',
      confidence: 0.8,
      source: 'structural',
    })
  }
  
  return results
}

/**
 * Infer labels from hard-case pattern membership
 */
export function inferLabelsFromHardCasePattern(
  patternType: string,
  severity: number
): Array<{ label: AuxiliaryLabelType; confidence: number; source: AuxiliaryLabelSource }> {
  const results: Array<{ label: AuxiliaryLabelType; confidence: number; source: AuxiliaryLabelSource }> = []
  
  // Always add pattern membership label
  results.push({
    label: 'hard_case_pattern_membership',
    confidence: Math.min(0.95, 0.6 + severity * 0.35),
    source: 'auto',
  })
  
  // Add pattern-type-specific labels
  if (patternType.includes('low_light') || patternType.includes('trail_cam')) {
    results.push({
      label: 'likely_input_quality_issue',
      confidence: 0.7,
      source: 'auto',
    })
  }
  
  if (patternType.includes('scale') || patternType.includes('reference')) {
    results.push({
      label: 'likely_scale_reference_failure',
      confidence: 0.75,
      source: 'auto',
    })
  }
  
  return results
}

// ============================================================================
// BATCH INFERENCE
// ============================================================================

/**
 * Generate all auxiliary labels for a pack item based on its artifacts
 */
export async function generateLabelsForItem(
  itemId: string
): Promise<AuxiliaryLabel[]> {
  const supabase = await createClient()
  
  // Get the item
  const { data: item, error: itemError } = await supabase
    .from('training_pack_items')
    .select('*')
    .eq('id', itemId)
    .single()
  
  if (itemError || !item) {
    throw new Error('Training pack item not found')
  }
  
  const labelsToCreate: CreateAuxiliaryLabelInput[] = []
  
  // Process supervision events
  if (item.supervision_event_ids && item.supervision_event_ids.length > 0) {
    const { data: events } = await supabase
      .from('supervision_events')
      .select('id, supervision_type, metadata_json')
      .in('id', item.supervision_event_ids)
    
    for (const event of (events || [])) {
      // Get labels for this event
      const { data: eventLabels } = await supabase
        .from('supervision_labels')
        .select('id, label')
        .eq('supervision_event_id', event.id)
      
      const supervisionLabels = (eventLabels || []).map(l => l.label)
      
      const inferred = inferLabelsFromSupervisionEvent(
        event.supervision_type,
        event.metadata_json || {},
        supervisionLabels
      )
      
      for (const inf of inferred) {
        labelsToCreate.push({
          training_pack_item_id: itemId,
          supervision_label_id: (eventLabels || []).find(l => l.label === inf.label)?.id,
          auxiliary_label_type: inf.label,
          confidence: inf.confidence,
          source: inf.source,
          evidence_json: { supervision_event_id: event.id, supervision_type: event.supervision_type },
        })
      }
    }
  }
  
  // Process reverse run
  if (item.reverse_run_id) {
    const { data: reverseRun } = await supabase
      .from('reverse_runs')
      .select('hypothesis_type, improvement_gross')
      .eq('id', item.reverse_run_id)
      .single()
    
    if (reverseRun) {
      const inferred = inferLabelsFromReverseRun(
        reverseRun.hypothesis_type,
        reverseRun.improvement_gross || 0
      )
      
      for (const inf of inferred) {
        labelsToCreate.push({
          training_pack_item_id: itemId,
          auxiliary_label_type: inf.label,
          confidence: inf.confidence,
          source: inf.source,
          evidence_json: { reverse_run_id: item.reverse_run_id, hypothesis_type: reverseRun.hypothesis_type },
        })
      }
    }
  }
  
  // Process structural run
  if (item.structural_hypothesis_run_id) {
    const { data: structuralRun } = await supabase
      .from('structural_hypothesis_runs')
      .select('topology_changed, change_reason')
      .eq('id', item.structural_hypothesis_run_id)
      .single()
    
    if (structuralRun) {
      const inferred = inferLabelsFromStructuralRun(
        structuralRun.topology_changed,
        structuralRun.change_reason
      )
      
      for (const inf of inferred) {
        labelsToCreate.push({
          training_pack_item_id: itemId,
          auxiliary_label_type: inf.label,
          confidence: inf.confidence,
          source: inf.source,
          evidence_json: { structural_run_id: item.structural_hypothesis_run_id },
        })
      }
    }
  }
  
  // Process hard-case patterns
  const summary = item.artifact_summary_json as { hard_case_pattern_ids?: string[]; hard_case_severity?: number }
  if (summary?.hard_case_pattern_ids && summary.hard_case_pattern_ids.length > 0) {
    const { data: patterns } = await supabase
      .from('hard_case_patterns')
      .select('id, name, severity')
      .in('id', summary.hard_case_pattern_ids)
    
    for (const pattern of (patterns || [])) {
      const inferred = inferLabelsFromHardCasePattern(
        pattern.name || 'unknown',
        pattern.severity || 0.5
      )
      
      for (const inf of inferred) {
        labelsToCreate.push({
          training_pack_item_id: itemId,
          auxiliary_label_type: inf.label,
          confidence: inf.confidence,
          source: inf.source,
          evidence_json: { hard_case_pattern_id: pattern.id, pattern_name: pattern.name },
        })
      }
    }
  }
  
  // Deduplicate by label type (keep highest confidence)
  const deduped: CreateAuxiliaryLabelInput[] = []
  const seen = new Map<string, number>()
  
  for (const label of labelsToCreate) {
    const existing = seen.get(label.auxiliary_label_type)
    if (existing === undefined || (label.confidence ?? 0) > existing) {
      // Remove old one if exists
      const idx = deduped.findIndex(l => l.auxiliary_label_type === label.auxiliary_label_type)
      if (idx >= 0) {
        deduped.splice(idx, 1)
      }
      deduped.push(label)
      seen.set(label.auxiliary_label_type, label.confidence ?? 0)
    }
  }
  
  // Create labels
  if (deduped.length > 0) {
    return await createAuxiliaryLabels(deduped)
  }
  
  return []
}

/**
 * Generate labels for all items in a pack
 */
export async function generateLabelsForPack(
  packId: string,
  onProgress?: (processed: number, total: number) => void
): Promise<{ created: number; errors: number }> {
  const supabase = await createClient()
  
  // Get all items
  const { data: items } = await supabase
    .from('training_pack_items')
    .select('id')
    .eq('training_pack_id', packId)
  
  const allItems = items || []
  let created = 0
  let errors = 0
  
  for (let i = 0; i < allItems.length; i++) {
    try {
      const labels = await generateLabelsForItem(allItems[i].id)
      created += labels.length
    } catch (err) {
      console.error(`[auxiliary-labels] Error generating labels for item ${allItems[i].id}:`, err)
      errors++
    }
    
    if (onProgress) {
      onProgress(i + 1, allItems.length)
    }
  }
  
  return { created, errors }
}
