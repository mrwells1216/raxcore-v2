/**
 * Phase 48: Shadow Scoring Engine
 * 
 * Runs candidate scoring variants alongside production without affecting user results.
 * Stores shadow results for later comparison and analysis.
 */

import { createClient } from '@/lib/supabase/server'
import type {
  ScoringVariant,
  ShadowPrediction,
  ShadowScoringConfig,
  Prediction,
  Measurements,
  Buck,
  BuckImage,
} from '@/lib/types'
import { getScoringVariant, getProductionVariant } from './variant-registry'

// ============================================================================
// SHADOW SCORING CONFIG
// ============================================================================

/**
 * Get active shadow scoring configurations
 */
export async function getActiveShadowConfigs(): Promise<ShadowScoringConfig[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('shadow_scoring_config')
    .select('*')
    .eq('is_enabled', true)

  if (error) throw new Error(`Failed to get shadow configs: ${error.message}`)
  return (data || []) as ShadowScoringConfig[]
}

/**
 * Get shadow config for a specific candidate variant
 */
export async function getShadowConfigForVariant(variantId: string): Promise<ShadowScoringConfig | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('shadow_scoring_config')
    .select('*')
    .eq('candidate_variant_id', variantId)
    .eq('is_enabled', true)
    .single()

  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to get shadow config: ${error.message}`)
  }
  return data as ShadowScoringConfig | null
}

/**
 * Create or update shadow scoring config
 */
export async function upsertShadowConfig(config: {
  candidateVariantId: string
  samplingRate?: number
  targetStates?: string[]
  targetRackTypes?: string[]
  targetSourceTypes?: string[]
  maxPerHour?: number
  maxPerDay?: number
  isEnabled?: boolean
  createdBy?: string
}): Promise<ShadowScoringConfig> {
  const supabase = await createClient()

  // Check if config exists
  const existing = await getShadowConfigForVariant(config.candidateVariantId)

  if (existing) {
    // Update existing
    const { data, error } = await supabase
      .from('shadow_scoring_config')
      .update({
        sampling_rate: config.samplingRate ?? existing.sampling_rate,
        target_states: config.targetStates ?? existing.target_states,
        target_rack_types: config.targetRackTypes ?? existing.target_rack_types,
        target_source_types: config.targetSourceTypes ?? existing.target_source_types,
        max_per_hour: config.maxPerHour ?? existing.max_per_hour,
        max_per_day: config.maxPerDay ?? existing.max_per_day,
        is_enabled: config.isEnabled ?? existing.is_enabled,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .select()
      .single()

    if (error) throw new Error(`Failed to update shadow config: ${error.message}`)
    return data as ShadowScoringConfig
  }

  // Create new
  const { data, error } = await supabase
    .from('shadow_scoring_config')
    .insert({
      candidate_variant_id: config.candidateVariantId,
      sampling_rate: config.samplingRate ?? 0.1,
      target_states: config.targetStates ?? null,
      target_rack_types: config.targetRackTypes ?? null,
      target_source_types: config.targetSourceTypes ?? null,
      max_per_hour: config.maxPerHour ?? 100,
      max_per_day: config.maxPerDay ?? 1000,
      is_enabled: config.isEnabled ?? true,
      created_by: config.createdBy ?? null,
    })
    .select()
    .single()

  if (error) throw new Error(`Failed to create shadow config: ${error.message}`)
  return data as ShadowScoringConfig
}

/**
 * Disable shadow scoring for a variant
 */
export async function disableShadowScoring(variantId: string): Promise<void> {
  const supabase = await createClient()

  await supabase
    .from('shadow_scoring_config')
    .update({ is_enabled: false, updated_at: new Date().toISOString() })
    .eq('candidate_variant_id', variantId)
}

// ============================================================================
// SHADOW SCORING DECISION
// ============================================================================

interface ShadowScoringDecision {
  shouldRunShadow: boolean
  configsToRun: ShadowScoringConfig[]
  reasons: string[]
}

/**
 * Determine if shadow scoring should run for this request
 */
export async function shouldRunShadowScoring(
  buck: Buck,
  productionPredictionId: string
): Promise<ShadowScoringDecision> {
  const configs = await getActiveShadowConfigs()
  
  if (configs.length === 0) {
    return { shouldRunShadow: false, configsToRun: [], reasons: ['No active shadow configs'] }
  }

  const eligibleConfigs: ShadowScoringConfig[] = []
  const reasons: string[] = []

  for (const config of configs) {
    // Check rate limits
    if (config.max_per_hour && config.shadow_count_hour >= config.max_per_hour) {
      reasons.push(`${config.candidate_variant_id}: hourly limit reached`)
      continue
    }
    if (config.max_per_day && config.shadow_count_today >= config.max_per_day) {
      reasons.push(`${config.candidate_variant_id}: daily limit reached`)
      continue
    }

    // Check segment targeting
    if (config.target_states && config.target_states.length > 0) {
      if (!config.target_states.includes(buck.state)) {
        reasons.push(`${config.candidate_variant_id}: state ${buck.state} not in target`)
        continue
      }
    }

    if (config.target_rack_types && config.target_rack_types.length > 0) {
      if (!config.target_rack_types.includes(buck.rack_type)) {
        reasons.push(`${config.candidate_variant_id}: rack_type ${buck.rack_type} not in target`)
        continue
      }
    }

    if (config.target_source_types && config.target_source_types.length > 0) {
      if (buck.source_type && !config.target_source_types.includes(buck.source_type)) {
        reasons.push(`${config.candidate_variant_id}: source_type ${buck.source_type} not in target`)
        continue
      }
    }

    // Sampling decision
    if (Math.random() > config.sampling_rate) {
      reasons.push(`${config.candidate_variant_id}: not sampled (rate: ${config.sampling_rate})`)
      continue
    }

    eligibleConfigs.push(config)
  }

  return {
    shouldRunShadow: eligibleConfigs.length > 0,
    configsToRun: eligibleConfigs,
    reasons,
  }
}

// ============================================================================
// SHADOW SCORING EXECUTION
// ============================================================================

interface ShadowScoringContext {
  buck: Buck
  images: BuckImage[]
  productionPrediction: Prediction
  productionVariant: ScoringVariant | null
}

interface ShadowScoringResult {
  variantId: string
  prediction: {
    predictedGross: number | null
    predictedNet: number | null
    confidencePercent: number | null
    errorBandLow: number | null
    errorBandHigh: number | null
    measurements: Measurements | null
    processingTimeMs: number
  }
  diffs: {
    grossDiff: number | null
    netDiff: number | null
    confidenceDiff: number | null
    spreadDiff: number | null
    beamDiff: number | null
    tineDiff: number | null
    massDiff: number | null
    geometryConsistencyDiff: number | null
  }
}

/**
 * Execute shadow scoring for a single variant
 * This is where you would plug in the actual scoring logic
 */
export async function executeShadowScoring(
  variant: ScoringVariant,
  context: ShadowScoringContext
): Promise<ShadowScoringResult> {
  const startTime = Date.now()

  // For now, we simulate scoring with the variant's configuration
  // In production, this would call the actual scoring pipeline with variant-specific config
  
  // Placeholder: In real implementation, this would:
  // 1. Get the model version from variant.model_version_id
  // 2. Get the calibration profile from variant.calibration_profile_id
  // 3. Apply any pipeline_config settings
  // 4. Run the full scoring pipeline
  
  // For demonstration, we'll compute a simulated result
  const prod = context.productionPrediction
  
  // Simulate slight variations based on variant config
  const variation = (Math.random() - 0.5) * 4 // +/- 2 inches variation
  const confVariation = (Math.random() - 0.5) * 10 // +/- 5% confidence variation
  
  const shadowGross = prod.predicted_gross !== null ? prod.predicted_gross + variation : null
  const shadowNet = prod.predicted_net !== null ? prod.predicted_net + variation * 0.8 : null
  const shadowConf = prod.confidence_percent !== null 
    ? Math.max(0, Math.min(100, prod.confidence_percent + confVariation))
    : null

  const processingTimeMs = Date.now() - startTime

  // Calculate diffs
  const grossDiff = shadowGross !== null && prod.predicted_gross !== null
    ? shadowGross - prod.predicted_gross
    : null
  const netDiff = shadowNet !== null && prod.predicted_net !== null
    ? shadowNet - prod.predicted_net
    : null
  const confidenceDiff = shadowConf !== null && prod.confidence_percent !== null
    ? shadowConf - prod.confidence_percent
    : null

  // Calculate measurement-level diffs if available
  let spreadDiff: number | null = null
  let beamDiff: number | null = null
  let tineDiff: number | null = null
  let massDiff: number | null = null

  if (prod.measurements) {
    // Simulated measurement variations
    spreadDiff = (Math.random() - 0.5) * 2
    beamDiff = (Math.random() - 0.5) * 3
    tineDiff = (Math.random() - 0.5) * 1.5
    massDiff = (Math.random() - 0.5) * 0.5
  }

  return {
    variantId: variant.id,
    prediction: {
      predictedGross: shadowGross,
      predictedNet: shadowNet,
      confidencePercent: shadowConf,
      errorBandLow: prod.error_band_low,
      errorBandHigh: prod.error_band_high,
      measurements: prod.measurements, // Would be recalculated in real impl
      processingTimeMs,
    },
    diffs: {
      grossDiff,
      netDiff,
      confidenceDiff,
      spreadDiff,
      beamDiff,
      tineDiff,
      massDiff,
      geometryConsistencyDiff: null, // Would be calculated from actual geometry analysis
    },
  }
}

/**
 * Run shadow scoring for all eligible variants
 */
export async function runShadowScoring(
  context: ShadowScoringContext,
  configs: ShadowScoringConfig[]
): Promise<ShadowPrediction[]> {
  const results: ShadowPrediction[] = []
  const supabase = await createClient()

  for (const config of configs) {
    try {
      // Get the variant
      const variant = await getScoringVariant(config.candidate_variant_id)
      if (!variant) {
        console.error(`Shadow scoring: variant ${config.candidate_variant_id} not found`)
        continue
      }

      // Execute shadow scoring
      const result = await executeShadowScoring(variant, context)

      // Store shadow prediction
      const { data: shadowPred, error } = await supabase
        .from('shadow_predictions')
        .insert({
          production_prediction_id: context.productionPrediction.id,
          production_variant_id: context.productionVariant?.id || null,
          shadow_variant_id: variant.id,
          predicted_gross: result.prediction.predictedGross,
          predicted_net: result.prediction.predictedNet,
          confidence_percent: result.prediction.confidencePercent,
          error_band_low: result.prediction.errorBandLow,
          error_band_high: result.prediction.errorBandHigh,
          measurements: result.prediction.measurements,
          processing_time_ms: result.prediction.processingTimeMs,
          gross_diff: result.diffs.grossDiff,
          net_diff: result.diffs.netDiff,
          confidence_diff: result.diffs.confidenceDiff,
          spread_diff: result.diffs.spreadDiff,
          beam_diff: result.diffs.beamDiff,
          tine_diff: result.diffs.tineDiff,
          mass_diff: result.diffs.massDiff,
          geometry_consistency_diff: result.diffs.geometryConsistencyDiff,
        })
        .select()
        .single()

      if (error) {
        console.error(`Shadow scoring: failed to store result for ${variant.id}:`, error)
        continue
      }

      results.push(shadowPred as ShadowPrediction)

      // Update counters
      await incrementShadowCounters(config.id)
    } catch (err) {
      console.error(`Shadow scoring: error for variant ${config.candidate_variant_id}:`, err)
    }
  }

  return results
}

/**
 * Increment shadow scoring counters
 */
async function incrementShadowCounters(configId: string): Promise<void> {
  const supabase = await createClient()
  const now = new Date()

  // Get current config
  const { data: config } = await supabase
    .from('shadow_scoring_config')
    .select('*')
    .eq('id', configId)
    .single()

  if (!config) return

  // Check if we need to reset counters
  const lastResetHour = config.last_reset_hour ? new Date(config.last_reset_hour) : null
  const lastResetDay = config.last_reset_day ? new Date(config.last_reset_day) : null

  const shouldResetHour = !lastResetHour || (now.getTime() - lastResetHour.getTime()) > 60 * 60 * 1000
  const shouldResetDay = !lastResetDay || now.getDate() !== lastResetDay.getDate()

  await supabase
    .from('shadow_scoring_config')
    .update({
      shadow_count_hour: shouldResetHour ? 1 : (config.shadow_count_hour || 0) + 1,
      shadow_count_today: shouldResetDay ? 1 : (config.shadow_count_today || 0) + 1,
      last_reset_hour: shouldResetHour ? now.toISOString() : config.last_reset_hour,
      last_reset_day: shouldResetDay ? now.toISOString() : config.last_reset_day,
      updated_at: now.toISOString(),
    })
    .eq('id', configId)
}

// ============================================================================
// SHADOW PREDICTION QUERIES
// ============================================================================

/**
 * Get shadow predictions for a production prediction
 */
export async function getShadowPredictionsForProduction(
  productionPredictionId: string
): Promise<ShadowPrediction[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('shadow_predictions')
    .select('*')
    .eq('production_prediction_id', productionPredictionId)
    .order('created_at', { ascending: true })

  if (error) throw new Error(`Failed to get shadow predictions: ${error.message}`)
  return (data || []) as ShadowPrediction[]
}

/**
 * Get shadow predictions for a variant
 */
export async function getShadowPredictionsForVariant(
  variantId: string,
  limit = 100
): Promise<ShadowPrediction[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('shadow_predictions')
    .select('*')
    .eq('shadow_variant_id', variantId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw new Error(`Failed to get shadow predictions for variant: ${error.message}`)
  return (data || []) as ShadowPrediction[]
}

/**
 * Get shadow prediction statistics for a variant
 */
export async function getShadowStats(variantId: string): Promise<{
  totalCount: number
  avgGrossDiff: number | null
  avgNetDiff: number | null
  avgConfidenceDiff: number | null
  avgProcessingTimeMs: number | null
  grossDiffStdDev: number | null
}> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('shadow_predictions')
    .select('gross_diff, net_diff, confidence_diff, processing_time_ms')
    .eq('shadow_variant_id', variantId)

  if (error) throw new Error(`Failed to get shadow stats: ${error.message}`)

  const predictions = data || []
  const totalCount = predictions.length

  if (totalCount === 0) {
    return {
      totalCount: 0,
      avgGrossDiff: null,
      avgNetDiff: null,
      avgConfidenceDiff: null,
      avgProcessingTimeMs: null,
      grossDiffStdDev: null,
    }
  }

  const grossDiffs = predictions.map(p => p.gross_diff).filter((d): d is number => d !== null)
  const netDiffs = predictions.map(p => p.net_diff).filter((d): d is number => d !== null)
  const confDiffs = predictions.map(p => p.confidence_diff).filter((d): d is number => d !== null)
  const times = predictions.map(p => p.processing_time_ms).filter((t): t is number => t !== null)

  const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : null
  const stdDev = (arr: number[]) => {
    if (arr.length < 2) return null
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length
    const variance = arr.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / arr.length
    return Math.sqrt(variance)
  }

  return {
    totalCount,
    avgGrossDiff: avg(grossDiffs),
    avgNetDiff: avg(netDiffs),
    avgConfidenceDiff: avg(confDiffs),
    avgProcessingTimeMs: avg(times),
    grossDiffStdDev: stdDev(grossDiffs),
  }
}

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

/**
 * Main shadow scoring entry point - call this after production scoring
 */
export async function maybeShadowScore(
  buck: Buck,
  images: BuckImage[],
  productionPrediction: Prediction
): Promise<ShadowPrediction[]> {
  try {
    // Get production variant for reference
    const productionVariant = await getProductionVariant()

    // Check if we should run shadow scoring
    const decision = await shouldRunShadowScoring(buck, productionPrediction.id)
    
    if (!decision.shouldRunShadow) {
      return []
    }

    // Run shadow scoring
    return await runShadowScoring(
      {
        buck,
        images,
        productionPrediction,
        productionVariant,
      },
      decision.configsToRun
    )
  } catch (err) {
    // Shadow scoring should never break the main flow
    console.error('Shadow scoring error:', err)
    return []
  }
}
