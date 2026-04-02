/**
 * Human Review Score Sheets Service
 * 
 * Handles creation, update, and retrieval of human-reviewed/corrected
 * measurement breakdowns for training truth.
 */

import { createClient } from '@/lib/supabase/server'
import type { ScoreSheet } from '@/lib/scoring/score-sheet'

// ============================================================================
// TYPES
// ============================================================================

export type ReviewerType = 'human' | 'expert' | 'automated'
export type ReviewStatus = 'draft' | 'final' | 'archived'

/**
 * Corrected measurements - flat structure for easy editing
 */
export interface CorrectedMeasurements {
  inside_spread: number | null
  main_beam_left: number | null
  main_beam_right: number | null
  g1_left: number | null
  g1_right: number | null
  g2_left: number | null
  g2_right: number | null
  g3_left: number | null
  g3_right: number | null
  g4_left: number | null
  g4_right: number | null
  g5_left: number | null
  g5_right: number | null
  h1_left: number | null
  h1_right: number | null
  h2_left: number | null
  h2_right: number | null
  h3_left: number | null
  h3_right: number | null
  h4_left: number | null
  h4_right: number | null
  abnormal_points: number | null
  deductions: number | null
}

/**
 * Per-measurement notes/flags
 */
export interface MeasurementNotes {
  [key: string]: {
    note?: string
    flagged?: boolean
    source?: 'ai' | 'corrected' | 'verified'
  }
}

/**
 * Human Review Sheet record
 */
export interface HumanReviewSheet {
  id: string
  buck_id: string | null
  prediction_id: string | null
  
  reviewer_type: ReviewerType
  review_status: ReviewStatus
  
  // AI original data
  ai_score_sheet: ScoreSheet | null
  ai_gross_score: number | null
  ai_net_score: number | null
  ai_confidence: number | null
  
  // Corrected data
  corrected_score_sheet: ScoreSheet | null
  corrected_gross_score: number | null
  corrected_net_score: number | null
  corrected_measurements: CorrectedMeasurements
  
  // Classification
  rack_type: 'typical' | 'non-typical' | null
  main_frame_points: number | null
  abnormal_point_count: number
  
  // Notes
  review_notes: string | null
  measurement_notes: MeasurementNotes | null
  
  // Training
  is_training_truth: boolean
  training_weight: number
  
  // Timestamps
  created_at: string
  updated_at: string
}

/**
 * Input for creating a new review sheet
 */
export interface CreateReviewSheetInput {
  buck_id: string
  prediction_id: string
  ai_score_sheet: ScoreSheet
  ai_gross_score: number
  ai_net_score: number
  ai_confidence: number
  rack_type?: 'typical' | 'non-typical'
  main_frame_points?: number
}

/**
 * Input for updating a review sheet
 */
export interface UpdateReviewSheetInput {
  corrected_measurements?: Partial<CorrectedMeasurements>
  corrected_gross_score?: number
  corrected_net_score?: number
  review_status?: ReviewStatus
  review_notes?: string
  measurement_notes?: MeasurementNotes
  rack_type?: 'typical' | 'non-typical'
  main_frame_points?: number
  abnormal_point_count?: number
  is_training_truth?: boolean
  training_weight?: number
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Extract flat measurements from a ScoreSheet
 */
export function extractMeasurementsFromScoreSheet(sheet: ScoreSheet): CorrectedMeasurements {
  return {
    inside_spread: sheet.spread.inside.value,
    main_beam_left: sheet.left.main_beam.value,
    main_beam_right: sheet.right.main_beam.value,
    g1_left: sheet.left.g1.value,
    g1_right: sheet.right.g1.value,
    g2_left: sheet.left.g2.value,
    g2_right: sheet.right.g2.value,
    g3_left: sheet.left.g3.value,
    g3_right: sheet.right.g3.value,
    g4_left: sheet.left.g4.value,
    g4_right: sheet.right.g4.value,
    g5_left: sheet.left.g5.value,
    g5_right: sheet.right.g5.value,
    h1_left: sheet.left.h1.value,
    h1_right: sheet.right.h1.value,
    h2_left: sheet.left.h2.value,
    h2_right: sheet.right.h2.value,
    h3_left: sheet.left.h3.value,
    h3_right: sheet.right.h3.value,
    h4_left: sheet.left.h4.value,
    h4_right: sheet.right.h4.value,
    abnormal_points: sheet.abnormal_points.total_length.value,
    deductions: sheet.deductions.symmetry_total.value,
  }
}

/**
 * Calculate gross score from measurements
 */
export function calculateGrossScore(m: CorrectedMeasurements): number {
  const spreadCredit = Math.min(
    m.inside_spread ?? 0,
    Math.max(m.main_beam_left ?? 0, m.main_beam_right ?? 0)
  )
  
  const leftTotal = (m.main_beam_left ?? 0) +
    (m.g1_left ?? 0) + (m.g2_left ?? 0) + (m.g3_left ?? 0) + (m.g4_left ?? 0) + (m.g5_left ?? 0) +
    (m.h1_left ?? 0) + (m.h2_left ?? 0) + (m.h3_left ?? 0) + (m.h4_left ?? 0)
  
  const rightTotal = (m.main_beam_right ?? 0) +
    (m.g1_right ?? 0) + (m.g2_right ?? 0) + (m.g3_right ?? 0) + (m.g4_right ?? 0) + (m.g5_right ?? 0) +
    (m.h1_right ?? 0) + (m.h2_right ?? 0) + (m.h3_right ?? 0) + (m.h4_right ?? 0)
  
  return spreadCredit + leftTotal + rightTotal + (m.abnormal_points ?? 0)
}

/**
 * Calculate net score from measurements (typical scoring)
 */
export function calculateNetScore(m: CorrectedMeasurements, rackType: 'typical' | 'non-typical'): number {
  const gross = calculateGrossScore(m)
  
  if (rackType === 'non-typical') {
    // Non-typical: gross - symmetry deductions only
    return gross - (m.deductions ?? 0)
  }
  
  // Typical: gross - symmetry deductions - abnormal points
  return gross - (m.deductions ?? 0) - (m.abnormal_points ?? 0)
}

/**
 * Calculate symmetry deductions
 */
export function calculateSymmetryDeductions(m: CorrectedMeasurements): number {
  const diffs = [
    Math.abs((m.main_beam_left ?? 0) - (m.main_beam_right ?? 0)),
    Math.abs((m.g1_left ?? 0) - (m.g1_right ?? 0)),
    Math.abs((m.g2_left ?? 0) - (m.g2_right ?? 0)),
    Math.abs((m.g3_left ?? 0) - (m.g3_right ?? 0)),
    Math.abs((m.g4_left ?? 0) - (m.g4_right ?? 0)),
    Math.abs((m.g5_left ?? 0) - (m.g5_right ?? 0)),
    Math.abs((m.h1_left ?? 0) - (m.h1_right ?? 0)),
    Math.abs((m.h2_left ?? 0) - (m.h2_right ?? 0)),
    Math.abs((m.h3_left ?? 0) - (m.h3_right ?? 0)),
    Math.abs((m.h4_left ?? 0) - (m.h4_right ?? 0)),
  ]
  return diffs.reduce((sum, d) => sum + d, 0)
}

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
