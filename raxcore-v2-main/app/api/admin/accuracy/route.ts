import { NextRequest, NextResponse } from 'next/server'
import {
  getAccuracyMetrics,
  getAccuracyBreakdown,
  getErrorDistribution
} from '@/lib/validation/service'

// GET /api/admin/accuracy - Get accuracy dashboard metrics
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const breakdown = searchParams.get('breakdown') as 'state' | 'rack_type' | 'score_bucket' | 'confidence_bucket' | null
    const distribution = searchParams.get('distribution') === 'true'

    // Get specific breakdown
    if (breakdown) {
      const data = await getAccuracyBreakdown(breakdown)
      return NextResponse.json({ success: true, data })
    }

    // Get error distribution
    if (distribution) {
      const data = await getErrorDistribution()
      return NextResponse.json({ success: true, data })
    }

    // Get overall metrics
    const metrics = await getAccuracyMetrics()
    return NextResponse.json({ success: true, data: metrics })
  } catch (error) {
    console.error('Error getting accuracy metrics:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to get accuracy metrics' },
      { status: 500 }
    )
  }
}
