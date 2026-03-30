import { NextRequest, NextResponse } from 'next/server'
import { promoteVariant } from '@/lib/sandbox'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json().catch(() => ({}))

    const result = await promoteVariant(
      id,
      body.decided_by,
      body.decision_reason,
      body.gate_evaluation_id
    )

    return NextResponse.json(result)
  } catch (error) {
    console.error('Error promoting variant:', error)
    return NextResponse.json(
      { error: 'Failed to promote variant' },
      { status: 500 }
    )
  }
}
