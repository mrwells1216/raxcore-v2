import { NextResponse } from 'next/server'
import { invokeWorker } from '@/lib/jobs'
import { verifyQStashRequest } from '@/lib/jobs/qstash-verify'

// Import pipelines to register them
import '@/lib/jobs/pipelines'

export const maxDuration = 60

export async function POST(request: Request) {
  if (!await verifyQStashRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    let maxJobs = 10
    let config = {}
    try {
      const body = await request.json()
      config = body.config ?? {}
      maxJobs = body.maxJobs ?? 10
    } catch {
      // No body or invalid JSON — use defaults
    }
    const result = await invokeWorker(config, maxJobs)
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    console.error('[Worker API] Error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    )
  }
}

export async function GET(request: Request) {
  if (!await verifyQStashRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const result = await invokeWorker({}, 5)
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    console.error('[Worker API] Error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
