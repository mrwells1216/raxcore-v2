'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useTransition, useState } from 'react'
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { 
  ChevronLeft, 
  ChevronRight, 
  Play, 
  Eye, 
  Trash2, 
  Loader2,
  XCircle
} from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import type { ValidationRun } from '@/lib/types'

interface ValidationRunsTableProps {
  runs: ValidationRun[]
  total: number
  page: number
  limit: number
}

export function ValidationRunsTable({ runs, total, page, limit }: ValidationRunsTableProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()
  const [executingId, setExecutingId] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const totalPages = Math.ceil(total / limit)

  const goToPage = (newPage: number) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('page', String(newPage))
    router.push(`?${params.toString()}`)
  }

  const executeRun = async (id: string) => {
    setExecutingId(id)
    try {
      const response = await fetch(`/api/admin/validation/runs/${id}/execute`, {
        method: 'POST',
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to execute validation run')
      }

      toast.success('Validation run completed')
      router.refresh()
    } catch (error) {
      console.error('Execute error:', error)
      toast.error(error instanceof Error ? error.message : 'Failed to execute validation run')
    } finally {
      setExecutingId(null)
    }
  }

  const cancelRun = async (id: string) => {
    startTransition(async () => {
      try {
        const response = await fetch(`/api/admin/validation/runs/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'cancel' }),
        })

        if (!response.ok) throw new Error('Failed to cancel')

        toast.success('Validation run cancelled')
        router.refresh()
      } catch (error) {
        console.error('Cancel error:', error)
        toast.error('Failed to cancel validation run')
      }
    })
  }

  const deleteRun = async () => {
    if (!deleteId) return
    
    startTransition(async () => {
      try {
        const response = await fetch(`/api/admin/validation/runs/${deleteId}`, {
          method: 'DELETE',
        })

        if (!response.ok) throw new Error('Failed to delete')

        toast.success('Validation run deleted')
        setDeleteId(null)
        router.refresh()
      } catch (error) {
        console.error('Delete error:', error)
        toast.error('Failed to delete validation run')
      }
    })
  }

  const getStatusBadge = (status: ValidationRun['status']) => {
    switch (status) {
      case 'completed':
        return <Badge className="bg-primary/10 text-primary">Completed</Badge>
      case 'running':
        return <Badge className="bg-amber-500/10 text-amber-600">Running</Badge>
      case 'pending':
        return <Badge variant="outline">Pending</Badge>
      case 'failed':
        return <Badge className="bg-red-500/10 text-red-600">Failed</Badge>
      case 'cancelled':
        return <Badge variant="secondary">Cancelled</Badge>
      default:
        return <Badge variant="outline">{status}</Badge>
    }
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-'
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Run Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-center">Progress</TableHead>
              <TableHead className="text-right">MAE</TableHead>
              <TableHead className="text-right">Within 10%</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="w-[120px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.length > 0 ? (
              runs.map((run) => (
                <TableRow key={run.id}>
                  <TableCell className="font-medium">{run.run_name}</TableCell>
                  <TableCell>{getStatusBadge(run.status)}</TableCell>
                  <TableCell>
                    {run.status === 'running' ? (
                      <div className="flex items-center gap-2">
                        <Progress 
                          value={run.total_examples > 0 
                            ? (run.processed_examples / run.total_examples) * 100 
                            : 0
                          } 
                          className="w-20 h-2"
                        />
                        <span className="text-xs text-muted-foreground">
                          {run.processed_examples}/{run.total_examples}
                        </span>
                      </div>
                    ) : run.status === 'completed' ? (
                      <span className="text-sm text-muted-foreground">
                        {run.processed_examples}/{run.total_examples}
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {run.mean_absolute_error_gross != null 
                      ? `${run.mean_absolute_error_gross.toFixed(1)}"` 
                      : '-'
                    }
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {run.within_10_percent != null 
                      ? `${run.within_10_percent.toFixed(0)}%` 
                      : '-'
                    }
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDate(run.created_at)}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {run.status === 'pending' && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-primary"
                          onClick={() => executeRun(run.id)}
                          disabled={executingId !== null}
                        >
                          {executingId === run.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Play className="h-4 w-4" />
                          )}
                        </Button>
                      )}
                      {run.status === 'running' && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-amber-600"
                          onClick={() => cancelRun(run.id)}
                          disabled={isPending}
                        >
                          <XCircle className="h-4 w-4" />
                        </Button>
                      )}
                      {run.status === 'completed' && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => router.push(`/admin/validation/${run.id}`)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-red-600"
                        onClick={() => setDeleteId(run.id)}
                        disabled={isPending || run.status === 'running'}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  No validation runs yet. Create one to get started.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {(page - 1) * limit + 1} - {Math.min(page * limit, total)} of {total}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => goToPage(page - 1)}
              disabled={page <= 1}
              className="min-h-[36px]"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => goToPage(page + 1)}
              disabled={page >= totalPages}
              className="min-h-[36px]"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Validation Run</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this validation run? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={deleteRun} disabled={isPending}>
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
