import { NextResponse } from 'next/server'
import { listReverseRuns } from '@/lib/reverse-engineering/service'

export const runtime = 'nodejs'

/**
 * GET /api/admin/reverse/runs
 * List all reverse runs for admin review
 */
export async function GET() {
  try {
    const runs = await listReverseRuns(200)
    return NextResponse.json({ runs })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to fetch runs'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
