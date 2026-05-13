import { NextResponse } from 'next/server'
import { getDatasetHealthSummary, getDatasetHealthTotals } from '@/lib/health'

export async function GET() {
  try {
    const [summary, totals] = await Promise.all([
      getDatasetHealthSummary(),
      getDatasetHealthTotals(),
    ])

    return NextResponse.json({
      summary,
      totals,
    })
  } catch (error) {
    console.error('Failed to get dataset health summary:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get health summary' },
      { status: 500 }
    )
  }
}
