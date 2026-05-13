import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getServiceSupabase } from '@/lib/supabase/admin'
import { startPrecisionPass, executePrecisionPass } from '@/lib/reverse-engineering/service'

export const runtime = 'nodejs'

// Check for development: NODE_ENV=development OR Vercel preview (not production deployment)
const IS_DEV = process.env.NODE_ENV === 'development' || 
  process.env.VERCEL_ENV === 'preview' || 
  process.env.VERCEL_ENV === 'development'
// Dev bypass user ID for anonymous precision passes in development
const DEV_ANON_USER_ID = 'dev-anonymous-user'

/**
 * POST /api/reverse/predictions/[predictionId]/precision-pass
 * Start a precision pass for a prediction.
 * In development, executes the pipeline inline immediately instead of waiting for a worker.
 */
export async function POST(
  req: Request, 
  { params }: { params: Promise<{ predictionId: string }> }
) {
  const { predictionId } = await params
  const supabase = await createClient()
  const { data } = await supabase.auth.getUser()
  const user = data?.user
  
  // In development, allow anonymous access; in production, require auth
  if (!user && !IS_DEV) {
    console.error('[precision-pass] Unauthorized: no user and not in dev mode')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const requesterId = user?.id ?? DEV_ANON_USER_ID

  // Parse optional body — manualOverrides may be included when user has corrected fields
  let manualOverrides: Record<string, unknown> | undefined
  try {
    const body = await req.json().catch(() => ({}))
    if (body?.manualOverrides && typeof body.manualOverrides === 'object') {
      manualOverrides = body.manualOverrides as Record<string, unknown>
    }
  } catch {
    // No body or non-JSON body — fine, overrides are optional
  }

  try {
    console.log('[precision-pass] Starting precision pass', {
      predictionId,
      requesterId,
      isDev: IS_DEV,
      hasUser: !!user,
      hasManualOverrides: !!manualOverrides,
      overrideFields: manualOverrides ? Object.keys(manualOverrides) : [],
    })

    const { run, jobId } = await startPrecisionPass({
      predictionId,
      requestedByUserId: requesterId,
      manualOverrides,
    })
    
    console.log('[precision-pass] Reverse run and job created', {
      runId: run.id,
      jobId,
      status: run.status,
    })

    // DEV-ONLY: execute pipeline inline so results are available immediately
    // without requiring a background worker process.
    if (IS_DEV) {
      console.log('[precision-pass] DEV: executing pipeline inline', { runId: run.id })
      
      try {
        await executePrecisionPass(run.id)
        console.log('[precision-pass] DEV: inline execution completed', { runId: run.id })

        // Mark the durable job as completed so it doesn't stay permanently queued
        const adminSupabase = await getServiceSupabase()
        await adminSupabase
          .from('durable_jobs')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
            result: { inline: true, runId: run.id },
          })
          .eq('id', jobId)

      } catch (execError) {
        const execMsg = execError instanceof Error ? execError.message : 'Inline execution failed'
        console.error('[precision-pass] DEV: inline execution failed', {
          runId: run.id,
          error: execMsg,
          stack: execError instanceof Error ? execError.stack : undefined,
        })
        // Return the runId anyway — the run is now marked failed in DB,
        // polling will surface the failure status to the UI.
        return NextResponse.json({ 
          runId: run.id, 
          jobId,
          status: 'failed',
          devError: execMsg,
        })
      }

      return NextResponse.json({ 
        runId: run.id, 
        jobId,
        status: 'completed',
      })
    }

    // PRODUCTION: return queued status, worker will process asynchronously
    return NextResponse.json({ 
      runId: run.id, 
      jobId,
      status: run.status,
    })

  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to start precision pass'
    const stack = e instanceof Error ? e.stack : undefined
    console.error('[precision-pass] Failed to start precision pass', {
      predictionId,
      requesterId,
      error: message,
      stack,
    })
    const status = message === 'Forbidden' ? 403 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
