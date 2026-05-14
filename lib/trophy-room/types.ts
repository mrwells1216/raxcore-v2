export type TrophyScoringSystem = 'bc_typical' | 'bc_nontypical' | 'py_typical' | 'py_nontypical'
export type WatermarkStatus = 'pending' | 'generating' | 'ready' | 'failed'

export interface TrophyRoomEntry {
  id: string
  user_id: string
  buck_id: string
  prediction_id: string | null
  display_photo_url: string
  watermarked_url: string | null
  watermark_status: WatermarkStatus
  display_label: string | null
  display_gross: number
  display_net: number | null
  scoring_system: TrophyScoringSystem
  confidence_tier: string
  is_verified_score: boolean
  approved_at: string
  deleted_at: string | null
  created_at: string
  updated_at: string
}

export interface TrophyEligibility {
  eligible: boolean
  reason: string
  source: 'verified_score' | 'high_confidence' | null
  defaultPhotoUrl: string | null
  candidatePhotoUrls: string[]
  suggestedDisplayGross: number | null
  suggestedDisplayNet: number | null
  suggestedScoringSystem: TrophyScoringSystem | null
  suggestedConfidenceTier: string | null
  isVerifiedScore: boolean
  predictionId: string | null
}
