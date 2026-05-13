/**
 * Phase 46: Scheduler API Endpoint
 * 
 * POST /api/jobs/scheduler - Process scheduled jobs
 * Called by Vercel Cron (e.g., every minute)
 */

import { NextResponse } from 'next/server'
import { invokeScheduler } from '@/lib/jobs/scheduler'

export const maxDuration = 30

export async function POST(request: Request) {
  try {
    // Verify cron secret if configured
    const cronSecret = process.env.CRON_SECRET
    if (cronSecret) {
      const authHeader = request.headers.get('authorization')
      if (authHeader !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
    }
    
    const result = await invokeScheduler()
    
    return NextResponse.json({
      success: true,
      ...result,
    })
    
  } catch (error) {
    console.error('[Scheduler API] Error:', error)
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    )
  }
}

// Support GET for simple cron invocations
export async function GET(request: Request) {
  try {
    const cronSecret = process.env.CRON_SECRET
    if (cronSecret) {
      const authHeader = request.headers.get('authorization')
      if (authHeader !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
    }
    
    const result = await invokeScheduler()
    
    return NextResponse.json({
      success: true,
      ...result,
    })
    
  } catch (error) {
    console.error('[Scheduler API] Error:', error)
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    )
  }
}
