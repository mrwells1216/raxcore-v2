/**
 * Human Review Types
 * 
 * Browser-safe type definitions for review sheets.
 * Can be safely imported in client components.
 */

import type { ScoreSheet } from '@/lib/scoring/score-sheet'

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
