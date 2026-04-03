import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { buildCalibrationProfile } from '@/lib/calibration/build-calibration-profile'

export async function POST() {
  const supabase = await createClient()

  const { data: samples, error } = await supabase
    .from('training_samples')
    .select('input,ai_output,ground_truth')

  if (error) {
    console.error('[calibration] failed to load training samples', error)
    return NextResponse.json({ error: 'Failed to load training samples' }, { status: 500 })
  }

  const profile = buildCalibrationProfile(samples ?? [])
  if (!profile) {
    return NextResponse.json({
      ok: true,
      message: 'Not enough usable samples to build calibration profile',
    })
  }

  const profileKey = 'global_default'

  const { error: upsertError } = await supabase
    .from('calibration_profiles')
    .upsert({
      profile_key: profileKey,
      scope: { level: 'global' },
      sample_count: profile.sample_count,
      gross_bias: profile.gross_bias,
      net_bias: profile.net_bias,
      gross_mae: profile.gross_mae,
      net_mae: profile.net_mae,
      confidence_scale: profile.confidence_scale,
      is_active: true,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'profile_key',
    })

  if (upsertError) {
    console.error('[calibration] failed to save profile', upsertError)
    return NextResponse.json({ error: 'Failed to save calibration profile' }, { status: 500 })
  }

  console.log('[calibration] profile rebuilt', profile)

  return NextResponse.json({
    ok: true,
    profile,
  })
}
