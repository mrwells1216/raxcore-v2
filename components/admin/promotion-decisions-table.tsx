'use client'

import { useRouter } from 'next/navigation'
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
import { ChevronLeft, ChevronRight, CheckCircle, XCircle, Clock, ArrowRight } from 'lucide-react'
import type { PromotionDecisionWithDetails } from '@/lib/types'

interface PromotionDecisionsTableProps {
  decisions: PromotionDecisionWithDetails[]
  total: number
  page: number
  limit: number
}

export function PromotionDecisionsTable({ decisions, total, page, limit }: PromotionDecisionsTableProps) {
  const router = useRouter()
  const totalPages = Math.ceil(total / limit)

  const getDecisionBadge = (decision: string) => {
    switch (decision) {
      case 'promote':
        return (
          <Badge variant="secondary" className="bg-green-500/10 text-green-600 gap-1">
            <CheckCircle className="h-3 w-3" />
            Promoted
          </Badge>
        )
      case 'reject':
        return (
          <Badge variant="destructive" className="gap-1">
            <XCircle className="h-3 w-3" />
            Rejected
          </Badge>
        )
      case 'defer':
        return (
          <Badge variant="secondary" className="bg-yellow-500/10 text-yellow-600 gap-1">
            <Clock className="h-3 w-3" />
            Deferred
          </Badge>
        )
      default:
        return <Badge variant="outline">{decision}</Badge>
    }
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  }

  if (decisions.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p>No promotion decisions recorded yet.</p>
        <p className="text-sm mt-1">Decisions are logged when you promote, reject, or defer a model.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Decision</TableHead>
              <TableHead>Models</TableHead>
              <TableHead>Benchmark</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Decided By</TableHead>
              <TableHead>Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {decisions.map((decision) => (
              <TableRow key={decision.id}>
                <TableCell>{getDecisionBadge(decision.decision)}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2 text-sm">
                    {decision.active_model_name && (
                      <span className="text-muted-foreground">{decision.active_model_name}</span>
                    )}
                    {decision.active_model_name && decision.candidate_model_name && (
                      <ArrowRight className="h-3 w-3 text-muted-foreground" />
                    )}
                    {decision.candidate_model_name && (
                      <span className="font-medium">{decision.candidate_model_name}</span>
                    )}
                    {!decision.active_model_name && !decision.candidate_model_name && (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  {decision.benchmark_pack_name ? (
                    <span className="text-sm">{decision.benchmark_pack_name}</span>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </TableCell>
                <TableCell>
                  <p className="text-sm line-clamp-2 max-w-[200px]">
                    {decision.decision_reason || '-'}
                  </p>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {decision.decided_by || 'System'}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {formatDate(decision.decided_at)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {(page - 1) * limit + 1} - {Math.min(page * limit, total)} of {total}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => router.push(`/admin/benchmarks?tab=decisions&page=${page - 1}`)}
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => router.push(`/admin/benchmarks?tab=decisions&page=${page + 1}`)}
            >
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
