import { NextResponse } from 'next/server'
import { getMapStats } from '@/lib/storage/service'

export async function GET() {
  try {
    const stats = await getMapStats()
    return NextResponse.json(stats)
  } catch (error) {
    console.warn('[map] remote storage unavailable, using empty fallback', error)
    return NextResponse.json({ total_bucks: 0, total_pins: 0, total_properties: 0 })
  }
}
