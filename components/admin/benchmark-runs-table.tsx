'use client'

import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ChevronLeft, ChevronRight, CheckCircle, XCircle, AlertTriangle, Clock, Loader2 } from 'lucide-react'
import type { BenchmarkRunWithDetails } from '@/lib/types'

interface BenchmarkRunsTableProps {
  runs: BenchmarkRunWithDetails[]
  total: number
  page: number
  limit: number
}

export function BenchmarkRunsTable({ runs, total, page, limit }: BenchmarkRunsTableProps) {
  const router = useRouter()
  const totalPages = Math.ceil(total / limit)

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge variant="secondary" className="bg-green-500/10 text-green-600">Completed</Badge>
      case 'running':
        return <Badge variant="secondary" className="bg-blue-500/10 text-blue-600">Running</Badge>
      case 'failed':
        return <Badge variant="destructive">Failed</Badge>
      case 'pending':
        return <Badge variant="outline">Pending</Badge>
      default:
        return <Badge variant="outline">{status}</Badge>
    }
  }

  const getGuardrailBadge = (passed: boolean | null, criticalFailures?: number, warningFailures?: number) => {
    if (passed === null) {
      return <Badge variant="outline" className="gap-1"><Clock className="h-3 w-3" />Pending</Badge>
    }
    if (passed) {
      if (warningFailures && warningFailures > 0) {
        return (
          <Badge variant="secondary" className="bg-yellow-500/10 text-yellow-600 gap-1">
            <AlertTriangle className="h-3 w-3" />
            {warningFailures} Warning(s)
          </Badge>
        )
      }
      return (
        <Badge variant="secondary" className="bg-green-500/10 text-green-600 gap-1">
          <CheckCircle className="h-3 w-3" />
          Passed
        </Badge>
      )
    }
    return (
      <Badge variant="destructive" className="gap-1">
        <XCircle className="h-3 w-3" />
        {criticalFailures} Failed
      </Badge>
    )
  }

  const getPurposeBadge = (purpose: string | null) => {
    switch (purpose) {
      case 'release_candidate':
        return <Badge variant="default">Release Candidate</Badge>
      case 'regression_test':
        return <Badge variant="secondary">Regression Test</Badge>
      case 'ad_hoc':
        return <Badge variant="outline">Ad Hoc</Badge>
      default:
        return <Badge variant="outline">-</Badge>
    }
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  }

  if (runs.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p>No benchmark runs yet.</p>
        <p className="text-sm mt-1">Run a benchmark from the Packs tab to get started.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Pack</TableHead>
              <TableHead>Purpose</TableHead>
              <TableHead>Models</TableHead>
              <TableHead className="text-center">Progress</TableHead>
              <TableHead>Guardrails</TableHead>
              <TableHead>Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((run) => {
              const guardrailResults = run.guardrail_results as { critical_failures?: number; warning_failures?: number } | null
              const progress = run.total_examples > 0 
                ? Math.round((run.processed_examples / run.total_examples) * 100)
                : 0

              return (
                <TableRow
                  key={run.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => router.push(`/admin/benchmarks/runs/${run.id}`)}
                >
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium">{run.pack_name}</span>
                      <span className="text-xs text-muted-foreground">
                        {run.pack_example_count} examples
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>{getPurposeBadge(run.run_purpose)}</TableCell>
                  <TableCell>
                    <div className="flex flex-col text-sm">
                      {run.candidate_model_name && (
                        <span>
                          <span className="text-muted-foreground">Candidate:</span>{' '}
                          {run.candidate_model_name}
                        </span>
                      )}
                      {run.active_model_name && (
                        <span className="text-xs text-muted-foreground">
                          vs {run.active_model_name}
                        </span>
                      )}
                      {!run.candidate_model_name && !run.active_model_name && (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col items-center gap-1 min-w-[100px]">
                      {run.bulk_run_status === 'running' ? (
                        <>
                          <Progress value={progress} className="h-2 w-full" />
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            {progress}%
                          </span>
                        </>
                      ) : (
                        getStatusBadge(run.bulk_run_status)
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {run.bulk_run_status === 'completed'
                      ? getGuardrailBadge(
                          run.all_guardrails_passed,
                          guardrailResults?.critical_failures,
                          guardrailResults?.warning_failures
                        )
                      : <span className="text-muted-foreground">-</span>
                    }
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDate(run.created_at)}
                  </TableCell>
                </TableRow>
              )
            })}
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
              onClick={() => router.push(`/admin/benchmarks?tab=runs&page=${page - 1}`)}
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => router.push(`/admin/benchmarks?tab=runs&page=${page + 1}`)}
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
