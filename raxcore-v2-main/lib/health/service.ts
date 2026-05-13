/**
 * Phase 27: Dataset Health + Training Example Quality Controls
 * 
 * Computes health scores, detects duplicates/outliers, and manages usability flags
 * for training examples to improve dataset quality.
 */

import { createClient } from '@/lib/supabase/server'
import type {
  TrainingExampleWithHealth,
  HealthFactors,
  HealthTier,
  ScoreSourceStrength,
  DuplicateCluster,
  DuplicateClusterMember,
  DuplicateClusterWithMembers,
  OutlierRecord,
  OutlierType,
  OutlierSeverity,
  HealthComputationRun,
  HealthReviewDecisionRecord,
  HealthReviewDecisionInput,
  DatasetHealthSummary,
  DatasetHealthTotals,
  DatasetHealthBreakdown,
  HealthFilterOptions,
  HealthComputationConfig,
  DEFAULT_HEALTH_CONFIG,
  ScoreSource,
  QualityFlags,
} from '@/lib/types'

// ============================================================================
// SCORE SOURCE STRENGTH MAPPING
// ============================================================================

function getScoreSourceStrength(scoreSource: ScoreSource | string | null): ScoreSourceStrength {
  switch (scoreSource) {
    case 'official_scorer':
      return 'official'
    case 'self_measured':
      return 'verified' // self_measured with verification
    case 'user_reported':
      return 'self_reported'
    case 'estimated':
      return 'estimated'
    default:
      return 'unknown'
  }
}

function getScoreSourceQuality(strength: ScoreSourceStrength): number {
  switch (strength) {
    case 'official': return 100
    case 'verified': return 80
    case 'self_reported': return 50
    case 'estimated': return 20
    case 'unknown': return 30
  }
}

// ============================================================================
// HEALTH SCORE COMPUTATION
// ============================================================================

export interface ExampleData {
  training_example_id: string
  verified_for_training: boolean
  quality_flags: QualityFlags | null
  score_source: ScoreSource | string | null
  images_used: number | null
  angle_diversity_score: number | null
  confidence_percent: number | null
  intake_quality: Record<string, unknown> | null
  trust_score?: number | null
  calibrated_confidence?: number | null
  gross_error: number | null
  net_error: number | null
  state: string | null
  rack_type: string | null
  source_type: string | null
  harvest_method: string | null
  main_frame_points: number | null
}

export function computeHealthScore(
  data: ExampleData,
  config: HealthComputationConfig = DEFAULT_HEALTH_CONFIG,
  existingFlags?: { is_outlier?: boolean; is_duplicate?: boolean; has_suspect_metadata?: boolean }
): { score: number; tier: HealthTier; factors: HealthFactors } {
  const weights = config.weights
  const thresholds = config.tier_thresholds
  
  // 1. Score source quality
  const scoreSourceStrength = getScoreSourceStrength(data.score_source)
  const scoreSourceQuality = getScoreSourceQuality(scoreSourceStrength)
  
  // 2. Verification status
  const verificationStatus = data.verified_for_training ? 100 : 50
  
  // 3. Image count factor
  const imageCount = data.images_used ?? 1
  let imageCountFactor: number
  if (imageCount >= 4) imageCountFactor = 100
  else if (imageCount === 3) imageCountFactor = 85
  else if (imageCount === 2) imageCountFactor = 70
  else imageCountFactor = 50
  
  // 4. Angle diversity factor (0-100 scale from 0-1)
  const angleDiversityFactor = Math.round((data.angle_diversity_score ?? 0.5) * 100)
  
  // 5. Image quality factor (from intake_quality if available)
  let imageQualityFactor = 70 // default
  if (data.intake_quality) {
    const iq = data.intake_quality as Record<string, number>
    // Average of available quality metrics
    const qualities = [
      iq.overall_quality,
      iq.lighting_quality,
      iq.sharpness_quality,
      iq.landmark_visibility,
    ].filter(q => typeof q === 'number')
    if (qualities.length > 0) {
      imageQualityFactor = Math.round(qualities.reduce((a, b) => a + b, 0) / qualities.length)
    }
  }
  
  // 6. Metadata completeness
  const metadataFields = [
    data.state,
    data.rack_type,
    data.source_type,
    data.harvest_method,
    data.main_frame_points,
  ]
  const filledFields = metadataFields.filter(f => f !== null && f !== undefined).length
  const metadataCompleteness = Math.round((filledFields / metadataFields.length) * 100)
  
  // 7. Measurement consistency (from quality_flags)
  let measurementConsistency = 70 // default
  if (data.quality_flags) {
    const flags = data.quality_flags
    let consistencyPoints = 0
    let totalPoints = 0
    
    if (flags.multi_angle !== undefined) { totalPoints++; if (flags.multi_angle) consistencyPoints++ }
    if (flags.high_resolution !== undefined) { totalPoints++; if (flags.high_resolution) consistencyPoints++ }
    if (flags.clear_landmarks !== undefined) { totalPoints++; if (flags.clear_landmarks) consistencyPoints++ }
    if (flags.consistent_measurements !== undefined) { totalPoints++; if (flags.consistent_measurements) consistencyPoints++ }
    
    if (totalPoints > 0) {
      measurementConsistency = Math.round((consistencyPoints / totalPoints) * 100)
    }
  }
  
  // 8. Trust score factor
  const trustScoreFactor = data.trust_score !== null && data.trust_score !== undefined
    ? Math.round(data.trust_score * 100)
    : 60 // default
  
  // 9. Confidence factor
  const confidenceFactor = data.calibrated_confidence ?? data.confidence_percent ?? 60
  
  // Calculate raw score
  const rawScore = (
    (scoreSourceQuality * weights.score_source) +
    (verificationStatus * weights.verification) +
    (imageCountFactor * weights.image_count) +
    (angleDiversityFactor * weights.angle_diversity) +
    (imageQualityFactor * weights.image_quality) +
    (metadataCompleteness * weights.metadata_completeness) +
    (measurementConsistency * weights.measurement_consistency) +
    (trustScoreFactor * weights.trust_score) +
    (confidenceFactor * weights.confidence)
  ) / 100 // Normalize by total weight percentage
  
  // Apply penalties
  let outlierPenalty = 0
  let duplicatePenalty = 0
  let suspectMetadataPenalty = 0
  
  if (existingFlags?.is_outlier) {
    outlierPenalty = -25 // Significant penalty for outliers
  }
  if (existingFlags?.is_duplicate) {
    duplicatePenalty = -30 // Significant penalty for duplicates
  }
  if (existingFlags?.has_suspect_metadata) {
    suspectMetadataPenalty = -15
  }
  
  const totalPenalty = outlierPenalty + duplicatePenalty + suspectMetadataPenalty
  const normalizedScore = Math.max(0, Math.min(100, rawScore + totalPenalty))
  
  // Determine health tier
  let tier: HealthTier
  if (normalizedScore >= thresholds.excellent) {
    tier = 'excellent'
  } else if (normalizedScore >= thresholds.good) {
    tier = 'good'
  } else if (normalizedScore >= thresholds.fair) {
    tier = 'fair'
  } else if (normalizedScore >= thresholds.poor) {
    tier = 'poor'
  } else {
    tier = 'excluded'
  }
  
  // Generate explanations
  const strengths: string[] = []
  const weaknesses: string[] = []
  
  if (scoreSourceQuality >= 80) strengths.push('Official or verified score source')
  else if (scoreSourceQuality <= 30) weaknesses.push('Weak score source (estimated/unknown)')
  
  if (data.verified_for_training) strengths.push('Verified for training')
  else weaknesses.push('Not yet verified')
  
  if (imageCount >= 3) strengths.push(`${imageCount} images with good coverage`)
  else if (imageCount === 1) weaknesses.push('Only 1 image')
  
  if (angleDiversityFactor >= 70) strengths.push('Good angle diversity')
  else if (angleDiversityFactor < 40) weaknesses.push('Limited angle coverage')
  
  if (measurementConsistency >= 80) strengths.push('Consistent measurements')
  else if (measurementConsistency < 50) weaknesses.push('Inconsistent measurements')
  
  if (existingFlags?.is_outlier) weaknesses.push('Flagged as statistical outlier')
  if (existingFlags?.is_duplicate) weaknesses.push('Flagged as duplicate')
  if (existingFlags?.has_suspect_metadata) weaknesses.push('Suspect metadata')
  
  const factors: HealthFactors = {
    score_source_quality: scoreSourceQuality,
    verification_status: verificationStatus,
    image_count_factor: imageCountFactor,
    angle_diversity_factor: angleDiversityFactor,
    image_quality_factor: imageQualityFactor,
    metadata_completeness: metadataCompleteness,
    measurement_consistency: measurementConsistency,
    error_stability: 70, // TODO: compute from historical data
    trust_score_factor: trustScoreFactor,
    confidence_factor: confidenceFactor,
    outlier_penalty: outlierPenalty,
    duplicate_penalty: duplicatePenalty,
    suspect_metadata_penalty: suspectMetadataPenalty,
    raw_score: rawScore,
    normalized_score: normalizedScore,
    top_strengths: strengths.slice(0, 3),
    top_weaknesses: weaknesses.slice(0, 3),
  }
  
  return { score: normalizedScore, tier, factors }
}

// ============================================================================
// DUPLICATE DETECTION
// ============================================================================

export interface DuplicateCandidate {
  example_id: string
  buck_id: string
  predicted_gross: number | null
  predicted_net: number | null
  official_gross: number | null
  measurements_hash?: string
}

export function detectDuplicates(
  examples: DuplicateCandidate[],
  config: HealthComputationConfig = DEFAULT_HEALTH_CONFIG
): { clusters: { type: 'exact' | 'near' | 'suspected'; reason: string; members: string[] }[] } {
  const clusters: { type: 'exact' | 'near' | 'suspected'; reason: string; members: string[] }[] = []
  
  if (!config.enable_duplicate_detection) {
    return { clusters }
  }
  
  // Group by buck_id first (exact duplicates)
  const byBuckId = new Map<string, DuplicateCandidate[]>()
  for (const ex of examples) {
    const existing = byBuckId.get(ex.buck_id) || []
    existing.push(ex)
    byBuckId.set(ex.buck_id, existing)
  }
  
  // Find exact duplicates (same buck_id)
  for (const [buckId, group] of byBuckId) {
    if (group.length > 1) {
      clusters.push({
        type: 'exact',
        reason: 'same_buck_id',
        members: group.map(g => g.example_id),
      })
    }
  }
  
  // Find near-duplicates by similar scores (if not already in a cluster)
  const clusteredIds = new Set(clusters.flatMap(c => c.members))
  const unclustered = examples.filter(ex => !clusteredIds.has(ex.example_id))
  
  // Simple score-based near-duplicate detection
  // In production, you'd use image similarity or more sophisticated methods
  const threshold = config.duplicate_measurement_similarity_threshold
  const nearClusters: Map<string, string[]> = new Map()
  
  for (let i = 0; i < unclustered.length; i++) {
    for (let j = i + 1; j < unclustered.length; j++) {
      const a = unclustered[i]
      const b = unclustered[j]
      
      // Check if official scores are very similar
      if (a.official_gross !== null && b.official_gross !== null) {
        const scoreDiff = Math.abs(a.official_gross - b.official_gross)
        if (scoreDiff < 2) { // Within 2 inches
          const key = `near_${a.example_id}`
          const existing = nearClusters.get(key) || [a.example_id]
          if (!existing.includes(b.example_id)) {
            existing.push(b.example_id)
          }
          nearClusters.set(key, existing)
        }
      }
    }
  }
  
  for (const members of nearClusters.values()) {
    if (members.length > 1) {
      clusters.push({
        type: 'suspected',
        reason: 'similar_scores',
        members,
      })
    }
  }
  
  return { clusters }
}

// ============================================================================
// OUTLIER DETECTION
// ============================================================================

export interface OutlierInput {
  example_id: string
  gross_error: number | null
  net_error: number | null
  predicted_gross: number | null
  official_gross: number | null
  confidence_percent: number | null
}

export function detectOutliers(
  examples: OutlierInput[],
  config: HealthComputationConfig = DEFAULT_HEALTH_CONFIG
): { outliers: { example_id: string; type: OutlierType; severity: OutlierSeverity; reason: string; details: Record<string, number> }[] } {
  const outliers: { example_id: string; type: OutlierType; severity: OutlierSeverity; reason: string; details: Record<string, number> }[] = []
  
  if (!config.enable_outlier_detection) {
    return { outliers }
  }
  
  // Calculate statistics for error distribution
  const errors = examples
    .map(ex => ex.gross_error)
    .filter((e): e is number => e !== null)
  
  if (errors.length < 10) {
    return { outliers } // Not enough data for statistical analysis
  }
  
  const mean = errors.reduce((a, b) => a + b, 0) / errors.length
  const variance = errors.reduce((sum, e) => sum + Math.pow(e - mean, 2), 0) / errors.length
  const stdDev = Math.sqrt(variance)
  
  // Sort for percentile calculation
  const sortedErrors = [...errors].sort((a, b) => a - b)
  const p5 = sortedErrors[Math.floor(errors.length * 0.05)]
  const p95 = sortedErrors[Math.floor(errors.length * 0.95)]
  
  const zThreshold = config.outlier_z_score_threshold
  
  for (const ex of examples) {
    if (ex.gross_error === null) continue
    
    const absError = Math.abs(ex.gross_error)
    const zScore = (ex.gross_error - mean) / stdDev
    const absZScore = Math.abs(zScore)
    
    // Check for error outliers
    if (absZScore > zThreshold) {
      let severity: OutlierSeverity = 'mild'
      if (absZScore > zThreshold + 1) severity = 'moderate'
      if (absZScore > zThreshold + 2) severity = 'severe'
      
      outliers.push({
        example_id: ex.example_id,
        type: 'error_outlier',
        severity,
        reason: `Gross error z-score of ${zScore.toFixed(2)} exceeds threshold of ${zThreshold}`,
        details: {
          z_score: zScore,
          gross_error: ex.gross_error,
          mean_error: mean,
          std_dev: stdDev,
        },
      })
    }
    
    // Check for score outliers (extreme predicted vs official difference)
    if (ex.predicted_gross !== null && ex.official_gross !== null) {
      if (absError > 30) { // More than 30 inches off
        outliers.push({
          example_id: ex.example_id,
          type: 'score_outlier',
          severity: absError > 50 ? 'severe' : 'moderate',
          reason: `Extreme prediction error of ${absError.toFixed(1)} inches`,
          details: {
            predicted: ex.predicted_gross,
            actual: ex.official_gross,
            error: ex.gross_error,
          },
        })
      }
    }
  }
  
  return { outliers }
}

// ============================================================================
// DATABASE OPERATIONS
// ============================================================================

// Get training examples with health data
export async function getTrainingExamplesWithHealth(
  options: HealthFilterOptions & { limit?: number; offset?: number; orderBy?: string } = {}
): Promise<{ data: TrainingExampleWithHealth[]; count: number }> {
  const supabase = await createClient()
  
  let query = supabase
    .from('training_examples')
    .select(`
      *,
      prediction:predictions!prediction_id (
        id, buck_id, predicted_gross, predicted_net, confidence_percent,
        images_used, angle_diversity_score, measurements, intake_quality,
        calibrated_confidence, trust_score,
        buck:bucks!buck_id (id, state, rack_type, source_type, harvest_method, main_frame_points)
      ),
      ground_truth:ground_truth_scores!ground_truth_id (
        id, official_gross, official_net, score_source, verified
      )
    `, { count: 'exact' })
  
  // Apply filters
  if (options.health_tier) {
    if (Array.isArray(options.health_tier)) {
      query = query.in('health_tier', options.health_tier)
    } else {
      query = query.eq('health_tier', options.health_tier)
    }
  }
  
  if (options.min_health_score !== undefined) {
    query = query.gte('health_score', options.min_health_score)
  }
  if (options.max_health_score !== undefined) {
    query = query.lte('health_score', options.max_health_score)
  }
  
  if (options.usable_for_training !== undefined) {
    query = query.eq('usable_for_training', options.usable_for_training)
  }
  if (options.usable_for_validation !== undefined) {
    query = query.eq('usable_for_validation', options.usable_for_validation)
  }
  
  if (options.is_low_quality !== undefined) {
    query = query.eq('is_low_quality', options.is_low_quality)
  }
  if (options.is_duplicate !== undefined) {
    query = query.eq('is_duplicate', options.is_duplicate)
  }
  if (options.is_outlier !== undefined) {
    query = query.eq('is_outlier', options.is_outlier)
  }
  if (options.needs_review !== undefined) {
    query = query.eq('needs_review', options.needs_review)
  }
  
  if (options.verified_only) {
    query = query.eq('verified_for_training', true)
  }
  
  if (options.exclude_duplicates) {
    query = query.eq('is_duplicate', false).eq('is_near_duplicate', false)
  }
  if (options.exclude_outliers) {
    query = query.eq('is_outlier', false)
  }
  
  // Apply ordering
  const orderBy = options.orderBy || 'created_at'
  query = query.order(orderBy, { ascending: false })
  
  // Apply pagination
  if (options.limit) {
    query = query.limit(options.limit)
  }
  if (options.offset) {
    query = query.range(options.offset, options.offset + (options.limit || 20) - 1)
  }
  
  const { data, error, count } = await query
  
  if (error) throw new Error(`Failed to get training examples with health: ${error.message}`)
  
  return { data: data || [], count: count || 0 }
}

// Get dataset health summary
export async function getDatasetHealthSummary(): Promise<DatasetHealthSummary[]> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('dataset_health_summary')
    .select('*')
  
  if (error) throw new Error(`Failed to get dataset health summary: ${error.message}`)
  
  return data || []
}

// Get dataset health totals
export async function getDatasetHealthTotals(): Promise<DatasetHealthTotals> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('training_examples')
    .select('health_score, health_tier, usable_for_training, usable_for_validation, needs_review, is_duplicate, is_near_duplicate, is_outlier', { count: 'exact' })
  
  if (error) throw new Error(`Failed to get health totals: ${error.message}`)
  
  const examples = data || []
  const total = examples.length
  
  let healthyCount = 0
  let fairCount = 0
  let unhealthyCount = 0
  let trainingEligible = 0
  let validationEligible = 0
  let needsReviewCount = 0
  let duplicatesCount = 0
  let outliersCount = 0
  let uncomputedCount = 0
  let healthScoreSum = 0
  let healthScoreCount = 0
  
  for (const ex of examples) {
    if (ex.health_tier === 'excellent' || ex.health_tier === 'good') healthyCount++
    else if (ex.health_tier === 'fair') fairCount++
    else if (ex.health_tier === 'poor' || ex.health_tier === 'excluded') unhealthyCount++
    
    if (ex.usable_for_training) trainingEligible++
    if (ex.usable_for_validation) validationEligible++
    if (ex.needs_review) needsReviewCount++
    if (ex.is_duplicate || ex.is_near_duplicate) duplicatesCount++
    if (ex.is_outlier) outliersCount++
    if (ex.health_score === null) uncomputedCount++
    else {
      healthScoreSum += ex.health_score
      healthScoreCount++
    }
  }
  
  return {
    total_examples: total,
    healthy_examples: healthyCount,
    fair_examples: fairCount,
    unhealthy_examples: unhealthyCount,
    training_eligible: trainingEligible,
    validation_eligible: validationEligible,
    needs_review: needsReviewCount,
    duplicates: duplicatesCount,
    outliers: outliersCount,
    uncomputed: uncomputedCount,
    avg_health_score: healthScoreCount > 0 ? Math.round(healthScoreSum / healthScoreCount * 100) / 100 : null,
  }
}

// Update training example health
export async function updateExampleHealth(
  exampleId: string,
  health: {
    health_score: number
    health_tier: HealthTier
    health_factors: HealthFactors
    usable_for_training?: boolean
    usable_for_validation?: boolean
    score_source_strength?: ScoreSourceStrength
  }
): Promise<void> {
  const supabase = await createClient()
  
  // Determine usability based on health tier if not specified
  const usableForTraining = health.usable_for_training ?? 
    (health.health_tier === 'excellent' || health.health_tier === 'good')
  const usableForValidation = health.usable_for_validation ?? 
    (health.health_tier !== 'excluded')
  
  const { error } = await supabase
    .from('training_examples')
    .update({
      health_score: health.health_score,
      health_tier: health.health_tier,
      health_factors: health.health_factors,
      health_computed_at: new Date().toISOString(),
      usable_for_training: usableForTraining,
      usable_for_validation: usableForValidation,
      score_source_strength: health.score_source_strength,
    })
    .eq('id', exampleId)
  
  if (error) throw new Error(`Failed to update example health: ${error.message}`)
}

// Mark example as duplicate
export async function markExampleAsDuplicate(
  exampleId: string,
  duplicateOfId: string | null,
  isNearDuplicate: boolean = false
): Promise<void> {
  const supabase = await createClient()
  
  const { error } = await supabase
    .from('training_examples')
    .update({
      is_duplicate: !isNearDuplicate,
      is_near_duplicate: isNearDuplicate,
      duplicate_of_id: duplicateOfId,
      needs_review: true,
      review_reason: isNearDuplicate ? 'Near-duplicate detected' : 'Duplicate detected',
    })
    .eq('id', exampleId)
  
  if (error) throw new Error(`Failed to mark example as duplicate: ${error.message}`)
}

// Mark example as outlier
export async function markExampleAsOutlier(
  exampleId: string,
  isOutlier: boolean,
  reviewReason?: string
): Promise<void> {
  const supabase = await createClient()
  
  const { error } = await supabase
    .from('training_examples')
    .update({
      is_outlier: isOutlier,
      needs_review: isOutlier,
      review_reason: isOutlier ? (reviewReason || 'Flagged as outlier') : null,
    })
    .eq('id', exampleId)
  
  if (error) throw new Error(`Failed to mark example as outlier: ${error.message}`)
}

// Create health review decision
export async function createHealthReviewDecision(
  input: HealthReviewDecisionInput
): Promise<HealthReviewDecisionRecord> {
  const supabase = await createClient()
  
  // Get current example state
  const { data: example, error: fetchError } = await supabase
    .from('training_examples')
    .select('usable_for_training, usable_for_validation')
    .eq('id', input.training_example_id)
    .single()
  
  if (fetchError) throw new Error(`Failed to fetch example: ${fetchError.message}`)
  
  // Create decision record
  const { data: decision, error: insertError } = await supabase
    .from('health_review_decisions')
    .insert({
      training_example_id: input.training_example_id,
      decision: input.decision,
      previous_usable_for_training: example.usable_for_training,
      previous_usable_for_validation: example.usable_for_validation,
      decision_reason: input.decision_reason,
      decision_notes: input.decision_notes,
      decided_by: input.decided_by,
      decided_at: new Date().toISOString(),
    })
    .select()
    .single()
  
  if (insertError) throw new Error(`Failed to create review decision: ${insertError.message}`)
  
  // Apply decision to example
  let updateFields: Record<string, unknown> = { needs_review: false }
  
  switch (input.decision) {
    case 'approve_training':
      updateFields.usable_for_training = true
      updateFields.usable_for_validation = true
      break
    case 'validation_only':
      updateFields.usable_for_training = false
      updateFields.usable_for_validation = true
      break
    case 'exclude':
      updateFields.usable_for_training = false
      updateFields.usable_for_validation = false
      updateFields.health_tier = 'excluded'
      break
    case 'mark_duplicate':
      updateFields.is_duplicate = true
      updateFields.usable_for_training = false
      break
    case 'needs_more_info':
    case 'defer':
      updateFields.needs_review = true // Keep flagged
      break
  }
  
  const { error: updateError } = await supabase
    .from('training_examples')
    .update(updateFields)
    .eq('id', input.training_example_id)
  
  if (updateError) throw new Error(`Failed to apply decision: ${updateError.message}`)
  
  return decision
}

// Get review decisions for an example
export async function getReviewDecisions(
  exampleId: string
): Promise<HealthReviewDecisionRecord[]> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('health_review_decisions')
    .select('*')
    .eq('training_example_id', exampleId)
    .order('decided_at', { ascending: false })
  
  if (error) throw new Error(`Failed to get review decisions: ${error.message}`)
  
  return data || []
}

// Create outlier record
export async function createOutlierRecord(
  exampleId: string,
  outlierType: OutlierType,
  severity: OutlierSeverity,
  reason: string,
  statisticalDetails?: Record<string, number>
): Promise<OutlierRecord> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('outlier_records')
    .insert({
      training_example_id: exampleId,
      outlier_type: outlierType,
      severity,
      outlier_reason: reason,
      statistical_details: statisticalDetails,
      detected_at: new Date().toISOString(),
    })
    .select()
    .single()
  
  if (error) throw new Error(`Failed to create outlier record: ${error.message}`)
  
  // Mark example as outlier
  await markExampleAsOutlier(exampleId, true, reason)
  
  return data
}

// Get outlier records
export async function getOutlierRecords(options?: {
  exampleId?: string
  outlierType?: OutlierType
  severity?: OutlierSeverity
  resolved?: boolean
  limit?: number
}): Promise<OutlierRecord[]> {
  const supabase = await createClient()
  
  let query = supabase
    .from('outlier_records')
    .select('*')
    .order('detected_at', { ascending: false })
  
  if (options?.exampleId) query = query.eq('training_example_id', options.exampleId)
  if (options?.outlierType) query = query.eq('outlier_type', options.outlierType)
  if (options?.severity) query = query.eq('severity', options.severity)
  if (options?.resolved !== undefined) query = query.eq('is_resolved', options.resolved)
  if (options?.limit) query = query.limit(options.limit)
  
  const { data, error } = await query
  
  if (error) throw new Error(`Failed to get outlier records: ${error.message}`)
  
  return data || []
}

// Create duplicate cluster
export async function createDuplicateCluster(
  clusterType: 'exact' | 'near' | 'suspected',
  reason: string,
  memberIds: string[],
  primaryId?: string
): Promise<DuplicateCluster> {
  const supabase = await createClient()
  
  const primary = primaryId || memberIds[0]
  
  // Create cluster
  const { data: cluster, error: clusterError } = await supabase
    .from('duplicate_clusters')
    .insert({
      cluster_type: clusterType,
      cluster_reason: reason,
      primary_example_id: primary,
      example_count: memberIds.length,
    })
    .select()
    .single()
  
  if (clusterError) throw new Error(`Failed to create duplicate cluster: ${clusterError.message}`)
  
  // Add members
  const members = memberIds.map(id => ({
    cluster_id: cluster.id,
    training_example_id: id,
    is_primary: id === primary,
  }))
  
  const { error: membersError } = await supabase
    .from('duplicate_cluster_members')
    .insert(members)
  
  if (membersError) throw new Error(`Failed to add cluster members: ${membersError.message}`)
  
  // Mark examples as duplicates (except primary)
  for (const id of memberIds) {
    if (id !== primary) {
      await markExampleAsDuplicate(id, primary, clusterType === 'near' || clusterType === 'suspected')
    }
  }
  
  return cluster
}

// Get duplicate clusters
export async function getDuplicateClusters(options?: {
  resolved?: boolean
  clusterType?: 'exact' | 'near' | 'suspected'
  limit?: number
}): Promise<DuplicateClusterWithMembers[]> {
  const supabase = await createClient()
  
  let query = supabase
    .from('duplicate_clusters')
    .select(`
      *,
      members:duplicate_cluster_members (
        *,
        example:training_examples (
          id, health_score, health_tier, gross_error, verified_for_training,
          prediction:predictions!prediction_id (
            id, predicted_gross, buck_id,
            buck:bucks!buck_id (id, state, source_type)
          ),
          ground_truth:ground_truth_scores!ground_truth_id (
            id, official_gross, score_source
          )
        )
      )
    `)
    .order('created_at', { ascending: false })
  
  if (options?.resolved !== undefined) query = query.eq('is_resolved', options.resolved)
  if (options?.clusterType) query = query.eq('cluster_type', options.clusterType)
  if (options?.limit) query = query.limit(options.limit)
  
  const { data, error } = await query
  
  if (error) throw new Error(`Failed to get duplicate clusters: ${error.message}`)
  
  return data || []
}

// Create health computation run
export async function createHealthComputationRun(
  runType: 'full' | 'incremental' | 'single',
  config?: Partial<HealthComputationConfig>
): Promise<HealthComputationRun> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('health_computation_runs')
    .insert({
      run_type: runType,
      run_config: config,
      status: 'running',
    })
    .select()
    .single()
  
  if (error) throw new Error(`Failed to create health computation run: ${error.message}`)
  
  return data
}

// Update health computation run
export async function updateHealthComputationRun(
  runId: string,
  updates: Partial<{
    examples_processed: number
    duplicates_detected: number
    outliers_detected: number
    examples_flagged_for_review: number
    computation_time_ms: number
    run_stats: Record<string, unknown>
    status: 'running' | 'completed' | 'failed' | 'cancelled'
    error_message: string
    completed_at: string
  }>
): Promise<void> {
  const supabase = await createClient()
  
  const { error } = await supabase
    .from('health_computation_runs')
    .update(updates)
    .eq('id', runId)
  
  if (error) throw new Error(`Failed to update health computation run: ${error.message}`)
}

// Run full health computation
export async function runFullHealthComputation(
  config: HealthComputationConfig = DEFAULT_HEALTH_CONFIG
): Promise<HealthComputationRun> {
  const startTime = Date.now()
  
  // Create run record
  const run = await createHealthComputationRun('full', config)
  
  try {
    const supabase = await createClient()
    
    // Fetch all training examples with related data
    const { data: examples, error: fetchError } = await supabase
      .from('training_examples')
      .select(`
        id, verified_for_training, quality_flags, gross_error, net_error,
        prediction:predictions!prediction_id (
          id, buck_id, predicted_gross, predicted_net, confidence_percent,
          images_used, angle_diversity_score, intake_quality,
          calibrated_confidence, trust_score,
          buck:bucks!buck_id (id, state, rack_type, source_type, harvest_method, main_frame_points)
        ),
        ground_truth:ground_truth_scores!ground_truth_id (
          id, official_gross, official_net, score_source
        )
      `)
    
    if (fetchError) throw new Error(`Failed to fetch examples: ${fetchError.message}`)
    
    const allExamples = examples || []
    let processed = 0
    let duplicatesDetected = 0
    let outliersDetected = 0
    let flaggedForReview = 0
    const tierCounts: Record<HealthTier, number> = {
      excellent: 0, good: 0, fair: 0, poor: 0, excluded: 0, unknown: 0
    }
    
    // Detect duplicates first
    const duplicateCandidates: DuplicateCandidate[] = allExamples.map(ex => ({
      example_id: ex.id,
      buck_id: (ex.prediction as Record<string, unknown>)?.buck_id as string || '',
      predicted_gross: (ex.prediction as Record<string, unknown>)?.predicted_gross as number | null,
      predicted_net: (ex.prediction as Record<string, unknown>)?.predicted_net as number | null,
      official_gross: (ex.ground_truth as Record<string, unknown>)?.official_gross as number | null,
    }))
    
    const { clusters } = detectDuplicates(duplicateCandidates, config)
    
    // Create duplicate clusters
    for (const cluster of clusters) {
      if (cluster.members.length > 1) {
        await createDuplicateCluster(cluster.type, cluster.reason, cluster.members)
        duplicatesDetected += cluster.members.length - 1 // Don't count primary
      }
    }
    
    // Detect outliers
    const outlierInputs: OutlierInput[] = allExamples.map(ex => ({
      example_id: ex.id,
      gross_error: ex.gross_error,
      net_error: ex.net_error,
      predicted_gross: (ex.prediction as Record<string, unknown>)?.predicted_gross as number | null,
      official_gross: (ex.ground_truth as Record<string, unknown>)?.official_gross as number | null,
      confidence_percent: (ex.prediction as Record<string, unknown>)?.confidence_percent as number | null,
    }))
    
    const { outliers } = detectOutliers(outlierInputs, config)
    
    // Create outlier records
    for (const outlier of outliers) {
      await createOutlierRecord(
        outlier.example_id,
        outlier.type,
        outlier.severity,
        outlier.reason,
        outlier.details
      )
      outliersDetected++
    }
    
    // Build lookup for flags
    const duplicateIds = new Set(clusters.flatMap(c => c.members.slice(1))) // Exclude primaries
    const outlierIds = new Set(outliers.map(o => o.example_id))
    
    // Compute health scores for each example
    for (const ex of allExamples) {
      const prediction = ex.prediction as Record<string, unknown> | null
      const groundTruth = ex.ground_truth as Record<string, unknown> | null
      const buck = prediction?.buck as Record<string, unknown> | null
      
      const exampleData: ExampleData = {
        training_example_id: ex.id,
        verified_for_training: ex.verified_for_training,
        quality_flags: ex.quality_flags as QualityFlags | null,
        score_source: groundTruth?.score_source as ScoreSource | null,
        images_used: prediction?.images_used as number | null,
        angle_diversity_score: prediction?.angle_diversity_score as number | null,
        confidence_percent: prediction?.confidence_percent as number | null,
        intake_quality: prediction?.intake_quality as Record<string, unknown> | null,
        trust_score: prediction?.trust_score as number | null,
        calibrated_confidence: prediction?.calibrated_confidence as number | null,
        gross_error: ex.gross_error,
        net_error: ex.net_error,
        state: buck?.state as string | null,
        rack_type: buck?.rack_type as string | null,
        source_type: buck?.source_type as string | null,
        harvest_method: buck?.harvest_method as string | null,
        main_frame_points: buck?.main_frame_points as number | null,
      }
      
      const { score, tier, factors } = computeHealthScore(exampleData, config, {
        is_duplicate: duplicateIds.has(ex.id),
        is_outlier: outlierIds.has(ex.id),
      })
      
      const sourceStrength = getScoreSourceStrength(groundTruth?.score_source as ScoreSource | null)
      
      await updateExampleHealth(ex.id, {
        health_score: score,
        health_tier: tier,
        health_factors: factors,
        score_source_strength: sourceStrength,
      })
      
      tierCounts[tier]++
      processed++
      
      if (factors.top_weaknesses.length > 0) {
        flaggedForReview++
      }
    }
    
    const completionTime = Date.now()
    
    // Update run with results
    await updateHealthComputationRun(run.id, {
      examples_processed: processed,
      duplicates_detected: duplicatesDetected,
      outliers_detected: outliersDetected,
      examples_flagged_for_review: flaggedForReview,
      computation_time_ms: completionTime - startTime,
      run_stats: {
        by_health_tier: tierCounts,
        avg_health_score: processed > 0 ? 
          allExamples.reduce((sum, ex) => sum + (ex.gross_error ? 70 : 50), 0) / processed : null,
      },
      status: 'completed',
      completed_at: new Date().toISOString(),
    })
    
    return { ...run, status: 'completed' as const }
    
  } catch (error) {
    await updateHealthComputationRun(run.id, {
      status: 'failed',
      error_message: error instanceof Error ? error.message : 'Unknown error',
      completed_at: new Date().toISOString(),
    })
    throw error
  }
}
