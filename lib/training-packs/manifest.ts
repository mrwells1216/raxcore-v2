/**
 * Phase 53: Training Pack Manifest Builder
 * 
 * Creates exportable JSON/CSV manifests from training packs.
 * Includes full supervision provenance and auxiliary labels.
 */

import { createClient } from '@/lib/supabase/server'
import { getServiceSupabase } from '@/lib/supabase/admin'
import type {
  TrainingPack,
  TrainingPackItem,
  TrainingPackManifestItem,
  TrainingPackExport,
  AuxiliaryLabel,
  TrainingSplitType,
  YesNoUnsure,
  AbnormalPointTag,
} from '@/lib/types'
import { getTrainingPackById, getTrainingPackItems } from './service'
import { getLabelsForItem } from '@/lib/auxiliary-labels/service'

// ============================================================================
// MANIFEST BUILDING
// ============================================================================

/**
 * Build a complete manifest item with all artifacts and labels
 */
export async function buildManifestItem(
  item: TrainingPackItem
): Promise<TrainingPackManifestItem> {
  const supabase = await createClient()
  
  // Get prediction details with full buck metadata including abnormal points
  const { data: prediction } = await supabase
    .from('predictions')
    .select(`
      *,
      bucks(
        state, 
        rack_type, 
        source_type,
        irregular_points_present,
        non_typical_traits_present,
        estimated_irregular_points_count,
        abnormal_point_notes,
        abnormal_point_tags
      )
    `)
    .eq('id', item.prediction_id)
    .single()
  
  // Get buck images
  const { data: images } = await supabase
    .from('buck_images')
    .select('angle_type, quality_score')
    .eq('buck_id', item.buck_id || '__none__')
  
  // Get ground truth if available
  const { data: groundTruth } = await supabase
    .from('ground_truth_scores')
    .select('gross_score, net_score, score_source')
    .eq('prediction_id', item.prediction_id)
    .single()
  
  // Get supervision events
  const supervisionEvents: Array<{
    event_id: string
    type: string
    confidence: number
    labels: string[]
    delta_gross?: number
  }> = []
  
  if (item.supervision_event_ids.length > 0) {
    const { data: events } = await supabase
      .from('supervision_events')
      .select('id, supervision_type, confidence, metadata_json')
      .in('id', item.supervision_event_ids)
    
    for (const event of (events || [])) {
      const { data: eventLabels } = await supabase
        .from('supervision_labels')
        .select('label')
        .eq('supervision_event_id', event.id)
      
      supervisionEvents.push({
        event_id: event.id,
        type: event.supervision_type,
        confidence: event.confidence || 0.5,
        labels: (eventLabels || []).map(l => l.label),
        delta_gross: (event.metadata_json as Record<string, unknown>)?.delta_gross as number | undefined,
      })
    }
  }
  
  // Get reverse run
  let reverseRun: {
    hypothesis_type: string
    improvement: number
    winning_hypothesis_rank: number
  } | null = null
  
  if (item.reverse_run_id) {
    const { data: run } = await supabase
      .from('reverse_runs')
      .select('hypothesis_type, improvement_gross, winning_hypothesis_rank')
      .eq('id', item.reverse_run_id)
      .single()
    
    if (run) {
      reverseRun = {
        hypothesis_type: run.hypothesis_type,
        improvement: run.improvement_gross || 0,
        winning_hypothesis_rank: run.winning_hypothesis_rank || 0,
      }
    }
  }
  
  // Get structural run
  let structuralRun: {
    topology_changed: boolean
    change_reason: string | null
    confidence: number
  } | null = null
  
  if (item.structural_hypothesis_run_id) {
    const { data: run } = await supabase
      .from('structural_hypothesis_runs')
      .select('topology_changed, change_reason, confidence')
      .eq('id', item.structural_hypothesis_run_id)
      .single()
    
    if (run) {
      structuralRun = {
        topology_changed: run.topology_changed,
        change_reason: run.change_reason,
        confidence: run.confidence || 0.5,
      }
    }
  }
  
  // Get auxiliary labels
  const labels = await getLabelsForItem(item.id)
  
  // Get hard-case patterns
  const { data: patternExamples } = await supabase
    .from('hard_case_pattern_examples')
    .select('pattern_id, hard_case_patterns(name, severity)')
    .eq('prediction_id', item.prediction_id)
  
  const hardCasePatterns = (patternExamples || []).map(pe => ({
    pattern_id: pe.pattern_id,
    pattern_name: (pe.hard_case_patterns as unknown as { name: string })?.name || 'unknown',
    severity: (pe.hard_case_patterns as unknown as { severity: number })?.severity || 0.5,
  }))
  
  // Build quality tier from image scores
  const imageScores = (images || []).map(i => i.quality_score || 0).filter(s => s > 0)
  const avgQuality = imageScores.length > 0 
    ? imageScores.reduce((a, b) => a + b, 0) / imageScores.length 
    : 0
  const qualityTier = avgQuality > 0.8 ? 'excellent' : avgQuality > 0.6 ? 'good' : avgQuality > 0.4 ? 'fair' : 'poor'
  
  // Calculate error
  const errorGross = groundTruth?.gross_score && prediction?.predicted_gross
    ? prediction.predicted_gross - groundTruth.gross_score
    : null
  
  // Extract buck metadata including abnormal points
  const buckData = prediction?.bucks as {
    state?: string
    rack_type?: string
    source_type?: string
    irregular_points_present?: YesNoUnsure | null
    non_typical_traits_present?: YesNoUnsure | null
    estimated_irregular_points_count?: number | null
    abnormal_point_notes?: string | null
    abnormal_point_tags?: AbnormalPointTag[] | null
  } | null

  return {
    item_id: item.id,
    buck_id: item.buck_id,
    prediction_id: item.prediction_id,
    split: item.split_assignment,
    image_summary: {
      count: images?.length || 0,
      angles: [...new Set((images || []).map(i => i.angle_type).filter(Boolean) as string[])],
      quality_tier: qualityTier,
    },
    score_summary: {
      predicted_gross: prediction?.predicted_gross || null,
      predicted_net: prediction?.predicted_net || null,
      official_score: groundTruth?.gross_score || null,
      error_gross: errorGross,
    },
    supervision_artifacts: {
      supervision_events: supervisionEvents,
      reverse_run: reverseRun,
      structural_run: structuralRun,
    },
    auxiliary_labels: labels.map(l => ({
      label: l.auxiliary_label_type,
      confidence: l.confidence,
      source: l.source,
      status: l.status,
    })),
    hard_case_patterns: hardCasePatterns,
    // Phase 54: Abnormal/Irregular Points metadata
    abnormal_points: buckData?.irregular_points_present || buckData?.non_typical_traits_present || buckData?.abnormal_point_tags?.length ? {
      irregular_points_present: buckData.irregular_points_present || null,
      non_typical_traits_present: buckData.non_typical_traits_present || null,
      estimated_irregular_points_count: buckData.estimated_irregular_points_count || null,
      abnormal_point_notes: buckData.abnormal_point_notes || null,
      abnormal_point_tags: buckData.abnormal_point_tags || [],
    } : null,
  }
}

/**
 * Build a full manifest for a training pack
 */
export async function buildPackManifest(
  packId: string,
  options?: {
    split?: TrainingSplitType
    limit?: number
  }
): Promise<{
  pack: TrainingPack
  items: TrainingPackManifestItem[]
  summary: {
    total_items: number
    splits: Record<TrainingSplitType, number>
    label_distribution: Record<string, number>
    artifact_coverage: {
      with_supervision: number
      with_reverse: number
      with_structural: number
      with_hard_case: number
    }
  }
}> {
  const pack = await getTrainingPackById(packId)
  if (!pack) throw new Error('Training pack not found')
  
  const items = await getTrainingPackItems(packId, {
    split: options?.split,
    limit: options?.limit || 10000,
  })
  
  const manifestItems: TrainingPackManifestItem[] = []
  const splits: Record<TrainingSplitType, number> = {
    train: 0,
    validation: 0,
    test: 0,
    benchmark_holdout: 0,
  }
  const labelDistribution: Record<string, number> = {}
  const artifactCoverage = {
    with_supervision: 0,
    with_reverse: 0,
    with_structural: 0,
    with_hard_case: 0,
  }
  
  for (const item of items) {
    const manifestItem = await buildManifestItem(item)
    manifestItems.push(manifestItem)
    
    // Update counts
    splits[item.split_assignment]++
    
    if (manifestItem.supervision_artifacts.supervision_events.length > 0) {
      artifactCoverage.with_supervision++
    }
    if (manifestItem.supervision_artifacts.reverse_run) {
      artifactCoverage.with_reverse++
    }
    if (manifestItem.supervision_artifacts.structural_run) {
      artifactCoverage.with_structural++
    }
    if (manifestItem.hard_case_patterns.length > 0) {
      artifactCoverage.with_hard_case++
    }
    
    for (const label of manifestItem.auxiliary_labels) {
      labelDistribution[label.label] = (labelDistribution[label.label] || 0) + 1
    }
  }
  
  return {
    pack,
    items: manifestItems,
    summary: {
      total_items: manifestItems.length,
      splits,
      label_distribution: labelDistribution,
      artifact_coverage: artifactCoverage,
    },
  }
}

// ============================================================================
// EXPORT FUNCTIONS
// ============================================================================

/**
 * Export a training pack manifest as JSON
 */
export async function exportManifestAsJson(
  packId: string,
  options?: { split?: TrainingSplitType; limit?: number }
): Promise<string> {
  const manifest = await buildPackManifest(packId, options)
  
  return JSON.stringify({
    version: '1.0',
    exported_at: new Date().toISOString(),
    pack: {
      id: manifest.pack.id,
      name: manifest.pack.name,
      pack_type: manifest.pack.pack_type,
      status: manifest.pack.status,
      variant_id: manifest.pack.variant_id,
      split_seed: manifest.pack.split_seed,
      split_config: manifest.pack.split_config_json,
    },
    summary: manifest.summary,
    items: manifest.items,
  }, null, 2)
}

/**
 * Export a training pack manifest as CSV
 */
export async function exportManifestAsCsv(
  packId: string,
  options?: { split?: TrainingSplitType; limit?: number }
): Promise<string> {
  const manifest = await buildPackManifest(packId, options)
  
  // CSV header
  const headers = [
    'item_id',
    'buck_id',
    'prediction_id',
    'split',
    'image_count',
    'image_angles',
    'quality_tier',
    'predicted_gross',
    'predicted_net',
    'official_score',
    'error_gross',
    'supervision_event_count',
    'supervision_types',
    'has_reverse_run',
    'reverse_improvement',
    'has_structural_run',
    'topology_changed',
    'auxiliary_labels',
    'label_confidence_avg',
    'hard_case_pattern_count',
  ].join(',')
  
  const rows = manifest.items.map(item => {
    const avgLabelConfidence = item.auxiliary_labels.length > 0
      ? item.auxiliary_labels.reduce((sum, l) => sum + l.confidence, 0) / item.auxiliary_labels.length
      : 0
    
    return [
      item.item_id,
      item.buck_id || '',
      item.prediction_id,
      item.split,
      item.image_summary.count,
      `"${item.image_summary.angles.join(';')}"`,
      item.image_summary.quality_tier,
      item.score_summary.predicted_gross ?? '',
      item.score_summary.predicted_net ?? '',
      item.score_summary.official_score ?? '',
      item.score_summary.error_gross ?? '',
      item.supervision_artifacts.supervision_events.length,
      `"${[...new Set(item.supervision_artifacts.supervision_events.map(e => e.type))].join(';')}"`,
      item.supervision_artifacts.reverse_run ? 'true' : 'false',
      item.supervision_artifacts.reverse_run?.improvement ?? '',
      item.supervision_artifacts.structural_run ? 'true' : 'false',
      item.supervision_artifacts.structural_run?.topology_changed ?? '',
      `"${item.auxiliary_labels.map(l => l.label).join(';')}"`,
      avgLabelConfidence.toFixed(3),
      item.hard_case_patterns.length,
    ].join(',')
  })
  
  return [headers, ...rows].join('\n')
}

/**
 * Create an export record
 */
export async function createExportRecord(
  packId: string,
  format: 'json' | 'csv',
  scope: 'full' | 'filtered',
  itemCount: number,
  labelCount: number,
  blobUrl?: string,
  filterJson?: Record<string, unknown>,
  exportedBy?: string
): Promise<TrainingPackExport> {
  const supabase = await getServiceSupabase()
  
  const { data, error } = await supabase
    .from('training_pack_exports')
    .insert({
      training_pack_id: packId,
      format,
      scope,
      filter_json: filterJson || null,
      manifest_blob_url: blobUrl || null,
      manifest_summary_json: {
        item_count: itemCount,
        label_count: labelCount,
      },
      exported_item_count: itemCount,
      exported_label_count: labelCount,
      exported_by: exportedBy || null,
    })
    .select()
    .single()
  
  if (error) {
    console.error('[manifest] Error creating export record:', error)
    throw new Error(`Failed to create export record: ${error.message}`)
  }
  
  // Update pack status to exported
  await supabase
    .from('training_packs')
    .update({
      status: 'exported',
      export_summary_json: {
        exported_at: new Date().toISOString(),
        exported_by: exportedBy,
        format,
        item_count: itemCount,
        label_count: labelCount,
        manifest_url: blobUrl,
      },
    })
    .eq('id', packId)
  
  return data as TrainingPackExport
}

/**
 * Get export history for a pack
 */
export async function getExportHistory(
  packId: string
): Promise<TrainingPackExport[]> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('training_pack_exports')
    .select('*')
    .eq('training_pack_id', packId)
    .order('exported_at', { ascending: false })
  
  if (error) {
    console.error('[manifest] Error fetching export history:', error)
    throw new Error(`Failed to fetch export history: ${error.message}`)
  }
  
  return data as TrainingPackExport[]
}
