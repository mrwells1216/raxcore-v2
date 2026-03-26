import { NextResponse } from 'next/server'
import { getMapStats } from '@/lib/storage/service'

export async function GET() {
  try {
    const stats = await getMapStats()
    return NextResponse.json(stats)
  } catch (error) {
    console.error('Error fetching map stats:', error)
    return NextResponse.json(
      { error: 'Failed to fetch map stats' },
      { status: 500 }
    )
  }
}
