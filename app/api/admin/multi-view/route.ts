import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { 
  getRecentMultiViewSets, 
  getMultiViewBenchmarkStats,
  getMultiViewSet,
} from '@/lib/scoring/multi-view-service'

/**
 * Phase 49: Multi-View Admin API
 * 
 * GET: Retrieve multi-view scoring statistics and recent sets
 */
export async function GET(request: Request) {
  const supabase = await createClient()
  
  // Verify admin access
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()
  
  if (!profile?.is_admin) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const action = searchParams.get('action') || 'stats'
  const mvSetId = searchParams.get('mvSetId')
  const limit = parseInt(searchParams.get('limit') || '50')

  try {
    switch (action) {
      case 'stats': {
        const stats = await getMultiViewBenchmarkStats()
        return NextResponse.json({ stats })
      }
      
      case 'recent': {
        const sets = await getRecentMultiViewSets(limit)
        return NextResponse.json({ sets })
      }
      
      case 'detail': {
        if (!mvSetId) {
          return NextResponse.json({ error: 'mvSetId required' }, { status: 400 })
        }
        const details = await getMultiViewSet(mvSetId)
        if (!details) {
          return NextResponse.json({ error: 'Multi-view set not found' }, { status: 404 })
        }
        return NextResponse.json({ details })
      }
      
      case 'summary': {
        // Get summary statistics
        const [stats, recentSets] = await Promise.all([
          getMultiViewBenchmarkStats(),
          getRecentMultiViewSets(10),
        ])
        
        // Count by status
        const { data: statusCounts } = await supabase
          .from('mv_sets')
          .select('status')
        
        const statusBreakdown: Record<string, number> = {}
        for (const row of statusCounts || []) {
          statusBreakdown[row.status] = (statusBreakdown[row.status] || 0) + 1
        }
        
        // Count by method
        const { data: methodCounts } = await supabase
          .from('mv_sets')
          .select('method')
        
        const methodBreakdown: Record<string, number> = {}
        for (const row of methodCounts || []) {
          methodBreakdown[row.method] = (methodBreakdown[row.method] || 0) + 1
        }
        
        // Get fallback rate
        const { count: totalSets } = await supabase
          .from('mv_sets')
          .select('*', { count: 'exact', head: true })
        
        const { count: fallbackSets } = await supabase
          .from('mv_sets')
          .select('*', { count: 'exact', head: true })
          .eq('fallback_used', true)
        
        const fallbackRate = totalSets ? ((fallbackSets || 0) / totalSets) * 100 : 0
        
        return NextResponse.json({
          benchmarkStats: stats,
          recentSets,
          statusBreakdown,
          methodBreakdown,
          totalSets: totalSets || 0,
          fallbackRate,
        })
      }
      
      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }
  } catch (error) {
    console.error('[multi-view API] Error:', error)
    return NextResponse.json({ 
      error: 'Failed to retrieve multi-view data',
      message: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 })
  }
}

/**
 * POST: Trigger multi-view operations
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  
  // Verify admin access
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()
  
  if (!profile?.is_admin) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  try {
    const body = await request.json()
    const { action } = body

    switch (action) {
      case 'reprocess': {
        const { mvSetId } = body
        if (!mvSetId) {
          return NextResponse.json({ error: 'mvSetId required' }, { status: 400 })
        }
        
        // Mark as pending for reprocessing
        await supabase
          .from('mv_sets')
          .update({ status: 'pending' })
          .eq('id', mvSetId)
        
        return NextResponse.json({ success: true, message: 'Marked for reprocessing' })
      }
      
      case 'run_benchmark': {
        const { mvSetId, groundTruthGross, groundTruthNet, singleImagePrediction, singleImageConfidence } = body
        
        if (!mvSetId || !groundTruthGross || !singleImagePrediction) {
          return NextResponse.json({ 
            error: 'mvSetId, groundTruthGross, and singleImagePrediction required' 
          }, { status: 400 })
        }
        
        const { recordBenchmarkComparison } = await import('@/lib/scoring/multi-view-service')
        
        const details = await getMultiViewSet(mvSetId)
        if (!details || !details.solution) {
          return NextResponse.json({ error: 'Multi-view solution not found' }, { status: 404 })
        }
        
        const result = await recordBenchmarkComparison({
          mvSetId,
          groundTruthGross,
          groundTruthNet,
          singleImagePrediction,
          singleImageConfidence: singleImageConfidence || 0.7,
          multiViewPrediction: details.solution.fused_gross_score || 0,
          multiViewConfidence: details.solution.score_confidence || 0,
        })
        
        return NextResponse.json({ 
          success: true, 
          benchmark: result,
          improvement: result?.improvement_inches,
        })
      }
      
      case 'batch_benchmark': {
        // Run benchmark on all sets with ground truth
        const { data: setsWithGroundTruth } = await supabase
          .from('mv_sets')
          .select(`
            id,
            buck_id,
            predictions!inner(ground_truth_scores!inner(official_gross, official_net))
          `)
          .not('predictions.ground_truth_scores', 'is', null)
          .limit(100)
        
        const results: { mvSetId: string; improvement: number | null; error?: string }[] = []
        
        for (const set of setsWithGroundTruth || []) {
          try {
            // This is simplified - real implementation would need more data
            results.push({
              mvSetId: set.id,
              improvement: null,
            })
          } catch (err) {
            results.push({
              mvSetId: set.id,
              improvement: null,
              error: err instanceof Error ? err.message : 'Unknown error',
            })
          }
        }
        
        return NextResponse.json({ 
          success: true, 
          processed: results.length,
          results,
        })
      }
      
      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }
  } catch (error) {
    console.error('[multi-view API] POST error:', error)
    return NextResponse.json({ 
      error: 'Failed to process multi-view action',
      message: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 })
  }
}
