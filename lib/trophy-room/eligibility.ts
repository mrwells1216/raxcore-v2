import 'server-only'
import { getServiceSupabase } from '@/lib/supabase/admin'
import type { TrophyEligibility, TrophyScoringSystem } from './types'

const HIGH_CONFIDENCE_MIN_PERCENT = 75

function inferConfidenceTier(percent: number | null | undefined): string | null {
  if (typeof percent !== 'number' || !isFinite(percent)) return null
  if (percent >= 85) return 'very_high'
  if (percent >= 75) return 'high'
  if (percent >= 60) return 'medium'
  if (percent >= 45) return 'low'
  return 'very_low'
}

function rackTypeToScoringSystem(rackType: string | null | undefined): TrophyScoringSystem {
  // P&Y is a separate organization (bow harvests) — without a recorded harvest
  // method we default to B&C variants.
  if (rackType === 'non-typical') return 'bc_nontypical'
  return 'bc_typical'
}

/**
 * Determines whether a buck is eligible for the Trophy Room.
 * Eligible if:
 *   1. Latest prediction has a confidence_tier in {'high', 'very_high'}, OR
 *   2. The buck has a verified advanced-scoring session (verification_source = 'verified').
 */
export async function checkTrophyEligibility(
  buckId: string,
  userId: string,
): Promise<TrophyEligibility> {
  const supabase = await getServiceSupabase()

  // Verify the buck belongs to this user
  const { data: buck } = await supabase
    .from('bucks')
    .select('id, user_id, rack_type, harvest_method')
    .eq('id', buckId)
    .single()

  if (!buck || buck.user_id !== userId) {
    return {
      eligible: false,
      reason: 'Buck not found or not owned by user.',
      source: null,
      defaultPhotoUrl: null,
      candidatePhotoUrls: [],
      suggestedDisplayGross: null,
      suggestedDisplayNet: null,
      suggestedScoringSystem: null,
      suggestedConfidenceTier: null,
      isVerifiedScore: false,
      predictionId: null,
    }
  }

  // Latest prediction
  const { data: prediction } = await supabase
    .from('predictions')
    .select('id, predicted_gross, predicted_net, confidence_percent, created_at')
    .eq('buck_id', buckId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  // Buck images for the photo picker
  const { data: imageRows } = await supabase
    .from('buck_images')
    .select('public_url, angle_type, created_at')
    .eq('buck_id', buckId)
    .order('created_at', { ascending: true })

  const allUrls = (imageRows ?? [])
    .map((row: { public_url: string | null }) => row.public_url)
    .filter((url: string | null): url is string => typeof url === 'string' && url.length > 0)

  const frontUrl =
    (imageRows ?? []).find((row: { angle_type: string | null; public_url: string | null }) =>
      row.angle_type === 'front' && typeof row.public_url === 'string'
    )?.public_url ?? null

  const defaultPhotoUrl = frontUrl ?? allUrls[0] ?? null

  // Check for verified advanced-scoring session (look at the advanced_score_sessions
  // table if present; fall back to checking predictions for a verification flag).
  let isVerified = false
  try {
    const { data: verifiedSession } = await supabase
      .from('advanced_score_sessions')
      .select('id')
      .eq('buck_id', buckId)
      .eq('verification_status', 'verified')
      .limit(1)
      .maybeSingle()
    isVerified = !!verifiedSession
  } catch {
    isVerified = false
  }

  const confidenceTier = inferConfidenceTier(prediction?.confidence_percent ?? null)
  const isHighConfidence = confidenceTier === 'high' || confidenceTier === 'very_high'

  const suggestedScoringSystem = rackTypeToScoringSystem(buck.rack_type)

  if (isVerified) {
    return {
      eligible: true,
      reason: 'This buck has a Verified Score from advanced scoring.',
      source: 'verified_score',
      defaultPhotoUrl,
      candidatePhotoUrls: allUrls,
      suggestedDisplayGross: prediction?.predicted_gross ?? null,
      suggestedDisplayNet: prediction?.predicted_net ?? null,
      suggestedScoringSystem,
      suggestedConfidenceTier: 'verified',
      isVerifiedScore: true,
      predictionId: prediction?.id ?? null,
    }
  }

  if (isHighConfidence && prediction?.predicted_gross != null && prediction.predicted_gross >= 0) {
    return {
      eligible: true,
      reason: 'This buck scored with high confidence.',
      source: 'high_confidence',
      defaultPhotoUrl,
      candidatePhotoUrls: allUrls,
      suggestedDisplayGross: prediction.predicted_gross,
      suggestedDisplayNet: prediction.predicted_net,
      suggestedScoringSystem,
      suggestedConfidenceTier: confidenceTier,
      isVerifiedScore: false,
      predictionId: prediction.id,
    }
  }

  return {
    eligible: false,
    reason:
      `Confidence too low for Trophy Room${confidenceTier ? ` (${confidenceTier})` : ''}. ` +
      `Run an Advanced Scoring session to verify, or score with clearer photos.`,
    source: null,
    defaultPhotoUrl,
    candidatePhotoUrls: allUrls,
    suggestedDisplayGross: prediction?.predicted_gross ?? null,
    suggestedDisplayNet: prediction?.predicted_net ?? null,
    suggestedScoringSystem,
    suggestedConfidenceTier: confidenceTier,
    isVerifiedScore: false,
    predictionId: prediction?.id ?? null,
  }
}

/** Server-side guard used by the create endpoint to validate user-submitted eligibility claims. */
export function isHighConfidencePercent(percent: number | null | undefined): boolean {
  return typeof percent === 'number' && percent >= HIGH_CONFIDENCE_MIN_PERCENT
}
