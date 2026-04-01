/**
 * Phase 53: Training Pack Generation Pipeline
 * 
 * Async job pipeline for building training packs from supervision events,
 * reverse/structural artifacts, and hard-case patterns.
 */

import { registerPipeline, definePipeline } from '../'
import type { StageContext } from '../types'
import { getServiceSupabase } from '@/lib/supabase/admin'
import {
  getTrainingPackById,
  addItemsToTrainingPack,
  updateTrainingPack,
  createPackJob,
  updatePackJobStatus,
  buildArtifactSummary,
  updateItemArtifactSummary,
  getTrainingPackItems,
  reassignPackSplits,
} from '@/lib/training-packs/service'
import { generateLabelsForPack } from '@/lib/auxiliary-labels/service'
import { exportManifestAsJson, exportManifestAsCsv, createExportRecord } from '@/lib/training-packs/manifest'
import type {
  TrainingPackFilterConfig,
  TrainingPackType,
  AddTrainingPackItemInput,
} from '@/lib/types'

// ============================================================================
// PAYLOAD TYPES
// ============================================================================

export interface TrainingPackResolveItemsPayload {
  packId: string
  filterConfig: TrainingPackFilterConfig
}

export interface TrainingPackAttachSupervisionPayload {
  packId: string
}

export interface TrainingPackAttachArtifactsPayload {
  packId: string
}

export interface TrainingPackAssignSplitsPayload {
  packId: string
  seed?: number
}

export interface TrainingPackGenerateLabelsPayload {
  packId: string
}

export interface TrainingPackExportPayload {
  packId: string
  format: 'json' | 'csv'
  scope: 'full' | 'filtered'
  splitFilter?: string
  exportedBy?: string
}

// ============================================================================
// STAGE: RESOLVE ITEMS
// ============================================================================

/**
 * Stage 1: Query predictions matching filters and add to pack
 */
async function resolveItems(
  payload: TrainingPackResolveItemsPayload,
  _ctx: StageContext
): Promise<{ itemCount: number }> {
  const { packId, filterConfig } = payload
  const supabase = await getServiceSupabase()
  
  // Build query based on filters
  let query = supabase
    .from('predictions')
    .select('id, buck_id, confidence_score')
    .not('predicted_gross', 'is', null)
  
  // Apply date filters
  if (filterConfig.created_after) {
    query = query.gte('created_at', filterConfig.created_after)
  }
  if (filterConfig.created_before) {
    query = query.lte('created_at', filterConfig.created_before)
  }
  
  // Apply confidence filters
  if (filterConfig.min_confidence_score !== undefined) {
    query = query.gte('confidence_score', filterConfig.min_confidence_score)
  }
  if (filterConfig.max_confidence_score !== undefined) {
    query = query.lte('confidence_score', filterConfig.max_confidence_score)
  }
  
  // Apply limit
  if (filterConfig.max_items) {
    query = query.limit(filterConfig.max_items)
  } else {
    query = query.limit(10000) // Default max
  }
  
  query = query.order('created_at', { ascending: false })
  
  const { data: predictions, error } = await query
  
  if (error) {
    throw new Error(`Failed to query predictions: ${error.message}`)
  }
  
  if (!predictions || predictions.length === 0) {
    return { itemCount: 0 }
  }
  
  // Filter by supervision types if specified
  let filteredPredictions = predictions
  
  if (filterConfig.include_supervision_types?.length) {
    const predictionIds = predictions.map(p => p.id)
    const { data: events } = await supabase
      .from('supervision_events')
      .select('prediction_id, supervision_type')
      .in('prediction_id', predictionIds)
      .in('supervision_type', filterConfig.include_supervision_types)
    
    const matchingIds = new Set((events || []).map(e => e.prediction_id))
    filteredPredictions = predictions.filter(p => matchingIds.has(p.id))
  }
  
  // Filter by verified score requirement
  if (filterConfig.require_verified_score) {
    const predictionIds = filteredPredictions.map(p => p.id)
    const { data: groundTruths } = await supabase
      .from('ground_truth_scores')
      .select('prediction_id')
      .in('prediction_id', predictionIds)
    
    const verifiedIds = new Set((groundTruths || []).map(g => g.prediction_id))
    filteredPredictions = filteredPredictions.filter(p => verifiedIds.has(p.id))
  }
  
  // Prepare items to add
  const items: AddTrainingPackItemInput[] = filteredPredictions.map(p => ({
    prediction_id: p.id,
    buck_id: p.buck_id,
    confidence_score: p.confidence_score,
  }))
  
  // Add items to pack
  await addItemsToTrainingPack(packId, items)
  
  // Update pack source summary
  const pack = await getTrainingPackById(packId)
  if (pack) {
    await updateTrainingPack(packId, {
      filter_config_json: filterConfig,
    })
  }
  
  return { itemCount: items.length }
}

// ============================================================================
// STAGE: ATTACH SUPERVISION
// ============================================================================

/**
 * Stage 2: Fetch supervision events for each item
 */
async function attachSupervision(
  payload: TrainingPackAttachSupervisionPayload,
  _ctx: StageContext
): Promise<{ attachedCount: number }> {
  const { packId } = payload
  const supabase = await getServiceSupabase()
  
  // Get all items
  const items = await getTrainingPackItems(packId, { limit: 10000 })
  
  let attachedCount = 0
  
  for (const item of items) {
    // Find supervision events for this prediction
    const { data: events } = await supabase
      .from('supervision_events')
      .select('id')
      .eq('prediction_id', item.prediction_id)
    
    if (events && events.length > 0) {
      const eventIds = events.map(e => e.id)
      
      await supabase
        .from('training_pack_items')
        .update({ supervision_event_ids: eventIds })
        .eq('id', item.id)
      
      attachedCount++
    }
  }
  
  return { attachedCount }
}

// ============================================================================
// STAGE: ATTACH ARTIFACTS
// ============================================================================

/**
 * Stage 3: Attach reverse/structural runs and build artifact summaries
 */
async function attachArtifacts(
  payload: TrainingPackAttachArtifactsPayload,
  _ctx: StageContext
): Promise<{ artifactCount: number }> {
  const { packId } = payload
  const supabase = await getServiceSupabase()
  
  // Get all items
  const items = await getTrainingPackItems(packId, { limit: 10000 })
  
  let artifactCount = 0
  
  for (const item of items) {
    // Find reverse run
    const { data: reverseRun } = await supabase
      .from('reverse_runs')
      .select('id')
      .eq('prediction_id', item.prediction_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
    
    // Find structural run
    const { data: structuralRun } = await supabase
      .from('structural_hypothesis_runs')
      .select('id')
      .eq('prediction_id', item.prediction_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
    
    // Build artifact summary
    const summary = await buildArtifactSummary(item.prediction_id)
    
    // Update item
    await supabase
      .from('training_pack_items')
      .update({
        reverse_run_id: reverseRun?.id || null,
        structural_hypothesis_run_id: structuralRun?.id || null,
        artifact_summary_json: summary,
      })
      .eq('id', item.id)
    
    if (reverseRun || structuralRun || summary.supervision_event_count > 0) {
      artifactCount++
    }
  }
  
  return { artifactCount }
}

// ============================================================================
// STAGE: ASSIGN SPLITS
// ============================================================================

/**
 * Stage 4: Compute deterministic splits for all items
 */
async function assignSplits(
  payload: TrainingPackAssignSplitsPayload,
  _ctx: StageContext
): Promise<{ splitCounts: Record<string, number> }> {
  const { packId, seed } = payload
  
  // Reassign splits
  await reassignPackSplits(packId, seed)
  
  // Get pack to return counts
  const pack = await getTrainingPackById(packId)
  
  return {
    splitCounts: {
      train: pack?.train_count || 0,
      validation: pack?.validation_count || 0,
      test: pack?.test_count || 0,
      benchmark_holdout: pack?.holdout_count || 0,
    },
  }
}

// ============================================================================
// STAGE: GENERATE LABELS
// ============================================================================

/**
 * Stage 5: Generate auxiliary labels from supervision/artifacts
 */
async function generateLabels(
  payload: TrainingPackGenerateLabelsPayload,
  _ctx: StageContext
): Promise<{ labelCount: number; errorCount: number }> {
  const { packId } = payload
  
  const result = await generateLabelsForPack(packId)
  
  return {
    labelCount: result.created,
    errorCount: result.errors,
  }
}

// ============================================================================
// STAGE: EXPORT
// ============================================================================

/**
 * Stage 6: Generate and store export manifest
 */
async function exportManifest(
  payload: TrainingPackExportPayload,
  _ctx: StageContext
): Promise<{ exportId: string; itemCount: number }> {
  const { packId, format, scope, splitFilter, exportedBy } = payload
  
  // Generate manifest
  let manifest: string
  if (format === 'json') {
    manifest = await exportManifestAsJson(packId, {
      split: splitFilter as 'train' | 'validation' | 'test' | 'benchmark_holdout' | undefined,
    })
  } else {
    manifest = await exportManifestAsCsv(packId, {
      split: splitFilter as 'train' | 'validation' | 'test' | 'benchmark_holdout' | undefined,
    })
  }
  
  // Count items and labels
  const pack = await getTrainingPackById(packId)
  const itemCount = pack?.item_count || 0
  
  // In production, you'd upload to blob storage here
  // For now, just create the export record
  const exportRecord = await createExportRecord(
    packId,
    format,
    scope,
    itemCount,
    0, // Would calculate label count
    undefined, // blobUrl would go here after upload
    scope === 'filtered' ? { split: splitFilter } : undefined,
    exportedBy
  )
  
  return {
    exportId: exportRecord.id,
    itemCount,
  }
}

// ============================================================================
// PIPELINE DEFINITIONS
// ============================================================================

// Resolve items pipeline
const resolveItemsPipeline = definePipeline<TrainingPackResolveItemsPayload, { itemCount: number }>(
  'training_pack_resolve_items',
  [
    {
      name: 'resolve_items',
      weight: 100,
      execute: (input, ctx) => resolveItems(input, ctx),
    },
  ]
)

// Attach supervision pipeline
const attachSupervisionPipeline = definePipeline<TrainingPackAttachSupervisionPayload, { attachedCount: number }>(
  'training_pack_attach_supervision',
  [
    {
      name: 'attach_supervision',
      weight: 100,
      execute: (input, ctx) => attachSupervision(input, ctx),
    },
  ]
)

// Attach artifacts pipeline
const attachArtifactsPipeline = definePipeline<TrainingPackAttachArtifactsPayload, { artifactCount: number }>(
  'training_pack_attach_artifacts',
  [
    {
      name: 'attach_artifacts',
      weight: 100,
      execute: (input, ctx) => attachArtifacts(input, ctx),
    },
  ]
)

// Assign splits pipeline
const assignSplitsPipeline = definePipeline<TrainingPackAssignSplitsPayload, { splitCounts: Record<string, number> }>(
  'training_pack_assign_splits',
  [
    {
      name: 'assign_splits',
      weight: 100,
      execute: (input, ctx) => assignSplits(input, ctx),
    },
  ]
)

// Generate labels pipeline
const generateLabelsPipeline = definePipeline<TrainingPackGenerateLabelsPayload, { labelCount: number; errorCount: number }>(
  'training_pack_generate_labels',
  [
    {
      name: 'generate_labels',
      weight: 100,
      execute: (input, ctx) => generateLabels(input, ctx),
    },
  ]
)

// Export pipeline
const exportPipeline = definePipeline<TrainingPackExportPayload, { exportId: string; itemCount: number }>(
  'training_pack_export',
  [
    {
      name: 'export_manifest',
      weight: 100,
      execute: (input, ctx) => exportManifest(input, ctx),
    },
  ]
)

// ============================================================================
// REGISTER PIPELINES
// ============================================================================

export function registerTrainingPackPipelines() {
  registerPipeline('training_pack_resolve_items', resolveItemsPipeline)
  registerPipeline('training_pack_attach_supervision', attachSupervisionPipeline)
  registerPipeline('training_pack_attach_artifacts', attachArtifactsPipeline)
  registerPipeline('training_pack_assign_splits', assignSplitsPipeline)
  registerPipeline('training_pack_generate_labels', generateLabelsPipeline)
  registerPipeline('training_pack_export', exportPipeline)
}

// ============================================================================
// ORCHESTRATION HELPER
// ============================================================================

/**
 * Run the full training pack generation pipeline
 */
export async function runFullPackGeneration(
  packId: string,
  filterConfig: TrainingPackFilterConfig,
  options?: {
    splitSeed?: number
    format?: 'json' | 'csv'
    exportedBy?: string
  }
): Promise<{
  itemCount: number
  attachedCount: number
  artifactCount: number
  splitCounts: Record<string, number>
  labelCount: number
  exportId?: string
}> {
  // Minimal stub context for direct invocation (not through job system)
  const stubCtx = {
    jobId: '',
    jobType: 'training_pack_resolve_items' as const,
    traceId: null,
    retryCount: 0,
    updateProgress: async () => {},
    recordStage: async () => {},
  } as StageContext

  // Stage 1: Resolve items
  const resolveResult = await resolveItems({ packId, filterConfig }, stubCtx)
  
  // Stage 2: Attach supervision
  const supervisionResult = await attachSupervision({ packId }, stubCtx)
  
  // Stage 3: Attach artifacts
  const artifactsResult = await attachArtifacts({ packId }, stubCtx)
  
  // Stage 4: Assign splits
  const splitsResult = await assignSplits({ packId, seed: options?.splitSeed }, stubCtx)
  
  // Stage 5: Generate labels
  const labelsResult = await generateLabels({ packId }, stubCtx)
  
  // Stage 6: Export (optional)
  let exportId: string | undefined
  if (options?.format) {
    const exportResult = await exportManifest({
      packId,
      format: options.format,
      scope: 'full',
      exportedBy: options.exportedBy,
    }, stubCtx)
    exportId = exportResult.exportId
  }
  
  // Update pack status
  await updateTrainingPack(packId, { status: 'ready' })
  
  return {
    itemCount: resolveResult.itemCount,
    attachedCount: supervisionResult.attachedCount,
    artifactCount: artifactsResult.artifactCount,
    splitCounts: splitsResult.splitCounts,
    labelCount: labelsResult.labelCount,
    exportId,
  }
}
