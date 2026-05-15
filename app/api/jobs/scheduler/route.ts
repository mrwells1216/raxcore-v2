import { NextResponse } from 'next/server'
import { invokeScheduler } from '@/lib/jobs/scheduler'
import { verifyQStashRequest } from '@/lib/jobs/qstash-verify'

export const maxDuration = 30

export async function POST(request: Request) {
  if (!await verifyQStashRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const result = await invokeScheduler()
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    console.error('[Scheduler API] Error:', error)
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
    const result = await invokeScheduler()
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    console.error('[Scheduler API] Error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
