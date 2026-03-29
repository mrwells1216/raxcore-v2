'use client'

import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ExternalLink, AlertTriangle, CheckCircle, XCircle, Clock, Loader2 } from 'lucide-react'

interface MVSolution {
  id: string
  method: string
  solution_quality_tier: string
  fallback_used: boolean
  fallback_reason: string | null
  avg_family_disagreement: number | null
  processing_time_ms: number | null
}

interface MVSet {
  id: string
  buck_id: string | null
  prediction_id: string | null
  status: string
  method: string
  image_count: number
  accepted_view_count: number | null
  rejected_view_count: number | null
  graph_connectivity_score: number | null
  processing_time_ms: number | null
  created_at: string
  mv_solution: MVSolution | MVSolution[] | null
}

interface MVSetsListProps {
  sets: MVSet[]
}

function getStatusIcon(status: string) {
  switch (status) {
    case 'completed':
      return <CheckCircle className="h-4 w-4 text-green-600" />
    case 'fallback_used':
      return <AlertTriangle className="h-4 w-4 text-amber-600" />
    case 'failed':
      return <XCircle className="h-4 w-4 text-red-600" />
    case 'running':
    case 'building_graph':
    case 'scoring_pairs':
    case 'fusing_families':
    case 'solving_geometry':
      return <Loader2 className="h-4 w-4 text-blue-600 animate-spin" />
    default:
      return <Clock className="h-4 w-4 text-muted-foreground" />
  }
}

function getQualityBadge(tier: string | null | undefined) {
  if (!tier) return null
  
  const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
    excellent: 'default',
    good: 'secondary',
    fair: 'outline',
    poor: 'destructive',
    fallback: 'destructive',
  }
  
  return (
    <Badge variant={variants[tier] || 'outline'} className="text-xs capitalize">
      {tier}
    </Badge>
  )
}

export function MVSetsList({ sets }: MVSetsListProps) {
  if (sets.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        No multi-view sets found. Multi-view fusion runs will appear here.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Status</TableHead>
            <TableHead>Images</TableHead>
            <TableHead>Connectivity</TableHead>
            <TableHead>Quality</TableHead>
            <TableHead>Method</TableHead>
            <TableHead>Disagreement</TableHead>
            <TableHead>Time</TableHead>
            <TableHead>Created</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sets.map(set => {
            const solution = Array.isArray(set.mv_solution) 
              ? set.mv_solution[0] 
              : set.mv_solution
            
            return (
              <TableRow key={set.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {getStatusIcon(set.status)}
                    <span className="text-sm capitalize">
                      {set.status.replace(/_/g, ' ')}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="text-sm">
                    <span className="font-medium">{set.image_count}</span>
                    <span className="text-muted-foreground ml-1">
                      ({set.accepted_view_count ?? 0} accepted)
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  {set.graph_connectivity_score !== null ? (
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-2 bg-muted rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-primary rounded-full"
                          style={{ width: `${set.graph_connectivity_score * 100}%` }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {(set.graph_connectivity_score * 100).toFixed(0)}%
                      </span>
                    </div>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </TableCell>
                <TableCell>
                  {getQualityBadge(solution?.solution_quality_tier)}
                </TableCell>
                <TableCell>
                  <span className="text-xs font-mono">
                    {(solution?.method ?? set.method).replace(/_/g, ' ')}
                  </span>
                </TableCell>
                <TableCell>
                  {solution?.avg_family_disagreement !== null && solution?.avg_family_disagreement !== undefined ? (
                    <span className={`text-sm ${
                      solution.avg_family_disagreement > 0.5 
                        ? 'text-red-600' 
                        : solution.avg_family_disagreement > 0.3
                        ? 'text-amber-600'
                        : 'text-green-600'
                    }`}>
                      {(solution.avg_family_disagreement * 100).toFixed(0)}%
                    </span>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </TableCell>
                <TableCell>
                  {set.processing_time_ms !== null ? (
                    <span className="text-xs text-muted-foreground">
                      {set.processing_time_ms}ms
                    </span>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </TableCell>
                <TableCell>
                  <span className="text-sm text-muted-foreground">
                    {formatDistanceToNow(new Date(set.created_at), { addSuffix: true })}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm" asChild>
                    <Link href={`/admin/multiview/${set.id}`}>
                      <ExternalLink className="h-4 w-4" />
                    </Link>
                  </Button>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
