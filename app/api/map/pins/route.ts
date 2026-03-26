import { NextRequest, NextResponse } from 'next/server'
import { 
  createMapPin, 
  getAllMapPins,
  getMapPinsByPropertyId,
  getMapPinsByBuckId
} from '@/lib/storage/service'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const propertyId = searchParams.get('property_id')
    const buckId = searchParams.get('buck_id')
    const locationType = searchParams.get('location_type') || undefined

    let pins

    if (propertyId) {
      pins = await getMapPinsByPropertyId(propertyId)
    } else if (buckId) {
      pins = await getMapPinsByBuckId(buckId)
    } else {
      pins = await getAllMapPins({
        location_type: locationType
      })
    }

    return NextResponse.json({ pins })
  } catch (error) {
    console.error('Error fetching pins:', error)
    return NextResponse.json(
      { error: 'Failed to fetch pins' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { 
      property_id, 
      buck_id, 
      label, 
      location_type, 
      latitude, 
      longitude,
      is_approximate,
      confidence_radius_meters,
      pin_date,
      notes
    } = body

    const pin = await createMapPin({
      property_id,
      buck_id,
      label,
      location_type: location_type || 'unknown',
      latitude,
      longitude,
      is_approximate: is_approximate || false,
      confidence_radius_meters,
      pin_date,
      notes
    })

    if (!pin) {
      return NextResponse.json(
        { error: 'Failed to create pin' },
        { status: 500 }
      )
    }

    return NextResponse.json({ id: pin.id })
  } catch (error) {
    console.error('Error creating pin:', error)
    return NextResponse.json(
      { error: 'Failed to create pin' },
      { status: 500 }
    )
  }
}
