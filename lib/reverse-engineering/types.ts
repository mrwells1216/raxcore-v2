import type { Measurements, Prediction, Buck, BuckImage } from '@/lib/types'

export type ReverseMode = 'precision_pass'
export type ReverseRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

export type HypothesisType =
  | 'noop'
  // Scale variants — named individually so UI can show distinct labels
  | 'scale_up'
  | 'scale_down'
  | 'scale'          // kept for backwards compat with stored rows
  // Measurement-specific adjustments
  | 'spread_expand'
  | 'spread_reduce'
  | 'spread'         // kept for backwards compat
  | 'beam_extend'
  | 'beam_reduce'
  | 'beam'           // kept for backwards compat
  | 'tine_extend'
  | 'tine_reduce'
  | 'tine'           // kept for backwards compat
  | 'mass_boost'
  | 'mass_reduce'
  | 'mass'           // kept for backwards compat
  | 'symmetry_beam'
  | 'symmetry_tine'
  | 'deduction_reduce'
  | 'deduction_increase'
  | 'deduction'      // kept for backwards compat
  | 'swap_sides'
  | 'combo'

export interface ReverseRunRow {
  id: string
  prediction_id: string
  buck_id: string | null
  requested_by_user_id: string | null
  mode: ReverseMode
  status: ReverseRunStatus
  baseline_snapshot: Record<string, unknown> | null
  settings: Record<string, unknown> | null
  best_hypothesis_id: string | null
  best_summary: Record<string, unknown> | null
  best_prediction_id: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
  failed_at: string | null
  failure_reason: string | null
}

export interface HypothesisParams {
  scale?: number
  overrides?: Partial<Record<keyof Measurements, number | null>>
  swapSides?: boolean
  symmetrize?: {
    family: 'beam' | 'tine' | 'mass'
    strength: number // 0..1
  }
  notes?: string[]
}

export interface HypothesisCandidateRow {
  id: string
  reverse_run_id: string
  hypothesis_rank: number
  hypothesis_type: HypothesisType
  params: HypothesisParams
  created_at: string
}

export interface HypothesisEvaluationRow {
  id: string
  candidate_id: string
  total_score: number
  geometry_score: number
  change_penalty: number
  plausibility_penalty: number
  predicted_gross: number | null
  predicted_net: number | null
  delta_gross: number | null
  delta_net: number | null
  est_error_band_width: number | null
  flags: Record<string, unknown> | null
  computed_at: string
}

export type ErrorCause =
  | 'scale_reference_weak'
  | 'front_spread_weak'
  | 'side_beams_weak'
  | 'tine_visibility_low'
  | 'occlusion_or_crop_risk'
  | 'lighting_quality_poor'
  | 'asymmetry_confounded'
  | 'domain_shift_risk'
  | 'few_images_low_diversity'

export interface ErrorCauseItem {
  cause: ErrorCause
  weight: number // 0..1
  evidence: string[]
}

export interface ErrorDecompositionRow {
  id: string
  reverse_run_id: string
  causes: ErrorCauseItem[]
  primary_cause: string | null
  confirmed_causes: ErrorCauseItem[] | null
  confirmed_by: string | null
  confirmed_at: string | null
  created_at: string
}

export interface ReverseBaselineBundle {
  buck: Buck
  images: BuckImage[]
  prediction: Prediction
  measurements: Measurements
  baseGross: number
  baseNet: number
}

export interface ReverseRunDetail {
  run: ReverseRunRow
  candidates: HypothesisCandidateRow[]
  evaluations: Record<string, HypothesisEvaluationRow>
  decomposition: ErrorDecompositionRow | null
}
