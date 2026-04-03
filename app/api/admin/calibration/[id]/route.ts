import { NextResponse } from 'next/server'
import {
  getCalibrationProfile,
  updateCalibrationProfile,
  activateCalibrationProfile,
  deleteCalibrationProfile,
} from '@/lib/calibration/service'
import type { CalibrationProfileInput } from '@/lib/types'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const profile = await getCalibrationProfile(id)
    
    if (!profile) {
      return NextResponse.json(
        { error: 'Calibration profile not found' }, 
        { status: 404 }
      )
    }

    return NextResponse.json({ profile })
  } catch (error) {
    console.error('Get calibration profile error:', error)
    return NextResponse.json(
      { error: 'Failed to get calibration profile' }, 
      { status: 500 }
    )
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json() as Partial<CalibrationProfileInput> & { reason?: string }
    
    const { reason, ...profileData } = body
    
    const profile = await updateCalibrationProfile(id, profileData, 'admin', reason)
    
    if (!profile) {
      return NextResponse.json(
        { error: 'Failed to update calibration profile' }, 
        { status: 500 }
      )
    }

    return NextResponse.json({ profile })
  } catch (error) {
    console.error('Update calibration profile error:', error)
    return NextResponse.json(
      { error: 'Failed to update calibration profile' }, 
      { status: 500 }
    )
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const success = await deleteCalibrationProfile(id)
    
    if (!success) {
      return NextResponse.json(
        { error: 'Cannot delete active profile' }, 
        { status: 400 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete calibration profile error:', error)
    return NextResponse.json(
      { error: 'Failed to delete calibration profile' }, 
      { status: 500 }
    )
  }
}

// POST to activate
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json() as { action?: string; reason?: string }
    
    if (body.action === 'activate') {
      const success = await activateCalibrationProfile(id, 'admin', body.reason)
      
      if (!success) {
        return NextResponse.json(
          { error: 'Failed to activate calibration profile' }, 
          { status: 500 }
        )
      }

      return NextResponse.json({ success: true })
    }

    return NextResponse.json(
      { error: 'Invalid action' }, 
      { status: 400 }
    )
  } catch (error) {
    console.error('Calibration profile action error:', error)
    return NextResponse.json(
      { error: 'Failed to perform action' }, 
      { status: 500 }
    )
  }
}
