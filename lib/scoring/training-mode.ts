/**
 * Training Mode Module (Phase 60)
 * 
 * Tracks prediction errors vs ground truth to enable learning.
 * Links errors to specific image quality metrics so we can understand
 * which conditions lead to which types of errors.
 * 
 * This enables:
 * 1. Per-image error attribution
 * 2. Per-angle error patterns
 * 3. Per-family systematic bias detection
 * 4. Quality-correlated error tracking
 */

import { createClient } from '@/lib/supabase/server'
import type { AngleType, Measurements } from '@/lib/types'
import type { ImageDiagnostics } from './image-diagnostics'
import type { ImageAngleScore } from './image-angle-scoring'
import type { MeasurementFamily } from './segment-confidence-interval'

// ============================================================================
// TYPES
// ============================================================================

export interface TrainingImageMetrics {
  imageIndex: number
  angleType: AngleType
  angleConfidence: number
  qualityScore: number          // 0-1 overall quality
  blurScore: number
  brightnessScore: number
  contrastScore: number
  spreadWeight: number          // How much this image contributed to spread
  beamWeight: number
  tineWeight: number
  massWeight: number
}

export interface TrainingPrediction {
  predictionId: string
  buckId: string
  userId?: string
  timestamp: string
  imageCount: number
  imageMetrics: TrainingImageMetrics[]
  predictedMeasurements: Measurements
  predictedGross: number | null
  predictedNet: number | null
  overallConfidence: number
  fusionMethod: string
  anglesCovered: AngleType[]
}

export interface TrainingGroundTruth {
  predictionId: string
  reviewerId?: string
  reviewedAt: string
  actualMeasurements: Measurements
  actualGross: number
  actualNet: number
  isOfficial: boolean
  notes?: string
}

export interface TrainingError {
  predictionId: string
  family: MeasurementFamily | 'gross' | 'net'
  field: string
  predictedValue: number
  actualValue: number
  error: number              // actual - predicted (positive = under-predicted)
  absError: number
  percentError: number
  associatedImageMetrics: TrainingImageMetrics[]
}

export interface TrainingErrorSummary {
  family: MeasurementFamily | 'gross' | 'net'
  sampleCount: number
  meanError: number          // Signed mean (shows bias direction)
  meanAbsError: number       // Absolute mean (shows magnitude)
  stdDev: number
  bias: 'over' | 'under' | 'neutral'
  
  // Error breakdown by angle
  byAngle: Record<AngleType, {
    sampleCount: number
    meanError: number
    meanAbsError: number
  }>
  
  // Error breakdown by quality tier
  byQuality: Record<'poor' | 'ok' | 'good', {
    sampleCount: number
    meanError: number
    meanAbsError: number
  }>
  
  // Error breakdown by image count
  byImageCount: Record<number, {
    sampleCount: number
    meanError: number
    meanAbsError: number
  }>
}

export interface TrainingModeSession {
  sessionId: string
  startedAt: string
  predictions: TrainingPrediction[]
  groundTruths: TrainingGroundTruth[]
  errors: TrainingError[]
  summaries: TrainingErrorSummary[]
}

// ============================================================================
// TRAINING DATA COLLECTION
// ============================================================================

/**
 * Record a prediction for training mode
 */
export function createTrainingPrediction(
  predictionId: string,
  buckId: string,
  imageScores: ImageAngleScore[],
  measurements: Measurements,
  grossScore: number | null,
  netScore: number | null,
  confidence: number,
  fusionMethod: string,
  userId?: string
): TrainingPrediction {
  const imageMetrics: TrainingImageMetrics[] = imageScores.map(score => ({
    imageIndex: score.imageIndex,
    angleType: score.angleType,
    angleConfidence: score.angleConfidence,
    qualityScore: score.diagnostics?.overallQuality === 'good' ? 1.0 :
                  score.diagnostics?.overallQuality === 'ok' ? 0.6 : 0.3,
    blurScore: score.diagnostics?.blurScore ?? 0,
    brightnessScore: score.diagnostics?.brightnessScore ?? 0,
    contrastScore: score.diagnostics?.contrastScore ?? 0,
    spreadWeight: score.qualityAdjustedScores.spread,
    beamWeight: score.qualityAdjustedScores.beam,
    tineWeight: score.qualityAdjustedScores.tine,
    massWeight: score.qualityAdjustedScores.mass,
  }))

  const anglesCovered = [...new Set(imageScores.map(s => s.angleType))]

  return {
    predictionId,
    buckId,
    userId,
    timestamp: new Date().toISOString(),
    imageCount: imageScores.length,
    imageMetrics,
    predictedMeasurements: measurements,
    predictedGross: grossScore,
    predictedNet: netScore,
    overallConfidence: confidence,
    fusionMethod,
    anglesCovered,
  }
}

/**
 * Record ground truth for a prediction
 */
export function createTrainingGroundTruth(
  predictionId: string,
  actualMeasurements: Measurements,
  actualGross: number,
  actualNet: number,
  isOfficial: boolean = false,
  reviewerId?: string,
  notes?: string
): TrainingGroundTruth {
  return {
    predictionId,
    reviewerId,
    reviewedAt: new Date().toISOString(),
    actualMeasurements,
    actualGross,
    actualNet,
    isOfficial,
    notes,
  }
}

// ============================================================================
// ERROR CALCULATION
// ============================================================================

/**
 * Calculate detailed errors between prediction and ground truth
 */
export function calculateTrainingErrors(
  prediction: TrainingPrediction,
  groundTruth: TrainingGroundTruth
): TrainingError[] {
  const errors: TrainingError[] = []
  const pred = prediction.predictedMeasurements
  const actual = groundTruth.actualMeasurements

  // Helper to create error record
  const addError = (
    family: MeasurementFamily | 'gross' | 'net',
    field: string,
    predictedValue: number | null,
    actualValue: number | null
  ) => {
    if (predictedValue === null || actualValue === null) return
    
    const error = actualValue - predictedValue
    const absError = Math.abs(error)
    const percentError = actualValue !== 0 ? (absError / actualValue) * 100 : 0

    errors.push({
      predictionId: prediction.predictionId,
      family,
      field,
      predictedValue,
      actualValue,
      error,
      absError,
      percentError,
      associatedImageMetrics: prediction.imageMetrics,
    })
  }

  // Spread errors
  addError('spread', 'inside_spread', pred.inside_spread, actual.inside_spread)

  // Beam errors
  addError('beam', 'main_beam_left', pred.main_beam_left, actual.main_beam_left)
  addError('beam', 'main_beam_right', pred.main_beam_right, actual.main_beam_right)

  // Tine errors
  for (let i = 1; i <= 5; i++) {
    const leftKey = `g${i}_left` as keyof Measurements
    const rightKey = `g${i}_right` as keyof Measurements
    addError('tine', leftKey, pred[leftKey] as number | null, actual[leftKey] as number | null)
    addError('tine', rightKey, pred[rightKey] as number | null, actual[rightKey] as number | null)
  }

  // Mass errors
  for (let i = 1; i <= 4; i++) {
    const leftKey = `h${i}_left` as keyof Measurements
    const rightKey = `h${i}_right` as keyof Measurements
    addError('mass', leftKey, pred[leftKey] as number | null, actual[leftKey] as number | null)
    addError('mass', rightKey, pred[rightKey] as number | null, actual[rightKey] as number | null)
  }

  // Deduction errors
  addError('deduction', 'deductions', pred.deductions, actual.deductions)

  // Score errors
  if (prediction.predictedGross !== null) {
    addError('gross', 'gross_score', prediction.predictedGross, groundTruth.actualGross)
  }
  if (prediction.predictedNet !== null) {
    addError('net', 'net_score', prediction.predictedNet, groundTruth.actualNet)
  }

  return errors
}

// ============================================================================
// ERROR ANALYSIS
// ============================================================================

/**
 * Summarize errors for a measurement family
 */
export function summarizeErrors(
  errors: TrainingError[],
  family: MeasurementFamily | 'gross' | 'net'
): TrainingErrorSummary {
  const familyErrors = errors.filter(e => e.family === family)
  
  if (familyErrors.length === 0) {
    return createEmptySummary(family)
  }

  // Calculate basic statistics
  const errorValues = familyErrors.map(e => e.error)
  const absErrorValues = familyErrors.map(e => e.absError)
  
  const meanError = errorValues.reduce((a, b) => a + b, 0) / errorValues.length
  const meanAbsError = absErrorValues.reduce((a, b) => a + b, 0) / absErrorValues.length
  
  const squaredDiffs = errorValues.map(e => Math.pow(e - meanError, 2))
  const stdDev = Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / errorValues.length)

  // Determine bias direction
  let bias: 'over' | 'under' | 'neutral' = 'neutral'
  if (meanError > 0.5) bias = 'under'      // Positive error = actual > predicted = under-prediction
  else if (meanError < -0.5) bias = 'over' // Negative error = actual < predicted = over-prediction

  // Breakdown by angle
  const byAngle: Record<AngleType, { sampleCount: number; meanError: number; meanAbsError: number }> = {
    front: { sampleCount: 0, meanError: 0, meanAbsError: 0 },
    left: { sampleCount: 0, meanError: 0, meanAbsError: 0 },
    right: { sampleCount: 0, meanError: 0, meanAbsError: 0 },
    back: { sampleCount: 0, meanError: 0, meanAbsError: 0 },
    other: { sampleCount: 0, meanError: 0, meanAbsError: 0 },
  }

  for (const error of familyErrors) {
    // Find the dominant angle for this error
    const dominantAngle = getDominantAngleForFamily(error.associatedImageMetrics, family)
    if (dominantAngle) {
      byAngle[dominantAngle].sampleCount++
      byAngle[dominantAngle].meanError += error.error
      byAngle[dominantAngle].meanAbsError += error.absError
    }
  }

  // Normalize angle averages
  for (const angle of Object.keys(byAngle) as AngleType[]) {
    if (byAngle[angle].sampleCount > 0) {
      byAngle[angle].meanError /= byAngle[angle].sampleCount
      byAngle[angle].meanAbsError /= byAngle[angle].sampleCount
    }
  }

  // Breakdown by quality
  const byQuality: Record<'poor' | 'ok' | 'good', { sampleCount: number; meanError: number; meanAbsError: number }> = {
    poor: { sampleCount: 0, meanError: 0, meanAbsError: 0 },
    ok: { sampleCount: 0, meanError: 0, meanAbsError: 0 },
    good: { sampleCount: 0, meanError: 0, meanAbsError: 0 },
  }

  for (const error of familyErrors) {
    const avgQuality = error.associatedImageMetrics.length > 0
      ? error.associatedImageMetrics.reduce((sum, m) => sum + m.qualityScore, 0) / error.associatedImageMetrics.length
      : 0.5

    const tier = avgQuality >= 0.8 ? 'good' : avgQuality >= 0.5 ? 'ok' : 'poor'
    byQuality[tier].sampleCount++
    byQuality[tier].meanError += error.error
    byQuality[tier].meanAbsError += error.absError
  }

  // Normalize quality averages
  for (const tier of ['poor', 'ok', 'good'] as const) {
    if (byQuality[tier].sampleCount > 0) {
      byQuality[tier].meanError /= byQuality[tier].sampleCount
      byQuality[tier].meanAbsError /= byQuality[tier].sampleCount
    }
  }

  // Breakdown by image count
  const byImageCount: Record<number, { sampleCount: number; meanError: number; meanAbsError: number }> = {}
  
  for (const error of familyErrors) {
    const count = error.associatedImageMetrics.length
    if (!byImageCount[count]) {
      byImageCount[count] = { sampleCount: 0, meanError: 0, meanAbsError: 0 }
    }
    byImageCount[count].sampleCount++
    byImageCount[count].meanError += error.error
    byImageCount[count].meanAbsError += error.absError
  }

  // Normalize image count averages
  for (const count of Object.keys(byImageCount)) {
    const c = parseInt(count)
    if (byImageCount[c].sampleCount > 0) {
      byImageCount[c].meanError /= byImageCount[c].sampleCount
      byImageCount[c].meanAbsError /= byImageCount[c].sampleCount
    }
  }

  return {
    family,
    sampleCount: familyErrors.length,
    meanError: Number(meanError.toFixed(2)),
    meanAbsError: Number(meanAbsError.toFixed(2)),
    stdDev: Number(stdDev.toFixed(2)),
    bias,
    byAngle,
    byQuality,
    byImageCount,
  }
}

function createEmptySummary(family: MeasurementFamily | 'gross' | 'net'): TrainingErrorSummary {
  return {
    family,
    sampleCount: 0,
    meanError: 0,
    meanAbsError: 0,
    stdDev: 0,
    bias: 'neutral',
    byAngle: {
      front: { sampleCount: 0, meanError: 0, meanAbsError: 0 },
      left: { sampleCount: 0, meanError: 0, meanAbsError: 0 },
      right: { sampleCount: 0, meanError: 0, meanAbsError: 0 },
      back: { sampleCount: 0, meanError: 0, meanAbsError: 0 },
      other: { sampleCount: 0, meanError: 0, meanAbsError: 0 },
    },
    byQuality: {
      poor: { sampleCount: 0, meanError: 0, meanAbsError: 0 },
      ok: { sampleCount: 0, meanError: 0, meanAbsError: 0 },
      good: { sampleCount: 0, meanError: 0, meanAbsError: 0 },
    },
    byImageCount: {},
  }
}

function getDominantAngleForFamily(
  metrics: TrainingImageMetrics[],
  family: MeasurementFamily | 'gross' | 'net'
): AngleType | null {
  if (metrics.length === 0) return null

  let maxWeight = 0
  let dominantAngle: AngleType = 'other'

  for (const metric of metrics) {
    let weight = 0
    switch (family) {
      case 'spread':
        weight = metric.spreadWeight
        break
      case 'beam':
        weight = metric.beamWeight
        break
      case 'tine':
        weight = metric.tineWeight
        break
      case 'mass':
        weight = metric.massWeight
        break
      default:
        weight = (metric.spreadWeight + metric.beamWeight + metric.tineWeight + metric.massWeight) / 4
    }

    if (weight > maxWeight) {
      maxWeight = weight
      dominantAngle = metric.angleType
    }
  }

  return dominantAngle
}

// ============================================================================
// PERSISTENCE
// ============================================================================

/**
 * Store training data in the database
 */
export async function storeTrainingData(
  prediction: TrainingPrediction,
  groundTruth: TrainingGroundTruth,
  errors: TrainingError[]
): Promise<boolean> {
  try {
    const supabase = await createClient()

    // Store the training sample
    const { error: sampleError } = await supabase
      .from('training_samples')
      .upsert({
        id: prediction.predictionId,
        buck_id: prediction.buckId,
        user_id: prediction.userId,
        input: {
          image_count: prediction.imageCount,
          angles_covered: prediction.anglesCovered,
          fusion_method: prediction.fusionMethod,
          image_metrics: prediction.imageMetrics,
        },
        ai_output: {
          measurements: prediction.predictedMeasurements,
          gross_score: prediction.predictedGross,
          net_score: prediction.predictedNet,
          confidence: prediction.overallConfidence,
        },
        ground_truth: {
          measurements: groundTruth.actualMeasurements,
          gross_score: groundTruth.actualGross,
          net_score: groundTruth.actualNet,
        },
        is_official: groundTruth.isOfficial,
        reviewed_by: groundTruth.reviewerId,
        reviewed_at: groundTruth.reviewedAt,
        notes: groundTruth.notes,
      })

    if (sampleError) {
      console.error('Error storing training sample:', sampleError)
      return false
    }

    // Store detailed errors
    const errorRecords = errors.map(e => ({
      prediction_id: e.predictionId,
      family: e.family,
      field: e.field,
      predicted_value: e.predictedValue,
      actual_value: e.actualValue,
      error: e.error,
      abs_error: e.absError,
      percent_error: e.percentError,
      dominant_angle: getDominantAngleForFamily(e.associatedImageMetrics, e.family),
      image_count: e.associatedImageMetrics.length,
      avg_quality: e.associatedImageMetrics.length > 0
        ? e.associatedImageMetrics.reduce((sum, m) => sum + m.qualityScore, 0) / e.associatedImageMetrics.length
        : null,
    }))

    const { error: errorsError } = await supabase
      .from('training_errors')
      .upsert(errorRecords)

    if (errorsError) {
      console.error('Error storing training errors:', errorsError)
      return false
    }

    return true
  } catch (err) {
    console.error('Error in storeTrainingData:', err)
    return false
  }
}

/**
 * Get error summaries from stored training data
 */
export async function getTrainingErrorSummaries(): Promise<TrainingErrorSummary[]> {
  try {
    const supabase = await createClient()

    const { data: errors, error } = await supabase
      .from('training_errors')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500)

    if (error || !errors) {
      console.error('Error fetching training errors:', error)
      return []
    }

    // Convert to TrainingError format
    const trainingErrors: TrainingError[] = errors.map(e => ({
      predictionId: e.prediction_id,
      family: e.family as MeasurementFamily | 'gross' | 'net',
      field: e.field,
      predictedValue: e.predicted_value,
      actualValue: e.actual_value,
      error: e.error,
      absError: e.abs_error,
      percentError: e.percent_error,
      associatedImageMetrics: [{
        imageIndex: 0,
        angleType: e.dominant_angle || 'other',
        angleConfidence: 1.0,
        qualityScore: e.avg_quality || 0.5,
        blurScore: 0,
        brightnessScore: 0,
        contrastScore: 0,
        spreadWeight: 0.5,
        beamWeight: 0.5,
        tineWeight: 0.5,
        massWeight: 0.5,
      }],
    }))

    // Generate summaries for each family
    const families: (MeasurementFamily | 'gross' | 'net')[] = [
      'spread', 'beam', 'tine', 'mass', 'deduction', 'gross', 'net'
    ]

    return families.map(family => summarizeErrors(trainingErrors, family))
  } catch (err) {
    console.error('Error in getTrainingErrorSummaries:', err)
    return []
  }
}

/**
 * Get correction factors based on training data
 */
export function getTrainingCorrections(
  summaries: TrainingErrorSummary[]
): Record<MeasurementFamily, number> {
  const corrections: Record<MeasurementFamily, number> = {
    spread: 0,
    beam: 0,
    tine: 0,
    mass: 0,
    deduction: 0,
  }

  const MIN_SAMPLES = 10
  const CORRECTION_STRENGTH = 0.5 // Apply 50% of the mean error as correction

  for (const summary of summaries) {
    if (summary.family === 'gross' || summary.family === 'net') continue
    if (summary.sampleCount < MIN_SAMPLES) continue
    if (Math.abs(summary.meanError) < 0.5) continue // Ignore small biases

    // Apply correction in opposite direction of the error
    // If meanError is positive (under-prediction), add positive correction
    // If meanError is negative (over-prediction), add negative correction
    corrections[summary.family] = summary.meanError * CORRECTION_STRENGTH
  }

  return corrections
}
