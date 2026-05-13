import { NextRequest, NextResponse } from 'next/server'
import { 
  createMapPin, 
  getAllMapPins,
  getMapPinsByPropertyId,
  getMapPinsByBuckId
} from '@/lib/storage/service'
import { validateCoordinate } from '@/lib/mapping/service'

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
    console.warn('[map] remote storage unavailable, using empty fallback', error)
    return NextResponse.json({ pins: [] })
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

    if (
      (latitude !== undefined || longitude !== undefined) &&
      !validateCoordinate({ lat: Number(latitude), lng: Number(longitude) })
    ) {
      return NextResponse.json(
        { error: 'Invalid latitude/longitude' },
        { status: 400 }
      )
    }

    const pin = await createMapPin({
      property_id,
      buck_id,
      label,
      location_type: location_type || 'unknown',
      latitude: latitude === undefined || latitude === null ? undefined : Number(latitude),
      longitude: longitude === undefined || longitude === null ? undefined : Number(longitude),
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
    console.warn('[map] remote storage unavailable, pin not created', error)
    return NextResponse.json(
      { error: 'Failed to create pin' },
      { status: 500 }
    )
  }
}
