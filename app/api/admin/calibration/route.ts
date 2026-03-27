import { NextResponse } from 'next/server'
import {
  listCalibrationProfiles,
  createCalibrationProfile,
  getActiveCalibrationProfile,
} from '@/lib/calibration/service'
import type { CalibrationProfileInput } from '@/lib/types'

export async function GET() {
  try {
    const [profiles, activeProfile] = await Promise.all([
      listCalibrationProfiles(),
      getActiveCalibrationProfile(),
    ])
    
    return NextResponse.json({ 
      profiles, 
      active_profile_id: activeProfile?.id || null 
    })
  } catch (error) {
    console.error('List calibration profiles error:', error)
    return NextResponse.json(
      { error: 'Failed to list calibration profiles' }, 
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as CalibrationProfileInput
    
    if (!body.name) {
      return NextResponse.json(
        { error: 'Profile name is required' }, 
        { status: 400 }
      )
    }

    const profile = await createCalibrationProfile(body, 'admin')
    
    if (!profile) {
      return NextResponse.json(
        { error: 'Failed to create calibration profile' }, 
        { status: 500 }
      )
    }

    return NextResponse.json({ profile })
  } catch (error) {
    console.error('Create calibration profile error:', error)
    return NextResponse.json(
      { error: 'Failed to create calibration profile' }, 
      { status: 500 }
    )
  }
}
