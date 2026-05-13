import { NextRequest, NextResponse } from 'next/server'
import { rollbackVariant } from '@/lib/sandbox'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json().catch(() => ({}))

    const result = await rollbackVariant(
      id,
      body.decided_by,
      body.decision_reason
    )

    return NextResponse.json(result)
  } catch (error) {
    console.error('Error rolling back variant:', error)
    return NextResponse.json(
      { error: 'Failed to rollback variant' },
      { status: 500 }
    )
  }
}
