import { NextResponse } from 'next/server'
import { rollbackModelVersion, getModelVersionsWithCalibration } from '@/lib/calibration/service'
import type { ModelRollbackRequest } from '@/lib/types'

export async function GET() {
  try {
    const models = await getModelVersionsWithCalibration()
    return NextResponse.json({ models })
  } catch (error) {
    console.error('List model versions error:', error)
    return NextResponse.json(
      { error: 'Failed to list model versions' }, 
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as ModelRollbackRequest
    
    if (!body.target_model_version_id) {
      return NextResponse.json(
        { error: 'Target model version ID is required' }, 
        { status: 400 }
      )
    }

    if (!body.reason) {
      return NextResponse.json(
        { error: 'Reason for rollback is required' }, 
        { status: 400 }
      )
    }

    const result = await rollbackModelVersion(body, 'admin')

    if (!result.success) {
      return NextResponse.json(
        { error: 'Rollback failed', warnings: result.warnings }, 
        { status: 500 }
      )
    }

    return NextResponse.json({ result })
  } catch (error) {
    console.error('Model rollback error:', error)
    return NextResponse.json(
      { error: 'Failed to rollback model version' }, 
      { status: 500 }
    )
  }
}
