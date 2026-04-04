import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  buildCalibrationProfile,
  buildSegmentedCalibrationProfiles,
} from '@/lib/calibration/build-calibration-profile'

export async function POST() {
  const supabase = await createClient()

  const { data: samples, error } = await supabase
    .from('training_samples')
    .select('input,ai_output,ground_truth')

  if (error) {
    console.error('[calibration] failed to load training samples', error)
    return NextResponse.json({ error: 'Failed to load training samples' }, { status: 500 })
  }

  const allSamples = samples ?? []

  const globalProfile = buildCalibrationProfile(allSamples)
  const segmentedProfiles = buildSegmentedCalibrationProfiles(allSamples)

  if (!globalProfile) {
    return NextResponse.json({
      ok: true,
      message: 'Not enough usable samples to build calibration profile',
    })
  }

  const rows = [
    {
      profile_key: 'global_default',
      scope: { level: 'global' },
      sample_count: globalProfile.sample_count,
      gross_bias: globalProfile.gross_bias,
      net_bias: globalProfile.net_bias,
      gross_mae: globalProfile.gross_mae,
      net_mae: globalProfile.net_mae,
      confidence_scale: globalProfile.confidence_scale,
      is_active: true,
      updated_at: new Date().toISOString(),
    },
    ...segmentedProfiles.map((profile) => ({
      profile_key: profile.profile_key,
      scope: profile.scope,
      sample_count: profile.sample_count,
      gross_bias: profile.gross_bias,
      net_bias: profile.net_bias,
      gross_mae: profile.gross_mae,
      net_mae: profile.net_mae,
      confidence_scale: profile.confidence_scale,
      is_active: true,
      updated_at: new Date().toISOString(),
    })),
  ]

  const { error: upsertError } = await supabase
    .from('calibration_profiles')
    .upsert(rows, { onConflict: 'profile_key' })

  if (upsertError) {
    console.error('[calibration] failed to save profiles', upsertError)
    return NextResponse.json({ error: 'Failed to save calibration profiles' }, { status: 500 })
  }

  console.log('[calibration] profiles rebuilt', {
    globalSampleCount: globalProfile.sample_count,
    segmentedCount: segmentedProfiles.length,
  })

  return NextResponse.json({
    ok: true,
    globalProfile,
    segmentedCount: segmentedProfiles.length,
    profilesSaved: rows.length,
  })
}
