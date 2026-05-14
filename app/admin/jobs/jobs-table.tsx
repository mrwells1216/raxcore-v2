'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/components/ui/select'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { DurableJob, JobStatus, JobType } from '@/lib/jobs/types'

interface JobsTableProps {
  jobs: DurableJob[]
  currentPage: number
  totalPages: number
  totalCount: number
  statusFilter?: JobStatus
  typeFilter?: JobType
  compact?: boolean
}

const STATUS_COLORS: Record<JobStatus, string> = {
  queued: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  running: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  completed: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  failed: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  cancelled: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  dead_letter: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
}

const PRIORITY_COLORS: Record<string, string> = {
  critical: 'text-red-600 dark:text-red-400',
  high: 'text-orange-600 dark:text-orange-400',
  normal: 'text-foreground',
  low: 'text-muted-foreground',
  background: 'text-muted-foreground/60',
}

export function JobsTable({
  jobs,
  currentPage,
  totalPages,
  totalCount,
  statusFilter,
  typeFilter,
  compact = false,
}: JobsTableProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const updateFilter = (key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams.toString())
    if (value && value !== 'all') {
      params.set(key, value)
    } else {
      params.delete(key)
    }
    params.set('page', '1')
    router.push(`/admin/jobs?${params.toString()}`)
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-'
    const date = new Date(dateStr)
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const formatDuration = (startedAt: string | null, completedAt: string | null) => {
    if (!startedAt) return '-'
    const start = new Date(startedAt).getTime()
    const end = completedAt ? new Date(completedAt).getTime() : Date.now()
    const ms = end - start
    if (ms < 1000) return `${ms}ms`
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
    return `${(ms / 60000).toFixed(1)}m`
  }

  return (
    <div className="space-y-4">
      {!compact && (
        <div className="flex items-center gap-4">
          <Select
            value={statusFilter ?? 'all'}
            onValueChange={(v) => updateFilter('status', v)}
          >
            <SelectTrigger className="w-36">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="queued">Queued</SelectItem>
              <SelectItem value="running">Running</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
              <SelectItem value="dead_letter">Dead Letter</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={typeFilter ?? 'all'}
            onValueChange={(v) => updateFilter('type', v)}
          >
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Job Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="score_full">Score Full</SelectItem>
              <SelectItem value="score_heavy">Score Heavy</SelectItem>
              <SelectItem value="render_generate">Render Generate</SelectItem>
              <SelectItem value="export_run">Export Run</SelectItem>
              <SelectItem value="benchmark_run">Benchmark Run</SelectItem>
              <SelectItem value="cleanup_stale_jobs">Cleanup Stale Jobs</SelectItem>
            </SelectContent>
          </Select>

          <div className="flex-1" />
          
          <span className="text-sm text-muted-foreground">
            {totalCount} job{totalCount !== 1 ? 's' : ''}
          </span>
        </div>
      )}

      <div className="rounded-lg border overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide">
                Job
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide">
                Status
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide">
                Progress
              </th>
              {!compact && (
                <>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide">
                    Priority
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide">
                    Retries
                  </th>
                </>
              )}
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide">
                Duration
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide">
                Created
              </th>
            </tr>
          </thead>
          <tbody>
            {jobs.length === 0 ? (
              <tr>
                <td 
                  colSpan={compact ? 5 : 7} 
                  className="px-4 py-8 text-center text-muted-foreground"
                >
                  No jobs found
                </td>
              </tr>
            ) : (
              jobs.map((job) => (
                <tr key={job.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium text-sm">
                        {job.job_type.replace(/_/g, ' ')}
                      </span>
                      <span className="text-xs text-muted-foreground font-mono">
                        {job.id.slice(0, 8)}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[job.status]}`}>
                      {job.status.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-primary rounded-full transition-all"
                          style={{ width: `${job.progress_percent}%` }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {job.progress_percent}%
                      </span>
                    </div>
                  </td>
                  {!compact && (
                    <>
                      <td className={`px-4 py-3 text-sm ${PRIORITY_COLORS[job.priority]}`}>
                        {job.priority}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {job.retry_count}/{job.max_retries}
                      </td>
                    </>
                  )}
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    {formatDuration(job.started_at, job.completed_at)}
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    {formatDate(job.created_at)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {!compact && totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {currentPage} of {totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage <= 1}
              asChild
            >
              <Link href={`/admin/jobs?page=${currentPage - 1}&${new URLSearchParams(
                Object.fromEntries(
                  ([['status', statusFilter], ['type', typeFilter]] as [string, string | undefined][])
                    .filter((entry): entry is [string, string] => entry[1] != null && entry[1] !== '')
                )
              ).toString()}`}>
                <ChevronLeft className="h-4 w-4" />
                Previous
              </Link>
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage >= totalPages}
              asChild
            >
              <Link href={`/admin/jobs?page=${currentPage + 1}&${new URLSearchParams(
                Object.fromEntries(
                  ([['status', statusFilter], ['type', typeFilter]] as [string, string | undefined][])
                    .filter((entry): entry is [string, string] => entry[1] != null && entry[1] !== '')
                )
              ).toString()}`}>
                Next
                <ChevronRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
