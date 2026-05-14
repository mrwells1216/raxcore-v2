/**
 * Phase 28: Training Influence Weighting + Safe Learning Boundaries
 * 
 * Controls how much each training example influences learning corrections.
 * High-quality, relevant examples have more influence while low-quality
 * or weakly related examples have limited impact.
 */

import { createClient } from '@/lib/supabase/server'
import type {
  InfluenceConfig,
  InfluenceFactors,
  InfluenceComputationInput,
  InfluenceComputationResult,
  SimilarityFactors,
  LearningCorrectionLog,
  CorrectionContribution,
  DriftDetectionLog,
  DriftAnalysisResult,
  DriftType,
  DriftSeverity,
  DriftAction,
  DriftMetrics,
  InfluentialExampleDetail,
  ScenarioContext,
  HealthTier,
  ScoreSource,
} from '@/lib/types'
import { DEFAULT_INFLUENCE_CONFIG } from '@/lib/types'
import { HIGH_OUTPUT_STATES, LOW_OUTPUT_STATES } from '@/lib/constants'

// ============================================================================
// CONFIGURATION CACHE
// ============================================================================

let configCache: { config: InfluenceConfig | null; loadedAt: number } = {
  config: null,
  loadedAt: 0,
}
const CONFIG_CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Get active influence configuration
 */
export async function getActiveInfluenceConfig(): Promise<InfluenceConfig> {
  const now = Date.now()
  
  if (configCache.config && (now - configCache.loadedAt) < CONFIG_CACHE_TTL_MS) {
    return configCache.config
  }
  
  try {
    const supabase = await createClient()
    
    const { data, error } = await supabase
      .from('influence_config')
      .select('*')
      .eq('is_active', true)
      .single()
    
    if (error || !data) {
      // Return default config if none found
      return {
        id: 'default',
        ...DEFAULT_INFLUENCE_CONFIG,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as InfluenceConfig
    }
    
    configCache = { config: data as InfluenceConfig, loadedAt: now }
    return data as InfluenceConfig
  } catch (err) {
    console.error('Error fetching influence config:', err)
    return {
      id: 'default',
      ...DEFAULT_INFLUENCE_CONFIG,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as InfluenceConfig
  }
}

/**
 * Clear config cache (call after updates)
 */
export function clearInfluenceConfigCache(): void {
  configCache = { config: null, loadedAt: 0 }
}

// ============================================================================
// INFLUENCE WEIGHT COMPUTATION
// ============================================================================

/**
 * Compute influence weight for a training example
 */
export function computeInfluenceWeight(
  input: InfluenceComputationInput,
  config: InfluenceConfig
): InfluenceComputationResult {
  const weights = config.weight_factors
  const rules = config.eligibility_rules
  const caps = config.safety_caps
  
  // Check eligibility
  let eligibilityReason: string | null = null
  
  if (rules.require_usable_for_training && input.usable_for_training === false) {
    eligibilityReason = 'Not marked usable for training'
    return createZeroInfluenceResult(eligibilityReason)
  }
  
  if (input.health_score !== null && input.health_score < rules.min_health_score) {
    eligibilityReason = `Health score ${input.health_score} below minimum ${rules.min_health_score}`
    return createZeroInfluenceResult(eligibilityReason)
  }
  
  if (rules.exclude_outliers && input.is_outlier) {
    eligibilityReason = 'Marked as outlier'
    return createZeroInfluenceResult(eligibilityReason)
  }
  
  if (rules.exclude_duplicates && input.is_duplicate) {
    eligibilityReason = 'Marked as duplicate'
    return createZeroInfluenceResult(eligibilityReason)
  }
  
  // Compute individual factors
  const factors: InfluenceFactors = {
    health_score_factor: computeHealthScoreFactor(input.health_score, input.health_tier),
    verification_strength_factor: computeVerificationStrengthFactor(input.verified_for_training, input.score_source),
    image_quality_factor: computeImageQualityFactor(input.images_used, input.angle_diversity_score, input.intake_quality),
    metadata_completeness_factor: computeMetadataCompletenessFactor(input.state, input.rack_type, input.quality_flags as Record<string, unknown> | null),
    error_stability_factor: 0.7, // Default, will be updated with historical data
    base_influence: 0,
    similarity_bonus: 0, // Set when computing similarity to a specific buck
    final_influence: 0,
    top_boosters: [],
    top_reducers: [],
  }
  
  // Calculate base influence as weighted sum
  let baseInfluence = 
    (factors.health_score_factor * weights.health_score) +
    (factors.verification_strength_factor * weights.verification_strength) +
    (factors.image_quality_factor * weights.image_quality) +
    (factors.metadata_completeness_factor * weights.metadata_completeness) +
    (factors.error_stability_factor * weights.error_stability)
  
  // Normalize to 0-1 range
  const totalWeight = weights.health_score + weights.verification_strength + 
    weights.image_quality + weights.metadata_completeness + weights.error_stability
  baseInfluence = baseInfluence / totalWeight
  
  // Apply low quality multiplier if applicable
  if (input.health_tier === 'poor' || input.health_tier === 'fair') {
    baseInfluence *= rules.low_quality_weight_multiplier
  }
  
  // Cap per-example influence
  baseInfluence = Math.min(baseInfluence, caps.max_per_example_influence)
  
  factors.base_influence = baseInfluence
  factors.final_influence = baseInfluence // Will be updated with similarity bonus during correction
  
  // Determine top boosters and reducers
  const factorScores = [
    { name: 'Health Score', value: factors.health_score_factor },
    { name: 'Verification', value: factors.verification_strength_factor },
    { name: 'Image Quality', value: factors.image_quality_factor },
    { name: 'Metadata', value: factors.metadata_completeness_factor },
    { name: 'Stability', value: factors.error_stability_factor },
  ]
  
  factorScores.sort((a, b) => b.value - a.value)
  factors.top_boosters = factorScores.slice(0, 2).filter(f => f.value >= 0.7).map(f => f.name)
  factors.top_reducers = factorScores.slice(-2).filter(f => f.value < 0.5).map(f => f.name)
  
  return {
    influence_weight: baseInfluence,
    influence_factors: factors,
    eligibility_reason: null,
  }
}

function createZeroInfluenceResult(reason: string): InfluenceComputationResult {
  return {
    influence_weight: 0,
    influence_factors: {
      health_score_factor: 0,
      verification_strength_factor: 0,
      image_quality_factor: 0,
      metadata_completeness_factor: 0,
      error_stability_factor: 0,
      base_influence: 0,
      similarity_bonus: 0,
      final_influence: 0,
      top_boosters: [],
      top_reducers: [reason],
    },
    eligibility_reason: reason,
  }
}

function computeHealthScoreFactor(healthScore: number | null, healthTier: HealthTier): number {
  if (healthScore !== null) {
    return Math.min(1, healthScore / 100)
  }
  
  // Estimate from tier if score not available
  switch (healthTier) {
    case 'excellent': return 0.9
    case 'good': return 0.75
    case 'fair': return 0.55
    case 'poor': return 0.35
    case 'excluded': return 0
    default: return 0.5
  }
}

function computeVerificationStrengthFactor(
  verified: boolean,
  scoreSource: ScoreSource | string | null
): number {
  let baseFactor = verified ? 0.7 : 0.4
  
  // Boost based on score source
  switch (scoreSource) {
    case 'official_scorer':
      baseFactor += 0.3
      break
    case 'self_measured':
      baseFactor += 0.15
      break
    case 'user_reported':
      baseFactor += 0.05
      break
    case 'estimated':
      baseFactor -= 0.1
      break
  }
  
  return Math.min(1, Math.max(0, baseFactor))
}

function computeImageQualityFactor(
  imageCount: number | null,
  angleDiversity: number | null,
  intakeQuality: Record<string, unknown> | null
): number {
  let factor = 0.5 // Default
  
  // Image count contribution
  const count = imageCount ?? 1
  if (count >= 4) factor += 0.2
  else if (count >= 3) factor += 0.15
  else if (count >= 2) factor += 0.1
  
  // Angle diversity contribution
  const diversity = angleDiversity ?? 0.5
  factor += diversity * 0.2
  
  // Intake quality contribution
  if (intakeQuality) {
    const iq = intakeQuality as Record<string, number>
    const qualities = [iq.overall_quality, iq.lighting_quality, iq.sharpness_quality].filter(q => typeof q === 'number')
    if (qualities.length > 0) {
      const avgQuality = qualities.reduce((a, b) => a + b, 0) / qualities.length / 100
      factor += avgQuality * 0.1
    }
  }
  
  return Math.min(1, Math.max(0, factor))
}

function computeMetadataCompletenessFactor(
  state: string | null,
  rackType: string | null,
  qualityFlags: Record<string, unknown> | null
): number {
  let completenessScore = 0
  let totalFields = 0
  
  // Key metadata fields
  if (state) { completenessScore++; totalFields++ } else { totalFields++ }
  if (rackType) { completenessScore++; totalFields++ } else { totalFields++ }
  
  // Quality flags boost
  if (qualityFlags) {
    const flags = qualityFlags as Record<string, boolean>
    if (flags.consistent_measurements) completenessScore += 0.5
    if (flags.clear_landmarks) completenessScore += 0.3
    totalFields += 0.8
  }
  
  return totalFields > 0 ? completenessScore / totalFields : 0.5
}

// ============================================================================
// SIMILARITY COMPUTATION (Similarity-Weighted Learning)
// ============================================================================

export interface SimilarityInput {
  state: string
  rackType: 'typical' | 'non-typical'
  mainFramePoints?: number
  sourceType?: string
  captureDevice?: string
  imageCount: number
  earsFullyVisible?: boolean
  harvestMethod?: string
  angleDiversity: number
  confidenceTier: 'low' | 'medium' | 'high'
}

export interface ExampleMetadata {
  state?: string
  rack_type?: string
  main_frame_points?: number
  source_type?: string
  capture_device?: string
  image_count?: number
  ears_fully_visible?: boolean
  harvest_method?: string
  angle_diversity_score?: number
  confidence_percent?: number
}

const SIMILARITY_WEIGHTS = {
  state: 0.18,
  rackType: 0.15,
  mainFramePoints: 0.12,
  sourceType: 0.10,
  captureDevice: 0.06,
  imageCount: 0.08,
  earsFullyVisible: 0.05,
  harvestMethod: 0.04,
  angleDiversity: 0.07,
  confidenceTier: 0.10,
  stateRegion: 0.05,
} as const

/**
 * Calculate similarity between current buck and a training example
 */
export function computeSimilarity(
  input: SimilarityInput,
  example: ExampleMetadata
): SimilarityFactors {
  let totalScore = 0
  const matchingFeatures: string[] = []
  const missingFeatures: string[] = []
  
  // State match (exact)
  const stateMatch = example.state === input.state
  if (stateMatch) {
    totalScore += SIMILARITY_WEIGHTS.state
    matchingFeatures.push(`State: ${input.state}`)
  } else {
    missingFeatures.push('State')
  }
  
  // State region match (partial credit)
  const inputIsHighOutput = HIGH_OUTPUT_STATES.includes(input.state as typeof HIGH_OUTPUT_STATES[number])
  const inputIsLowOutput = LOW_OUTPUT_STATES.includes(input.state as typeof LOW_OUTPUT_STATES[number])
  const exampleIsHighOutput = HIGH_OUTPUT_STATES.includes(example.state as typeof HIGH_OUTPUT_STATES[number])
  const exampleIsLowOutput = LOW_OUTPUT_STATES.includes(example.state as typeof LOW_OUTPUT_STATES[number])
  
  const stateRegionMatch = (inputIsHighOutput && exampleIsHighOutput) || (inputIsLowOutput && exampleIsLowOutput)
  if (stateRegionMatch) {
    totalScore += SIMILARITY_WEIGHTS.stateRegion
    matchingFeatures.push('Same state tier')
  }
  
  // Rack type match
  const rackTypeMatch = example.rack_type === input.rackType
  if (rackTypeMatch) {
    totalScore += SIMILARITY_WEIGHTS.rackType
    matchingFeatures.push(`Rack: ${input.rackType}`)
  } else {
    missingFeatures.push('Rack type')
  }
  
  // Frame size similarity
  let frameSizeSimilarity = 0
  if (example.main_frame_points && input.mainFramePoints) {
    const diff = Math.abs(example.main_frame_points - input.mainFramePoints)
    if (diff === 0) {
      frameSizeSimilarity = 1
      totalScore += SIMILARITY_WEIGHTS.mainFramePoints
      matchingFeatures.push(`Frame: ${input.mainFramePoints}-point`)
    } else if (diff <= 2) {
      frameSizeSimilarity = 0.5
      totalScore += SIMILARITY_WEIGHTS.mainFramePoints * 0.5
      matchingFeatures.push('Similar frame')
    } else {
      missingFeatures.push('Frame size')
    }
  }
  
  // Source type match
  const sourceTypeMatch = example.source_type === input.sourceType
  if (sourceTypeMatch && input.sourceType) {
    totalScore += SIMILARITY_WEIGHTS.sourceType
    matchingFeatures.push(`Source: ${input.sourceType}`)
  } else if (input.sourceType) {
    missingFeatures.push('Source type')
  }
  
  // Capture device match
  const captureDeviceMatch = example.capture_device === input.captureDevice
  if (captureDeviceMatch && input.captureDevice) {
    totalScore += SIMILARITY_WEIGHTS.captureDevice
    matchingFeatures.push(`Device: ${input.captureDevice}`)
  }
  
  // Image count similarity
  let imageCountSimilarity = 0
  if (example.image_count !== undefined && example.image_count !== null) {
    const diff = Math.abs(example.image_count - input.imageCount)
    if (diff <= 1) {
      imageCountSimilarity = 1
      totalScore += SIMILARITY_WEIGHTS.imageCount
      matchingFeatures.push('Image count match')
    } else if (diff <= 2) {
      imageCountSimilarity = 0.5
      totalScore += SIMILARITY_WEIGHTS.imageCount * 0.5
    }
  }
  
  // Ears visibility match
  const earsVisibilityMatch = example.ears_fully_visible === input.earsFullyVisible
  if (earsVisibilityMatch && example.ears_fully_visible !== undefined) {
    totalScore += SIMILARITY_WEIGHTS.earsFullyVisible
    if (input.earsFullyVisible) matchingFeatures.push('Ears visible')
  }
  
  // Harvest method match
  const harvestMethodMatch = example.harvest_method === input.harvestMethod
  if (harvestMethodMatch && input.harvestMethod) {
    totalScore += SIMILARITY_WEIGHTS.harvestMethod
    matchingFeatures.push(`Harvest: ${input.harvestMethod}`)
  }
  
  // Angle diversity similarity
  let angleDiversitySimilarity = 0
  if (example.angle_diversity_score !== undefined && example.angle_diversity_score !== null) {
    const diff = Math.abs(example.angle_diversity_score - input.angleDiversity)
    if (diff <= 0.15) {
      angleDiversitySimilarity = 1
      totalScore += SIMILARITY_WEIGHTS.angleDiversity
      matchingFeatures.push('Angle coverage match')
    } else if (diff <= 0.3) {
      angleDiversitySimilarity = 0.5
      totalScore += SIMILARITY_WEIGHTS.angleDiversity * 0.5
    }
  }
  
  // Confidence tier match
  let confidenceTierMatch = false
  if (example.confidence_percent !== undefined && example.confidence_percent !== null) {
    const exampleTier = example.confidence_percent >= 75 ? 'high' : example.confidence_percent >= 50 ? 'medium' : 'low'
    confidenceTierMatch = exampleTier === input.confidenceTier
    if (confidenceTierMatch) {
      totalScore += SIMILARITY_WEIGHTS.confidenceTier
      matchingFeatures.push(`Confidence: ${input.confidenceTier}`)
    }
  }
  
  return {
    state_match: stateMatch,
    state_region_match: stateRegionMatch,
    rack_type_match: rackTypeMatch,
    frame_size_similarity: frameSizeSimilarity,
    source_type_match: sourceTypeMatch,
    capture_device_match: captureDeviceMatch,
    image_count_similarity: imageCountSimilarity,
    ears_visibility_match: earsVisibilityMatch,
    harvest_method_match: harvestMethodMatch,
    angle_diversity_similarity: angleDiversitySimilarity,
    confidence_tier_match: confidenceTierMatch,
    total_similarity: totalScore,
    matching_features: matchingFeatures,
    missing_features: missingFeatures,
  }
}

// ============================================================================
// BOUNDED CORRECTION AGGREGATION
// ============================================================================

export interface WeightedExample {
  id: string
  buckId: string
  error: number
  similarity: number
  influenceWeight: number
  effectiveWeight: number // similarity * influence
  groundTruthScore: number
  predictedScore: number
  matchingFeatures: string[]
  state?: string
  rackType?: string
}

export interface AggregationResult {
  correction: number
  method: 'weighted_mean' | 'trimmed_mean' | 'median' | 'robust_mean'
  totalWeight: number
  consistency: number
  contributions: Array<{
    exampleId: string
    weightedContribution: number
  }>
}

/**
 * Aggregate corrections using outlier-resistant methods
 */
export function aggregateCorrections(
  examples: WeightedExample[],
  config: InfluenceConfig
): AggregationResult {
  if (examples.length === 0) {
    return { correction: 0, method: 'weighted_mean', totalWeight: 0, consistency: 0, contributions: [] }
  }
  
  const caps = config.safety_caps
  
  // Sort by effective weight for trimming
  const sorted = [...examples].sort((a, b) => b.effectiveWeight - a.effectiveWeight)
  
  // Check if we have enough total influence weight
  const totalWeight = sorted.reduce((sum, ex) => sum + ex.effectiveWeight, 0)
  if (totalWeight < caps.min_total_influence_weight) {
    return { correction: 0, method: 'weighted_mean', totalWeight, consistency: 0, contributions: [] }
  }
  
  // Check consistency of errors
  const errors = sorted.map(ex => ex.error)
  const consistency = calculateConsistency(errors)
  
  // Choose aggregation method based on consistency and example count
  let method: AggregationResult['method'] = 'weighted_mean'
  let correction: number
  
  if (consistency < 0.3) {
    // High disagreement - use median for robustness
    method = 'median'
    correction = calculateWeightedMedian(sorted)
  } else if (sorted.length >= 8 && consistency < 0.6) {
    // Moderate disagreement with enough samples - use trimmed mean
    method = 'trimmed_mean'
    correction = calculateTrimmedMean(sorted, 0.1) // Trim 10% from each end
  } else if (sorted.length >= 5) {
    // Use robust mean (down-weights outliers)
    method = 'robust_mean'
    correction = calculateRobustMean(sorted)
  } else {
    // Standard weighted mean
    method = 'weighted_mean'
    correction = calculateWeightedMean(sorted)
  }
  
  // Build contribution list
  const contributions = sorted.map(ex => ({
    exampleId: ex.id,
    weightedContribution: ex.error * ex.effectiveWeight,
  }))
  
  return {
    correction,
    method,
    totalWeight,
    consistency,
    contributions,
  }
}

function calculateConsistency(errors: number[]): number {
  if (errors.length < 2) return 1.0
  
  const mean = errors.reduce((a, b) => a + b, 0) / errors.length
  if (Math.abs(mean) < 0.5) return 0.8
  
  const variance = errors.reduce((sum, e) => sum + Math.pow(e - mean, 2), 0) / errors.length
  const stdDev = Math.sqrt(variance)
  const cv = stdDev / Math.abs(mean)
  
  return Math.max(0, Math.min(1, 1 - cv * 0.5))
}

function calculateWeightedMean(examples: WeightedExample[]): number {
  const totalWeight = examples.reduce((sum, ex) => sum + ex.effectiveWeight, 0)
  if (totalWeight === 0) return 0
  
  const weightedSum = examples.reduce((sum, ex) => sum + ex.error * ex.effectiveWeight, 0)
  return weightedSum / totalWeight
}

function calculateTrimmedMean(examples: WeightedExample[], trimPercent: number): number {
  const trimCount = Math.floor(examples.length * trimPercent)
  const trimmed = examples.slice(trimCount, examples.length - trimCount)
  return calculateWeightedMean(trimmed)
}

function calculateWeightedMedian(examples: WeightedExample[]): number {
  if (examples.length === 0) return 0
  
  const sorted = [...examples].sort((a, b) => a.error - b.error)
  const totalWeight = sorted.reduce((sum, ex) => sum + ex.effectiveWeight, 0)
  const halfWeight = totalWeight / 2
  
  let cumWeight = 0
  for (const ex of sorted) {
    cumWeight += ex.effectiveWeight
    if (cumWeight >= halfWeight) {
      return ex.error
    }
  }
  
  return sorted[sorted.length - 1].error
}

function calculateRobustMean(examples: WeightedExample[]): number {
  // Iteratively re-weight to down-weight outliers
  const errors = examples.map(ex => ex.error)
  const mean = errors.reduce((a, b) => a + b, 0) / errors.length
  const stdDev = Math.sqrt(errors.reduce((sum, e) => sum + Math.pow(e - mean, 2), 0) / errors.length)
  
  // Down-weight examples more than 2 stdDev from mean
  const threshold = stdDev * 2
  let totalWeight = 0
  let weightedSum = 0
  
  for (const ex of examples) {
    const distance = Math.abs(ex.error - mean)
    const outlierFactor = distance > threshold ? 0.5 : 1.0
    const adjustedWeight = ex.effectiveWeight * outlierFactor
    
    totalWeight += adjustedWeight
    weightedSum += ex.error * adjustedWeight
  }
  
  return totalWeight > 0 ? weightedSum / totalWeight : mean
}

// ============================================================================
// DRIFT DETECTION
// ============================================================================

/**
 * Analyze recent corrections for drift patterns
 */
export async function analyzeDrift(config: InfluenceConfig): Promise<DriftAnalysisResult> {
  const driftSettings = config.drift_protection
  
  if (!driftSettings.enabled) {
    return {
      hasActiveDrift: false,
      driftAlerts: [],
      currentBias: { direction: 'balanced', ratio: 1, magnitude: 0 },
      recommendedAction: 'none',
      strengthMultiplier: 1.0,
    }
  }
  
  try {
    const supabase = await createClient()
    
    // Get recent corrections
    const windowStart = new Date(Date.now() - driftSettings.detection_window_hours * 60 * 60 * 1000)
    
    const { data: corrections } = await supabase
      .from('learning_correction_log')
      .select('gross_correction, correction_direction, created_at')
      .gte('created_at', windowStart.toISOString())
      .order('created_at', { ascending: false })
    
    if (!corrections || corrections.length < driftSettings.min_samples_for_detection) {
      return {
        hasActiveDrift: false,
        driftAlerts: [],
        currentBias: { direction: 'balanced', ratio: 1, magnitude: 0 },
        recommendedAction: 'none',
        strengthMultiplier: 1.0,
      }
    }
    
    // Calculate directional bias
    const positive = corrections.filter(c => c.gross_correction > 0.5).length
    const negative = corrections.filter(c => c.gross_correction < -0.5).length
    const biasRatio = negative > 0 ? positive / negative : positive > 0 ? 999 : 1
    
    // Calculate magnitude
    const avgMagnitude = corrections.reduce((sum, c) => sum + Math.abs(c.gross_correction), 0) / corrections.length
    
    // Check for active drift
    const driftAlerts: DriftDetectionLog[] = []
    let strengthMultiplier = 1.0
    let recommendedAction: DriftAction = 'none'
    
    // Check directional bias
    if (biasRatio > driftSettings.directional_bias_threshold || biasRatio < 1 / driftSettings.directional_bias_threshold) {
      const severity: DriftSeverity = biasRatio > 5 ? 'high' : biasRatio > 4 ? 'medium' : 'low'
      recommendedAction = 'reduced_learning_strength'
      
      if (driftSettings.auto_reduce_strength_on_drift) {
        strengthMultiplier *= driftSettings.strength_reduction_factor
      }
    }
    
    // Check magnitude drift
    if (avgMagnitude > driftSettings.magnitude_drift_threshold * 5) {
      recommendedAction = 'flagged_for_review'
      if (driftSettings.auto_reduce_strength_on_drift) {
        strengthMultiplier *= driftSettings.strength_reduction_factor
      }
    }
    
    // Get any unresolved drift alerts
    const { data: unresolvedAlerts } = await supabase
      .from('drift_detection_log')
      .select('*')
      .eq('is_resolved', false)
      .order('detected_at', { ascending: false })
      .limit(10)
    
    return {
      hasActiveDrift: strengthMultiplier < 1.0 || (!!unresolvedAlerts && unresolvedAlerts.length > 0),
      driftAlerts: (unresolvedAlerts as DriftDetectionLog[]) || [],
      currentBias: {
        direction: biasRatio > 1.5 ? 'positive' : biasRatio < 0.67 ? 'negative' : 'balanced',
        ratio: biasRatio,
        magnitude: avgMagnitude,
      },
      recommendedAction,
      strengthMultiplier,
    }
  } catch (err) {
    console.error('Error analyzing drift:', err)
    return {
      hasActiveDrift: false,
      driftAlerts: [],
      currentBias: { direction: 'balanced', ratio: 1, magnitude: 0 },
      recommendedAction: 'none',
      strengthMultiplier: 1.0,
    }
  }
}

/**
 * Log a detected drift event
 */
export async function logDriftDetection(
  driftType: DriftType,
  severity: DriftSeverity,
  metrics: DriftMetrics,
  windowHours: number,
  samplesAnalyzed: number,
  actionTaken: DriftAction = 'none'
): Promise<void> {
  try {
    const supabase = await createClient()
    
    await supabase.from('drift_detection_log').insert({
      drift_type: driftType,
      severity,
      detection_window_hours: windowHours,
      samples_analyzed: samplesAnalyzed,
      drift_metrics: metrics,
      action_taken: actionTaken,
    })
  } catch (err) {
    console.error('Error logging drift detection:', err)
  }
}

// ============================================================================
// CORRECTION LOGGING
// ============================================================================

/**
 * Log a learning correction with full details
 */
export async function logLearningCorrection(
  buckId: string | null,
  predictionId: string | null,
  correction: {
    gross: number
    net: number
    confidenceBoost: number
    preCap: number
    capped: boolean
    capReason: string | null
    method: string
  },
  examples: InfluentialExampleDetail[],
  context: ScenarioContext | null,
  measurementCorrections?: Record<string, number>
): Promise<string | null> {
  try {
    const supabase = await createClient()
    
    // Calculate stats
    const similarities = examples.map(e => e.similarity_score)
    const totalInfluence = examples.reduce((sum, e) => sum + e.effective_weight, 0)
    
    const { data, error } = await supabase
      .from('learning_correction_log')
      .insert({
        buck_id: buckId,
        prediction_id: predictionId,
        gross_correction: correction.gross,
        net_correction: correction.net,
        confidence_boost: correction.confidenceBoost,
        aggregation_method: correction.method,
        pre_cap_gross_correction: correction.preCap,
        cap_applied: correction.capped,
        cap_reason: correction.capReason,
        contributing_examples_count: examples.length,
        highly_similar_count: examples.filter(e => e.similarity_score >= 0.5).length,
        total_influence_weight: totalInfluence,
        avg_similarity: similarities.length > 0 ? similarities.reduce((a, b) => a + b, 0) / similarities.length : null,
        max_similarity: similarities.length > 0 ? Math.max(...similarities) : null,
        min_similarity: similarities.length > 0 ? Math.min(...similarities) : null,
        correction_direction: correction.gross > 0.5 ? 'increase' : correction.gross < -0.5 ? 'decrease' : 'none',
        measurement_corrections: measurementCorrections || null,
        influential_examples: examples,
        scenario_context: context,
      })
      .select('id')
      .single()
    
    if (error) {
      console.error('Error logging correction:', error)
      return null
    }
    
    return data?.id || null
  } catch (err) {
    console.error('Error logging learning correction:', err)
    return null
  }
}

/**
 * Log individual contributions for a correction
 */
export async function logCorrectionContributions(
  correctionLogId: string,
  contributions: Array<{
    trainingExampleId: string
    similarity: number
    influenceWeight: number
    effectiveWeight: number
    errorContribution: number
    weightedContribution: number
    similarityFactors: SimilarityFactors | null
  }>
): Promise<void> {
  try {
    const supabase = await createClient()
    
    const records = contributions.map(c => ({
      correction_log_id: correctionLogId,
      training_example_id: c.trainingExampleId,
      similarity_score: c.similarity,
      influence_weight: c.influenceWeight,
      effective_weight: c.effectiveWeight,
      error_contribution: c.errorContribution,
      weighted_contribution: c.weightedContribution,
      similarity_factors: c.similarityFactors,
    }))
    
    await supabase.from('correction_contributions').insert(records)
  } catch (err) {
    console.error('Error logging correction contributions:', err)
  }
}

// ============================================================================
// INFLUENCE WEIGHT UPDATES
// ============================================================================

/**
 * Compute and update influence weights for all training examples
 */
export async function computeAllInfluenceWeights(): Promise<{
  processed: number
  updated: number
  errors: number
}> {
  try {
    const supabase = await createClient()
    const config = await getActiveInfluenceConfig()
    
    // Get all training examples with relevant data
    const { data: examples, error } = await supabase
      .from('training_examples')
      .select(`
        id,
        health_score,
        health_tier,
        verified_for_training,
        usable_for_training,
        is_outlier,
        is_duplicate,
        buck:bucks!inner (
          state,
          rack_type
        ),
        ground_truth:ground_truth_scores (
          score_source
        ),
        prediction:predictions (
          images_used,
          angle_diversity_score,
          confidence_percent,
          intake_quality
        )
      `)
      .limit(1000)
    
    if (error || !examples) {
      console.error('Error fetching examples:', error)
      return { processed: 0, updated: 0, errors: 1 }
    }
    
    let updated = 0
    let errors = 0
    
    for (const example of examples) {
      try {
        const buck = Array.isArray(example.buck) ? example.buck[0] : example.buck
        const groundTruth = Array.isArray(example.ground_truth) ? example.ground_truth[0] : example.ground_truth
        const prediction = Array.isArray(example.prediction) ? example.prediction[0] : example.prediction
        
        const input: InfluenceComputationInput = {
          training_example_id: example.id,
          health_score: example.health_score,
          health_tier: example.health_tier || 'unknown',
          verified_for_training: example.verified_for_training || false,
          score_source: groundTruth?.score_source || null,
          images_used: prediction?.images_used || null,
          angle_diversity_score: prediction?.angle_diversity_score || null,
          intake_quality: prediction?.intake_quality as Record<string, unknown> | null,
          quality_flags: null,
          is_outlier: example.is_outlier || false,
          is_duplicate: example.is_duplicate || false,
          usable_for_training: example.usable_for_training,
          state: buck?.state || null,
          rack_type: buck?.rack_type || null,
        }
        
        const result = computeInfluenceWeight(input, config)
        
        // Update the example
        const { error: updateError } = await supabase
          .from('training_examples')
          .update({
            influence_weight: result.influence_weight,
            influence_factors: result.influence_factors,
            influence_computed_at: new Date().toISOString(),
            training_eligibility_reason: result.eligibility_reason,
          })
          .eq('id', example.id)
        
        if (updateError) {
          errors++
        } else {
          updated++
        }
      } catch (err) {
        errors++
      }
    }
    
    return { processed: examples.length, updated, errors }
  } catch (err) {
    console.error('Error computing influence weights:', err)
    return { processed: 0, updated: 0, errors: 1 }
  }
}

/**
 * Get recent corrections with details for admin view
 */
export async function getRecentCorrections(limit: number = 50): Promise<LearningCorrectionLog[]> {
  try {
    const supabase = await createClient()
    
    const { data, error } = await supabase
      .from('learning_correction_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit)
    
    if (error) {
      console.error('Error fetching corrections:', error)
      return []
    }
    
    return data as LearningCorrectionLog[]
  } catch (err) {
    console.error('Error getting recent corrections:', err)
    return []
  }
}

/**
 * Get contributions for a specific correction
 */
export async function getCorrectionContributions(correctionLogId: string): Promise<CorrectionContribution[]> {
  try {
    const supabase = await createClient()
    
    const { data, error } = await supabase
      .from('correction_contributions')
      .select('*')
      .eq('correction_log_id', correctionLogId)
      .order('effective_weight', { ascending: false })
    
    if (error) {
      console.error('Error fetching contributions:', error)
      return []
    }
    
    return data as CorrectionContribution[]
  } catch (err) {
    console.error('Error getting correction contributions:', err)
    return []
  }
}
