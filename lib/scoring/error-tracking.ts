/**
 * Error Pattern Tracking Module (Phase 9)
 * 
 * Tracks where vision scoring is most wrong to:
 * 1. Identify systematic biases
 * 2. Inform targeted corrections
 * 3. Expose patterns in admin dashboard
 */

import { createClient } from '@/lib/supabase/server'
import type { Measurements } from '@/lib/types'

// Error categories
export type ErrorCategory = 
  | 'spread'
  | 'beams' 
  | 'tines_g1' 
  | 'tines_g2' 
  | 'tines_g3' 
  | 'tines_g4'
  | 'tines_g5'
  | 'circumferences'
  | 'gross_score'
  | 'net_score'

export interface CategoryError {
  category: ErrorCategory
  avgError: number
  avgAbsError: number
  bias: 'over' | 'under' | 'neutral'
  sampleCount: number
  percentOfSamples: number
}

export interface ErrorPatternSummary {
  totalSamples: number
  overallGrossError: number
  overallNetError: number
  overallBias: 'over' | 'under' | 'neutral'
  categoryErrors: CategoryError[]
  worstCategory: ErrorCategory
  bestCategory: ErrorCategory
  recommendations: string[]
}

export interface MeasurementErrorRecord {
  prediction_id: string
  spread_error: number | null
  beam_left_error: number | null
  beam_right_error: number | null
  g1_error: number | null
  g2_error: number | null
  g3_error: number | null
  g4_error: number | null
  g5_error: number | null
  circumference_error: number | null
  gross_error: number | null
  net_error: number | null
  created_at: string
}

/**
 * Calculate measurement-level errors between predicted and ground truth
 */
export function calculateMeasurementErrors(
  predicted: Measurements,
  groundTruth: Measurements
): Record<string, number | null> {
  const errors: Record<string, number | null> = {}

  // Helper to calculate error if both values exist
  const calcError = (pred: number | null, truth: number | null): number | null => {
    if (pred === null || truth === null) return null
    return pred - truth // Positive = over-estimate, negative = under-estimate
  }

  errors.spread_error = calcError(predicted.inside_spread, groundTruth.inside_spread)
  errors.beam_left_error = calcError(predicted.main_beam_left, groundTruth.main_beam_left)
  errors.beam_right_error = calcError(predicted.main_beam_right, groundTruth.main_beam_right)
  
  // Tine errors (average left and right)
  const g1Error = [
    calcError(predicted.g1_left, groundTruth.g1_left),
    calcError(predicted.g1_right, groundTruth.g1_right)
  ].filter((e): e is number => e !== null)
  errors.g1_error = g1Error.length > 0 ? g1Error.reduce((a, b) => a + b, 0) / g1Error.length : null

  const g2Error = [
    calcError(predicted.g2_left, groundTruth.g2_left),
    calcError(predicted.g2_right, groundTruth.g2_right)
  ].filter((e): e is number => e !== null)
  errors.g2_error = g2Error.length > 0 ? g2Error.reduce((a, b) => a + b, 0) / g2Error.length : null

  const g3Error = [
    calcError(predicted.g3_left, groundTruth.g3_left),
    calcError(predicted.g3_right, groundTruth.g3_right)
  ].filter((e): e is number => e !== null)
  errors.g3_error = g3Error.length > 0 ? g3Error.reduce((a, b) => a + b, 0) / g3Error.length : null

  const g4Error = [
    calcError(predicted.g4_left, groundTruth.g4_left),
    calcError(predicted.g4_right, groundTruth.g4_right)
  ].filter((e): e is number => e !== null)
  errors.g4_error = g4Error.length > 0 ? g4Error.reduce((a, b) => a + b, 0) / g4Error.length : null

  const g5Error = [
    calcError(predicted.g5_left, groundTruth.g5_left),
    calcError(predicted.g5_right, groundTruth.g5_right)
  ].filter((e): e is number => e !== null)
  errors.g5_error = g5Error.length > 0 ? g5Error.reduce((a, b) => a + b, 0) / g5Error.length : null

  // Circumference errors (average all)
  const hErrors = [
    calcError(predicted.h1_left, groundTruth.h1_left),
    calcError(predicted.h1_right, groundTruth.h1_right),
    calcError(predicted.h2_left, groundTruth.h2_left),
    calcError(predicted.h2_right, groundTruth.h2_right),
    calcError(predicted.h3_left, groundTruth.h3_left),
    calcError(predicted.h3_right, groundTruth.h3_right),
    calcError(predicted.h4_left, groundTruth.h4_left),
    calcError(predicted.h4_right, groundTruth.h4_right),
  ].filter((e): e is number => e !== null)
  errors.circumference_error = hErrors.length > 0 ? hErrors.reduce((a, b) => a + b, 0) / hErrors.length : null

  return errors
}

/**
 * Store error record for a prediction
 */
export async function storeErrorRecord(
  predictionId: string,
  predicted: Measurements,
  groundTruth: Measurements,
  grossError: number,
  netError: number
): Promise<boolean> {
  try {
    const supabase = await createClient()
    const errors = calculateMeasurementErrors(predicted, groundTruth)

    const { error } = await supabase
      .from('measurement_errors')
      .upsert({
        prediction_id: predictionId,
        ...errors,
        gross_error: grossError,
        net_error: netError,
      })

    if (error) {
      console.error('Error storing measurement errors:', error)
      return false
    }
    return true
  } catch (err) {
    console.error('Error in storeErrorRecord:', err)
    return false
  }
}

/**
 * Get aggregated error patterns from stored records
 */
export async function getErrorPatterns(
  limit: number = 100
): Promise<ErrorPatternSummary> {
  const emptyResult: ErrorPatternSummary = {
    totalSamples: 0,
    overallGrossError: 0,
    overallNetError: 0,
    overallBias: 'neutral',
    categoryErrors: [],
    worstCategory: 'gross_score',
    bestCategory: 'gross_score',
    recommendations: ['Insufficient data for error pattern analysis.'],
  }

  try {
    const supabase = await createClient()

    const { data: errorRecords, error } = await supabase
      .from('measurement_errors')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error || !errorRecords || errorRecords.length === 0) {
      return emptyResult
    }

    // Calculate category-level statistics
    const categoryStats: Record<ErrorCategory, { errors: number[]; absErrors: number[] }> = {
      spread: { errors: [], absErrors: [] },
      beams: { errors: [], absErrors: [] },
      tines_g1: { errors: [], absErrors: [] },
      tines_g2: { errors: [], absErrors: [] },
      tines_g3: { errors: [], absErrors: [] },
      tines_g4: { errors: [], absErrors: [] },
      tines_g5: { errors: [], absErrors: [] },
      circumferences: { errors: [], absErrors: [] },
      gross_score: { errors: [], absErrors: [] },
      net_score: { errors: [], absErrors: [] },
    }

    for (const record of errorRecords) {
      if (record.spread_error !== null) {
        categoryStats.spread.errors.push(record.spread_error)
        categoryStats.spread.absErrors.push(Math.abs(record.spread_error))
      }
      if (record.beam_left_error !== null && record.beam_right_error !== null) {
        const beamAvg = (record.beam_left_error + record.beam_right_error) / 2
        categoryStats.beams.errors.push(beamAvg)
        categoryStats.beams.absErrors.push(Math.abs(beamAvg))
      }
      if (record.g1_error !== null) {
        categoryStats.tines_g1.errors.push(record.g1_error)
        categoryStats.tines_g1.absErrors.push(Math.abs(record.g1_error))
      }
      if (record.g2_error !== null) {
        categoryStats.tines_g2.errors.push(record.g2_error)
        categoryStats.tines_g2.absErrors.push(Math.abs(record.g2_error))
      }
      if (record.g3_error !== null) {
        categoryStats.tines_g3.errors.push(record.g3_error)
        categoryStats.tines_g3.absErrors.push(Math.abs(record.g3_error))
      }
      if (record.g4_error !== null) {
        categoryStats.tines_g4.errors.push(record.g4_error)
        categoryStats.tines_g4.absErrors.push(Math.abs(record.g4_error))
      }
      if (record.g5_error !== null) {
        categoryStats.tines_g5.errors.push(record.g5_error)
        categoryStats.tines_g5.absErrors.push(Math.abs(record.g5_error))
      }
      if (record.circumference_error !== null) {
        categoryStats.circumferences.errors.push(record.circumference_error)
        categoryStats.circumferences.absErrors.push(Math.abs(record.circumference_error))
      }
      if (record.gross_error !== null) {
        categoryStats.gross_score.errors.push(record.gross_error)
        categoryStats.gross_score.absErrors.push(Math.abs(record.gross_error))
      }
      if (record.net_error !== null) {
        categoryStats.net_score.errors.push(record.net_error)
        categoryStats.net_score.absErrors.push(Math.abs(record.net_error))
      }
    }

    // Build category error summaries
    const categoryErrors: CategoryError[] = []
    let worstAbsError = 0
    let worstCategory: ErrorCategory = 'gross_score'
    let bestAbsError = Infinity
    let bestCategory: ErrorCategory = 'gross_score'

    for (const [category, stats] of Object.entries(categoryStats) as [ErrorCategory, { errors: number[]; absErrors: number[] }][]) {
      if (stats.errors.length === 0) continue

      const avgError = stats.errors.reduce((a, b) => a + b, 0) / stats.errors.length
      const avgAbsError = stats.absErrors.reduce((a, b) => a + b, 0) / stats.absErrors.length
      
      const bias: 'over' | 'under' | 'neutral' = 
        avgError > 0.5 ? 'over' : avgError < -0.5 ? 'under' : 'neutral'

      categoryErrors.push({
        category,
        avgError: Number(avgError.toFixed(2)),
        avgAbsError: Number(avgAbsError.toFixed(2)),
        bias,
        sampleCount: stats.errors.length,
        percentOfSamples: Number((stats.errors.length / errorRecords.length * 100).toFixed(1)),
      })

      if (avgAbsError > worstAbsError) {
        worstAbsError = avgAbsError
        worstCategory = category
      }
      if (avgAbsError < bestAbsError) {
        bestAbsError = avgAbsError
        bestCategory = category
      }
    }

    // Sort by absolute error descending
    categoryErrors.sort((a, b) => b.avgAbsError - a.avgAbsError)

    // Generate recommendations
    const recommendations: string[] = []
    const topErrors = categoryErrors.slice(0, 3)
    
    for (const err of topErrors) {
      if (err.avgAbsError > 2) {
        if (err.bias === 'over') {
          recommendations.push(`Vision tends to over-estimate ${err.category.replace('_', ' ')} by ~${err.avgAbsError.toFixed(1)}". Consider adding negative correction.`)
        } else if (err.bias === 'under') {
          recommendations.push(`Vision tends to under-estimate ${err.category.replace('_', ' ')} by ~${err.avgAbsError.toFixed(1)}". Consider adding positive correction.`)
        } else {
          recommendations.push(`High variance in ${err.category.replace('_', ' ')} estimates (~${err.avgAbsError.toFixed(1)}"). May need more training data.`)
        }
      }
    }

    if (recommendations.length === 0) {
      recommendations.push('Error patterns within acceptable ranges.')
    }

    // Overall stats
    const grossStats = categoryStats.gross_score
    const netStats = categoryStats.net_score
    const overallGrossError = grossStats.errors.length > 0
      ? grossStats.errors.reduce((a, b) => a + b, 0) / grossStats.errors.length
      : 0
    const overallNetError = netStats.errors.length > 0
      ? netStats.errors.reduce((a, b) => a + b, 0) / netStats.errors.length
      : 0
    const overallBias: 'over' | 'under' | 'neutral' =
      overallGrossError > 1 ? 'over' : overallGrossError < -1 ? 'under' : 'neutral'

    return {
      totalSamples: errorRecords.length,
      overallGrossError: Number(overallGrossError.toFixed(2)),
      overallNetError: Number(overallNetError.toFixed(2)),
      overallBias,
      categoryErrors,
      worstCategory,
      bestCategory,
      recommendations,
    }
  } catch (err) {
    console.error('Error getting error patterns:', err)
    return emptyResult
  }
}

/**
 * Get error correction suggestions based on patterns
 */
export function getErrorCorrections(patterns: ErrorPatternSummary): Record<ErrorCategory, number> {
  const corrections: Record<ErrorCategory, number> = {
    spread: 0,
    beams: 0,
    tines_g1: 0,
    tines_g2: 0,
    tines_g3: 0,
    tines_g4: 0,
    tines_g5: 0,
    circumferences: 0,
    gross_score: 0,
    net_score: 0,
  }

  // Only apply corrections if we have enough samples and significant bias
  if (patterns.totalSamples < 10) return corrections

  for (const categoryError of patterns.categoryErrors) {
    // Apply correction that's 50% of the average error (conservative)
    // Negative because we want to correct in opposite direction
    if (categoryError.sampleCount >= 5 && Math.abs(categoryError.avgError) > 0.5) {
      corrections[categoryError.category] = -categoryError.avgError * 0.5
    }
  }

  return corrections
}
