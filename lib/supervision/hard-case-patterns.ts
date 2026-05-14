import 'server-only'

/**
 * Phase 52: Hard-Case Pattern System
 * 
 * Manages recurring hard-case patterns that the system struggles with.
 * Patterns are accumulated over time from supervision signals.
 */

import { getServiceSupabase } from '@/lib/supabase/admin'
import type {
  HardCasePatternRow,
  HardCasePatternSummary,
  HardCasePatternExampleRow,
  CreateHardCasePatternInput,
  HardCasePatternQueryFilters,
  PatternDefinition,
  PatternCondition,
  SegmentDistribution,
  FailureCauseLabel,
  MitigationStatus,
} from './types'
import { PREDEFINED_PATTERNS, SUPERVISION_SETTINGS } from './config'

// ============================================================================
// HARD CASE PATTERNS - CREATE
// ============================================================================

/**
 * Create a new hard-case pattern
 */
export async function createHardCasePattern(
  input: CreateHardCasePatternInput
): Promise<HardCasePatternRow> {
  const supabase = await getServiceSupabase()
  
  const { data, error } = await supabase
    .from('hard_case_patterns')
    .insert({
      pattern_name: input.pattern_name,
      pattern_definition: input.pattern_definition,
      description: input.description ?? null,
      severity: input.severity ?? 0.5,
      associated_labels: input.associated_labels ?? [],
      examples_count: 0,
      segment_distribution: {},
      mitigation_status: 'unaddressed',
    })
    .select()
    .single()
  
  if (error || !data) {
    throw new Error(`Failed to create hard-case pattern: ${error?.message ?? 'unknown'}`)
  }
  
  return data as HardCasePatternRow
}

/**
 * Initialize predefined patterns if they don't exist
 */
export async function initializePredefinedPatterns(): Promise<number> {
  const supabase = await getServiceSupabase()
  let created = 0
  
  for (const predefined of PREDEFINED_PATTERNS) {
    // Check if pattern exists
    const { data: existing } = await supabase
      .from('hard_case_patterns')
      .select('id')
      .eq('pattern_name', predefined.name)
      .single()
    
    if (!existing) {
      await createHardCasePattern({
        pattern_name: predefined.name,
        pattern_definition: predefined.definition,
        description: predefined.description,
        severity: predefined.severity,
        associated_labels: predefined.associated_labels,
      })
      created++
    }
  }
  
  return created
}

// ============================================================================
// HARD CASE PATTERNS - READ
// ============================================================================

/**
 * Get a hard-case pattern by ID
 */
export async function getHardCasePattern(patternId: string): Promise<HardCasePatternSummary | null> {
  const supabase = await getServiceSupabase()
  
  const { data, error } = await supabase
    .from('hard_case_patterns_summary')
    .select('*')
    .eq('id', patternId)
    .single()
  
  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to get hard-case pattern: ${error.message}`)
  }
  
  return data as HardCasePatternSummary | null
}

/**
 * Get a hard-case pattern by name
 */
export async function getHardCasePatternByName(patternName: string): Promise<HardCasePatternSummary | null> {
  const supabase = await getServiceSupabase()
  
  const { data, error } = await supabase
    .from('hard_case_patterns_summary')
    .select('*')
    .eq('pattern_name', patternName)
    .single()
  
  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to get hard-case pattern: ${error.message}`)
  }
  
  return data as HardCasePatternSummary | null
}

/**
 * List hard-case patterns with filters
 */
export async function listHardCasePatterns(
  filters?: HardCasePatternQueryFilters
): Promise<{ data: HardCasePatternSummary[]; count: number }> {
  const supabase = await getServiceSupabase()
  
  let query = supabase
    .from('hard_case_patterns_summary')
    .select('*', { count: 'exact' })
    .order('severity', { ascending: false })
  
  if (filters?.mitigation_status) {
    const statuses = Array.isArray(filters.mitigation_status) 
      ? filters.mitigation_status 
      : [filters.mitigation_status]
    query = query.in('mitigation_status', statuses)
  }
  
  if (filters?.min_severity !== undefined) {
    query = query.gte('severity', filters.min_severity)
  }
  
  if (filters?.min_examples !== undefined) {
    query = query.gte('examples_count', filters.min_examples)
  }
  
  if (filters?.associated_label) {
    query = query.contains('associated_labels', [filters.associated_label])
  }
  
  if (filters?.limit) {
    query = query.limit(filters.limit)
  }
  
  if (filters?.offset) {
    query = query.range(filters.offset, filters.offset + (filters.limit || 50) - 1)
  }
  
  const { data, error, count } = await query
  
  if (error) {
    throw new Error(`Failed to list hard-case patterns: ${error.message}`)
  }
  
  return {
    data: (data || []) as HardCasePatternSummary[],
    count: count || 0,
  }
}

// ============================================================================
// HARD CASE PATTERNS - UPDATE
// ============================================================================

/**
 * Update a hard-case pattern
 */
export async function updateHardCasePattern(
  patternId: string,
  updates: Partial<{
    description: string
    severity: number
    associated_labels: FailureCauseLabel[]
    mitigation_status: MitigationStatus
    mitigation_notes: string
  }>
): Promise<HardCasePatternRow> {
  const supabase = await getServiceSupabase()
  
  const { data, error } = await supabase
    .from('hard_case_patterns')
    .update(updates)
    .eq('id', patternId)
    .select()
    .single()
  
  if (error || !data) {
    throw new Error(`Failed to update hard-case pattern: ${error?.message ?? 'unknown'}`)
  }
  
  return data as HardCasePatternRow
}

/**
 * Track candidate variant impact on a pattern
 */
export async function trackVariantImpact(
  patternId: string,
  variantId: string,
  impact: 'helping' | 'hurting'
): Promise<void> {
  const supabase = await getServiceSupabase()
  
  const { data: pattern } = await supabase
    .from('hard_case_patterns')
    .select('candidate_variants_helping, candidate_variants_hurting')
    .eq('id', patternId)
    .single()
  
  if (!pattern) return
  
  const helping = pattern.candidate_variants_helping || []
  const hurting = pattern.candidate_variants_hurting || []
  
  // Remove from opposite list if present
  if (impact === 'helping') {
    const newHurting = hurting.filter((v: string) => v !== variantId)
    const newHelping = helping.includes(variantId) ? helping : [...helping, variantId]
    
    await supabase
      .from('hard_case_patterns')
      .update({
        candidate_variants_helping: newHelping,
        candidate_variants_hurting: newHurting,
      })
      .eq('id', patternId)
  } else {
    const newHelping = helping.filter((v: string) => v !== variantId)
    const newHurting = hurting.includes(variantId) ? hurting : [...hurting, variantId]
    
    await supabase
      .from('hard_case_patterns')
      .update({
        candidate_variants_helping: newHelping,
        candidate_variants_hurting: newHurting,
      })
      .eq('id', patternId)
  }
}

// ============================================================================
// PATTERN EXAMPLES
// ============================================================================

/**
 * Add an example to a hard-case pattern
 */
export async function addPatternExample(params: {
  patternId: string
  predictionId?: string
  buckId?: string
  matchConfidence: number
  matchingFeatures: Record<string, unknown>
  errorGross?: number
  errorNet?: number
}): Promise<HardCasePatternExampleRow> {
  const supabase = await getServiceSupabase()
  
  const { data, error } = await supabase
    .from('hard_case_pattern_examples')
    .insert({
      pattern_id: params.patternId,
      prediction_id: params.predictionId ?? null,
      buck_id: params.buckId ?? null,
      match_confidence: params.matchConfidence,
      matching_features: params.matchingFeatures,
      error_gross: params.errorGross ?? null,
      error_net: params.errorNet ?? null,
    })
    .select()
    .single()
  
  if (error || !data) {
    throw new Error(`Failed to add pattern example: ${error?.message ?? 'unknown'}`)
  }
  
  // Update pattern example count and segment distribution
  await updatePatternStats(params.patternId)
  
  // Update prediction metadata
  if (params.predictionId) {
    supabase.rpc('array_append_unique', {
      table_name: 'predictions',
      row_id: params.predictionId,
      column_name: 'hard_case_pattern_ids',
      new_value: params.patternId,
    }).then(() => {
      // Ignore if RPC doesn't exist
    })
  }
  
  return data as HardCasePatternExampleRow
}

/**
 * Get examples for a pattern
 */
export async function getPatternExamples(
  patternId: string,
  limit: number = 100
): Promise<HardCasePatternExampleRow[]> {
  const supabase = await getServiceSupabase()
  
  const { data, error } = await supabase
    .from('hard_case_pattern_examples')
    .select('*')
    .eq('pattern_id', patternId)
    .order('error_gross', { ascending: false, nullsFirst: false })
    .limit(limit)
  
  if (error) {
    throw new Error(`Failed to get pattern examples: ${error.message}`)
  }
  
  return (data || []) as HardCasePatternExampleRow[]
}

/**
 * Remove an example from a pattern
 */
export async function removePatternExample(exampleId: string): Promise<void> {
  const supabase = await getServiceSupabase()
  
  // Get pattern ID before deleting
  const { data: example } = await supabase
    .from('hard_case_pattern_examples')
    .select('pattern_id')
    .eq('id', exampleId)
    .single()
  
  const { error } = await supabase
    .from('hard_case_pattern_examples')
    .delete()
    .eq('id', exampleId)
  
  if (error) {
    throw new Error(`Failed to remove pattern example: ${error.message}`)
  }
  
  // Update stats
  if (example) {
    await updatePatternStats(example.pattern_id)
  }
}

// ============================================================================
// PATTERN MATCHING
// ============================================================================

/**
 * Check if a prediction matches any hard-case patterns
 */
export async function matchPredictionToPatterns(params: {
  predictionId: string
  buckId?: string
  state?: string
  rackType?: string
  sourceType?: string
  imageCount?: number
  lightingQuality?: string
  frontalReferenceQuality?: number
  asymmetryPercent?: number
  hasRightProfile?: boolean
  tineVisibilityScore?: number
  beamTipVisibility?: number
  crossViewDisagreement?: number
  confidencePercent?: number
  errorGross?: number
  errorNet?: number
}): Promise<Array<{ patternId: string; patternName: string; matchConfidence: number; matchingFeatures: Record<string, unknown> }>> {
  const supabase = await getServiceSupabase()
  
  // Get all active patterns
  const { data: patterns } = await supabase
    .from('hard_case_patterns')
    .select('*')
    .neq('mitigation_status', 'mitigated')
  
  const matches: Array<{
    patternId: string
    patternName: string
    matchConfidence: number
    matchingFeatures: Record<string, unknown>
  }> = []
  
  for (const pattern of (patterns || []) as HardCasePatternRow[]) {
    const result = evaluatePatternMatch(pattern.pattern_definition, params)
    
    if (result.matches) {
      matches.push({
        patternId: pattern.id,
        patternName: pattern.pattern_name,
        matchConfidence: result.confidence,
        matchingFeatures: result.matchingFeatures,
      })
      
      // Auto-add as example if confidence is high enough
      if (result.confidence >= 0.7) {
        await addPatternExample({
          patternId: pattern.id,
          predictionId: params.predictionId,
          buckId: params.buckId,
          matchConfidence: result.confidence,
          matchingFeatures: result.matchingFeatures,
          errorGross: params.errorGross,
          errorNet: params.errorNet,
        }).catch(() => {
          // Ignore duplicate errors
        })
      }
    }
  }
  
  return matches.sort((a, b) => b.matchConfidence - a.matchConfidence)
}

/**
 * Evaluate if a prediction matches a pattern definition
 */
function evaluatePatternMatch(
  definition: PatternDefinition,
  data: Record<string, unknown>
): { matches: boolean; confidence: number; matchingFeatures: Record<string, unknown> } {
  const { conditions, operator } = definition
  
  const matchResults: Array<{ condition: PatternCondition; matches: boolean; value: unknown }> = []
  
  for (const condition of conditions) {
    const value = data[condition.field]
    const matches = evaluateCondition(condition, value)
    matchResults.push({ condition, matches, value })
  }
  
  const matchCount = matchResults.filter(r => r.matches).length
  const totalConditions = conditions.length
  
  let overallMatch: boolean
  if (operator === 'AND') {
    overallMatch = matchCount === totalConditions
  } else {
    overallMatch = matchCount > 0
  }
  
  // Calculate confidence based on how many conditions matched
  const confidence = totalConditions > 0 ? matchCount / totalConditions : 0
  
  // Build matching features
  const matchingFeatures: Record<string, unknown> = {}
  for (const result of matchResults) {
    if (result.matches) {
      matchingFeatures[result.condition.field] = result.value
    }
  }
  
  return {
    matches: overallMatch,
    confidence,
    matchingFeatures,
  }
}

/**
 * Evaluate a single pattern condition
 */
function evaluateCondition(condition: PatternCondition, value: unknown): boolean {
  if (value === undefined || value === null) {
    return false
  }
  
  switch (condition.operator) {
    case 'eq':
      return value === condition.value
    case 'ne':
      return value !== condition.value
    case 'gt':
      return typeof value === 'number' && value > (condition.value as number)
    case 'lt':
      return typeof value === 'number' && value < (condition.value as number)
    case 'gte':
      return typeof value === 'number' && value >= (condition.value as number)
    case 'lte':
      return typeof value === 'number' && value <= (condition.value as number)
    case 'in':
      return Array.isArray(condition.value) && condition.value.includes(value as string)
    case 'contains':
      return typeof value === 'string' && value.includes(condition.value as string)
    default:
      return false
  }
}

// ============================================================================
// PATTERN DISCOVERY
// ============================================================================

/**
 * Discover new patterns from recent supervision events
 */
export async function discoverNewPatterns(): Promise<{
  discovered: number
  candidates: Array<{
    name: string
    description: string
    exampleCount: number
    avgError: number
    suggestedSeverity: number
    suggestedLabels: FailureCauseLabel[]
  }>
}> {
  const supabase = await getServiceSupabase()
  const candidates: Array<{
    name: string
    description: string
    exampleCount: number
    avgError: number
    suggestedSeverity: number
    suggestedLabels: FailureCauseLabel[]
  }> = []
  
  // Get recent supervision events with labels
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
  
  const { data: events } = await supabase
    .from('supervision_events_with_labels')
    .select('*')
    .gte('created_at', thirtyDaysAgo.toISOString())
    .eq('label_status', 'confirmed')
  
  if (!events || events.length < SUPERVISION_SETTINGS.min_pattern_examples) {
    return { discovered: 0, candidates }
  }
  
  // Group events by label combinations
  const labelGroups: Map<string, {
    events: typeof events
    labels: FailureCauseLabel[]
  }> = new Map()
  
  for (const event of events as Array<{
    labels: Array<{ label: FailureCauseLabel }>
    delta_gross: number | null
    metadata_json: Record<string, unknown>
  }>) {
    if (!event.labels || event.labels.length === 0) continue
    
    const labelKey = event.labels
      .map(l => l.label)
      .sort()
      .join(',')
    
    const existing = labelGroups.get(labelKey) || { events: [], labels: event.labels.map(l => l.label) }
    existing.events.push(event)
    labelGroups.set(labelKey, existing)
  }
  
  // Find groups that meet threshold
  for (const [_, group] of labelGroups) {
    if (group.events.length >= SUPERVISION_SETTINGS.min_pattern_examples) {
      // Check if pattern already exists
      const patternName = `auto_${group.labels.join('_')}`
      const existing = await getHardCasePatternByName(patternName)
      
      if (!existing) {
        const avgError = group.events.reduce((sum, e) => sum + Math.abs((e as unknown as { delta_gross: number | null }).delta_gross || 0), 0) / group.events.length
        const severity = Math.min(0.9, avgError / 10) // Scale severity by error
        
        candidates.push({
          name: patternName,
          description: `Auto-discovered pattern with labels: ${group.labels.join(', ')}`,
          exampleCount: group.events.length,
          avgError,
          suggestedSeverity: severity,
          suggestedLabels: group.labels,
        })
      }
    }
  }
  
  return { discovered: 0, candidates }
}

/**
 * Promote pattern candidates to actual patterns
 */
export async function promotePatternCandidate(params: {
  name: string
  description: string
  severity: number
  associatedLabels: FailureCauseLabel[]
  predictionIds?: string[]
}): Promise<HardCasePatternRow> {
  // Create pattern with generic definition
  const pattern = await createHardCasePattern({
    pattern_name: params.name,
    pattern_definition: {
      conditions: [],
      operator: 'AND',
      pattern_description: params.description,
    },
    description: params.description,
    severity: params.severity,
    associated_labels: params.associatedLabels,
  })
  
  // Add examples if provided
  if (params.predictionIds) {
    for (const predictionId of params.predictionIds) {
      await addPatternExample({
        patternId: pattern.id,
        predictionId,
        matchConfidence: 1.0,
        matchingFeatures: { manually_added: true },
      }).catch(() => {
        // Ignore errors
      })
    }
  }
  
  return pattern
}

// ============================================================================
// PHASE 52 PATCH 2: HARD-CASE PATTERN UPDATE HOOK
// ============================================================================

/**
 * Called when supervision events accumulate around a pattern.
 * Tracks recurrence and severity to guide mitigation priority.
 */
export async function updatePatternFromAccumulatedEvents(
  patternId: string,
  timeWindow: number = 7 * 24 * 60 * 60 // 7 days in seconds
): Promise<{ updated: boolean; newSeverity: number }> {
  const supabase = await getServiceSupabase()
  
  // Get recent examples for this pattern
  const cutoffTime = new Date(Date.now() - timeWindow * 1000).toISOString()
  const { data: recentExamples, error } = await supabase
    .from('hard_case_pattern_examples')
    .select('error_gross, error_net')
    .eq('pattern_id', patternId)
    .gte('created_at', cutoffTime)
  
  if (error || !recentExamples || recentExamples.length === 0) {
    return { updated: false, newSeverity: 0 }
  }
  
  // Calculate aggregate severity from errors
  const errors = recentExamples
    .map(e => Math.abs(e.error_gross || 0))
    .filter(e => e > 0)
  
  if (errors.length === 0) {
    return { updated: false, newSeverity: 0 }
  }
  
  const avgError = errors.reduce((a, b) => a + b, 0) / errors.length
  const maxError = Math.max(...errors)
  
  // Scale severity: higher errors = higher severity
  // Base on average error with bonus for max error
  const newSeverity = Math.min(
    1.0,
    (avgError / 10) * 0.6 + (Math.min(maxError / 20, 1) * 0.4)
  )
  
  // Get current pattern
  const { data: pattern } = await supabase
    .from('hard_case_patterns')
    .select('associated_labels, mitigation_status')
    .eq('id', patternId)
    .single()
  
  if (!pattern) return { updated: false, newSeverity }
  
  // Update pattern severity and track recurrence
  const { data: updated, error: updateError } = await supabase
    .from('hard_case_patterns')
    .update({
      severity: newSeverity,
      examples_count: recentExamples.length,
    })
    .eq('id', patternId)
    .select()
    .single()
  
  if (updateError || !updated) {
    console.error('[Phase 52] Failed to update hard-case pattern:', updateError)
    return { updated: false, newSeverity }
  }
  
  return { updated: true, newSeverity }
}

// ============================================================================
// STATS
// ============================================================================

/**
 * Update pattern statistics
 */
async function updatePatternStats(patternId: string): Promise<void> {
  const supabase = await getServiceSupabase()
  
  // Get example stats
  const { data: examples } = await supabase
    .from('hard_case_pattern_examples')
    .select('buck_id, error_gross')
    .eq('pattern_id', patternId)
  
  const examplesCount = examples?.length || 0
  
  // Get buck metadata for segment distribution
  if (examplesCount > 0 && examples) {
    const buckIds = examples
      .map(e => e.buck_id)
      .filter((id): id is string => id !== null)
    
    const segmentDist: SegmentDistribution = {
      state: {},
      rack_type: {},
      source_type: {},
    }
    
    if (buckIds.length > 0) {
      const { data: bucks } = await supabase
        .from('bucks')
        .select('state, rack_type, source_type')
        .in('id', buckIds)
      
      for (const buck of bucks || []) {
        if (buck.state) {
          segmentDist.state![buck.state] = (segmentDist.state![buck.state] || 0) + 1
        }
        if (buck.rack_type) {
          segmentDist.rack_type![buck.rack_type] = (segmentDist.rack_type![buck.rack_type] || 0) + 1
        }
        if (buck.source_type) {
          segmentDist.source_type![buck.source_type] = (segmentDist.source_type![buck.source_type] || 0) + 1
        }
      }
    }
    
    await supabase
      .from('hard_case_patterns')
      .update({
        examples_count: examplesCount,
        segment_distribution: segmentDist,
      })
      .eq('id', patternId)
  } else {
    await supabase
      .from('hard_case_patterns')
      .update({ examples_count: 0 })
      .eq('id', patternId)
  }
}

/**
 * Get pattern impact summary
 */
export async function getPatternImpactSummary(patternId: string): Promise<{
  totalExamples: number
  avgErrorGross: number
  maxErrorGross: number
  stateDistribution: Record<string, number>
  rackTypeDistribution: Record<string, number>
  recentTrend: 'improving' | 'stable' | 'worsening'
  helpingVariantsCount: number
  hurtingVariantsCount: number
}> {
  const supabase = await getServiceSupabase()
  
  const { data: pattern } = await supabase
    .from('hard_case_patterns_summary')
    .select('*')
    .eq('id', patternId)
    .single()
  
  if (!pattern) {
    throw new Error('Pattern not found')
  }
  
  const patternData = pattern as HardCasePatternSummary
  
  return {
    totalExamples: patternData.actual_example_count || 0,
    avgErrorGross: patternData.avg_error_gross || 0,
    maxErrorGross: patternData.max_error_gross || 0,
    stateDistribution: patternData.segment_distribution?.state || {},
    rackTypeDistribution: patternData.segment_distribution?.rack_type || {},
    recentTrend: 'stable', // Would compute from time series
    helpingVariantsCount: patternData.helping_variants_count || 0,
    hurtingVariantsCount: patternData.hurting_variants_count || 0,
  }
}
