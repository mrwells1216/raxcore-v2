/**
 * Phase 46: Worker API Endpoint
 * 
 * POST /api/jobs/worker - Invoke worker to process jobs
 * Called by Vercel Cron or external scheduler
 */

import { NextResponse } from 'next/server'
import { invokeWorker } from '@/lib/jobs'

// Import pipelines to register them
import '@/lib/jobs/pipelines'

export const maxDuration = 60 // Allow up to 60 seconds for batch processing

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
    
    // Parse optional config from body
    let config = {}
    let maxJobs = 10
    
    try {
      const body = await request.json()
      config = body.config ?? {}
      maxJobs = body.maxJobs ?? 10
    } catch {
      // No body or invalid JSON, use defaults
    }
    
    // Invoke the worker
    const result = await invokeWorker(config, maxJobs)
    
    return NextResponse.json({
      success: true,
      ...result,
    })
    
  } catch (error) {
    console.error('[Worker API] Error:', error)
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    )
  }
}

// Also support GET for simple cron invocations
export async function GET(request: Request) {
  try {
    // Verify cron secret if configured
    const cronSecret = process.env.CRON_SECRET
    if (cronSecret) {
      const authHeader = request.headers.get('authorization')
      if (authHeader !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
    }
    
    const result = await invokeWorker({}, 5)
    
    return NextResponse.json({
      success: true,
      ...result,
    })
    
  } catch (error) {
    console.error('[Worker API] Error:', error)
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    )
  }
}
