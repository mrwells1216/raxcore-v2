import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  try {
    const supabase = await createClient()

    // Get photo guidance events
    const { data: events, count } = await supabase
      .from('photo_guidance_events')
      .select('*', { count: 'exact' })
      .order('shown_at', { ascending: false })
      .limit(5000)

    if (!events || events.length === 0) {
      return NextResponse.json({
        totalShown: 0,
        acceptanceRate: null,
        acceptanceTrend: null,
        effectiveness: [],
      })
    }

    // Calculate overall stats
    const totalShown = count || events.length
    const photosAdded = events.filter(e => e.user_action === 'added_photo').length
    const acceptanceRate = totalShown > 0 ? (photosAdded / totalShown) * 100 : 0

    // Group by recommendation type and decision policy
    const groupedData = new Map<string, typeof events>()
    for (const event of events) {
      const key = `${event.recommendation_type}|${event.decision_policy}|${event.target_family || 'none'}`
      if (!groupedData.has(key)) groupedData.set(key, [])
      groupedData.get(key)!.push(event)
    }

    const effectiveness = Array.from(groupedData.entries()).map(([key, items]) => {
      const [recommendationType, decisionPolicy, targetFamily] = key.split('|')
      
      const added = items.filter(i => i.user_action === 'added_photo').length
      const dismissed = items.filter(i => i.user_action === 'dismissed').length
      
      const expectedImprovements = items
        .map(i => i.expected_confidence_improvement)
        .filter((v): v is number => v !== null)
      
      const actualImprovements = items
        .map(i => i.actual_improvement)
        .filter((v): v is number => v !== null)

      const avgExpected = expectedImprovements.length > 0
        ? expectedImprovements.reduce((a, b) => a + b, 0) / expectedImprovements.length
        : 0

      const avgActual = actualImprovements.length > 0
        ? actualImprovements.reduce((a, b) => a + b, 0) / actualImprovements.length
        : null

      return {
        recommendationType,
        decisionPolicy,
        targetFamily: targetFamily === 'none' ? null : targetFamily,
        timesShown: items.length,
        photosAdded: added,
        dismissed,
        acceptanceRate: items.length > 0 ? (added / items.length) * 100 : 0,
        avgExpectedImprovement: avgExpected,
        avgActualImprovement: avgActual,
        improvementDelta: avgActual !== null ? avgActual - avgExpected : null,
      }
    }).sort((a, b) => b.timesShown - a.timesShown)

    return NextResponse.json({
      totalShown,
      acceptanceRate,
      acceptanceTrend: null, // Would calculate from time series
      effectiveness,
    })
  } catch (error) {
    console.error('Error fetching guidance effectiveness:', error)
    return NextResponse.json({
      totalShown: 0,
      acceptanceRate: null,
      acceptanceTrend: null,
      effectiveness: [],
    })
  }
}
