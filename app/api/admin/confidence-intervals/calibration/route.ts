import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  try {
    const supabase = await createClient()

    // Get overall interval coverage stats from confidence_interval_validation
    const { data: validationData } = await supabase
      .from('confidence_interval_validation')
      .select('within_band, predicted_band_width, actual_error, calibrated_confidence_percent, interval_profile_type, segment_name')
      .not('ground_truth_gross', 'is', null)
      .limit(5000)

    if (!validationData || validationData.length === 0) {
      // Return mock data structure if no data yet
      return NextResponse.json({
        overallCoverage: null,
        avgBandWidth: null,
        coverageTrend: null,
        calibrationSummary: [],
        familyAnalysis: [],
        segmentPerformance: [],
      })
    }

    // Calculate overall coverage
    const withinBandCount = validationData.filter(v => v.within_band).length
    const overallCoverage = (withinBandCount / validationData.length) * 100

    // Calculate average band width
    const bandWidths = validationData.map(v => v.predicted_band_width).filter(Boolean)
    const avgBandWidth = bandWidths.length > 0
      ? bandWidths.reduce((a, b) => a + b, 0) / bandWidths.length
      : null

    // Group by profile type for calibration summary
    const byProfile = new Map<string, typeof validationData>()
    for (const v of validationData) {
      const key = `${v.interval_profile_type}|${v.segment_name || 'Global'}`
      if (!byProfile.has(key)) byProfile.set(key, [])
      byProfile.get(key)!.push(v)
    }

    const calibrationSummary = Array.from(byProfile.entries()).map(([key, items]) => {
      const [profileType, segmentName] = key.split('|')
      const withinBand = items.filter(i => i.within_band).length
      const highConfMisses = items.filter(i => 
        i.calibrated_confidence_percent >= 70 && !i.within_band
      ).length
      const lowConfHits = items.filter(i =>
        i.calibrated_confidence_percent < 50 && i.within_band
      ).length
      const bandWidthsInGroup = items.map(i => i.predicted_band_width).filter(Boolean)
      const errors = items.map(i => Math.abs(i.actual_error || 0))

      return {
        profileType,
        segmentName: segmentName === 'Global' ? null : segmentName,
        sampleCount: items.length,
        coveragePercent: (withinBand / items.length) * 100,
        avgBandWidth: bandWidthsInGroup.length > 0
          ? bandWidthsInGroup.reduce((a, b) => a + b, 0) / bandWidthsInGroup.length
          : 0,
        avgActualError: errors.length > 0
          ? errors.reduce((a, b) => a + b, 0) / errors.length
          : 0,
        highConfMisses,
        lowConfHits,
      }
    }).sort((a, b) => b.sampleCount - a.sampleCount)

    // Get segment metrics for family analysis
    const { data: segmentMetrics } = await supabase
      .from('segment_metrics')
      .select('segment_id, spread_avg_error, beam_avg_error, tine_avg_error, mass_avg_error, deduction_avg_error, interval_coverage_80')
      .order('evaluated_at', { ascending: false })
      .limit(100)

    // Aggregate family-level data
    const families = ['spread', 'beam', 'tine', 'mass', 'deduction']
    const familyAnalysis = families.map(family => {
      const fieldName = `${family}_avg_error` as keyof typeof segmentMetrics[0]
      const errors = (segmentMetrics ?? [])
        .map(m => m[fieldName] as number | null)
        .filter((e): e is number => e !== null)

      return {
        family,
        avgConfidence: 60, // Placeholder - would come from predictions data
        avgError: errors.length > 0 ? errors.reduce((a, b) => a + b, 0) / errors.length : 0,
        sampleCount: errors.length,
        withinBandPercent: 75, // Placeholder
      }
    })

    // Get segment residual profiles for segment performance
    const { data: residualProfiles } = await supabase
      .from('segment_residual_profiles')
      .select(`
        segment_id,
        sample_count,
        avg_abs_gross_error,
        p90_gross_error,
        interval_coverage_80,
        interval_coverage_95
      `)
      .order('sample_count', { ascending: false })
      .limit(50)

    // Get segment names
    const segmentIds = (residualProfiles ?? []).map(p => p.segment_id).filter(Boolean)
    const { data: segments } = await supabase
      .from('calibration_segments')
      .select('id, name, level')
      .in('id', segmentIds)

    const segmentMap = new Map((segments ?? []).map(s => [s.id, s]))

    const segmentPerformance = (residualProfiles ?? []).map(p => {
      const seg = segmentMap.get(p.segment_id)
      return {
        segmentId: p.segment_id,
        segmentName: seg?.name || 'Unknown',
        level: seg?.level || 0,
        sampleCount: p.sample_count,
        avgAbsError: p.avg_abs_gross_error || 0,
        p90Error: p.p90_gross_error || 0,
        intervalCoverage80: p.interval_coverage_80,
        intervalCoverage95: p.interval_coverage_95,
      }
    })

    return NextResponse.json({
      overallCoverage,
      avgBandWidth,
      coverageTrend: null, // Would calculate from historical data
      calibrationSummary,
      familyAnalysis,
      segmentPerformance,
    })
  } catch (error) {
    console.error('Error fetching confidence interval calibration:', error)
    return NextResponse.json({
      overallCoverage: null,
      avgBandWidth: null,
      coverageTrend: null,
      calibrationSummary: [],
      familyAnalysis: [],
      segmentPerformance: [],
    })
  }
}
