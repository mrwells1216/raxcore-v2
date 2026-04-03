import 'server-only'

/**
 * Phase 52: Learning Actions System
 * 
 * Generates and manages actionable learning suggestions from supervision signals.
 * These actions inform calibration, protected segments, benchmarks, and more.
 */

import { getServiceSupabase } from '@/lib/supabase/admin'
import type {
  LearningActionRow,
  LearningActionDashboard,
  CreateLearningActionInput,
  LearningActionQueryFilters,
  LearningActionType,
  LearningActionStatus,
  LearningActionParams,
  EstimatedImpact,
  FailureCauseLabel,
  SupervisionEventWithLabels,
  HardCasePatternSummary,
} from './types'
import { SUPERVISION_SETTINGS, LEARNING_ACTION_INFO } from './config'

// ============================================================================
// LEARNING ACTIONS - CREATE
// ============================================================================

/**
 * Create a new learning action
 */
export async function createLearningAction(
  input: CreateLearningActionInput
): Promise<LearningActionRow> {
  const supabase = await getServiceSupabase()
  
  const { data, error } = await supabase
    .from('learning_actions')
    .insert({
      action_type: input.action_type,
      supervision_event_ids: input.supervision_event_ids ?? [],
      hard_case_pattern_id: input.hard_case_pattern_id ?? null,
      action_description: input.action_description,
      action_params: input.action_params ?? {},
      priority: input.priority ?? 'medium',
      confidence: input.confidence ?? 0.5,
      estimated_impact: input.estimated_impact ?? {},
      status: 'pending',
    })
    .select()
    .single()
  
  if (error || !data) {
    throw new Error(`Failed to create learning action: ${error?.message ?? 'unknown'}`)
  }
  
  return data as LearningActionRow
}

/**
 * Generate learning actions from supervision events
 */
export async function generateLearningActionsFromEvents(
  eventIds: string[]
): Promise<LearningActionRow[]> {
  const supabase = await getServiceSupabase()
  
  // Get events with labels
  const { data: events } = await supabase
    .from('supervision_events_with_labels')
    .select('*')
    .in('id', eventIds)
  
  if (!events || events.length === 0) return []
  
  const actions: LearningActionRow[] = []
  const typedEvents = events as SupervisionEventWithLabels[]
  
  // Group events by label
  const labelGroups: Map<FailureCauseLabel, SupervisionEventWithLabels[]> = new Map()
  
  for (const event of typedEvents) {
    if (!event.labels) continue
    for (const label of event.labels) {
      const existing = labelGroups.get(label.label) || []
      existing.push(event)
      labelGroups.set(label.label, existing)
    }
  }
  
  // Generate actions for each label group that meets threshold
  for (const [label, groupEvents] of labelGroups) {
    if (groupEvents.length < SUPERVISION_SETTINGS.min_supervision_events_for_action) continue
    
    const confirmedCount = groupEvents.filter(e => e.label_status === 'confirmed').length
    const priority = confirmedCount >= SUPERVISION_SETTINGS.min_confirmed_events_for_high_priority 
      ? 'high' : 'medium'
    
    // Determine action type based on label category
    const actionSuggestions = suggestActionsForLabel(label, groupEvents)
    
    for (const suggestion of actionSuggestions) {
      // Check if similar action already exists
      const { data: existing } = await supabase
        .from('learning_actions')
        .select('id')
        .eq('action_type', suggestion.type)
        .contains('action_params', { target_label: label })
        .eq('status', 'pending')
        .single()
      
      if (existing) continue
      
      const action = await createLearningAction({
        action_type: suggestion.type,
        supervision_event_ids: groupEvents.map(e => e.id),
        action_description: suggestion.description,
        action_params: {
          target_label: label,
          ...suggestion.params,
        },
        priority,
        confidence: suggestion.confidence,
        estimated_impact: suggestion.impact,
      })
      
      actions.push(action)
    }
  }
  
  return actions
}

/**
 * Generate learning actions from a hard-case pattern
 */
export async function generateLearningActionsFromPattern(
  pattern: HardCasePatternSummary
): Promise<LearningActionRow[]> {
  const supabase = await getServiceSupabase()
  const actions: LearningActionRow[] = []
  
  // Check if pattern warrants actions
  if (pattern.actual_example_count < SUPERVISION_SETTINGS.min_pattern_examples) {
    return []
  }
  
  // 1. Suggest benchmark pack if enough examples
  if (pattern.actual_example_count >= 10) {
    const { data: existingBenchmark } = await supabase
      .from('learning_actions')
      .select('id')
      .eq('action_type', 'benchmark_pack_candidate')
      .eq('hard_case_pattern_id', pattern.id)
      .in('status', ['pending', 'approved'])
      .single()
    
    if (!existingBenchmark) {
      const action = await createLearningAction({
        action_type: 'benchmark_pack_candidate',
        hard_case_pattern_id: pattern.id,
        action_description: `Create benchmark pack from "${pattern.pattern_name}" pattern with ${pattern.actual_example_count} examples`,
        action_params: {
          pack_name: `Hard Case: ${pattern.pattern_name}`,
          example_count: pattern.actual_example_count,
        },
        priority: pattern.severity >= 0.8 ? 'high' : 'medium',
        confidence: 0.8,
        estimated_impact: {
          affected_segments: Object.keys(pattern.segment_distribution?.state || {}),
          risk_level: 'low',
        },
      })
      actions.push(action)
    }
  }
  
  // 2. Suggest protected segment if high severity
  if (pattern.severity >= 0.75 && pattern.actual_example_count >= 5) {
    const { data: existingProtected } = await supabase
      .from('learning_actions')
      .select('id')
      .eq('action_type', 'protected_segment_candidate')
      .eq('hard_case_pattern_id', pattern.id)
      .in('status', ['pending', 'approved'])
      .single()
    
    if (!existingProtected) {
      const action = await createLearningAction({
        action_type: 'protected_segment_candidate',
        hard_case_pattern_id: pattern.id,
        action_description: `Add protected segment rule for "${pattern.pattern_name}" pattern (severity: ${(pattern.severity * 100).toFixed(0)}%)`,
        action_params: {
          pattern_name: pattern.pattern_name,
          suggested_threshold: pattern.avg_error_gross || 1.0,
        },
        priority: 'high',
        confidence: 0.7,
        estimated_impact: {
          affected_prediction_count: pattern.actual_example_count,
          risk_level: 'medium',
        },
      })
      actions.push(action)
    }
  }
  
  // 3. Suggest shadow test if variants are helping
  if ((pattern.helping_variants_count || 0) > 0) {
    const action = await createLearningAction({
      action_type: 'shadow_test_recommendation',
      hard_case_pattern_id: pattern.id,
      action_description: `Shadow test variants showing improvement on "${pattern.pattern_name}" pattern`,
      action_params: {
        variant_ids: pattern.candidate_variants_helping,
        test_duration_days: 7,
      },
      priority: 'medium',
      confidence: 0.6,
    })
    actions.push(action)
  }
  
  // 4. Suggest fine-tuning labels if many confirmed
  if (pattern.actual_example_count >= 20) {
    const { data: existingFineTuning } = await supabase
      .from('learning_actions')
      .select('id')
      .eq('action_type', 'fine_tuning_label_candidate')
      .eq('hard_case_pattern_id', pattern.id)
      .in('status', ['pending', 'approved'])
      .single()
    
    if (!existingFineTuning) {
      const action = await createLearningAction({
        action_type: 'fine_tuning_label_candidate',
        hard_case_pattern_id: pattern.id,
        action_description: `Prepare "${pattern.pattern_name}" pattern examples for model fine-tuning`,
        action_params: {
          label_type: 'hard_case',
          label_confidence: 0.85,
          example_count: pattern.actual_example_count,
        },
        priority: 'medium',
        confidence: 0.75,
      })
      actions.push(action)
    }
  }
  
  return actions
}

/**
 * Generate UI guidance action
 */
export async function generateUIGuidanceAction(params: {
  supervisionEventIds?: string[]
  hardCasePatternId?: string
  guidanceType: 'photo_request' | 'quality_warning' | 'confidence_explanation'
  guidanceMessage: string
  targetCondition: string
}): Promise<LearningActionRow> {
  return createLearningAction({
    action_type: 'ui_guidance_candidate',
    supervision_event_ids: params.supervisionEventIds,
    hard_case_pattern_id: params.hardCasePatternId,
    action_description: `Add UI guidance: "${params.guidanceMessage}"`,
    action_params: {
      guidance_type: params.guidanceType,
      guidance_message: params.guidanceMessage,
      target_condition: params.targetCondition,
    },
    priority: 'low',
    confidence: 0.6,
  })
}

// ============================================================================
// LEARNING ACTIONS - READ
// ============================================================================

/**
 * Get a learning action by ID
 */
export async function getLearningAction(actionId: string): Promise<LearningActionDashboard | null> {
  const supabase = await getServiceSupabase()
  
  const { data, error } = await supabase
    .from('learning_actions_dashboard')
    .select('*')
    .eq('id', actionId)
    .single()
  
  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to get learning action: ${error.message}`)
  }
  
  return data as LearningActionDashboard | null
}

/**
 * List learning actions with filters
 */
export async function listLearningActions(
  filters?: LearningActionQueryFilters
): Promise<{ data: LearningActionDashboard[]; count: number }> {
  const supabase = await getServiceSupabase()
  
  let query = supabase
    .from('learning_actions_dashboard')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
  
  if (filters?.action_type) {
    const types = Array.isArray(filters.action_type) ? filters.action_type : [filters.action_type]
    query = query.in('action_type', types)
  }
  
  if (filters?.status) {
    const statuses = Array.isArray(filters.status) ? filters.status : [filters.status]
    query = query.in('status', statuses)
  }
  
  if (filters?.priority) {
    const priorities = Array.isArray(filters.priority) ? filters.priority : [filters.priority]
    query = query.in('priority', priorities)
  }
  
  if (filters?.hard_case_pattern_id) {
    query = query.eq('hard_case_pattern_id', filters.hard_case_pattern_id)
  }
  
  if (filters?.limit) {
    query = query.limit(filters.limit)
  }
  
  if (filters?.offset) {
    query = query.range(filters.offset, filters.offset + (filters.limit || 50) - 1)
  }
  
  const { data, error, count } = await query
  
  if (error) {
    throw new Error(`Failed to list learning actions: ${error.message}`)
  }
  
  return {
    data: (data || []) as LearningActionDashboard[],
    count: count || 0,
  }
}

/**
 * Get pending learning actions for admin review
 */
export async function getPendingLearningActions(): Promise<LearningActionDashboard[]> {
  const { data } = await listLearningActions({
    status: 'pending',
    limit: 100,
  })
  return data
}

// ============================================================================
// LEARNING ACTIONS - UPDATE
// ============================================================================

/**
 * Review a learning action (approve/reject)
 */
export async function reviewLearningAction(
  actionId: string,
  decision: 'approved' | 'rejected',
  reviewedByUserId: string,
  notes?: string
): Promise<LearningActionRow> {
  const supabase = await getServiceSupabase()
  
  const { data, error } = await supabase
    .from('learning_actions')
    .update({
      status: decision,
      reviewed_by_user_id: reviewedByUserId,
      reviewed_at: new Date().toISOString(),
      review_notes: notes ?? null,
    })
    .eq('id', actionId)
    .select()
    .single()
  
  if (error || !data) {
    throw new Error(`Failed to review learning action: ${error?.message ?? 'unknown'}`)
  }
  
  return data as LearningActionRow
}

/**
 * Mark a learning action as implemented
 */
export async function markActionImplemented(
  actionId: string,
  implementationNotes?: string
): Promise<LearningActionRow> {
  const supabase = await getServiceSupabase()
  
  const { data, error } = await supabase
    .from('learning_actions')
    .update({
      status: 'implemented',
      implemented_at: new Date().toISOString(),
      implementation_notes: implementationNotes ?? null,
    })
    .eq('id', actionId)
    .select()
    .single()
  
  if (error || !data) {
    throw new Error(`Failed to mark action implemented: ${error?.message ?? 'unknown'}`)
  }
  
  return data as LearningActionRow
}

/**
 * Archive a learning action
 */
export async function archiveLearningAction(actionId: string): Promise<void> {
  const supabase = await getServiceSupabase()
  
  const { error } = await supabase
    .from('learning_actions')
    .update({ status: 'archived' })
    .eq('id', actionId)
  
  if (error) {
    throw new Error(`Failed to archive learning action: ${error.message}`)
  }
}

// ============================================================================
// BATCH GENERATION
// ============================================================================

/**
 * Run batch generation of learning actions from recent supervision
 */
export async function runLearningActionGeneration(): Promise<{
  eventsProcessed: number
  patternsProcessed: number
  actionsGenerated: number
}> {
  const supabase = await getServiceSupabase()
  
  let actionsGenerated = 0
  
  // Get recent confirmed supervision events
  const sevenDaysAgo = new Date()
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
  
  const { data: recentEvents } = await supabase
    .from('supervision_events')
    .select('id')
    .gte('created_at', sevenDaysAgo.toISOString())
    .eq('label_status', 'confirmed')
  
  const eventIds = (recentEvents || []).map(e => e.id)
  
  if (eventIds.length > 0) {
    const eventActions = await generateLearningActionsFromEvents(eventIds)
    actionsGenerated += eventActions.length
  }
  
  // Get active patterns
  const { data: patterns } = await supabase
    .from('hard_case_patterns_summary')
    .select('*')
    .neq('mitigation_status', 'mitigated')
    .gte('examples_count', SUPERVISION_SETTINGS.min_pattern_examples)
  
  for (const pattern of (patterns || []) as HardCasePatternSummary[]) {
    const patternActions = await generateLearningActionsFromPattern(pattern)
    actionsGenerated += patternActions.length
  }
  
  return {
    eventsProcessed: eventIds.length,
    patternsProcessed: (patterns || []).length,
    actionsGenerated,
  }
}

// ============================================================================
// HELPERS
// ============================================================================

interface ActionSuggestion {
  type: LearningActionType
  description: string
  params: LearningActionParams
  confidence: number
  impact: EstimatedImpact
}

function suggestActionsForLabel(
  label: FailureCauseLabel,
  events: SupervisionEventWithLabels[]
): ActionSuggestion[] {
  const suggestions: ActionSuggestion[] = []
  
  // Calibration-related labels
  if (label === 'confidence_overestimate' || label === 'confidence_underestimate' || label === 'segment_calibration_miss') {
    suggestions.push({
      type: 'calibration_adjustment_candidate',
      description: `Adjust calibration to address ${label.replace(/_/g, ' ')} issues`,
      params: {
        adjustment_type: label === 'confidence_overestimate' ? 'reduce_confidence' : 'increase_confidence',
      },
      confidence: 0.7,
      impact: {
        expected_improvement: [{
          metric: 'confidence_calibration',
          current_value: 0,
          expected_value: 0,
          improvement_percent: 10,
        }],
        risk_level: 'medium',
      },
    })
  }
  
  // Reference-related labels
  if (label === 'scale_reference_failure' || label === 'weak_front_reference' || label === 'weak_side_reference') {
    suggestions.push({
      type: 'ui_guidance_candidate',
      description: `Add photo guidance for ${label.replace(/_/g, ' ')}`,
      params: {
        guidance_type: 'photo_request',
        guidance_message: getGuidanceMessageForLabel(label),
        target_condition: label,
      },
      confidence: 0.8,
      impact: {
        risk_level: 'low',
      },
    })
  }
  
  // If many events, suggest data priority
  if (events.length >= 10) {
    suggestions.push({
      type: 'data_gap_priority_candidate',
      description: `Prioritize data collection for ${label.replace(/_/g, ' ')} cases`,
      params: {
        gap_description: `Cases with ${label.replace(/_/g, ' ')}`,
        priority_score: events.length / 10,
      },
      confidence: 0.6,
      impact: {
        affected_prediction_count: events.length,
        risk_level: 'low',
      },
    })
  }
  
  return suggestions
}

function getGuidanceMessageForLabel(label: FailureCauseLabel): string {
  const messages: Partial<Record<FailureCauseLabel, string>> = {
    scale_reference_failure: 'A clearer frontal view with both ears visible would improve this score.',
    weak_front_reference: 'This score would benefit from a better frontal angle photo.',
    weak_side_reference: 'Adding a clear side profile would help refine beam measurements.',
    tine_occlusion: 'Some tines may be obscured - additional angles could improve accuracy.',
    lighting_quality_failure: 'Better lighting would help improve measurement accuracy.',
    crop_or_occlusion_failure: 'Please ensure the full rack is visible in your photos.',
  }
  
  return messages[label] || 'Additional photos may improve scoring accuracy.'
}

/**
 * Get action implementation preview
 */
export async function getActionImplementationPreview(actionId: string): Promise<{
  action: LearningActionDashboard
  affectedPredictions: number
  estimatedImpact: string
  implementationSteps: string[]
}> {
  const action = await getLearningAction(actionId)
  if (!action) throw new Error('Action not found')
  
  const actionInfo = LEARNING_ACTION_INFO[action.action_type]
  
  const steps: string[] = []
  
  switch (action.action_type) {
    case 'calibration_adjustment_candidate':
      steps.push('1. Review current calibration settings')
      steps.push('2. Apply suggested adjustment in shadow mode')
      steps.push('3. Run validation against benchmark pack')
      steps.push('4. If improved, promote to production')
      break
    case 'protected_segment_candidate':
      steps.push('1. Define protected segment criteria')
      steps.push('2. Add to promotion gate configuration')
      steps.push('3. Test with existing candidate variants')
      break
    case 'benchmark_pack_candidate':
      steps.push('1. Export pattern examples to benchmark pack')
      steps.push('2. Tag pack with pattern metadata')
      steps.push('3. Add to standard evaluation suite')
      break
    case 'ui_guidance_candidate':
      steps.push('1. Add conditional guidance to scoring UI')
      steps.push('2. Define trigger conditions')
      steps.push('3. Deploy and monitor effectiveness')
      break
    default:
      steps.push('Implementation steps not defined for this action type')
  }
  
  return {
    action,
    affectedPredictions: (action.estimated_impact as EstimatedImpact)?.affected_prediction_count || 0,
    estimatedImpact: actionInfo.description,
    implementationSteps: steps,
  }
}
