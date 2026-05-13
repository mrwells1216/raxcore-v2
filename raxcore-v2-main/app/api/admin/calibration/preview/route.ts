import { NextResponse } from 'next/server'
import { previewCalibrationChanges } from '@/lib/calibration/service'
import type { CalibrationProfile } from '@/lib/types'

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      proposed_profile: Partial<CalibrationProfile>
      validation_run_id?: string
      sample_size?: number
    }
    
    if (!body.proposed_profile) {
      return NextResponse.json(
        { error: 'Proposed profile is required' }, 
        { status: 400 }
      )
    }

    const preview = await previewCalibrationChanges(
      body.proposed_profile,
      body.validation_run_id,
      body.sample_size || 50
    )

    return NextResponse.json({ preview })
  } catch (error) {
    console.error('Preview calibration error:', error)
    return NextResponse.json(
      { error: 'Failed to preview calibration changes' }, 
      { status: 500 }
    )
  }
}
