'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Loader2, Copy, CheckCircle2, AlertTriangle } from 'lucide-react'
import type { DuplicateClusterWithMembers } from '@/lib/types'

const fetcher = (url: string) => fetch(url).then(res => res.json())

function ClusterTypeBadge({ type }: { type: string }) {
  const variants: Record<string, { variant: 'default' | 'secondary' | 'outline'; label: string }> = {
    exact: { variant: 'default', label: 'Exact Duplicate' },
    near: { variant: 'secondary', label: 'Near Duplicate' },
    suspected: { variant: 'outline', label: 'Suspected' },
  }
  
  const { variant, label } = variants[type] || variants.suspected
  return <Badge variant={variant}>{label}</Badge>
}

export function DuplicatesPanel() {
  const [resolvedFilter, setResolvedFilter] = useState<string>('false')
  const [typeFilter, setTypeFilter] = useState<string>('all')

  const queryParams = new URLSearchParams()
  if (resolvedFilter !== 'all') {
    queryParams.set('resolved', resolvedFilter)
  }
  if (typeFilter !== 'all') {
    queryParams.set('cluster_type', typeFilter)
  }

  const { data, error, isLoading } = useSWR<{
    clusters: DuplicateClusterWithMembers[]
  }>(`/api/admin/health/duplicates?${queryParams}`, fetcher)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        Failed to load duplicate clusters. Please try again.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <Select value={resolvedFilter} onValueChange={setResolvedFilter}>
          <SelectTrigger className="w-[160px] min-h-[44px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="false">Unresolved</SelectItem>
            <SelectItem value="true">Resolved</SelectItem>
          </SelectContent>
        </Select>

        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[160px] min-h-[44px]">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="exact">Exact</SelectItem>
            <SelectItem value="near">Near</SelectItem>
            <SelectItem value="suspected">Suspected</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Clusters */}
      {data.clusters.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Copy className="h-12 w-12 mx-auto mb-4 opacity-20" />
          <p>No duplicate clusters found</p>
          <p className="text-sm">Run health computation to detect duplicates</p>
        </div>
      ) : (
        <Accordion type="single" collapsible className="space-y-2">
          {data.clusters.map((cluster) => (
            <AccordionItem key={cluster.id} value={cluster.id} className="border rounded-lg px-4">
              <AccordionTrigger className="hover:no-underline">
                <div className="flex items-center gap-3 text-left">
                  <ClusterTypeBadge type={cluster.cluster_type} />
                  <span className="font-medium">{cluster.example_count} examples</span>
                  {cluster.is_resolved ? (
                    <CheckCircle2 className="h-4 w-4 text-primary" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                  )}
                  <span className="text-sm text-muted-foreground">{cluster.cluster_reason}</span>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-3 pt-2 pb-4">
                  {/* Cluster details */}
                  <div className="text-sm text-muted-foreground">
                    <p>Created: {new Date(cluster.created_at).toLocaleDateString()}</p>
                    {cluster.is_resolved && (
                      <p>Resolved by: {cluster.resolved_by} on {new Date(cluster.resolved_at!).toLocaleDateString()}</p>
                    )}
                    {cluster.resolution_notes && (
                      <p>Notes: {cluster.resolution_notes}</p>
                    )}
                  </div>

                  {/* Members */}
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Members:</p>
                    {cluster.members.map((member) => (
                      <Card key={member.id} className={member.is_primary ? 'border-primary' : ''}>
                        <CardContent className="p-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              {member.is_primary && (
                                <Badge variant="default" className="text-xs">Primary</Badge>
                              )}
                              <span className="font-mono text-sm">{member.training_example_id.slice(0, 8)}...</span>
                              {member.similarity_score !== null && (
                                <span className="text-xs text-muted-foreground">
                                  {(member.similarity_score * 100).toFixed(0)}% similar
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 text-sm">
                              {member.example && (
                                <>
                                  <Badge variant="outline">
                                    Score: {member.example.health_score?.toFixed(0) ?? 'N/A'}
                                  </Badge>
                                  <Badge variant={member.example.health_tier === 'excellent' || member.example.health_tier === 'good' ? 'default' : 'secondary'}>
                                    {member.example.health_tier}
                                  </Badge>
                                </>
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>

                  {/* Actions */}
                  {!cluster.is_resolved && (
                    <div className="flex gap-2 pt-2">
                      <Button variant="outline" size="sm">
                        Keep Primary Only
                      </Button>
                      <Button variant="outline" size="sm">
                        Keep All (Not Duplicates)
                      </Button>
                    </div>
                  )}
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      )}
    </div>
  )
}
