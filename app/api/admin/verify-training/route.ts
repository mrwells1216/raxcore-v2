import { NextResponse } from 'next/server'
import { verifyTrainingExample, unverifyTrainingExample, getTrainingExampleById } from '@/lib/storage/service'

export async function POST(request: Request) {
  try {
    const { id, verified, quality_score } = await request.json()
    
    if (!id || typeof verified !== 'boolean') {
      return NextResponse.json({ error: 'id and verified are required' }, { status: 400 })
    }

    // Check if example exists
    const existing = await getTrainingExampleById(id)
    if (!existing) {
      return NextResponse.json({ error: 'Training example not found' }, { status: 404 })
    }

    let updated
    if (verified) {
      updated = await verifyTrainingExample(id, 'admin', quality_score)
    } else {
      updated = await unverifyTrainingExample(id)
    }

    return NextResponse.json({ success: true, example: updated })
  } catch (error) {
    console.error('Verify training error:', error)
    return NextResponse.json({ error: 'Failed to verify training example' }, { status: 500 })
  }
}
