/**
 * Phase 28: Weighted Learning Correction
 * 
 * Enhanced learning correction that uses influence weighting, similarity-based
 * weighting, bounded aggregation, and drift protection.
 * 
 * This module wraps and enhances the Phase 10 learning correction logic.
 */

import { createClient } from '@/lib/supabase/server'
import type { 
  Measurements, 
  CalibrationProfile,
  WeightedLearningCorrectionResult,
  WeightedLearningSummary,
  InfluentialExampleDetail,
  ScenarioContext,
  DriftWarning,
  MeasurementCorrectionInfo,
} from '@/lib/types'
import {
  getActiveInfluenceConfig,
  computeSimilarity,
  aggregateCorrections,
  analyzeDrift,
  logLearningCorrection,
  logCorrectionContributions,
  type SimilarityInput,
  type WeightedExample,
} from '@/lib/influence'
import { 
  getCalibrationApplicationValues,
} from '@/lib/calibration/utils'

// ============================================================================
// TYPES
// ============================================================================

export interface WeightedLearningInput {
  state: string
  rackType: 'typical' | 'non-typical'
  mainFramePoints?: number
  sourceType?: string
  captureDevice?: string
  imageCount: number
  earsFullyVisible?: boolean
  harvestMethod?: string
  angleDiversity: number
  baseVisionConfidence: number
  normalizedConfidence: number
  buckId?: string
  predictionId?: string
  calibrationProfile?: CalibrationProfile | null
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const GUARDRAILS = {
  MIN_SIMILAR_EXAMPLES: 3,
  MIN_SIMILARITY_THRESHOLD: 0.25,
  HIGH_SIMILARITY_THRESHOLD: 0.50,
  MIN_CONSISTENCY_FOR_ANY_CORRECTION: 0.3,
  MIN_CONSISTENCY_FOR_STRONG_CORRECTION: 0.6,
  CONFIDENCE_BREAKPOINT_LOW: 55,
  CONFIDENCE_BREAKPOINT_HIGH: 80,
  LOW_CONFIDENCE_CORRECTION_SCALE: 1.2,
  HIGH_CONFIDENCE_CORRECTION_SCALE: 0.6,
} as const

// ============================================================================
// MAIN FUNCTION
// ============================================================================

/**
 * Compute learning correction with full influence weighting
 */
export async function computeWeightedLearningCorrection(
  input: WeightedLearningInput,
  currentMeasurements?: Measurements
): Promise<WeightedLearningCorrectionResult> {
  const emptyResult = createEmptyResult()
  
  try {
    const supabase = await createClient()
    const config = await getActiveInfluenceConfig()
    const caps = config.safety_caps
    const eligibility = config.eligibility_rules
    
    // Check for drift and get strength multiplier
    const driftAnalysis = await analyzeDrift(config)
    let driftWarning: DriftWarning | null = null
    
    if (driftAnalysis.hasActiveDrift && driftAnalysis.strengthMultiplier < 1.0) {
      driftWarning = {
        type: driftAnalysis.driftAlerts[0]?.drift_type || 'directional_bias',
        severity: driftAnalysis.driftAlerts[0]?.severity || 'low',
        message: `Learning strength reduced due to detected ${driftAnalysis.currentBias.direction} bias`,
        strengthReduced: true,
        reductionFactor: driftAnalysis.strengthMultiplier,
      }
    }
    
    // Build query for eligible training examples
    let query = supabase
      .from('training_examples')
      .select(`
        id, 
        buck_id,
        error_amount, 
        ground_truth_score, 
        predicted_score,
        influence_weight,
        influence_factors,
        health_score,
        health_tier,
        usable_for_training,
        is_outlier,
        is_duplicate,
        main_beam_left,
        main_beam_right,
        inside_spread,
        tine_measurements,
        circumference_measurements
      `)
      .eq('verified_for_training', true)
      .not('error_amount', 'is', null)
    
    // Apply eligibility filters
    if (eligibility.require_usable_for_training) {
      query = query.eq('usable_for_training', true)
    }
    if (eligibility.min_health_score > 0) {
      query = query.gte('health_score', eligibility.min_health_score)
    }
    if (eligibility.exclude_outliers) {
      query = query.or('is_outlier.is.null,is_outlier.eq.false')
    }
    if (eligibility.exclude_duplicates) {
      query = query.or('is_duplicate.is.null,is_duplicate.eq.false')
    }
    
    const { data: verifiedExamples, error: examplesError } = await query.limit(500)
    
    if (examplesError || !verifiedExamples || verifiedExamples.length === 0) {
      emptyResult.summary.notes = ['No eligible training examples available.']
      return emptyResult
    }
    
    // Get buck metadata for all examples
    const buckIds = verifiedExamples.map(e => e.buck_id).filter(Boolean) as string[]
    
    const { data: bucks } = await supabase
      .from('bucks')
      .select('id, state, rack_type, main_frame_points, source_type, capture_device, ears_fully_visible, harvest_method')
      .in('id', buckIds)
    
    const bucksMap = new Map(bucks?.map(b => [b.id, b]) || [])
    
    // Get predictions for angle diversity and confidence
    const { data: predictions } = await supabase
      .from('predictions')
      .select('buck_id, images_used, angle_diversity_score, confidence_percent')
      .in('buck_id', buckIds)
    
    const predictionsMap = new Map(predictions?.map(p => [p.buck_id, p]) || [])
    
    // Build similarity input
    const similarityInput: SimilarityInput = {
      state: input.state,
      rackType: input.rackType,
      mainFramePoints: input.mainFramePoints,
      sourceType: input.sourceType,
      captureDevice: input.captureDevice,
      imageCount: input.imageCount,
      earsFullyVisible: input.earsFullyVisible,
      harvestMethod: input.harvestMethod,
      angleDiversity: input.angleDiversity,
      confidenceTier: input.baseVisionConfidence >= 75 ? 'high' : 
                      input.baseVisionConfidence >= 50 ? 'medium' : 'low',
    }
    
    // Calculate similarity and build weighted examples
    const weightedExamples: WeightedExample[] = []
    const featureFrequency: Map<string, number> = new Map()
    const missingFeatureFrequency: Map<string, number> = new Map()
    
    for (const example of verifiedExamples) {
      if (!example.buck_id || typeof example.error_amount !== 'number') continue
      
      const buck = bucksMap.get(example.buck_id)
      const prediction = predictionsMap.get(example.buck_id)
      if (!buck) continue
      
      // Calculate similarity
      const similarity = computeSimilarity(similarityInput, {
        state: buck.state,
        rack_type: buck.rack_type,
        main_frame_points: buck.main_frame_points,
        source_type: buck.source_type,
        capture_device: buck.capture_device,
        image_count: prediction?.images_used,
        ears_fully_visible: buck.ears_fully_visible,
        harvest_method: buck.harvest_method,
        angle_diversity_score: prediction?.angle_diversity_score,
        confidence_percent: prediction?.confidence_percent,
      })
      
      // Skip if below similarity threshold
      if (similarity.total_similarity < GUARDRAILS.MIN_SIMILARITY_THRESHOLD) continue
      
      // Get influence weight (use stored or default to 1.0)
      let influenceWeight = example.influence_weight ?? 1.0
      
      // Apply low quality multiplier if needed
      if (example.health_tier === 'poor' || example.health_tier === 'fair') {
        influenceWeight *= eligibility.low_quality_weight_multiplier
      }
      
      // Cap per-example influence
      influenceWeight = Math.min(influenceWeight, caps.max_per_example_influence)
      
      // Calculate effective weight (similarity * influence)
      const effectiveWeight = similarity.total_similarity * influenceWeight
      
      weightedExamples.push({
        id: example.id,
        buckId: example.buck_id,
        error: example.error_amount,
        similarity: similarity.total_similarity,
        influenceWeight,
        effectiveWeight,
        groundTruthScore: example.ground_truth_score,
        predictedScore: example.predicted_score || 0,
        matchingFeatures: similarity.matching_features,
        state: buck.state,
        rackType: buck.rack_type,
      })
      
      // Track feature frequency
      for (const feature of similarity.matching_features) {
        featureFrequency.set(feature, (featureFrequency.get(feature) || 0) + 1)
      }
      for (const feature of similarity.missing_features) {
        missingFeatureFrequency.set(feature, (missingFeatureFrequency.get(feature) || 0) + 1)
      }
    }
    
    // Check minimum example requirement
    if (weightedExamples.length < caps.min_examples_for_correction) {
      emptyResult.summary.verifiedExamplesConsidered = verifiedExamples.length
      emptyResult.summary.notes = [
        `Found ${weightedExamples.length} eligible example(s), need at least ${caps.min_examples_for_correction}.`
      ]
      return emptyResult
    }
    
    // Sort by effective weight
    weightedExamples.sort((a, b) => b.effectiveWeight - a.effectiveWeight)
    const topExamples = weightedExamples.slice(0, 25)
    const highlySimilar = topExamples.filter(e => e.similarity >= GUARDRAILS.HIGH_SIMILARITY_THRESHOLD)
    
    // Aggregate corrections using bounded method
    const aggregation = aggregateCorrections(topExamples, config)
    
    // Check if total influence is sufficient
    if (aggregation.totalWeight < caps.min_total_influence_weight) {
      emptyResult.summary.verifiedExamplesConsidered = verifiedExamples.length
      emptyResult.summary.eligibleExamplesUsed = topExamples.length
      emptyResult.summary.totalInfluenceWeight = aggregation.totalWeight
      emptyResult.summary.notes = [
        `Total influence weight ${aggregation.totalWeight.toFixed(2)} below minimum ${caps.min_total_influence_weight}.`
      ]
      return emptyResult
    }
    
    // Check consistency
    if (aggregation.consistency < GUARDRAILS.MIN_CONSISTENCY_FOR_ANY_CORRECTION) {
      return createInconsistentResult(
        verifiedExamples.length,
        topExamples,
        aggregation,
        featureFrequency,
        missingFeatureFrequency,
        driftWarning
      )
    }
    
    // Apply confidence-based scaling
    let rawCorrection = aggregation.correction
    if (input.baseVisionConfidence < GUARDRAILS.CONFIDENCE_BREAKPOINT_LOW) {
      rawCorrection *= GUARDRAILS.LOW_CONFIDENCE_CORRECTION_SCALE
    } else if (input.baseVisionConfidence > GUARDRAILS.CONFIDENCE_BREAKPOINT_HIGH) {
      rawCorrection *= GUARDRAILS.HIGH_CONFIDENCE_CORRECTION_SCALE
    }
    
    // Reduce correction if consistency is moderate
    if (aggregation.consistency < GUARDRAILS.MIN_CONSISTENCY_FOR_STRONG_CORRECTION) {
      const consistencyScale = aggregation.consistency / GUARDRAILS.MIN_CONSISTENCY_FOR_STRONG_CORRECTION
      rawCorrection *= consistencyScale
    }
    
    // Apply drift reduction
    if (driftAnalysis.strengthMultiplier < 1.0) {
      rawCorrection *= driftAnalysis.strengthMultiplier
    }
    
    // Get calibration values
    const calibrationValues = getCalibrationApplicationValues(input.calibrationProfile)
    rawCorrection *= calibrationValues.learningStrength
    
    // Apply hard caps
    const preCap = rawCorrection
    let capped = false
    let capReason: string | null = null
    
    if (Math.abs(rawCorrection) > caps.max_total_correction_inches) {
      rawCorrection = Math.sign(rawCorrection) * caps.max_total_correction_inches
      capped = true
      capReason = `Capped at ${caps.max_total_correction_inches}" maximum`
    }
    
    if (Math.abs(rawCorrection) > calibrationValues.maxTotalCorrection) {
      rawCorrection = Math.sign(rawCorrection) * calibrationValues.maxTotalCorrection
      capped = true
      capReason = `Capped by calibration profile at ${calibrationValues.maxTotalCorrection}"`
    }
    
    const grossCorrection = rawCorrection
    const netCorrection = grossCorrection * 0.85
    
    // Calculate confidence boost
    const avgSimilarity = topExamples.reduce((sum, ex) => sum + ex.similarity, 0) / topExamples.length
    const avgInfluence = topExamples.reduce((sum, ex) => sum + ex.influenceWeight, 0) / topExamples.length
    const confidenceBoost = Math.min(12, topExamples.length * avgSimilarity * avgInfluence * 1.5)
    
    // Build per-measurement corrections
    const measurementCorrections = new Map<string, number>()
    const measurementCorrectionsList: MeasurementCorrectionInfo[] = []
    
    if (currentMeasurements && Math.abs(grossCorrection) >= 1) {
      const correctionFraction = grossCorrection / 100
      
      // Apply spread correction
      if (currentMeasurements.inside_spread) {
        const spreadCorr = correctionFraction * currentMeasurements.inside_spread * 0.3 * calibrationValues.spreadWeight
        const cappedSpread = Math.max(
          -calibrationValues.maxSpreadCorrection,
          Math.min(calibrationValues.maxSpreadCorrection, spreadCorr)
        )
        measurementCorrections.set('inside_spread', cappedSpread)
        measurementCorrectionsList.push({
          field: 'inside_spread',
          originalValue: currentMeasurements.inside_spread,
          correction: cappedSpread,
          correctedValue: currentMeasurements.inside_spread + cappedSpread,
          confidence: avgSimilarity,
          sampleCount: topExamples.length,
        })
      }
      
      // Apply beam corrections
      for (const beam of ['main_beam_left', 'main_beam_right'] as const) {
        const val = currentMeasurements[beam]
        if (val) {
          const beamCorr = correctionFraction * val * 0.25 * calibrationValues.beamWeight
          const cappedBeam = Math.max(
            -calibrationValues.maxBeamCorrection,
            Math.min(calibrationValues.maxBeamCorrection, beamCorr)
          )
          measurementCorrections.set(beam, cappedBeam)
          measurementCorrectionsList.push({
            field: beam,
            originalValue: val,
            correction: cappedBeam,
            correctedValue: val + cappedBeam,
            confidence: avgSimilarity,
            sampleCount: topExamples.length,
          })
        }
      }
    }
    
    // Build influential examples list
    const influentialExamples: InfluentialExampleDetail[] = topExamples.slice(0, 10).map(ex => ({
      example_id: ex.id,
      buck_id: ex.buckId,
      similarity_score: Number(ex.similarity.toFixed(3)),
      influence_weight: Number(ex.influenceWeight.toFixed(3)),
      effective_weight: Number(ex.effectiveWeight.toFixed(3)),
      error_contribution: ex.error,
      weighted_contribution: Number((ex.error * ex.effectiveWeight).toFixed(2)),
      matching_features: ex.matchingFeatures,
      ground_truth_score: ex.groundTruthScore,
      predicted_score: ex.predictedScore,
      state: ex.state || null,
      rack_type: ex.rackType || null,
    }))
    
    // Determine correction characteristics
    const positiveCount = topExamples.filter(e => e.error > 0.5).length
    const negativeCount = topExamples.filter(e => e.error < -0.5).length
    
    const correctionDirection = Math.abs(grossCorrection) < 0.5 ? 'none' :
      positiveCount > negativeCount * 2 ? 'increase' :
      negativeCount > positiveCount * 2 ? 'decrease' : 'mixed'
    
    const correctionStrength = Math.abs(grossCorrection) >= 5 ? 'high' :
      Math.abs(grossCorrection) >= 2.5 ? 'medium' :
      Math.abs(grossCorrection) >= 1 ? 'low' : 'none'
    
    const matchQuality = avgSimilarity >= 0.6 ? 'strong' :
      avgSimilarity >= 0.4 ? 'moderate' :
      avgSimilarity >= GUARDRAILS.MIN_SIMILARITY_THRESHOLD ? 'weak' : 'none'
    
    // Build notes
    const notes: string[] = []
    notes.push(`Used ${topExamples.length} examples (${highlySimilar.length} highly similar) with ${matchQuality} match quality.`)
    notes.push(`Aggregation method: ${aggregation.method}, consistency: ${(aggregation.consistency * 100).toFixed(0)}%`)
    
    if (grossCorrection > 0.5) {
      notes.push(`Training suggests AI under-estimates by ~${grossCorrection.toFixed(1)}" for similar bucks.`)
    } else if (grossCorrection < -0.5) {
      notes.push(`Training suggests AI over-estimates by ~${Math.abs(grossCorrection).toFixed(1)}" for similar bucks.`)
    }
    
    if (capped && capReason) {
      notes.push(capReason)
    }
    
    if (driftWarning) {
      notes.push(`Drift protection: ${driftWarning.message}`)
    }
    
    // Log the correction
    const scenarioContext: ScenarioContext = {
      state: input.state,
      rack_type: input.rackType,
      source_type: input.sourceType || null,
      capture_device: input.captureDevice || null,
      image_count: input.imageCount,
      angle_diversity: input.angleDiversity,
      base_vision_confidence: input.baseVisionConfidence,
    }
    
    const logId = await logLearningCorrection(
      input.buckId || null,
      input.predictionId || null,
      {
        gross: grossCorrection,
        net: netCorrection,
        confidenceBoost,
        preCap,
        capped,
        capReason,
        method: aggregation.method,
      },
      influentialExamples,
      scenarioContext,
      Object.fromEntries(measurementCorrections)
    )
    
    // Log individual contributions
    if (logId) {
      await logCorrectionContributions(
        logId,
        topExamples.map(ex => ({
          trainingExampleId: ex.id,
          similarity: ex.similarity,
          influenceWeight: ex.influenceWeight,
          effectiveWeight: ex.effectiveWeight,
          errorContribution: ex.error,
          weightedContribution: ex.error * ex.effectiveWeight,
          similarityFactors: null, // Could be computed but adds overhead
        }))
      )
    }
    
    // Build summary
    const summary: WeightedLearningSummary = {
      verifiedExamplesConsidered: verifiedExamples.length,
      eligibleExamplesUsed: topExamples.length,
      highlySimilarExamplesUsed: highlySimilar.length,
      totalInfluenceWeight: Number(aggregation.totalWeight.toFixed(3)),
      avgSimilarity: Number(avgSimilarity.toFixed(3)),
      avgInfluenceWeight: Number(avgInfluence.toFixed(3)),
      strongestMatchingFeatures: Array.from(featureFrequency.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([f]) => f),
      weakestMatchingFeatures: Array.from(missingFeatureFrequency.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([f]) => f),
      correctionDirection,
      grossAdjustmentApplied: Number(grossCorrection.toFixed(2)),
      netAdjustmentApplied: Number(netCorrection.toFixed(2)),
      confidenceAdjustmentApplied: Number(confidenceBoost.toFixed(1)),
      correctionStrength,
      measurementCorrections: measurementCorrectionsList,
      correctionCapped: capped,
      cappingReason: capReason,
      exampleConsistency: Number(aggregation.consistency.toFixed(2)),
      aggregationMethod: aggregation.method,
      driftWarning,
      influentialExamples,
      notes,
      matchQuality,
    }
    
    return {
      grossCorrection: Number(grossCorrection.toFixed(2)),
      netCorrection: Number(netCorrection.toFixed(2)),
      confidenceBoost: Number(confidenceBoost.toFixed(1)),
      measurementCorrections,
      aggregationMethod: aggregation.method,
      preCap: {
        grossCorrection: Number(preCap.toFixed(2)),
        wasCapped: capped,
        capReason,
      },
      totalInfluenceWeight: aggregation.totalWeight,
      contributingExamples: influentialExamples,
      driftWarning,
      summary,
    }
  } catch (err) {
    console.error('Error in weighted learning correction:', err)
    emptyResult.summary.notes = ['Error accessing training data.']
    return emptyResult
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function createEmptyResult(): WeightedLearningCorrectionResult {
  return {
    grossCorrection: 0,
    netCorrection: 0,
    confidenceBoost: 0,
    measurementCorrections: new Map(),
    aggregationMethod: 'weighted_mean',
    preCap: { grossCorrection: 0, wasCapped: false, capReason: null },
    totalInfluenceWeight: 0,
    contributingExamples: [],
    driftWarning: null,
    summary: {
      verifiedExamplesConsidered: 0,
      eligibleExamplesUsed: 0,
      highlySimilarExamplesUsed: 0,
      totalInfluenceWeight: 0,
      avgSimilarity: 0,
      avgInfluenceWeight: 0,
      strongestMatchingFeatures: [],
      weakestMatchingFeatures: [],
      correctionDirection: 'none',
      grossAdjustmentApplied: 0,
      netAdjustmentApplied: 0,
      confidenceAdjustmentApplied: 0,
      correctionStrength: 'none',
      measurementCorrections: [],
      correctionCapped: false,
      cappingReason: null,
      exampleConsistency: 0,
      aggregationMethod: 'weighted_mean',
      driftWarning: null,
      influentialExamples: [],
      notes: ['No training data available.'],
      matchQuality: 'none',
    },
  }
}

function createInconsistentResult(
  totalConsidered: number,
  topExamples: WeightedExample[],
  aggregation: { totalWeight: number; consistency: number; method: string },
  featureFrequency: Map<string, number>,
  missingFeatureFrequency: Map<string, number>,
  driftWarning: DriftWarning | null
): WeightedLearningCorrectionResult {
  const avgSimilarity = topExamples.reduce((sum, ex) => sum + ex.similarity, 0) / topExamples.length
  const avgInfluence = topExamples.reduce((sum, ex) => sum + ex.influenceWeight, 0) / topExamples.length
  
  const influentialExamples: InfluentialExampleDetail[] = topExamples.slice(0, 5).map(ex => ({
    example_id: ex.id,
    buck_id: ex.buckId,
    similarity_score: ex.similarity,
    influence_weight: ex.influenceWeight,
    effective_weight: ex.effectiveWeight,
    error_contribution: ex.error,
    weighted_contribution: ex.error * ex.effectiveWeight,
    matching_features: ex.matchingFeatures,
    ground_truth_score: ex.groundTruthScore,
    predicted_score: ex.predictedScore,
    state: ex.state || null,
    rack_type: ex.rackType || null,
  }))
  
  return {
    grossCorrection: 0,
    netCorrection: 0,
    confidenceBoost: Math.min(5, topExamples.length * 0.5),
    measurementCorrections: new Map(),
    aggregationMethod: aggregation.method as 'weighted_mean' | 'trimmed_mean' | 'median' | 'robust_mean',
    preCap: { grossCorrection: 0, wasCapped: false, capReason: 'Examples disagree too much' },
    totalInfluenceWeight: aggregation.totalWeight,
    contributingExamples: influentialExamples,
    driftWarning,
    summary: {
      verifiedExamplesConsidered: totalConsidered,
      eligibleExamplesUsed: topExamples.length,
      highlySimilarExamplesUsed: topExamples.filter(e => e.similarity >= 0.5).length,
      totalInfluenceWeight: aggregation.totalWeight,
      avgSimilarity,
      avgInfluenceWeight: avgInfluence,
      strongestMatchingFeatures: Array.from(featureFrequency.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([f]) => f),
      weakestMatchingFeatures: Array.from(missingFeatureFrequency.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([f]) => f),
      correctionDirection: 'none',
      grossAdjustmentApplied: 0,
      netAdjustmentApplied: 0,
      confidenceAdjustmentApplied: Math.min(5, topExamples.length * 0.5),
      correctionStrength: 'none',
      measurementCorrections: [],
      correctionCapped: false,
      cappingReason: 'Examples disagree too much for reliable correction',
      exampleConsistency: aggregation.consistency,
      aggregationMethod: aggregation.method,
      driftWarning,
      influentialExamples,
      notes: [
        `Found ${topExamples.length} examples but they disagree significantly.`,
        `Consistency: ${(aggregation.consistency * 100).toFixed(0)}% (need 30% minimum).`,
      ],
      matchQuality: 'weak',
    },
  }
}
