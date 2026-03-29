import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { MVSetsList } from '@/components/admin/mv-sets-list'
import { MVStatsCards } from '@/components/admin/mv-stats-cards'
import { MVQualityChart } from '@/components/admin/mv-quality-chart'

export const metadata = {
  title: 'Multi-View Fusion | RAXcore Admin',
  description: 'Manage and analyze multi-image fusion scoring',
}

async function getMVStats() {
  const supabase = await createClient()
  
  // Get overall stats
  const { data: mvSets } = await supabase
    .from('mv_sets')
    .select('status, method, graph_connectivity_score, image_count, accepted_view_count, rejected_view_count')
  
  const { data: solutions } = await supabase
    .from('mv_solution')
    .select('solution_quality_tier, fallback_used, method, avg_family_disagreement')
  
  const stats = {
    totalSets: mvSets?.length ?? 0,
    completed: mvSets?.filter(s => s.status === 'completed').length ?? 0,
    fallbackUsed: mvSets?.filter(s => s.status === 'fallback_used').length ?? 0,
    failed: mvSets?.filter(s => s.status === 'failed').length ?? 0,
    avgConnectivity: mvSets?.length 
      ? mvSets.reduce((sum, s) => sum + (s.graph_connectivity_score ?? 0), 0) / mvSets.length 
      : 0,
    avgImageCount: mvSets?.length
      ? mvSets.reduce((sum, s) => sum + (s.image_count ?? 0), 0) / mvSets.length
      : 0,
    qualityTiers: {
      excellent: solutions?.filter(s => s.solution_quality_tier === 'excellent').length ?? 0,
      good: solutions?.filter(s => s.solution_quality_tier === 'good').length ?? 0,
      fair: solutions?.filter(s => s.solution_quality_tier === 'fair').length ?? 0,
      poor: solutions?.filter(s => s.solution_quality_tier === 'poor').length ?? 0,
      fallback: solutions?.filter(s => s.solution_quality_tier === 'fallback').length ?? 0,
    },
    methodBreakdown: {
      full_graph_fusion: solutions?.filter(s => s.method === 'full_graph_fusion').length ?? 0,
      subgraph_fusion: solutions?.filter(s => s.method === 'subgraph_fusion').length ?? 0,
      single_view_fallback: solutions?.filter(s => s.method === 'single_view_fallback').length ?? 0,
      weighted_blend: solutions?.filter(s => s.method === 'weighted_blend').length ?? 0,
    },
    avgDisagreement: solutions?.length
      ? solutions.reduce((sum, s) => sum + (s.avg_family_disagreement ?? 0), 0) / solutions.length
      : 0,
  }
  
  return stats
}

async function getRecentMVSets() {
  const supabase = await createClient()
  
  const { data } = await supabase
    .from('mv_sets')
    .select(`
      *,
      mv_solution(*)
    `)
    .order('created_at', { ascending: false })
    .limit(20)
  
  return data ?? []
}

export default async function MultiViewAdminPage() {
  const stats = await getMVStats()
  const recentSets = await getRecentMVSets()
  
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Multi-View Fusion</h1>
        <p className="text-muted-foreground">
          Cross-view geometry solving and multi-image scoring analysis
        </p>
      </div>
      
      {/* Stats Cards */}
      <Suspense fallback={<StatsCardsSkeleton />}>
        <MVStatsCards stats={stats} />
      </Suspense>
      
      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Quality Distribution */}
        <Card>
          <CardHeader>
            <CardTitle>Quality Distribution</CardTitle>
            <CardDescription>
              Solution quality tiers across all multi-view sets
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Suspense fallback={<Skeleton className="h-48" />}>
              <MVQualityChart qualityTiers={stats.qualityTiers} />
            </Suspense>
          </CardContent>
        </Card>
        
        {/* Method Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle>Fusion Methods</CardTitle>
            <CardDescription>
              Which methods are being used for solutions
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {Object.entries(stats.methodBreakdown).map(([method, count]) => (
                <div key={method} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="font-mono text-xs">
                      {method.replace(/_/g, ' ')}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{count}</span>
                    <span className="text-xs text-muted-foreground">
                      ({stats.totalSets > 0 ? ((count / stats.totalSets) * 100).toFixed(1) : 0}%)
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
      
      {/* Recent Sets Table */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Multi-View Sets</CardTitle>
          <CardDescription>
            Latest multi-image fusion scoring runs
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense fallback={<Skeleton className="h-96" />}>
            <MVSetsList sets={recentSets} />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  )
}

function StatsCardsSkeleton() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {[1, 2, 3, 4].map(i => (
        <Card key={i}>
          <CardHeader className="pb-2">
            <Skeleton className="h-4 w-24" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-8 w-16" />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
