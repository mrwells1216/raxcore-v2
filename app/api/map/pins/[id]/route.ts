import { NextRequest, NextResponse } from 'next/server'
import { 
  getMapPinById, 
  updateMapPin, 
  deleteMapPin 
} from '@/lib/storage/service'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const pin = await getMapPinById(id)

    if (!pin) {
      return NextResponse.json(
        { error: 'Pin not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({ pin })
  } catch (error) {
    console.error('Error fetching pin:', error)
    return NextResponse.json(
      { error: 'Failed to fetch pin' },
      { status: 500 }
    )
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()

    const success = await updateMapPin(id, body)

    if (!success) {
      return NextResponse.json(
        { error: 'Failed to update pin' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error updating pin:', error)
    return NextResponse.json(
      { error: 'Failed to update pin' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const success = await deleteMapPin(id)

    if (!success) {
      return NextResponse.json(
        { error: 'Failed to delete pin' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting pin:', error)
    return NextResponse.json(
      { error: 'Failed to delete pin' },
      { status: 500 }
    )
  }
}
