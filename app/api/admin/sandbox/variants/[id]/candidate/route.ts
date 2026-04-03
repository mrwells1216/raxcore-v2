import { NextRequest, NextResponse } from 'next/server'
import { markAsCandidate } from '@/lib/sandbox'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const variant = await markAsCandidate(id)
    return NextResponse.json({ variant })
  } catch (error) {
    console.error('Error marking as candidate:', error)
    return NextResponse.json(
      { error: 'Failed to mark as candidate' },
      { status: 500 }
    )
  }
}
