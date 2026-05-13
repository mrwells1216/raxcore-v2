import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const supabase = await createClient()

  const predictionId = req.nextUrl.searchParams.get('predictionId')

  if (!predictionId) {
    return NextResponse.json({ error: 'Missing predictionId' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('reverse_runs')
    .select('id,best_summary,completed_at,status')
    .eq('prediction_id', predictionId)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('[latest-run] error', error)
    return NextResponse.json(null)
  }

  return NextResponse.json(data ?? null)
}
