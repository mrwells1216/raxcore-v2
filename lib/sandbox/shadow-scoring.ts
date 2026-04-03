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
 * Execute shadow scoring for a single variant using the REAL scoring pipeline
 * Runs the full scoring logic with variant-specific calibration profile
 */
export async function executeShadowScoring(
  variant: ScoringVariant,
  context: ShadowScoringContext
): Promise<ShadowScoringResult> {
  const startTime = Date.now()
  const prod = context.productionPrediction

  // Import the real scoring pipeline
  const { scoreBuck } = await import('@/lib/scoring/ai-service')

  // Load the variant's calibration profile if specified
  let calibrationProfile = null
  if (variant.calibration_profile_id) {
    const supabase = await createClient()
    const { data } = await supabase
      .from('calibration_profiles')
      .select('*')
      .eq('id', variant.calibration_profile_id)
      .single()
    calibrationProfile = data
  }

  // Build scoring input from buck data
  const scoringInput = {
    images: context.images.map(img => ({
      imageUrl: img.image_url,
      angleType: img.angle_type as 'front' | 'left' | 'right' | 'back',
      width: img.width || 1024,
      height: img.height || 768,
    })),
    state: context.buck.state,
    rackType: context.buck.rack_type as 'typical' | 'non-typical',
    earsFullyVisible: context.buck.ears_fully_visible ?? undefined,
    sourceType: context.buck.source_type ?? undefined,
    captureDevice: context.buck.capture_device ?? undefined,
    mainFramePoints: context.buck.main_frame_points ?? undefined,
    // Pass variant's calibration profile to override the default
    calibrationProfile: calibrationProfile,
    // Use a trace ID for logging
    traceId: `shadow-${variant.id}-${context.buck.id}`,
  }

  // Run the real scoring pipeline with variant config
  const shadowResult = await scoreBuck(scoringInput)

  const processingTimeMs = Date.now() - startTime

  // Calculate diffs vs production
  const grossDiff = shadowResult.predictedGross !== null && prod.predicted_gross !== null
    ? shadowResult.predictedGross - prod.predicted_gross
    : null
  const netDiff = shadowResult.predictedNet !== null && prod.predicted_net !== null
    ? shadowResult.predictedNet - prod.predicted_net
    : null
  const confidenceDiff = shadowResult.confidencePercent !== null && prod.confidence_percent !== null
    ? shadowResult.confidencePercent - prod.confidence_percent
    : null

  // Calculate measurement-level diffs from real measurements
  let spreadDiff: number | null = null
  let beamDiff: number | null = null
  let tineDiff: number | null = null
  let massDiff: number | null = null
  let geometryConsistencyDiff: number | null = null

  const prodMeasurements = prod.measurements as Measurements | null
  const shadowMeasurements = shadowResult.measurements

  if (prodMeasurements && shadowMeasurements) {
    // Spread diff
    if (prodMeasurements.inside_spread !== null && shadowMeasurements.inside_spread !== null) {
      spreadDiff = shadowMeasurements.inside_spread - prodMeasurements.inside_spread
    }

    // Beam diff (average of left+right)
    const prodBeamAvg = ((prodMeasurements.main_beam_left || 0) + (prodMeasurements.main_beam_right || 0)) / 2
    const shadowBeamAvg = ((shadowMeasurements.main_beam_left || 0) + (shadowMeasurements.main_beam_right || 0)) / 2
    if (prodBeamAvg > 0 && shadowBeamAvg > 0) {
      beamDiff = shadowBeamAvg - prodBeamAvg
    }

    // Tine diff (sum of G points)
    const prodTineSum = [
      prodMeasurements.g1_left, prodMeasurements.g1_right,
      prodMeasurements.g2_left, prodMeasurements.g2_right,
      prodMeasurements.g3_left, prodMeasurements.g3_right,
      prodMeasurements.g4_left, prodMeasurements.g4_right,
    ].filter((v): v is number => v !== null).reduce((a, b) => a + b, 0)
    const shadowTineSum = [
      shadowMeasurements.g1_left, shadowMeasurements.g1_right,
      shadowMeasurements.g2_left, shadowMeasurements.g2_right,
      shadowMeasurements.g3_left, shadowMeasurements.g3_right,
      shadowMeasurements.g4_left, shadowMeasurements.g4_right,
    ].filter((v): v is number => v !== null).reduce((a, b) => a + b, 0)
    tineDiff = shadowTineSum - prodTineSum

    // Mass diff (sum of H circumferences)
    const prodMassSum = [
      prodMeasurements.h1_left, prodMeasurements.h1_right,
      prodMeasurements.h2_left, prodMeasurements.h2_right,
      prodMeasurements.h3_left, prodMeasurements.h3_right,
      prodMeasurements.h4_left, prodMeasurements.h4_right,
    ].filter((v): v is number => v !== null).reduce((a, b) => a + b, 0)
    const shadowMassSum = [
      shadowMeasurements.h1_left, shadowMeasurements.h1_right,
      shadowMeasurements.h2_left, shadowMeasurements.h2_right,
      shadowMeasurements.h3_left, shadowMeasurements.h3_right,
      shadowMeasurements.h4_left, shadowMeasurements.h4_right,
    ].filter((v): v is number => v !== null).reduce((a, b) => a + b, 0)
    massDiff = shadowMassSum - prodMassSum
  }

  // Geometry consistency diff from Phase 42 metadata
  if (shadowResult.phase42Metadata?.geometry_consistency?.consistency_score !== undefined) {
    // Compare with production geometry score if available in prediction metadata
    const prodGeometryScore = (prod.metadata as Record<string, unknown> | null)?.phase42Metadata
      ? ((prod.metadata as Record<string, unknown>).phase42Metadata as Record<string, unknown>)?.geometry_consistency
        ? (((prod.metadata as Record<string, unknown>).phase42Metadata as Record<string, unknown>).geometry_consistency as Record<string, number>)?.consistency_score
        : null
      : null
    if (typeof prodGeometryScore === 'number') {
      geometryConsistencyDiff = shadowResult.phase42Metadata.geometry_consistency.consistency_score - prodGeometryScore
    }
  }

  return {
    variantId: variant.id,
    prediction: {
      predictedGross: shadowResult.predictedGross,
      predictedNet: shadowResult.predictedNet,
      confidencePercent: shadowResult.confidencePercent,
      errorBandLow: shadowResult.errorBandLow,
      errorBandHigh: shadowResult.errorBandHigh,
      measurements: shadowMeasurements,
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
      geometryConsistencyDiff,
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
// BATCH SHADOW SCORING (for job pipeline)
// ============================================================================

interface ProcessShadowBatchOptions {
  limit?: number
}

interface ProcessShadowBatchResult {
  processed: number
  skipped: number
  errors: number
  results: Array<{
    predictionId: string
    variantId: string
    grossDiff: number | null
    success: boolean
    error?: string
  }>
}

/**
 * Process a batch of recent predictions for shadow scoring
 * Called by the sandbox_shadow_batch job
 */
export async function processShadowBatch(
  options: ProcessShadowBatchOptions = {}
): Promise<ProcessShadowBatchResult> {
  const limit = options.limit ?? 50
  const supabase = await createClient()
  
  const result: ProcessShadowBatchResult = {
    processed: 0,
    skipped: 0,
    errors: 0,
    results: [],
  }

  // Get active shadow configs
  const configs = await getActiveShadowConfigs()
  if (configs.length === 0) {
    return result
  }

  // Get recent predictions that haven't been shadow scored yet
  // Look for predictions from the last hour that don't have shadow_predictions
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  
  const { data: recentPredictions, error: predError } = await supabase
    .from('predictions')
    .select(`
      id,
      buck_id,
      predicted_gross,
      predicted_net,
      confidence_percent,
      error_band_low,
      error_band_high,
      measurements,
      metadata,
      bucks!inner (
        id,
        state,
        rack_type,
        source_type,
        capture_device,
        ears_fully_visible,
        main_frame_points
      )
    `)
    .gte('created_at', oneHourAgo)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (predError) {
    console.error('Failed to get recent predictions:', predError)
    return result
  }

  if (!recentPredictions || recentPredictions.length === 0) {
    return result
  }

  // Get production variant
  const productionVariant = await getProductionVariant()

  // Process each prediction
  for (const pred of recentPredictions) {
    // Check if already shadow scored
    const { count } = await supabase
      .from('shadow_predictions')
      .select('*', { count: 'exact', head: true })
      .eq('production_prediction_id', pred.id)

    if ((count || 0) > 0) {
      result.skipped++
      continue
    }

    const buck = pred.bucks as unknown as Buck
    if (!buck) {
      result.skipped++
      continue
    }

    // Get buck images
    const { data: images } = await supabase
      .from('buck_images')
      .select('*')
      .eq('buck_id', buck.id)
      .order('order_index', { ascending: true })

    if (!images || images.length === 0) {
      result.skipped++
      continue
    }

    // Build context
    const context: ShadowScoringContext = {
      buck,
      images: images as BuckImage[],
      productionPrediction: pred as unknown as Prediction,
      productionVariant,
    }

    // Determine which configs apply
    const decision = await shouldRunShadowScoring(buck, pred.id)
    if (!decision.shouldRunShadow) {
      result.skipped++
      continue
    }

    // Run shadow scoring
    try {
      const shadowResults = await runShadowScoring(context, decision.configsToRun)
      
      for (const shadowPred of shadowResults) {
        result.results.push({
          predictionId: pred.id,
          variantId: shadowPred.shadow_variant_id,
          grossDiff: shadowPred.gross_diff,
          success: true,
        })
      }
      
      result.processed++
    } catch (err) {
      result.errors++
      result.results.push({
        predictionId: pred.id,
        variantId: 'unknown',
        grossDiff: null,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return result
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
