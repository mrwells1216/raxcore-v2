/**
 * Deprecated runtime helper.
 * The canonical calibration runtime now lives in: lib/calibration.ts
 * Kept temporarily only for backward compatibility / migration safety.
 */

import { createClient } from '@/lib/supabase/server'

function bucketImageCount(count: number | null | undefined): string {
  if (!count || count <= 1) return '1'
  if (count === 2) return '2'
  if (count === 3) return '3'
  return '4_plus'
}

export async function getActiveCalibrationProfile(params?: {
  state?: string | null
  rackType?: string | null
  imageCount?: number | null
}) {
  const supabase = await createClient()

  const state = params?.state ?? null
  const rackType = params?.rackType ?? null
  const imageBucket = bucketImageCount(params?.imageCount ?? null)

  const candidateKeys = [
    `segment:${state ?? 'any'}:${rackType ?? 'any'}:${imageBucket}`,
    `segment:${state ?? 'any'}:${rackType ?? 'any'}:any`,
    `segment:any:${rackType ?? 'any'}:any`,
    'global_default',
  ]

  const { data, error } = await supabase
    .from('calibration_profiles')
    .select('*')
    .eq('is_active', true)
    .in('profile_key', candidateKeys)

  if (error) {
    console.warn('[calibration] failed to load active profiles', error)
    return null
  }

  if (!data?.length) return null

  const selected =
    candidateKeys
      .map((key) => data.find((row) => row.profile_key === key))
      .find(Boolean) ?? null

  if (selected) {
    console.log('[calibration] selected profile', {
      profileKey: selected.profile_key,
      sampleCount: selected.sample_count,
    })
  }

  return selected
}
