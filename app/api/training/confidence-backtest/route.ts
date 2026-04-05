import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { buildConfidenceBacktest } from '@/lib/training/confidence-backtest'

export async function GET() {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('training_samples')
    .select('*')
    .eq('is_official', true)
    .order('reviewed_at', { ascending: false })

  if (error) {
    console.error('[confidence-backtest] failed loading official samples', error)
    return NextResponse.json(
      { error: 'Failed loading official samples' },
      { status: 500 }
    )
  }

  const backtest = buildConfidenceBacktest(data ?? [])

  console.log('[confidence-backtest] built report', {
    totalOfficialSamples: backtest.total_official_samples,
    usableSamples: backtest.usable_samples,
    confidenceOrderingPasses: backtest.confidence_ordering_passes,
  })

  return NextResponse.json({
    ok: true,
    backtest,
  })
}
