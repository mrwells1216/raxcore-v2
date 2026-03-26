import { NextResponse } from 'next/server'
import { getErrorPatterns, getErrorCorrections } from '@/lib/scoring/error-tracking'

export async function GET() {
  try {
    const patterns = await getErrorPatterns(200)
    const corrections = getErrorCorrections(patterns)

    return NextResponse.json({
      patterns,
      corrections,
      generatedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Error fetching error patterns:', error)
    return NextResponse.json(
      { error: 'Failed to fetch error patterns' },
      { status: 500 }
    )
  }
}
