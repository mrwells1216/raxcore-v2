import { NextRequest, NextResponse } from 'next/server'
import { linkTrainingPackToVariant } from '@/lib/sandbox/variant-registry'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json()
    const { trainingPackId } = body

    if (!trainingPackId) {
      return NextResponse.json(
        { error: 'trainingPackId is required' },
        { status: 400 }
      )
    }

    await linkTrainingPackToVariant(params.id, trainingPackId)

    return NextResponse.json({
      success: true,
      message: 'Training pack linked to variant',
    })
  } catch (error) {
    console.error('Error linking pack:', error)
    return NextResponse.json(
      { error: 'Failed to link training pack' },
      { status: 500 }
    )
  }
}
