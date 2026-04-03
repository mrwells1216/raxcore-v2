'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Progress } from '@/components/ui/progress'
import {
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  Play,
  Trash2,
  Eye,
  Download,
  XCircle,
  GitCompare,
  FlaskConical,
  Loader2,
} from 'lucide-react'
import { toast } from 'sonner'
import type { BulkValidationRun } from '@/lib/types'
import type { ModelVersionRecord } from '@/lib/storage/service'
import { formatDistanceToNow } from 'date-fns'

interface BulkRunsTableProps {
  runs: BulkValidationRun[]
  total: number
  page: number
  limit: number
  modelVersions: ModelVersionRecord[]
}

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-500/10 text-yellow-700 border-yellow-500/30',
  running: 'bg-blue-500/10 text-blue-700 border-blue-500/30',
  completed: 'bg-green-500/10 text-green-700 border-green-500/30',
  failed: 'bg-red-500/10 text-red-700 border-red-500/30',
  cancelled: 'bg-gray-500/10 text-gray-700 border-gray-500/30',
}

export function BulkRunsTable({ runs, total, page, limit, modelVersions }: BulkRunsTableProps) {
  const router = useRouter()
  const [executingId, setExecutingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [selectedRun, setSelectedRun] = useState<BulkValidationRun | null>(null)

  const totalPages = Math.ceil(total / limit)

  const handleExecute = async (runId: string) => {
    setExecutingId(runId)
    try {
      const res = await fetch(`/api/admin/bulk-validation/runs/${runId}/execute`, {
        method: 'POST',
      })
      const data = await res.json()

      if (data.success) {
        toast.success(`Processed ${data.data.processed} examples`)
        router.refresh()
      } else {
        toast.error(data.error || 'Failed to execute run')
      }
    } catch (err) {
      toast.error('Failed to execute run')
    } finally {
      setExecutingId(null)
    }
  }

  const handleCancel = async (runId: string) => {
    try {
      const res = await fetch(`/api/admin/bulk-validation/runs/${runId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel' }),
      })
      const data = await res.json()

      if (data.success) {
        toast.success('Run cancelled')
        router.refresh()
      } else {
        toast.error(data.error || 'Failed to cancel run')
      }
    } catch (err) {
      toast.error('Failed to cancel run')
    }
  }

  const handleDelete = async () => {
    if (!selectedRun) return

    setDeletingId(selectedRun.id)
    try {
      const res = await fetch(`/api/admin/bulk-validation/runs/${selectedRun.id}`, {
        method: 'DELETE',
      })
      const data = await res.json()

      if (data.success) {
        toast.success('Run deleted')
        router.refresh()
      } else {
        toast.error(data.error || 'Failed to delete run')
      }
    } catch (err) {
      toast.error('Failed to delete run')
    } finally {
      setDeletingId(null)
      setShowDeleteDialog(false)
      setSelectedRun(null)
    }
  }

  const getModelName = (modelVersionId: string | null) => {
    if (!modelVersionId) return 'Current Active'
    const model = modelVersions.find((m) => m.id === modelVersionId)
    return model?.version_name || 'Unknown'
  }

  return (
    <div className="space-y-4">
      {runs.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <FlaskConical className="h-12 w-12 mx-auto mb-3 opacity-50" />
          <p>No bulk validation runs yet.</p>
          <p className="text-sm">Create a new run to test model accuracy.</p>
        </div>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Run Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Progress</TableHead>
                <TableHead>Primary Model</TableHead>
                <TableHead>MAE</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((run) => {
                const progressPercent = run.total_examples > 0
                  ? (run.processed_examples / run.total_examples) * 100
                  : 0
                const mae = run.summary_metrics?.primary_model?.avg_gross_error

                return (
                  <TableRow key={run.id}>
                    <TableCell>
                      <Link
                        href={`/admin/bulk-validation/${run.id}`}
                        className="font-medium hover:underline"
                      >
                        {run.run_name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="gap-1">
                        {run.run_type === 'model_comparison' ? (
                          <>
                            <GitCompare className="h-3 w-3" />
                            Compare
                          </>
                        ) : (
                          <>
                            <FlaskConical className="h-3 w-3" />
                            Single
                          </>
                        )}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={statusColors[run.status]}>
                        {run.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 min-w-[120px]">
                        <Progress value={progressPercent} className="h-2 flex-1" />
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {run.processed_examples}/{run.total_examples}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {getModelName(run.primary_model_version_id)}
                    </TableCell>
                    <TableCell>
                      {mae != null ? (
                        <span className={mae <= 10 ? 'text-green-600' : mae <= 15 ? 'text-yellow-600' : 'text-red-600'}>
                          {mae.toFixed(1)}&quot;
                        </span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDistanceToNow(new Date(run.created_at), { addSuffix: true })}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild>
                            <Link href={`/admin/bulk-validation/${run.id}`}>
                              <Eye className="h-4 w-4 mr-2" />
                              View Details
                            </Link>
                          </DropdownMenuItem>
                          {run.status === 'pending' && (
                            <DropdownMenuItem
                              onClick={() => handleExecute(run.id)}
                              disabled={executingId === run.id}
                            >
                              {executingId === run.id ? (
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              ) : (
                                <Play className="h-4 w-4 mr-2" />
                              )}
                              Execute Run
                            </DropdownMenuItem>
                          )}
                          {(run.status === 'running' || run.status === 'pending') && (
                            <DropdownMenuItem onClick={() => handleCancel(run.id)}>
                              <XCircle className="h-4 w-4 mr-2" />
                              Cancel
                            </DropdownMenuItem>
                          )}
                          {run.status === 'completed' && (
                            <DropdownMenuItem asChild>
                              <a href={`/api/admin/bulk-validation/runs/${run.id}/export?format=csv`}>
                                <Download className="h-4 w-4 mr-2" />
                                Export CSV
                              </a>
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => {
                              setSelectedRun(run)
                              setShowDeleteDialog(true)
                            }}
                            disabled={run.status === 'running'}
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Page {page} of {totalPages} ({total} total runs)
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => router.push(`/admin/bulk-validation?page=${page - 1}`)}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => router.push(`/admin/bulk-validation?page=${page + 1}`)}
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Validation Run</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{selectedRun?.run_name}&quot;? This will also delete all
              associated results. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deletingId != null}
            >
              {deletingId ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
