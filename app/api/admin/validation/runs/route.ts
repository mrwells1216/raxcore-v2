import { NextRequest, NextResponse } from 'next/server'
import {
  createValidationRun,
  listValidationRuns,
  getTrainingExamplesForValidation
} from '@/lib/validation/service'
import type { ValidationRunConfig } from '@/lib/types'

// GET /api/admin/validation/runs - List all validation runs
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status') || undefined
    const limit = parseInt(searchParams.get('limit') || '20')
    const offset = parseInt(searchParams.get('offset') || '0')

    const { data, count } = await listValidationRuns({ status, limit, offset })

    return NextResponse.json({
      success: true,
      data,
      pagination: {
        total: count,
        limit,
        offset,
        hasMore: offset + data.length < count
      }
    })
  } catch (error) {
    console.error('Error listing validation runs:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to list validation runs' },
      { status: 500 }
    )
  }
}

// POST /api/admin/validation/runs - Create a new validation run
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { runName, modelVersionId, config } = body as {
      runName: string
      modelVersionId?: string
      config?: ValidationRunConfig
    }

    if (!runName) {
      return NextResponse.json(
        { success: false, error: 'Run name is required' },
        { status: 400 }
      )
    }

    // Get count of eligible training examples
    const examples = await getTrainingExamplesForValidation(config)
    
    if (examples.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No training examples match the specified criteria' },
        { status: 400 }
      )
    }

    const run = await createValidationRun({
      runName,
      modelVersionId,
      config
    })

    return NextResponse.json({
      success: true,
      data: run,
      eligibleExamples: examples.length
    })
  } catch (error) {
    console.error('Error creating validation run:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to create validation run' },
      { status: 500 }
    )
  }
}
