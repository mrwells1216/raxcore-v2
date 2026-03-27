import { NextRequest, NextResponse } from 'next/server'
import {
  getBulkValidationRun,
  getBulkValidationResults,
  deleteBulkValidationRun,
  updateBulkRunStatus,
  buildComparisonDetails,
} from '@/lib/validation/bulk-service'

// GET /api/admin/bulk-validation/runs/[id] - Get bulk validation run details
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { searchParams } = new URL(request.url)
    const includeResults = searchParams.get('includeResults') === 'true'
    const resultsLimit = parseInt(searchParams.get('resultsLimit') || '50')
    const resultsOffset = parseInt(searchParams.get('resultsOffset') || '0')
    const state = searchParams.get('state') || undefined
    const rackType = searchParams.get('rackType') || undefined

    const run = await getBulkValidationRun(id)

    if (!run) {
      return NextResponse.json(
        { success: false, error: 'Bulk validation run not found' },
        { status: 404 }
      )
    }

    let results = null
    let resultsCount = 0
    let comparisonDetails = null

    if (includeResults) {
      const { data, count } = await getBulkValidationResults(id, {
        limit: resultsLimit,
        offset: resultsOffset,
        state,
        rackType,
      })
      results = data
      resultsCount = count

      // Build comparison details for model comparison runs
      if (run.run_type === 'model_comparison' && data.length > 0) {
        comparisonDetails = buildComparisonDetails(data, run.primary_model_version_id)
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        run,
        results,
        resultsCount,
        comparisonDetails,
      },
    })
  } catch (error) {
    console.error('Error getting bulk validation run:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to get bulk validation run' },
      { status: 500 }
    )
  }
}

// DELETE /api/admin/bulk-validation/runs/[id] - Delete a bulk validation run
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const run = await getBulkValidationRun(id)

    if (!run) {
      return NextResponse.json(
        { success: false, error: 'Bulk validation run not found' },
        { status: 404 }
      )
    }

    // Only allow deleting non-running runs
    if (run.status === 'running') {
      return NextResponse.json(
        { success: false, error: 'Cannot delete a running validation run' },
        { status: 400 }
      )
    }

    await deleteBulkValidationRun(id)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting bulk validation run:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to delete bulk validation run' },
      { status: 500 }
    )
  }
}

// PATCH /api/admin/bulk-validation/runs/[id] - Update run status (cancel)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { action } = body as { action: 'cancel' }

    const run = await getBulkValidationRun(id)

    if (!run) {
      return NextResponse.json(
        { success: false, error: 'Bulk validation run not found' },
        { status: 404 }
      )
    }

    if (action === 'cancel') {
      if (run.status !== 'running' && run.status !== 'pending') {
        return NextResponse.json(
          { success: false, error: 'Only pending or running runs can be cancelled' },
          { status: 400 }
        )
      }

      await updateBulkRunStatus(id, 'cancelled', 'Run cancelled by user')

      return NextResponse.json({ success: true })
    }

    return NextResponse.json(
      { success: false, error: 'Invalid action' },
      { status: 400 }
    )
  } catch (error) {
    console.error('Error updating bulk validation run:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to update bulk validation run' },
      { status: 500 }
    )
  }
}
