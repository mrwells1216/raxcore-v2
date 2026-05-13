'use client'

import { useRouter, useSearchParams } from 'next/navigation'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ChevronLeft, ChevronRight, Eye, Cpu, Calculator, CheckCircle } from 'lucide-react'
import Link from 'next/link'
import type { BuckRecord } from '@/lib/storage/service'

interface SubmissionsTableProps {
  submissions: (BuckRecord & { 
    predicted_gross?: number | null
    confidence_percent?: number | null
    scoring_method?: string | null
    has_ground_truth?: boolean 
  })[]
  total: number
  page: number
  limit: number
}

export function SubmissionsTable({ submissions, total, page, limit }: SubmissionsTableProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const totalPages = Math.ceil(total / limit)

  const updateFilter = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (value === 'all') {
      params.delete(key)
    } else {
      params.set(key, value)
    }
    params.set('page', '1')
    router.push(`?${params.toString()}`)
  }

  const goToPage = (newPage: number) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('page', String(newPage))
    router.push(`?${params.toString()}`)
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: '2-digit'
    })
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <Select 
          value={searchParams.get('status') || 'all'} 
          onValueChange={(v) => updateFilter('status', v)}
        >
          <SelectTrigger className="w-[140px] min-h-[44px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="processing">Processing</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="rounded-md border border-border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>Buck Info</TableHead>
              <TableHead>Score</TableHead>
              <TableHead>Confidence</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="w-[60px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {submissions.length > 0 ? (
              submissions.map((sub) => (
                <TableRow key={sub.id}>
                  <TableCell className="font-mono text-xs">
                    {sub.id.slice(0, 8)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div>
                        <p className="font-medium text-sm">
                          {sub.state} - {sub.rack_type === 'typical' ? 'Typ' : 'NT'}
                        </p>
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          {sub.main_frame_points ? `${sub.main_frame_points}pt` : '-'}
                          {sub.has_ground_truth && (
                            <CheckCircle className="h-3 w-3 text-primary ml-1" />
                          )}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    {sub.predicted_gross ? (
                      <div className="flex items-center gap-1.5">
                        {sub.scoring_method === 'vision' ? (
                          <Cpu className="h-3 w-3 text-primary" />
                        ) : (
                          <Calculator className="h-3 w-3 text-muted-foreground" />
                        )}
                        <span className="font-medium tabular-nums">
                          {sub.predicted_gross.toFixed(1)}&quot;
                        </span>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {sub.confidence_percent ? (
                      <Badge 
                        variant="outline"
                        className={
                          sub.confidence_percent >= 75 ? 'bg-primary/10 text-primary border-primary/30' :
                          sub.confidence_percent >= 50 ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30' :
                          'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30'
                        }
                      >
                        {sub.confidence_percent.toFixed(0)}%
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge 
                      variant={sub.status === 'completed' ? 'secondary' : 'outline'}
                      className={
                        sub.status === 'completed' ? 'bg-primary/10 text-primary' :
                        sub.status === 'failed' ? 'bg-red-500/10 text-red-600 dark:text-red-400' :
                        sub.status === 'processing' ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400' :
                        ''
                      }
                    >
                      {sub.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDate(sub.created_at)}
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" asChild className="h-8 w-8">
                      <Link href={`/admin/submissions/${sub.id}`}>
                        <Eye className="h-4 w-4" />
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  No submissions found
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
    </div>
  )
}
