import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { startPrecisionPass } from '@/lib/reverse-engineering/service'

export const runtime = 'nodejs'

/**
 * POST /api/reverse/predictions/[predictionId]/precision-pass
 * Start a precision pass for a prediction
 */
export async function POST(
  _: Request, 
  { params }: { params: Promise<{ predictionId: string }> }
) {
  const { predictionId } = await params
  const supabase = await createClient()
  const { data } = await supabase.auth.getUser()
  const user = data?.user
  
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { run, jobId } = await startPrecisionPass({
      predictionId,
      requestedByUserId: user.id,
    })
    
    return NextResponse.json({ 
      runId: run.id, 
      jobId,
      status: run.status,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to start precision pass'
    const status = message === 'Forbidden' ? 403 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
