/**
 * Human Review Types
 * 
 * Browser-safe type definitions for review sheets.
 * Can be safely imported in client components.
 */

import type { ScoreSheet } from '@/lib/scoring/score-sheet'

export type ReviewerType = 'human' | 'expert' | 'automated'
export type ReviewStatus = 'draft' | 'final' | 'archived'

export type LearningScoreSource =
  | 'official_score_sheet'
  | 'manual_exact_measurements'
  | 'approximate_user_estimate'
  | 'unknown'

export type LearningScorePrecision =
  | 'exact'
  | 'approximate'
  | 'rough_estimate'
  | 'unknown'

export interface ApproximateLearningScoreInput {
  grossScore: number | null
  netScore: number | null
  source: LearningScoreSource
  precision: LearningScorePrecision
  notes?: string | null
}

export interface ApproximateLearningScoreMetadata extends ApproximateLearningScoreInput {
  learningWeight: number
  learningUse: 'aggregate_score_comparison_only'
  fieldLevelCalibration: false
  verifiedScoreEligible: false
  note: string
}

export const APPROXIMATE_SCORE_LEARNING_NOTE =
  'Aggregate approximate score only - not suitable for field-level calibration.'

export function normalizeOptionalScore(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  if (n < 0 || n > 400) return null
  return Math.round(n * 10) / 10
}

function hasProvidedScoreValue(value: unknown): boolean {
  if (value === null || value === undefined) return false
  return typeof value === 'string' ? value.trim() !== '' : true
}

export function normalizeLearningScoreSource(value: unknown): LearningScoreSource {
  if (
    value === 'official_score_sheet' ||
    value === 'manual_exact_measurements' ||
    value === 'approximate_user_estimate' ||
    value === 'unknown'
  ) {
    return value
  }

  return 'approximate_user_estimate'
}

export function normalizeLearningScorePrecision(value: unknown): LearningScorePrecision {
  if (
    value === 'exact' ||
    value === 'approximate' ||
    value === 'rough_estimate' ||
    value === 'unknown'
  ) {
    return value
  }

  return 'approximate'
}

export function getLearningScoreWeight(
  sourceOrInput: LearningScoreSource | ApproximateLearningScoreInput | null | undefined,
  precisionArg?: LearningScorePrecision
): number {
  const source =
    typeof sourceOrInput === 'string'
      ? sourceOrInput
      : sourceOrInput?.source ?? 'unknown'
  const precision =
    typeof sourceOrInput === 'string'
      ? precisionArg ?? 'unknown'
      : sourceOrInput?.precision ?? 'unknown'

  if (source === 'official_score_sheet' && precision === 'exact') return 1.0
  if (source === 'manual_exact_measurements' && precision === 'exact') return 0.85
  if (source === 'approximate_user_estimate' && precision === 'approximate') return 0.35
  if (source === 'approximate_user_estimate' && precision === 'rough_estimate') return 0.18
  return 0.1
}

export function getLearningScoreWeightLabel(weight: number): string {
  if (weight >= 0.85) return 'High'
  if (weight >= 0.35) return 'Low'
  if (weight >= 0.18) return 'Very low'
  return 'Minimal'
}

export function parseApproximateLearningScoreInput(input: unknown): {
  value: ApproximateLearningScoreMetadata | null
  error: string | null
} {
  if (!input || typeof input !== 'object') {
    return { value: null, error: null }
  }

  const record = input as Record<string, unknown>
  const rawGross = record.grossScore ?? record.gross_score
  const rawNet = record.netScore ?? record.net_score
  const grossProvided = hasProvidedScoreValue(rawGross)
  const netProvided = hasProvidedScoreValue(rawNet)

  if (!grossProvided && !netProvided) {
    return { value: null, error: null }
  }

  const grossScore = normalizeOptionalScore(rawGross)
  const netScore = normalizeOptionalScore(rawNet)

  if (grossProvided && grossScore === null) {
    return { value: null, error: 'Approximate gross score must be a finite number from 0 to 400.' }
  }

  if (netProvided && netScore === null) {
    return { value: null, error: 'Approximate net score must be a finite number from 0 to 400.' }
  }

  const source = normalizeLearningScoreSource(record.source)
  const precision = normalizeLearningScorePrecision(record.precision)
  const notes = typeof record.notes === 'string' && record.notes.trim()
    ? record.notes.trim()
    : null
  const learningWeight = getLearningScoreWeight(source, precision)

  return {
    value: {
      grossScore,
      netScore,
      source,
      precision,
      notes,
      learningWeight,
      learningUse: 'aggregate_score_comparison_only',
      fieldLevelCalibration: false,
      verifiedScoreEligible: false,
      note: APPROXIMATE_SCORE_LEARNING_NOTE,
    },
    error: null,
  }
}

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
