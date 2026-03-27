import { NextRequest, NextResponse } from 'next/server'
import {
  createBulkValidationRun,
  listBulkValidationRuns,
  getFilteredTrainingExamples,
} from '@/lib/validation/bulk-service'
import type { BulkValidationFilters } from '@/lib/types'

// GET /api/admin/bulk-validation/runs - List all bulk validation runs
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status') || undefined
    const runType = searchParams.get('runType') || undefined
    const limit = parseInt(searchParams.get('limit') || '20')
    const offset = parseInt(searchParams.get('offset') || '0')

    const { data, count } = await listBulkValidationRuns({ status, runType, limit, offset })

    return NextResponse.json({
      success: true,
      data,
      pagination: {
        total: count,
        limit,
        offset,
        hasMore: offset + data.length < count,
      },
    })
  } catch (error) {
    console.error('Error listing bulk validation runs:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to list bulk validation runs' },
      { status: 500 }
    )
  }
}

// POST /api/admin/bulk-validation/runs - Create a new bulk validation run
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      runName,
      runType = 'single_model',
      primaryModelVersionId,
      comparisonModelVersionIds = [],
      primaryCalibrationProfileId,
      comparisonCalibrationProfileIds = [],
      filters,
    } = body as {
      runName: string
      runType?: 'single_model' | 'model_comparison'
      primaryModelVersionId?: string
      comparisonModelVersionIds?: string[]
      primaryCalibrationProfileId?: string
      comparisonCalibrationProfileIds?: string[]
      filters?: BulkValidationFilters
    }

    if (!runName) {
      return NextResponse.json(
        { success: false, error: 'Run name is required' },
        { status: 400 }
      )
    }

    // Validate comparison runs have comparison models
    if (runType === 'model_comparison' && comparisonModelVersionIds.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Model comparison runs require at least one comparison model' },
        { status: 400 }
      )
    }

    // Get count of eligible training examples
    const examples = await getFilteredTrainingExamples(filters)

    if (examples.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No training examples match the specified filters' },
        { status: 400 }
      )
    }

    const run = await createBulkValidationRun({
      runName,
      runType,
      primaryModelVersionId,
      comparisonModelVersionIds,
      primaryCalibrationProfileId,
      comparisonCalibrationProfileIds,
      filters,
    })

    return NextResponse.json({
      success: true,
      data: run,
      eligibleExamples: examples.length,
    })
  } catch (error) {
    console.error('Error creating bulk validation run:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to create bulk validation run' },
      { status: 500 }
    )
  }
}
