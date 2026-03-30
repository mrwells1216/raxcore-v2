import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/db/client'
import { startTrainingPackGeneration } from '@/lib/training-packs/service'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const jobId = await startTrainingPackGeneration(params.id)
    
    return NextResponse.json({
      success: true,
      jobId,
      message: 'Training pack generation started',
    })
  } catch (error) {
    console.error('Error starting pack generation:', error)
    return NextResponse.json(
      { error: 'Failed to start generation' },
      { status: 500 }
    )
  }
}
