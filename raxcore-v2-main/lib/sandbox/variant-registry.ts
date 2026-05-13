/**
 * Phase 48: Scoring Variant Registry
 * 
 * Manages the registry of scoring variants (models, pipelines, calibrations).
 * Provides CRUD operations and variant lifecycle management.
 */

import { createClient } from '@/lib/supabase/server'
import type {
  ScoringVariant,
  ScoringVariantWithStats,
  ScoringVariantInput,
  ScoringVariantType,
} from '@/lib/types'

// ============================================================================
// VARIANT CRUD
// ============================================================================

/**
 * Create a new scoring variant
 */
export async function createScoringVariant(
  input: ScoringVariantInput,
  createdBy?: string
): Promise<ScoringVariant> {
  const supabase = await createClient()

  // Validate variant type requirements
  if (input.variant_type === 'model' && !input.model_version_id) {
    throw new Error('Model variant requires model_version_id')
  }
  if (input.variant_type === 'calibration' && !input.calibration_profile_id) {
    throw new Error('Calibration variant requires calibration_profile_id')
  }

  const { data, error } = await supabase
    .from('scoring_variants')
    .insert({
      name: input.name,
      description: input.description || null,
      version_tag: input.version_tag,
      variant_type: input.variant_type,
      model_version_id: input.model_version_id || null,
      calibration_profile_id: input.calibration_profile_id || null,
      pipeline_config: input.pipeline_config || {},
      metadata: input.metadata || {},
      notes: input.notes || null,
      is_candidate: input.is_candidate ?? false,
      is_production: false,
      is_archived: false,
      created_by: createdBy || null,
    })
    .select()
    .single()

  if (error) throw new Error(`Failed to create scoring variant: ${error.message}`)
  return data as ScoringVariant
}

/**
 * Get a scoring variant by ID
 */
export async function getScoringVariant(id: string): Promise<ScoringVariant | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('scoring_variants')
    .select('*')
    .eq('id', id)
    .single()

  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to get scoring variant: ${error.message}`)
  }
  return data as ScoringVariant | null
}

/**
 * Get a scoring variant by version tag
 */
export async function getScoringVariantByTag(versionTag: string): Promise<ScoringVariant | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('scoring_variants')
    .select('*')
    .eq('version_tag', versionTag)
    .single()

  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to get scoring variant by tag: ${error.message}`)
  }
  return data as ScoringVariant | null
}

/**
 * Get the current production variant
 */
export async function getProductionVariant(): Promise<ScoringVariant | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('scoring_variants')
    .select('*')
    .eq('is_production', true)
    .single()

  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to get production variant: ${error.message}`)
  }
  return data as ScoringVariant | null
}

/**
 * List scoring variants with optional filters
 */
export async function listScoringVariants(options?: {
  includeArchived?: boolean
  variantType?: ScoringVariantType
  isCandidate?: boolean
  isProduction?: boolean
  limit?: number
  offset?: number
}): Promise<{ data: ScoringVariantWithStats[]; count: number }> {
  const supabase = await createClient()

  let query = supabase
    .from('scoring_variants_with_stats')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })

  if (!options?.includeArchived) {
    query = query.eq('is_archived', false)
  }

  if (options?.variantType) {
    query = query.eq('variant_type', options.variantType)
  }

  if (options?.isCandidate !== undefined) {
    query = query.eq('is_candidate', options.isCandidate)
  }

  if (options?.isProduction !== undefined) {
    query = query.eq('is_production', options.isProduction)
  }

  if (options?.limit) {
    query = query.limit(options.limit)
  }

  if (options?.offset) {
    query = query.range(options.offset, options.offset + (options.limit || 20) - 1)
  }

  const { data, error, count } = await query

  if (error) throw new Error(`Failed to list scoring variants: ${error.message}`)
  return { data: (data || []) as ScoringVariantWithStats[], count: count || 0 }
}

/**
 * List candidate variants
 */
export async function listCandidateVariants(): Promise<ScoringVariantWithStats[]> {
  const { data } = await listScoringVariants({ isCandidate: true })
  return data
}

/**
 * Update a scoring variant
 */
export async function updateScoringVariant(
  id: string,
  updates: Partial<Pick<ScoringVariant, 'name' | 'description' | 'notes' | 'metadata' | 'pipeline_config' | 'is_candidate' | 'is_archived'>>
): Promise<ScoringVariant> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('scoring_variants')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single()

  if (error) throw new Error(`Failed to update scoring variant: ${error.message}`)
  return data as ScoringVariant
}

// ============================================================================
// PHASE 53: TRAINING PACK LINKAGE
// ============================================================================

/**
 * Link a training pack to a candidate variant for evaluation
 */
export async function linkTrainingPackToVariant(
  variantId: string,
  trainingPackId: string
): Promise<void> {
  const supabase = await createClient()

  const { error } = await supabase
    .from('variant_training_pack_links')
    .insert({
      variant_id: variantId,
      training_pack_id: trainingPackId,
    })

  if (error && error.code !== '23505') { // Ignore unique constraint violations
    throw new Error(`Failed to link training pack: ${error.message}`)
  }
}

/**
 * Get training packs linked to a variant
 */
export async function getVariantTrainingPacks(variantId: string): Promise<string[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('variant_training_pack_links')
    .select('training_pack_id')
    .eq('variant_id', variantId)

  if (error) throw new Error(`Failed to get training packs: ${error.message}`)
  return (data || []).map(r => r.training_pack_id)
}

/**
 * Unlink a training pack from a variant
 */
export async function unlinkTrainingPackFromVariant(
  variantId: string,
  trainingPackId: string
): Promise<void> {
  const supabase = await createClient()

  const { error } = await supabase
    .from('variant_training_pack_links')
    .delete()
    .eq('variant_id', variantId)
    .eq('training_pack_id', trainingPackId)

  if (error) throw new Error(`Failed to unlink training pack: ${error.message}`)
}

/**
 * Archive a scoring variant
 */
export async function archiveScoringVariant(id: string): Promise<void> {
  const supabase = await createClient()

  // Check if it's the production variant
  const variant = await getScoringVariant(id)
  if (variant?.is_production) {
    throw new Error('Cannot archive the production variant')
  }

  const { error } = await supabase
    .from('scoring_variants')
    .update({
      is_archived: true,
      is_candidate: false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (error) throw new Error(`Failed to archive scoring variant: ${error.message}`)
}

/**
 * Mark a variant as candidate for testing
 */
export async function markAsCandidate(id: string): Promise<ScoringVariant> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('scoring_variants')
    .update({
      is_candidate: true,
      is_archived: false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single()

  if (error) throw new Error(`Failed to mark as candidate: ${error.message}`)
  return data as ScoringVariant
}

/**
 * Remove candidate status from a variant
 */
export async function removeCandidate(id: string): Promise<ScoringVariant> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('scoring_variants')
    .update({
      is_candidate: false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single()

  if (error) throw new Error(`Failed to remove candidate status: ${error.message}`)
  return data as ScoringVariant
}

// ============================================================================
// VARIANT PROMOTION
// ============================================================================

/**
 * Promote a variant to production
 */
export async function promoteVariant(
  variantId: string,
  decidedBy?: string,
  decisionReason?: string,
  gateEvaluationId?: string
): Promise<{ success: boolean; previousProductionId: string | null }> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('promote_variant', {
    p_variant_id: variantId,
    p_decided_by: decidedBy || null,
    p_decision_reason: decisionReason || null,
    p_gate_evaluation_id: gateEvaluationId || null,
  })

  if (error) throw new Error(`Failed to promote variant: ${error.message}`)

  const result = data as { success: boolean; promoted_variant_id: string; previous_production_variant_id: string | null }
  return {
    success: result.success,
    previousProductionId: result.previous_production_variant_id,
  }
}

/**
 * Rollback to a previous variant
 */
export async function rollbackVariant(
  targetVariantId: string,
  decidedBy?: string,
  decisionReason?: string
): Promise<{ success: boolean; rolledBackFrom: string | null }> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('rollback_variant', {
    p_target_variant_id: targetVariantId,
    p_decided_by: decidedBy || null,
    p_decision_reason: decisionReason || null,
  })

  if (error) throw new Error(`Failed to rollback variant: ${error.message}`)

  const result = data as { success: boolean; rolled_back_to: string; rolled_back_from: string | null; error?: string }
  
  if (!result.success) {
    throw new Error(result.error || 'Rollback failed')
  }

  return {
    success: result.success,
    rolledBackFrom: result.rolled_back_from,
  }
}

// ============================================================================
// VARIANT CREATION HELPERS
// ============================================================================

/**
 * Create a variant from an existing model version
 */
export async function createVariantFromModel(
  modelVersionId: string,
  calibrationProfileId?: string,
  name?: string,
  versionTag?: string,
  createdBy?: string
): Promise<ScoringVariant> {
  const supabase = await createClient()

  // Get model version details
  const { data: model, error: modelError } = await supabase
    .from('model_versions')
    .select('id, version_name')
    .eq('id', modelVersionId)
    .single()

  if (modelError || !model) {
    throw new Error('Model version not found')
  }

  const variantName = name || `Variant: ${model.version_name}`
  const tag = versionTag || `v-${model.version_name}-${Date.now()}`

  return createScoringVariant({
    name: variantName,
    version_tag: tag,
    variant_type: calibrationProfileId ? 'hybrid' : 'model',
    model_version_id: modelVersionId,
    calibration_profile_id: calibrationProfileId,
    is_candidate: true,
  }, createdBy)
}

/**
 * Create a variant from an existing calibration profile
 */
export async function createVariantFromCalibration(
  calibrationProfileId: string,
  name?: string,
  versionTag?: string,
  createdBy?: string
): Promise<ScoringVariant> {
  const supabase = await createClient()

  // Get calibration profile details
  const { data: profile, error: profileError } = await supabase
    .from('calibration_profiles')
    .select('id, name, model_version_id')
    .eq('id', calibrationProfileId)
    .single()

  if (profileError || !profile) {
    throw new Error('Calibration profile not found')
  }

  const variantName = name || `Variant: ${profile.name}`
  const tag = versionTag || `v-cal-${profile.name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`

  return createScoringVariant({
    name: variantName,
    version_tag: tag,
    variant_type: profile.model_version_id ? 'hybrid' : 'calibration',
    model_version_id: profile.model_version_id || undefined,
    calibration_profile_id: calibrationProfileId,
    is_candidate: true,
  }, createdBy)
}

/**
 * Create a pipeline variant with custom configuration
 */
export async function createPipelineVariant(
  pipelineConfig: Record<string, unknown>,
  name: string,
  versionTag: string,
  modelVersionId?: string,
  calibrationProfileId?: string,
  createdBy?: string
): Promise<ScoringVariant> {
  return createScoringVariant({
    name,
    version_tag: versionTag,
    variant_type: 'pipeline',
    model_version_id: modelVersionId,
    calibration_profile_id: calibrationProfileId,
    pipeline_config: pipelineConfig,
    is_candidate: true,
  }, createdBy)
}

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Ensure a production variant exists
 * Creates one from the active model if none exists
 */
export async function ensureProductionVariant(): Promise<ScoringVariant> {
  const existing = await getProductionVariant()
  if (existing) return existing

  const supabase = await createClient()

  // Get active model version
  const { data: activeModel } = await supabase
    .from('model_versions')
    .select('id, version_name')
    .eq('is_active', true)
    .single()

  // Get active calibration profile
  const { data: activeCalibration } = await supabase
    .from('calibration_profiles')
    .select('id, name')
    .eq('is_active', true)
    .single()

  // Create production variant
  const variant = await createScoringVariant({
    name: 'Production Baseline',
    version_tag: `prod-baseline-${Date.now()}`,
    variant_type: activeModel && activeCalibration ? 'hybrid' : activeModel ? 'model' : 'calibration',
    model_version_id: activeModel?.id,
    calibration_profile_id: activeCalibration?.id,
    metadata: {
      auto_created: true,
      source: 'ensureProductionVariant',
    },
  })

  // Mark as production
  await supabase
    .from('scoring_variants')
    .update({ is_production: true })
    .eq('id', variant.id)

  return { ...variant, is_production: true }
}
