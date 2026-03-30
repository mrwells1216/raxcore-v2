import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/db/client'
import { getTrainingPack, getTrainingPackStats, updateTrainingPackStatus } from '@/lib/training-packs/service'

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const pack = await getTrainingPack(params.id)
    if (!pack) {
      return NextResponse.json({ error: 'Pack not found' }, { status: 404 })
    }

    const stats = await getTrainingPackStats(params.id)
    
    return NextResponse.json({
      pack,
      stats,
    })
  } catch (error) {
    console.error('Error fetching training pack:', error)
    return NextResponse.json(
      { error: 'Failed to fetch training pack' },
      { status: 500 }
    )
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json()
    const { status } = body

    if (!status) {
      return NextResponse.json(
        { error: 'Status is required' },
        { status: 400 }
      )
    }

    const updated = await updateTrainingPackStatus(params.id, status)
    return NextResponse.json(updated)
  } catch (error) {
    console.error('Error updating training pack:', error)
    return NextResponse.json(
      { error: 'Failed to update training pack' },
      { status: 500 }
    )
  }
}
