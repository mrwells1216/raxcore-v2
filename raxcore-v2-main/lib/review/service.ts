/**
 * Human Review Score Sheets Service (Server-Only)
 * 
 * Handles creation, update, and retrieval of human-reviewed/corrected
 * measurement breakdowns for training truth.
 * 
 * This file is server-only. For client code, use ./types.ts and ./client.ts
 */

import 'server-only'

import { createClient } from '@/lib/supabase/server'
import type { ScoreSheet } from '@/lib/scoring/score-sheet'

// Re-export types for server usage
export type {
  ReviewerType,
  ReviewStatus,
  CorrectedMeasurements,
  MeasurementNotes,
  HumanReviewSheet,
  CreateReviewSheetInput,
  UpdateReviewSheetInput,
} from './types'

// Re-export utility functions for server usage
export {
  extractMeasurementsFromScoreSheet,
  calculateGrossScore,
  calculateNetScore,
  calculateSymmetryDeductions,
} from './client'

// Import types for internal use
import type {
  ReviewerType,
  ReviewStatus,
  CorrectedMeasurements,
  MeasurementNotes,
  HumanReviewSheet,
  CreateReviewSheetInput,
  UpdateReviewSheetInput,
} from './types'

import { extractMeasurementsFromScoreSheet } from './client'

// ============================================================================
// DATABASE OPERATIONS
// ============================================================================

/**
 * Get existing review sheet for a prediction
 */
export async function getReviewSheetByPrediction(
  predictionId: string
): Promise<HumanReviewSheet | null> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('human_review_sheets')
    .select('*')
    .eq('prediction_id', predictionId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()
  
  if (error && error.code !== 'PGRST116') {
    console.error('[review-service] Error fetching review sheet:', error)
    return null
  }
  
  if (!data) return null
  
  return mapDbRowToReviewSheet(data)
}

/**
 * Get all review sheets for a buck
 */
export async function getReviewSheetsByBuck(
  buckId: string
): Promise<HumanReviewSheet[]> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('human_review_sheets')
    .select('*')
    .eq('buck_id', buckId)
    .order('created_at', { ascending: false })
  
  if (error) {
    console.error('[review-service] Error fetching review sheets:', error)
    return []
  }
  
  return (data ?? []).map(mapDbRowToReviewSheet)
}

/**
 * Get a review sheet by ID
 */
export async function getReviewSheetById(id: string): Promise<HumanReviewSheet | null> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('human_review_sheets')
    .select('*')
    .eq('id', id)
    .single()
  
  if (error) {
    console.error('[review-service] Error fetching review sheet by ID:', error)
    return null
  }
  
  return data ? mapDbRowToReviewSheet(data) : null
}

/**
 * Create a new review sheet
 */
export async function createReviewSheet(
  input: CreateReviewSheetInput
): Promise<HumanReviewSheet | null> {
  const supabase = await createClient()
  
  // Extract initial corrected measurements from AI score sheet
  const initialMeasurements = extractMeasurementsFromScoreSheet(input.ai_score_sheet)
  
  const insertData = {
    buck_id: input.buck_id,
    prediction_id: input.prediction_id,
    reviewer_type: 'human' as const,
    review_status: 'draft' as const,
    ai_score_sheet: input.ai_score_sheet,
    ai_gross_score: input.ai_gross_score,
    ai_net_score: input.ai_net_score,
    ai_confidence: input.ai_confidence,
    corrected_score_sheet: input.ai_score_sheet, // Start with AI values
    corrected_gross_score: input.ai_gross_score,
    corrected_net_score: input.ai_net_score,
    // Flat corrected measurements
    corrected_inside_spread: initialMeasurements.inside_spread,
    corrected_main_beam_left: initialMeasurements.main_beam_left,
    corrected_main_beam_right: initialMeasurements.main_beam_right,
    corrected_g1_left: initialMeasurements.g1_left,
    corrected_g1_right: initialMeasurements.g1_right,
    corrected_g2_left: initialMeasurements.g2_left,
    corrected_g2_right: initialMeasurements.g2_right,
    corrected_g3_left: initialMeasurements.g3_left,
    corrected_g3_right: initialMeasurements.g3_right,
    corrected_g4_left: initialMeasurements.g4_left,
    corrected_g4_right: initialMeasurements.g4_right,
    corrected_g5_left: initialMeasurements.g5_left,
    corrected_g5_right: initialMeasurements.g5_right,
    corrected_h1_left: initialMeasurements.h1_left,
    corrected_h1_right: initialMeasurements.h1_right,
    corrected_h2_left: initialMeasurements.h2_left,
    corrected_h2_right: initialMeasurements.h2_right,
    corrected_h3_left: initialMeasurements.h3_left,
    corrected_h3_right: initialMeasurements.h3_right,
    corrected_h4_left: initialMeasurements.h4_left,
    corrected_h4_right: initialMeasurements.h4_right,
    corrected_abnormal_points: initialMeasurements.abnormal_points,
    corrected_deductions: initialMeasurements.deductions,
    rack_type: input.rack_type ?? input.ai_score_sheet.metadata.rack_type,
    main_frame_points: input.main_frame_points ?? input.ai_score_sheet.metadata.main_frame_points,
    abnormal_point_count: input.ai_score_sheet.abnormal_points.count,
  }
  
  const { data, error } = await supabase
    .from('human_review_sheets')
    .insert(insertData)
    .select()
    .single()
  
  if (error) {
    console.error('[review-service] Error creating review sheet:', error)
    return null
  }
  
  return data ? mapDbRowToReviewSheet(data) : null
}

/**
 * Update a review sheet
 */
export async function updateReviewSheet(
  id: string,
  input: UpdateReviewSheetInput
): Promise<HumanReviewSheet | null> {
  const supabase = await createClient()
  
  // Build update object
  const updateData: Record<string, unknown> = {}
  
  if (input.corrected_measurements) {
    const m = input.corrected_measurements
    if (m.inside_spread !== undefined) updateData.corrected_inside_spread = m.inside_spread
    if (m.main_beam_left !== undefined) updateData.corrected_main_beam_left = m.main_beam_left
    if (m.main_beam_right !== undefined) updateData.corrected_main_beam_right = m.main_beam_right
    if (m.g1_left !== undefined) updateData.corrected_g1_left = m.g1_left
    if (m.g1_right !== undefined) updateData.corrected_g1_right = m.g1_right
    if (m.g2_left !== undefined) updateData.corrected_g2_left = m.g2_left
    if (m.g2_right !== undefined) updateData.corrected_g2_right = m.g2_right
    if (m.g3_left !== undefined) updateData.corrected_g3_left = m.g3_left
    if (m.g3_right !== undefined) updateData.corrected_g3_right = m.g3_right
    if (m.g4_left !== undefined) updateData.corrected_g4_left = m.g4_left
    if (m.g4_right !== undefined) updateData.corrected_g4_right = m.g4_right
    if (m.g5_left !== undefined) updateData.corrected_g5_left = m.g5_left
    if (m.g5_right !== undefined) updateData.corrected_g5_right = m.g5_right
    if (m.h1_left !== undefined) updateData.corrected_h1_left = m.h1_left
    if (m.h1_right !== undefined) updateData.corrected_h1_right = m.h1_right
    if (m.h2_left !== undefined) updateData.corrected_h2_left = m.h2_left
    if (m.h2_right !== undefined) updateData.corrected_h2_right = m.h2_right
    if (m.h3_left !== undefined) updateData.corrected_h3_left = m.h3_left
    if (m.h3_right !== undefined) updateData.corrected_h3_right = m.h3_right
    if (m.h4_left !== undefined) updateData.corrected_h4_left = m.h4_left
    if (m.h4_right !== undefined) updateData.corrected_h4_right = m.h4_right
    if (m.abnormal_points !== undefined) updateData.corrected_abnormal_points = m.abnormal_points
    if (m.deductions !== undefined) updateData.corrected_deductions = m.deductions
  }
  
  if (input.corrected_gross_score !== undefined) updateData.corrected_gross_score = input.corrected_gross_score
  if (input.corrected_net_score !== undefined) updateData.corrected_net_score = input.corrected_net_score
  if (input.review_status !== undefined) updateData.review_status = input.review_status
  if (input.review_notes !== undefined) updateData.review_notes = input.review_notes
  if (input.measurement_notes !== undefined) updateData.measurement_notes = input.measurement_notes
  if (input.rack_type !== undefined) updateData.rack_type = input.rack_type
  if (input.main_frame_points !== undefined) updateData.main_frame_points = input.main_frame_points
  if (input.abnormal_point_count !== undefined) updateData.abnormal_point_count = input.abnormal_point_count
  if (input.is_training_truth !== undefined) updateData.is_training_truth = input.is_training_truth
  if (input.training_weight !== undefined) updateData.training_weight = input.training_weight
  
  const { data, error } = await supabase
    .from('human_review_sheets')
    .update(updateData)
    .eq('id', id)
    .select()
    .single()
  
  if (error) {
    console.error('[review-service] Error updating review sheet:', error)
    return null
  }
  
  return data ? mapDbRowToReviewSheet(data) : null
}

/**
 * Get all finalized review sheets for training
 */
export async function getFinalizedReviewSheets(
  options: { limit?: number; onlyTrainingTruth?: boolean } = {}
): Promise<HumanReviewSheet[]> {
  const supabase = await createClient()
  
  let query = supabase
    .from('human_review_sheets')
    .select('*')
    .eq('review_status', 'final')
  
  if (options.onlyTrainingTruth) {
    query = query.eq('is_training_truth', true)
  }
  
  if (options.limit) {
    query = query.limit(options.limit)
  }
  
  const { data, error } = await query.order('created_at', { ascending: false })
  
  if (error) {
    console.error('[review-service] Error fetching finalized review sheets:', error)
    return []
  }
  
  return (data ?? []).map(mapDbRowToReviewSheet)
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Map database row to HumanReviewSheet type
 */
function mapDbRowToReviewSheet(row: Record<string, unknown>): HumanReviewSheet {
  return {
    id: row.id as string,
    buck_id: row.buck_id as string | null,
    prediction_id: row.prediction_id as string | null,
    reviewer_type: row.reviewer_type as ReviewerType,
    review_status: row.review_status as ReviewStatus,
    ai_score_sheet: row.ai_score_sheet as ScoreSheet | null,
    ai_gross_score: row.ai_gross_score as number | null,
    ai_net_score: row.ai_net_score as number | null,
    ai_confidence: row.ai_confidence as number | null,
    corrected_score_sheet: row.corrected_score_sheet as ScoreSheet | null,
    corrected_gross_score: row.corrected_gross_score as number | null,
    corrected_net_score: row.corrected_net_score as number | null,
    corrected_measurements: {
      inside_spread: row.corrected_inside_spread as number | null,
      main_beam_left: row.corrected_main_beam_left as number | null,
      main_beam_right: row.corrected_main_beam_right as number | null,
      g1_left: row.corrected_g1_left as number | null,
      g1_right: row.corrected_g1_right as number | null,
      g2_left: row.corrected_g2_left as number | null,
      g2_right: row.corrected_g2_right as number | null,
      g3_left: row.corrected_g3_left as number | null,
      g3_right: row.corrected_g3_right as number | null,
      g4_left: row.corrected_g4_left as number | null,
      g4_right: row.corrected_g4_right as number | null,
      g5_left: row.corrected_g5_left as number | null,
      g5_right: row.corrected_g5_right as number | null,
      h1_left: row.corrected_h1_left as number | null,
      h1_right: row.corrected_h1_right as number | null,
      h2_left: row.corrected_h2_left as number | null,
      h2_right: row.corrected_h2_right as number | null,
      h3_left: row.corrected_h3_left as number | null,
      h3_right: row.corrected_h3_right as number | null,
      h4_left: row.corrected_h4_left as number | null,
      h4_right: row.corrected_h4_right as number | null,
      abnormal_points: row.corrected_abnormal_points as number | null,
      deductions: row.corrected_deductions as number | null,
    },
    rack_type: row.rack_type as 'typical' | 'non-typical' | null,
    main_frame_points: row.main_frame_points as number | null,
    abnormal_point_count: (row.abnormal_point_count as number) ?? 0,
    review_notes: row.review_notes as string | null,
    measurement_notes: row.measurement_notes as MeasurementNotes | null,
    is_training_truth: (row.is_training_truth as boolean) ?? false,
    training_weight: (row.training_weight as number) ?? 1.0,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  }
}
