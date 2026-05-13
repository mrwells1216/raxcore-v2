import { NextRequest, NextResponse } from 'next/server'
import { runFullHealthComputation, createHealthComputationRun, updateHealthComputationRun } from '@/lib/health'
import { DEFAULT_HEALTH_CONFIG } from '@/lib/types'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    
    const config = {
      ...DEFAULT_HEALTH_CONFIG,
      ...body.config,
    }

    // For a full computation, this might take a while
    // In production, you'd want to use a background job
    const run = await runFullHealthComputation(config)

    return NextResponse.json({ 
      run,
      message: 'Health computation completed successfully'
    })
  } catch (error) {
    console.error('Failed to run health computation:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to compute health' },
      { status: 500 }
    )
  }
}

// Get computation run status
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const runId = searchParams.get('run_id')

    if (!runId) {
      // Return recent runs
      const { createClient } = await import('@/lib/supabase/server')
      const supabase = await createClient()
      
      const { data: runs, error } = await supabase
        .from('health_computation_runs')
        .select('*')
        .order('started_at', { ascending: false })
        .limit(10)

      if (error) throw new Error(error.message)

      return NextResponse.json({ runs })
    }

    // Return specific run
    const { createClient } = await import('@/lib/supabase/server')
    const supabase = await createClient()
    
    const { data: run, error } = await supabase
      .from('health_computation_runs')
      .select('*')
      .eq('id', runId)
      .single()

    if (error) throw new Error(error.message)

    return NextResponse.json({ run })
  } catch (error) {
    console.error('Failed to get computation runs:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get runs' },
      { status: 500 }
    )
  }
}
