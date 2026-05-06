import { NextRequest, NextResponse } from 'next/server'
import { 
  createProperty, 
  getAllProperties 
} from '@/lib/storage/service'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const state = searchParams.get('state') || undefined
    const propertyType = searchParams.get('property_type') || undefined

    const properties = await getAllProperties({
      state,
      property_type: propertyType
    })

    return NextResponse.json({ properties })
  } catch (error) {
    // Downgrade to warn — properties table may not exist in all environments
    console.warn('[map] getAllProperties error (non-critical):', error)
    return NextResponse.json({ properties: [] })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { name, owner_label, state, county, property_type, acreage, notes } = body

    if (!name) {
      return NextResponse.json(
        { error: 'Property name is required' },
        { status: 400 }
      )
    }

    const property = await createProperty({
      name,
      owner_label,
      state,
      county,
      property_type: property_type || 'unknown',
      acreage,
      notes
    })

    if (!property) {
      return NextResponse.json(
        { error: 'Failed to create property' },
        { status: 500 }
      )
    }

    return NextResponse.json({ id: property.id })
  } catch (error) {
    console.warn('[map] remote storage unavailable, property not created', error)
    return NextResponse.json(
      { error: 'Failed to create property' },
      { status: 500 }
    )
  }
}
