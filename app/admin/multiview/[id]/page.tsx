export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ArrowLeft, ExternalLink, CheckCircle, AlertTriangle, XCircle } from 'lucide-react'
import { MVViewGraph } from '@/components/admin/mv-view-graph'
import { MVFamilyBreakdown } from '@/components/admin/mv-family-breakdown'
import { MVEdgesTable } from '@/components/admin/mv-edges-table'

interface PageProps {
  params: Promise<{ id: string }>
}

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params
  return {
    title: `Multi-View Set ${id.slice(0, 8)} | RAXcore Admin`,
  }
}

async function getMVSetDetails(id: string) {
  const supabase = await createClient()
  
  const { data: mvSet, error } = await supabase
    .from('mv_sets')
    .select('*')
    .eq('id', id)
    .single()
  
  if (error || !mvSet) return null
  
  const { data: solution } = await supabase
    .from('mv_solution')
    .select('*')
    .eq('mv_set_id', id)
    .single()
  
  const { data: views } = await supabase
    .from('mv_views')
    .select('*')
    .eq('mv_set_id', id)
    .order('image_index')
  
  const { data: edges } = await supabase
    .from('mv_edges')
    .select('*')
    .eq('mv_set_id', id)
    .order('match_quality', { ascending: false })
  
  const { data: familySupport } = await supabase
    .from('mv_family_support')
    .select('*')
    .eq('mv_solution_id', solution?.id)
  
  return {
    mvSet,
    solution,
    views: views ?? [],
    edges: edges ?? [],
    familySupport: familySupport ?? [],
  }
}

function getStatusBadge(status: string) {
  const variants: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: typeof CheckCircle }> = {
    completed: { variant: 'default', icon: CheckCircle },
    fallback_used: { variant: 'secondary', icon: AlertTriangle },
    failed: { variant: 'destructive', icon: XCircle },
  }
  
  const config = variants[status] || { variant: 'outline' as const, icon: null }
  const Icon = config.icon
  
  return (
    <Badge variant={config.variant} className="gap-1 capitalize">
      {Icon && <Icon className="h-3 w-3" />}
      {status.replace(/_/g, ' ')}
    </Badge>
  )
}

export default async function MVSetDetailPage({ params }: PageProps) {
  const { id } = await params
  const data = await getMVSetDetails(id)
  
  if (!data) {
    notFound()
  }
  
  const { mvSet, solution, views, edges, familySupport } = data
  
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/admin/multiview">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              Multi-View Set
            </h1>
            {getStatusBadge(mvSet.status)}
            {solution && (
              <Badge variant="outline" className="capitalize">
                {solution.solution_quality_tier}
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground font-mono">
            {mvSet.id}
          </p>
        </div>
        {mvSet.buck_id && (
          <Button variant="outline" size="sm" asChild>
            <Link href={`/admin/submissions/${mvSet.buck_id}`}>
              <ExternalLink className="h-4 w-4 mr-2" />
              View Buck
            </Link>
          </Button>
        )}
      </div>
      
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Images
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{mvSet.image_count}</div>
            <p className="text-xs text-muted-foreground">
              {mvSet.accepted_view_count} accepted, {mvSet.rejected_view_count} rejected
            </p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Connectivity
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {mvSet.graph_connectivity_score !== null 
                ? `${(mvSet.graph_connectivity_score * 100).toFixed(0)}%`
                : '-'}
            </div>
            <p className="text-xs text-muted-foreground">
              Subgraph: {mvSet.strongest_subgraph_size ?? 0} views
            </p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Disagreement
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {solution?.avg_family_disagreement !== null 
                ? `${(solution.avg_family_disagreement * 100).toFixed(0)}%`
                : '-'}
            </div>
            <p className="text-xs text-muted-foreground">
              Max: {solution?.max_family_disagreement !== null 
                ? `${(solution.max_family_disagreement * 100).toFixed(0)}%`
                : '-'}
            </p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Processing
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {mvSet.processing_time_ms ?? '-'}ms
            </div>
            <p className="text-xs text-muted-foreground">
              Method: {solution?.method?.replace(/_/g, ' ') ?? mvSet.method}
            </p>
          </CardContent>
        </Card>
      </div>
      
      {/* Fallback Info */}
      {solution?.fallback_used && solution.fallback_reason && (
        <Card className="border-amber-500/50 bg-amber-500/5">
          <CardHeader>
            <CardTitle className="text-amber-600 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              Fallback Triggered
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">{solution.fallback_reason}</p>
          </CardContent>
        </Card>
      )}
      
      {/* Tabs */}
      <Tabs defaultValue="graph">
        <TabsList>
          <TabsTrigger value="graph">View Graph</TabsTrigger>
          <TabsTrigger value="families">Family Breakdown</TabsTrigger>
          <TabsTrigger value="edges">Edge Analysis</TabsTrigger>
          <TabsTrigger value="views">Views</TabsTrigger>
        </TabsList>
        
        <TabsContent value="graph" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>View Graph Visualization</CardTitle>
              <CardDescription>
                Node connections and edge weights between views
              </CardDescription>
            </CardHeader>
            <CardContent>
              <MVViewGraph views={views} edges={edges} />
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="families" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Family Fusion Breakdown</CardTitle>
              <CardDescription>
                Per-family primary views, weights, and disagreement
              </CardDescription>
            </CardHeader>
            <CardContent>
              <MVFamilyBreakdown 
                familySupport={familySupport} 
                views={views}
                solution={solution}
              />
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="edges" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Edge Analysis</CardTitle>
              <CardDescription>
                Pairwise view relationships and match quality
              </CardDescription>
            </CardHeader>
            <CardContent>
              <MVEdgesTable edges={edges} views={views} />
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="views" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Individual Views</CardTitle>
              <CardDescription>
                Per-image scoring and contribution details
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {views.map(view => (
                  <div 
                    key={view.id}
                    className={`p-4 rounded-lg border ${
                      view.is_outlier 
                        ? 'border-red-500/50 bg-red-500/5' 
                        : view.is_accepted
                        ? 'border-green-500/50 bg-green-500/5'
                        : 'border-border'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">View {view.image_index}</span>
                          <Badge variant="outline" className="capitalize">
                            {view.angle_class.replace(/_/g, ' ')}
                          </Badge>
                          {view.is_primary_view && (
                            <Badge variant="default">Primary</Badge>
                          )}
                          {view.is_outlier && (
                            <Badge variant="destructive">Outlier</Badge>
                          )}
                          {!view.is_accepted && !view.is_outlier && (
                            <Badge variant="secondary">Rejected</Badge>
                          )}
                        </div>
                        {view.rejection_reason && (
                          <p className="text-sm text-muted-foreground mt-1">
                            {view.rejection_reason}
                          </p>
                        )}
                      </div>
                      <div className="text-right text-sm">
                        <div>Score: {view.view_overall_score?.toFixed(2) ?? '-'}</div>
                        <div className="text-muted-foreground">
                          Ref: {view.reference_quality_score?.toFixed(2) ?? '-'}
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-4 gap-4 mt-4 text-sm">
                      <div>
                        <div className="text-muted-foreground">Spread</div>
                        <div className="font-medium">
                          {view.spread_contribution_score?.toFixed(2) ?? '-'}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Beam</div>
                        <div className="font-medium">
                          {view.beam_contribution_score?.toFixed(2) ?? '-'}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Tine</div>
                        <div className="font-medium">
                          {view.tine_contribution_score?.toFixed(2) ?? '-'}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Mass</div>
                        <div className="font-medium">
                          {view.mass_contribution_score?.toFixed(2) ?? '-'}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
