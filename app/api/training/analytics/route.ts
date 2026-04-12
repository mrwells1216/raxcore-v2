import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { buildTrainingAnalytics } from '@/lib/training/analytics'

export async function GET() {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('training_samples')
    .select('*')
    .eq('is_official', true)
    .order('reviewed_at', { ascending: false })

  if (error) {
    console.error('[training-analytics] failed loading official training samples', error)
    return NextResponse.json(
      { error: 'Failed loading official training samples' },
      { status: 500 }
    )
  }

  const analytics = buildTrainingAnalytics(data ?? [])

  console.log('[training-analytics] built analytics', {
    totalOfficialSamples: analytics.total_official_samples,
  })

  return NextResponse.json({
    ok: true,
    analytics,
  })
}
