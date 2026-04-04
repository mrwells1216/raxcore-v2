import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  buildCalibrationAggregate,
  buildProfileFromRows,
  extractTrainingScores,
} from '@/lib/calibration'

export async function POST() {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('training_samples')
    .select('*')

  if (error) {
    console.error('[calibration] failed loading training samples', error)
    return NextResponse.json(
      { error: 'Failed loading training samples' },
      { status: 500 }
    )
  }

  const rows = buildCalibrationAggregate(data ?? [])

  const profiles: any[] = []

  // Global
  const globalProfile = buildProfileFromRows({
    profileType: 'global',
    rows: rows.map((r) => ({
      aiGross: r.aiGross as number,
      aiNet: r.aiNet as number,
      reviewedGross: r.reviewedGross as number,
      reviewedNet: r.reviewedNet as number,
    })),
  })
  if (globalProfile) profiles.push(globalProfile)

  // State
  const stateGroups = new Map<string, typeof rows>()
  for (const row of rows) {
    if (!row.state) continue
    const key = row.state
    const existing = stateGroups.get(key) ?? []
    existing.push(row)
    stateGroups.set(key, existing)
  }

  for (const [state, groupRows] of stateGroups.entries()) {
    const profile = buildProfileFromRows({
      profileType: 'state',
      state,
      rows: groupRows.map((r) => ({
        aiGross: r.aiGross as number,
        aiNet: r.aiNet as number,
        reviewedGross: r.reviewedGross as number,
        reviewedNet: r.reviewedNet as number,
      })),
    })
    if (profile) profiles.push(profile)
  }

  // Rack Type
  const rackGroups = new Map<string, typeof rows>()
  for (const row of rows) {
    if (!row.rackType) continue
    const key = row.rackType
    const existing = rackGroups.get(key) ?? []
    existing.push(row)
    rackGroups.set(key, existing)
  }

  for (const [rackType, groupRows] of rackGroups.entries()) {
    const profile = buildProfileFromRows({
      profileType: 'rack_type',
      rackType,
      rows: groupRows.map((r) => ({
        aiGross: r.aiGross as number,
        aiNet: r.aiNet as number,
        reviewedGross: r.reviewedGross as number,
        reviewedNet: r.reviewedNet as number,
      })),
    })
    if (profile) profiles.push(profile)
  }

  // State + Rack Type
  const comboGroups = new Map<string, { state: string; rackType: string; rows: typeof rows }>()
  for (const row of rows) {
    if (!row.state || !row.rackType) continue
    const key = `${row.state}::${row.rackType}`
    const existing = comboGroups.get(key)
    if (existing) {
      existing.rows.push(row)
    } else {
      comboGroups.set(key, {
        state: row.state,
        rackType: row.rackType,
        rows: [row],
      })
    }
  }

  for (const [, group] of comboGroups.entries()) {
    const profile = buildProfileFromRows({
      profileType: 'state_rack_type',
      state: group.state,
      rackType: group.rackType,
      rows: group.rows.map((r) => ({
        aiGross: r.aiGross as number,
        aiNet: r.aiNet as number,
        reviewedGross: r.reviewedGross as number,
        reviewedNet: r.reviewedNet as number,
      })),
    })
    if (profile) profiles.push(profile)
  }

  if (!profiles.length) {
    return NextResponse.json({
      ok: true,
      profilesSaved: 0,
      message: 'Not enough training data to build calibration profiles',
    })
  }

  const payload = profiles.map((profile) => ({
    ...profile,
    is_active: true,
    updated_at: new Date().toISOString(),
  }))

  const { error: upsertError } = await supabase
    .from('calibration_profiles')
    .upsert(payload, { onConflict: 'profile_key' })

  if (upsertError) {
    console.error('[calibration] failed saving profiles', upsertError)
    return NextResponse.json(
      { error: 'Failed saving calibration profiles' },
      { status: 500 }
    )
  }

  console.log('[calibration] rebuilt profiles', {
    profilesSaved: payload.length,
  })

  return NextResponse.json({
    ok: true,
    profilesSaved: payload.length,
    profiles: payload,
  })
}
