import { NextRequest, NextResponse } from 'next/server'
import { 
  linkBuckToProperty, 
  setBuckPrimaryPin,
  getMapPinsByBuckId,
  getBuckById
} from '@/lib/storage/service'
import { createClient } from '@/lib/supabase/server'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    
    // Get buck with property info
    const { data: buck, error } = await supabase
      .from('bucks')
      .select(`
        *,
        property:properties(*)
      `)
      .eq('id', id)
      .single()

    if (error || !buck) {
      return NextResponse.json(
        { error: 'Buck not found' },
        { status: 404 }
      )
    }

    // Get pins for this buck
    const pins = await getMapPinsByBuckId(id)

    return NextResponse.json({ 
      buck,
      property: buck.property,
      pins 
    })
  } catch (error) {
    console.error('Error fetching buck mapping:', error)
    return NextResponse.json(
      { error: 'Failed to fetch buck mapping data' },
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
    const { property_id, primary_pin_id } = body

    let success = true

    if (property_id !== undefined) {
      success = await linkBuckToProperty(id, property_id)
    }

    if (success && primary_pin_id !== undefined) {
      success = await setBuckPrimaryPin(id, primary_pin_id)
    }

    if (!success) {
      return NextResponse.json(
        { error: 'Failed to update buck mapping' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error updating buck mapping:', error)
    return NextResponse.json(
      { error: 'Failed to update buck mapping' },
      { status: 500 }
    )
  }
}
