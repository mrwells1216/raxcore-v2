import { NextRequest, NextResponse } from 'next/server'
import {
  executeBulkValidationRun,
  BulkRunNotFoundError,
  BulkRunNotPendingError,
} from '@/lib/validation/bulk-service'

// Scoring every example in a pack can take a while; allow the full window.
export const maxDuration = 300

// POST /api/admin/bulk-validation/runs/[id]/execute - Execute a bulk validation run
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    const data = await executeBulkValidationRun(id)
    return NextResponse.json({ success: true, data })
  } catch (error) {
    if (error instanceof BulkRunNotFoundError) {
      return NextResponse.json(
        { success: false, error: 'Bulk validation run not found' },
        { status: 404 }
      )
    }
    if (error instanceof BulkRunNotPendingError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 400 }
      )
    }
    console.error('Error executing bulk validation run:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to execute bulk validation run' },
      { status: 500 }
    )
  }
}
