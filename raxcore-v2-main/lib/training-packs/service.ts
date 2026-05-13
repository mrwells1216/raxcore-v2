/**
 * Phase 53: Training Pack Generation Service
 * 
 * Core CRUD operations and pack generation logic for training packs.
 * Integrates with supervision events, reverse/structural artifacts, and auxiliary labels.
 */

import { createClient } from '@/lib/supabase/server'
import { getServiceSupabase } from '@/lib/supabase/admin'
import type {
  TrainingPack,
  TrainingPackItem,
  TrainingPackJob,
  TrainingPackStats,
  TrainingPackWithStats,
  CreateTrainingPackInput,
  AddTrainingPackItemInput,
  TrainingPackFilterConfig,
  TrainingPackArtifactSummary,
  TrainingSplitType,
  ListTrainingPacksOptions,
} from '@/lib/types'

// ============================================================================
// PACK CRUD
// ============================================================================

/**
 * Create a new training pack
 */
export async function createTrainingPack(
  input: CreateTrainingPackInput
): Promise<TrainingPack> {
  const supabase = await getServiceSupabase()
  
  const { data, error } = await supabase
    .from('training_packs')
    .insert({
      name: input.name,
      description: input.description || null,
      pack_type: input.pack_type,
      status: 'draft',
      filter_config_json: input.filter_config_json || {},
      split_config_json: input.split_config_json || {
        train: 0.7,
        validation: 0.15,
        test: 0.10,
        benchmark_holdout: 0.05,
      },
      variant_id: input.variant_id || null,
      created_by: input.created_by || null,
    })
    .select()
    .single()
  
  if (error) {
    console.error('[training-packs] Error creating pack:', error)
    throw new Error(`Failed to create training pack: ${error.message}`)
  }
  
  return data as TrainingPack
}

/**
 * Get a training pack by ID
 */
export async function getTrainingPackById(
  packId: string
): Promise<TrainingPack | null> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('training_packs')
    .select('*')
    .eq('id', packId)
    .single()
  
  if (error) {
    if (error.code === 'PGRST116') return null
    console.error('[training-packs] Error fetching pack:', error)
    throw new Error(`Failed to fetch training pack: ${error.message}`)
  }
  
  return data as TrainingPack
}

/**
 * Get a training pack with computed statistics
 */
export async function getTrainingPackWithStats(
  packId: string
): Promise<TrainingPackWithStats | null> {
  const pack = await getTrainingPackById(packId)
  if (!pack) return null
  
  const stats = await computePackStats(packId)
  
  return { ...pack, stats }
}

/**
 * List training packs with optional filters
 */
export async function listTrainingPacks(
  options: ListTrainingPacksOptions = {}
): Promise<TrainingPack[]> {
  const supabase = await createClient()
  
  let query = supabase
    .from('training_packs')
    .select('*')
  
  if (options.pack_type) {
    query = query.eq('pack_type', options.pack_type)
  }
  
  if (options.status) {
    query = query.eq('status', options.status)
  }
  
  if (options.variant_id) {
    query = query.eq('variant_id', options.variant_id)
  }
  
  if (options.created_by) {
    query = query.eq('created_by', options.created_by)
  }
  
  // Ordering
  const orderBy = options.order_by || 'created_at'
  const orderDir = options.order_dir === 'asc'
  query = query.order(orderBy, { ascending: orderDir })
  
  // Pagination
  if (options.limit) {
    query = query.limit(options.limit)
  }
  
  if (options.offset) {
    query = query.range(options.offset, options.offset + (options.limit || 50) - 1)
  }
  
  const { data, error } = await query
  
  if (error) {
    console.error('[training-packs] Error listing packs:', error)
    throw new Error(`Failed to list training packs: ${error.message}`)
  }
  
  return data as TrainingPack[]
}

/**
 * Update a training pack
 */
export async function updateTrainingPack(
  packId: string,
  updates: Partial<Pick<TrainingPack, 'name' | 'description' | 'status' | 'filter_config_json' | 'split_config_json' | 'variant_id' | 'split_seed'>>
): Promise<TrainingPack> {
  const supabase = await getServiceSupabase()
  
  const { data, error } = await supabase
    .from('training_packs')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', packId)
    .select()
    .single()
  
  if (error) {
    console.error('[training-packs] Error updating pack:', error)
    throw new Error(`Failed to update training pack: ${error.message}`)
  }
  
  return data as TrainingPack
}

/**
 * Delete a training pack
 */
export async function deleteTrainingPack(packId: string): Promise<void> {
  const supabase = await getServiceSupabase()
  
  const { error } = await supabase
    .from('training_packs')
    .delete()
    .eq('id', packId)
  
  if (error) {
    console.error('[training-packs] Error deleting pack:', error)
    throw new Error(`Failed to delete training pack: ${error.message}`)
  }
}

// ============================================================================
// PACK ITEMS
// ============================================================================

/**
 * Add items to a training pack
 */
export async function addItemsToTrainingPack(
  packId: string,
  items: AddTrainingPackItemInput[]
): Promise<TrainingPackItem[]> {
  const supabase = await getServiceSupabase()
  
  // Get pack to determine split seed
  const pack = await getTrainingPackById(packId)
  if (!pack) throw new Error('Training pack not found')
  
  // Prepare items with split assignment
  const preparedItems = items.map(item => ({
    training_pack_id: packId,
    prediction_id: item.prediction_id,
    buck_id: item.buck_id || null,
    split_assignment: computeSplitAssignment(
      item.buck_id || item.prediction_id,
      pack.split_seed || 42,
      pack.split_config_json
    ),
    supervision_event_ids: item.supervision_event_ids || [],
    reverse_run_id: item.reverse_run_id || null,
    structural_hypothesis_run_id: item.structural_hypothesis_run_id || null,
    artifact_summary_json: {},
    confidence_score: item.confidence_score || null,
    item_quality_score: item.item_quality_score || null,
  }))
  
  const { data, error } = await supabase
    .from('training_pack_items')
    .insert(preparedItems)
    .select()
  
  if (error) {
    console.error('[training-packs] Error adding items:', error)
    throw new Error(`Failed to add items to pack: ${error.message}`)
  }
  
  return data as TrainingPackItem[]
}

/**
 * Get items for a training pack
 */
export async function getTrainingPackItems(
  packId: string,
  options?: {
    split?: TrainingSplitType
    limit?: number
    offset?: number
  }
): Promise<TrainingPackItem[]> {
  const supabase = await createClient()
  
  let query = supabase
    .from('training_pack_items')
    .select('*')
    .eq('training_pack_id', packId)
  
  if (options?.split) {
    query = query.eq('split_assignment', options.split)
  }
  
  query = query.order('created_at', { ascending: false })
  
  if (options?.limit) {
    query = query.limit(options.limit)
  }
  
  if (options?.offset) {
    query = query.range(options.offset, options.offset + (options.limit || 50) - 1)
  }
  
  const { data, error } = await query
  
  if (error) {
    console.error('[training-packs] Error fetching items:', error)
    throw new Error(`Failed to fetch pack items: ${error.message}`)
  }
  
  return data as TrainingPackItem[]
}

/**
 * Get a single pack item by ID
 */
export async function getTrainingPackItemById(
  itemId: string
): Promise<TrainingPackItem | null> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('training_pack_items')
    .select('*')
    .eq('id', itemId)
    .single()
  
  if (error) {
    if (error.code === 'PGRST116') return null
    console.error('[training-packs] Error fetching item:', error)
    throw new Error(`Failed to fetch pack item: ${error.message}`)
  }
  
  return data as TrainingPackItem
}

/**
 * Update artifact summary for a pack item
 */
export async function updateItemArtifactSummary(
  itemId: string,
  summary: TrainingPackArtifactSummary
): Promise<void> {
  const supabase = await getServiceSupabase()
  
  const { error } = await supabase
    .from('training_pack_items')
    .update({ artifact_summary_json: summary })
    .eq('id', itemId)
  
  if (error) {
    console.error('[training-packs] Error updating artifact summary:', error)
    throw new Error(`Failed to update artifact summary: ${error.message}`)
  }
}

/**
 * Remove items from a training pack
 */
export async function removeItemsFromPack(
  packId: string,
  itemIds: string[]
): Promise<void> {
  const supabase = await getServiceSupabase()
  
  const { error } = await supabase
    .from('training_pack_items')
    .delete()
    .eq('training_pack_id', packId)
    .in('id', itemIds)
  
  if (error) {
    console.error('[training-packs] Error removing items:', error)
    throw new Error(`Failed to remove items: ${error.message}`)
  }
}

// ============================================================================
// SPLIT ASSIGNMENT
// ============================================================================

/**
 * Compute deterministic split assignment based on ID and seed
 */
export function computeSplitAssignment(
  id: string,
  seed: number,
  config: { train: number; validation: number; test: number; benchmark_holdout: number }
): TrainingSplitType {
  // Simple hash function
  const hash = hashString(id + seed.toString())
  const normalized = (hash % 10000) / 10000
  
  if (normalized < config.train) {
    return 'train'
  } else if (normalized < config.train + config.validation) {
    return 'validation'
  } else if (normalized < config.train + config.validation + config.test) {
    return 'test'
  } else {
    return 'benchmark_holdout'
  }
}

/**
 * Reassign splits for all items in a pack
 */
export async function reassignPackSplits(
  packId: string,
  seed?: number
): Promise<void> {
  const supabase = await getServiceSupabase()
  
  // Get pack and items
  const pack = await getTrainingPackById(packId)
  if (!pack) throw new Error('Training pack not found')
  
  const items = await getTrainingPackItems(packId, { limit: 10000 })
  
  const newSeed = seed ?? Math.floor(Math.random() * 1000000)
  
  // Update pack with new seed
  await updateTrainingPack(packId, { split_seed: newSeed })
  
  // Update each item's split assignment
  for (const item of items) {
    const newSplit = computeSplitAssignment(
      item.buck_id || item.prediction_id,
      newSeed,
      pack.split_config_json
    )
    
    await supabase
      .from('training_pack_items')
      .update({ split_assignment: newSplit })
      .eq('id', item.id)
  }
}

// ============================================================================
// STATISTICS
// ============================================================================

/**
 * Compute statistics for a training pack
 */
export async function computePackStats(packId: string): Promise<TrainingPackStats> {
  const supabase = await createClient()
  
  // Get all items
  const { data: items, error: itemsError } = await supabase
    .from('training_pack_items')
    .select('*')
    .eq('training_pack_id', packId)
  
  if (itemsError) {
    console.error('[training-packs] Error fetching items for stats:', itemsError)
    throw new Error(`Failed to compute stats: ${itemsError.message}`)
  }
  
  const allItems = items as TrainingPackItem[]
  
  // Get auxiliary labels
  const itemIds = allItems.map(i => i.id)
  const { data: labels, error: labelsError } = await supabase
    .from('auxiliary_labels')
    .select('*')
    .in('training_pack_item_id', itemIds.length > 0 ? itemIds : ['__none__'])
  
  if (labelsError) {
    console.error('[training-packs] Error fetching labels for stats:', labelsError)
  }
  
  const allLabels = (labels || []) as Array<{ auxiliary_label_type: string; status: string }>
  
  // Compute split counts
  const splits: Record<TrainingSplitType, number> = {
    train: 0,
    validation: 0,
    test: 0,
    benchmark_holdout: 0,
  }
  
  for (const item of allItems) {
    splits[item.split_assignment]++
  }
  
  // Compute label distribution
  const labelDistribution: Record<string, number> = {}
  let confirmedCount = 0
  let pendingCount = 0
  
  for (const label of allLabels) {
    labelDistribution[label.auxiliary_label_type] = (labelDistribution[label.auxiliary_label_type] || 0) + 1
    if (label.status === 'confirmed') confirmedCount++
    if (label.status === 'pending') pendingCount++
  }
  
  // Compute artifact coverage
  let withSupervision = 0
  let withReverse = 0
  let withStructural = 0
  let withHardCase = 0
  let totalConfidence = 0
  let totalQuality = 0
  let confidenceCount = 0
  let qualityCount = 0
  
  const segmentDistribution: Record<string, number> = {}
  
  for (const item of allItems) {
    if (item.supervision_event_ids.length > 0) withSupervision++
    if (item.reverse_run_id) withReverse++
    if (item.structural_hypothesis_run_id) withStructural++
    
    const summary = item.artifact_summary_json as TrainingPackArtifactSummary
    if (summary?.hard_case_pattern_ids?.length > 0) withHardCase++
    
    if (item.confidence_score !== null) {
      totalConfidence += item.confidence_score
      confidenceCount++
    }
    
    if (item.item_quality_score !== null) {
      totalQuality += item.item_quality_score
      qualityCount++
    }
  }
  
  return {
    total_items: allItems.length,
    splits,
    label_distribution: labelDistribution as Record<string, number>,
    confirmed_label_count: confirmedCount,
    pending_label_count: pendingCount,
    items_with_supervision: withSupervision,
    items_with_reverse: withReverse,
    items_with_structural: withStructural,
    items_with_hard_case: withHardCase,
    avg_confidence_score: confidenceCount > 0 ? totalConfidence / confidenceCount : 0,
    avg_quality_score: qualityCount > 0 ? totalQuality / qualityCount : 0,
    segment_distribution: segmentDistribution,
  }
}

// ============================================================================
// VARIANT LINKING
// ============================================================================

/**
 * Link a training pack to a candidate variant
 */
export async function linkPackToVariant(
  packId: string,
  variantId: string
): Promise<void> {
  const supabase = await getServiceSupabase()
  
  // Update pack
  await updateTrainingPack(packId, { variant_id: variantId })
  
  // Also update candidate_models.training_pack_ids
  const { data: variant, error: fetchError } = await supabase
    .from('candidate_models')
    .select('training_pack_ids')
    .eq('id', variantId)
    .single()
  
  if (fetchError) {
    console.error('[training-packs] Error fetching variant:', fetchError)
    return
  }
  
  const existingIds = (variant?.training_pack_ids || []) as string[]
  if (!existingIds.includes(packId)) {
    const { error: updateError } = await supabase
      .from('candidate_models')
      .update({ training_pack_ids: [...existingIds, packId] })
      .eq('id', variantId)
    
    if (updateError) {
      console.error('[training-packs] Error updating variant pack IDs:', updateError)
    }
  }
}

/**
 * Unlink a training pack from a candidate variant
 */
export async function unlinkPackFromVariant(
  packId: string,
  variantId: string
): Promise<void> {
  const supabase = await getServiceSupabase()
  
  // Update pack
  await updateTrainingPack(packId, { variant_id: null })
  
  // Also update candidate_models.training_pack_ids
  const { data: variant, error: fetchError } = await supabase
    .from('candidate_models')
    .select('training_pack_ids')
    .eq('id', variantId)
    .single()
  
  if (fetchError) {
    console.error('[training-packs] Error fetching variant:', fetchError)
    return
  }
  
  const existingIds = (variant?.training_pack_ids || []) as string[]
  const updatedIds = existingIds.filter(id => id !== packId)
  
  const { error: updateError } = await supabase
    .from('candidate_models')
    .update({ training_pack_ids: updatedIds })
    .eq('id', variantId)
  
  if (updateError) {
    console.error('[training-packs] Error updating variant pack IDs:', updateError)
  }
}

// ============================================================================
// JOBS
// ============================================================================

/**
 * Create a pack generation job
 */
export async function createPackJob(
  packId: string,
  jobType: string
): Promise<TrainingPackJob> {
  const supabase = await getServiceSupabase()
  
  const { data, error } = await supabase
    .from('training_pack_jobs')
    .insert({
      training_pack_id: packId,
      job_type: jobType,
      status: 'pending',
    })
    .select()
    .single()
  
  if (error) {
    console.error('[training-packs] Error creating job:', error)
    throw new Error(`Failed to create job: ${error.message}`)
  }
  
  return data as TrainingPackJob
}

/**
 * Update a pack job status
 */
export async function updatePackJobStatus(
  jobId: string,
  updates: Partial<Pick<TrainingPackJob, 'status' | 'processed_items' | 'total_items' | 'result_json' | 'error_message' | 'started_at' | 'completed_at'>>
): Promise<void> {
  const supabase = await getServiceSupabase()
  
  const { error } = await supabase
    .from('training_pack_jobs')
    .update(updates)
    .eq('id', jobId)
  
  if (error) {
    console.error('[training-packs] Error updating job:', error)
    throw new Error(`Failed to update job: ${error.message}`)
  }
}

/**
 * Get jobs for a training pack
 */
export async function getPackJobs(
  packId: string
): Promise<TrainingPackJob[]> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('training_pack_jobs')
    .select('*')
    .eq('training_pack_id', packId)
    .order('created_at', { ascending: false })
  
  if (error) {
    console.error('[training-packs] Error fetching jobs:', error)
    throw new Error(`Failed to fetch jobs: ${error.message}`)
  }
  
  return data as TrainingPackJob[]
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Simple string hash function for deterministic split assignment
 */
function hashString(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32bit integer
  }
  return Math.abs(hash)
}

/**
 * Build artifact summary for a prediction
 */
export async function buildArtifactSummary(
  predictionId: string
): Promise<TrainingPackArtifactSummary> {
  const supabase = await createClient()
  
  // Get supervision events
  const { data: events } = await supabase
    .from('supervision_events')
    .select('id, supervision_type')
    .eq('prediction_id', predictionId)
  
  // Get supervision labels
  const eventIds = (events || []).map(e => e.id)
  const { data: labels } = await supabase
    .from('supervision_labels')
    .select('label')
    .in('supervision_event_id', eventIds.length > 0 ? eventIds : ['__none__'])
  
  // Get reverse run
  const { data: reverseRun } = await supabase
    .from('reverse_runs')
    .select('id, hypothesis_type, improvement_gross')
    .eq('prediction_id', predictionId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()
  
  // Get structural run
  const { data: structuralRun } = await supabase
    .from('structural_hypothesis_runs')
    .select('id, topology_changed, change_reason')
    .eq('prediction_id', predictionId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()
  
  // Get hard-case patterns
  const { data: patterns } = await supabase
    .from('hard_case_pattern_examples')
    .select('pattern_id, hard_case_patterns(severity)')
    .eq('prediction_id', predictionId)
  
  // Get prediction
  const { data: prediction } = await supabase
    .from('predictions')
    .select('predicted_gross, confidence_score')
    .eq('id', predictionId)
    .single()
  
  return {
    supervision_event_count: events?.length || 0,
    supervision_types: [...new Set((events || []).map(e => e.supervision_type))],
    supervision_labels: [...new Set((labels || []).map(l => l.label))],
    reverse_run_exists: !!reverseRun,
    reverse_hypothesis_type: reverseRun?.hypothesis_type,
    reverse_improvement_inches: reverseRun?.improvement_gross,
    structural_run_exists: !!structuralRun,
    structural_topology_changed: structuralRun?.topology_changed,
    structural_change_reason: structuralRun?.change_reason,
    hard_case_pattern_ids: (patterns || []).map(p => p.pattern_id),
    hard_case_severity: patterns?.length ? Math.max(...patterns.map(p => (p.hard_case_patterns as { severity: number })?.severity || 0)) : undefined,
    predicted_gross: prediction?.predicted_gross,
  }
}
