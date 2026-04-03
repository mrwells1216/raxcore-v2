import { NextResponse } from 'next/server'
import { listVariantComparisons } from '@/lib/sandbox'

export async function GET() {
  try {
    const { data: comparisons } = await listVariantComparisons({ limit: 50 })

    return NextResponse.json({ comparisons })
  } catch (error) {
    console.error('Error fetching comparisons:', error)
    return NextResponse.json(
      { error: 'Failed to fetch comparisons' },
      { status: 500 }
    )
  }
}
