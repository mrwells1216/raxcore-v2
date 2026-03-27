import { NextRequest, NextResponse } from 'next/server'
import {
  getValidationRun,
  getValidationSummary,
  deleteValidationRun,
  updateValidationRunStatus
} from '@/lib/validation/service'

// GET /api/admin/validation/runs/[id] - Get validation run details
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { searchParams } = new URL(request.url)
    const includeSummary = searchParams.get('summary') === 'true'

    if (includeSummary) {
      const summary = await getValidationSummary(id)
      if (!summary) {
        return NextResponse.json(
          { success: false, error: 'Validation run not found' },
          { status: 404 }
        )
      }
      return NextResponse.json({ success: true, data: summary })
    }

    const run = await getValidationRun(id)
    if (!run) {
      return NextResponse.json(
        { success: false, error: 'Validation run not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true, data: run })
  } catch (error) {
    console.error('Error getting validation run:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to get validation run' },
      { status: 500 }
    )
  }
}

// PATCH /api/admin/validation/runs/[id] - Update validation run status (cancel)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { action } = body as { action: 'cancel' }

    if (action === 'cancel') {
      await updateValidationRunStatus(id, 'cancelled')
      return NextResponse.json({ success: true, message: 'Validation run cancelled' })
    }

    return NextResponse.json(
      { success: false, error: 'Invalid action' },
      { status: 400 }
    )
  } catch (error) {
    console.error('Error updating validation run:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to update validation run' },
      { status: 500 }
    )
  }
}

// DELETE /api/admin/validation/runs/[id] - Delete validation run
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    await deleteValidationRun(id)
    return NextResponse.json({ success: true, message: 'Validation run deleted' })
  } catch (error) {
    console.error('Error deleting validation run:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to delete validation run' },
      { status: 500 }
    )
  }
}
