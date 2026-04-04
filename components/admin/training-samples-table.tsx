'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react'

interface TrainingSample {
  id: string
  buck_id: string | null
  prediction_id: string | null
  input: {
    images?: string[]
    image_count?: number
    rack_type?: string | null
    state?: string | null
  } | null
  ai_output: {
    gross_score?: number | null
    net_score?: number | null
  } | null
  ground_truth: {
    gross_score?: number | null
    net_score?: number | null
  } | null
  review_completeness: number
  is_official: boolean
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
}

interface TrainingSamplesTableProps {
  samples: TrainingSample[]
  total: number
  page: number
  limit: number
}

export function TrainingSamplesTable({
  samples,
  total,
  page,
  limit,
}: TrainingSamplesTableProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const totalPages = Math.ceil(total / limit)

  const goToPage = (newPage: number) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('page', String(newPage))
    params.set('tab', 'samples')
    router.push(`?${params.toString()}`)
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-'
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: '2-digit',
    })
  }

  const getScoreDelta = (sample: TrainingSample) => {
    const aiGross = sample.ai_output?.gross_score
    const truthGross = sample.ground_truth?.gross_score
    if (aiGross == null || truthGross == null) return null
    return truthGross - aiGross
  }

  const getDeltaColor = (delta: number | null) => {
    if (delta === null) return ''
    const abs = Math.abs(delta)
    if (abs <= 3) return 'text-green-600'
    if (abs <= 7) return 'text-yellow-600'
    return 'text-red-600'
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>State</TableHead>
              <TableHead>Rack Type</TableHead>
              <TableHead className="text-right">AI Gross</TableHead>
              <TableHead className="text-right">Truth Gross</TableHead>
              <TableHead className="text-right">Delta</TableHead>
              <TableHead className="text-center">Complete</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Reviewed</TableHead>
              <TableHead className="w-[60px]">View</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {samples.length > 0 ? (
              samples.map((sample) => {
                const delta = getScoreDelta(sample)
                return (
                  <TableRow key={sample.id}>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {sample.input?.state ?? '-'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm capitalize">
                      {sample.input?.rack_type ?? '-'}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {sample.ai_output?.gross_score?.toFixed(1) ?? '-'}
                    </TableCell>
                    <TableCell className="text-right font-mono font-medium">
                      {sample.ground_truth?.gross_score?.toFixed(1) ?? '-'}
                    </TableCell>
                    <TableCell className={`text-right font-mono ${getDeltaColor(delta)}`}>
                      {delta !== null
                        ? `${delta > 0 ? '+' : ''}${delta.toFixed(1)}`
                        : '-'}
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1">
                        <div
                          className="h-2 rounded-full bg-muted"
                          style={{ width: 40 }}
                        >
                          <div
                            className={`h-2 rounded-full ${
                              sample.review_completeness >= 90
                                ? 'bg-green-500'
                                : sample.review_completeness >= 50
                                  ? 'bg-yellow-500'
                                  : 'bg-red-500'
                            }`}
                            style={{
                              width: `${Math.min(100, sample.review_completeness)}%`,
                            }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {sample.review_completeness}%
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {sample.is_official ? (
                        <Badge className="bg-green-100 text-green-800 border-green-200">
                          Official
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-yellow-700 border-yellow-300">
                          Partial
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(sample.reviewed_at)}
                    </TableCell>
                    <TableCell>
                      {sample.prediction_id && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          asChild
                        >
                          <a
                            href={`/results/${sample.prediction_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })
            ) : (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                  No training samples found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {(page - 1) * limit + 1} - {Math.min(page * limit, total)} of{' '}
            {total}
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
