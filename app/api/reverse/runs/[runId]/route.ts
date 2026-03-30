import { NextResponse } from 'next/server'
import { getReverseRunDetail } from '@/lib/reverse-engineering/service'

export const runtime = 'nodejs'

/**
 * GET /api/reverse/runs/[runId]
 * Get detailed reverse run data including candidates, evaluations, and decomposition
 */
export async function GET(
  _: Request, 
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params
  
  try {
    const detail = await getReverseRunDetail(runId)
    return NextResponse.json(detail)
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to fetch run'
    const status = message === 'Run not found' ? 404 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
