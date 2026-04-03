'use client'

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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { ChevronLeft, ChevronRight, Eye, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import type { BulkValidationResult, ModelPredictionResult } from '@/lib/types'

interface BulkRunResultsTableProps {
  results: BulkValidationResult[]
  total: number
  page: number
  limit: number
  runId: string
  primaryModelVersionId: string | null
}

export function BulkRunResultsTable({
  results,
  total,
  page,
  limit,
  runId,
  primaryModelVersionId,
}: BulkRunResultsTableProps) {
  const router = useRouter()
  const totalPages = Math.ceil(total / limit)

  const getPrimaryResult = (modelResults: ModelPredictionResult[]) => {
    return modelResults.find((mr) => mr.model_version_id === primaryModelVersionId)
  }

  const getErrorIndicator = (error: number) => {
    const absError = Math.abs(error)
    if (absError <= 5) return <Badge className="bg-green-500/10 text-green-700 border-green-500/30">Excellent</Badge>
    if (absError <= 10) return <Badge className="bg-blue-500/10 text-blue-700 border-blue-500/30">Good</Badge>
    if (absError <= 15) return <Badge className="bg-yellow-500/10 text-yellow-700 border-yellow-500/30">Fair</Badge>
    return <Badge className="bg-red-500/10 text-red-700 border-red-500/30">Poor</Badge>
  }

  return (
    <div className="space-y-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Buck ID</TableHead>
            <TableHead>Ground Truth</TableHead>
            <TableHead>Predicted</TableHead>
            <TableHead>Error</TableHead>
            <TableHead>Quality</TableHead>
            <TableHead>State</TableHead>
            <TableHead>Images</TableHead>
            <TableHead className="w-[80px]">Details</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {results.map((result) => {
            const primaryResult = getPrimaryResult(result.model_results as ModelPredictionResult[])
            const errorGross = primaryResult?.error_gross ?? 0
            const predictedGross = primaryResult?.final_gross ?? 0

            return (
              <TableRow key={result.id}>
                <TableCell>
                  {result.buck_id ? (
                    <Link
                      href={`/admin/bucks/${result.buck_id}`}
                      className="font-mono text-sm hover:underline"
                    >
                      {result.buck_id.slice(0, 8)}...
                    </Link>
                  ) : (
                    <span className="font-mono text-sm text-muted-foreground">
                      {result.training_example_id.slice(0, 8)}...
                    </span>
                  )}
                </TableCell>
                <TableCell className="font-mono">
                  {result.ground_truth_gross.toFixed(1)}&quot;
                </TableCell>
                <TableCell className="font-mono">
                  {predictedGross.toFixed(1)}&quot;
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    {errorGross > 0 ? (
                      <TrendingUp className="h-4 w-4 text-red-500" />
                    ) : errorGross < 0 ? (
                      <TrendingDown className="h-4 w-4 text-blue-500" />
                    ) : (
                      <Minus className="h-4 w-4 text-muted-foreground" />
                    )}
                    <span
                      className={`font-mono ${
                        Math.abs(errorGross) <= 5
                          ? 'text-green-600'
                          : Math.abs(errorGross) <= 10
                          ? 'text-blue-600'
                          : Math.abs(errorGross) <= 15
                          ? 'text-yellow-600'
                          : 'text-red-600'
                      }`}
                    >
                      {errorGross > 0 ? '+' : ''}
                      {errorGross.toFixed(1)}&quot;
                    </span>
                  </div>
                </TableCell>
                <TableCell>{getErrorIndicator(errorGross)}</TableCell>
                <TableCell>
                  {result.state ? (
                    <Badge variant="outline">{result.state}</Badge>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </TableCell>
                <TableCell>{result.image_count || '-'}</TableCell>
                <TableCell>
                  <ResultDetailDialog result={result} primaryModelVersionId={primaryModelVersionId} />
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
            Page {page} of {totalPages} ({total} total results)
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() =>
                router.push(`/admin/bulk-validation/${runId}?resultsPage=${page - 1}`)
              }
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() =>
                router.push(`/admin/bulk-validation/${runId}?resultsPage=${page + 1}`)
              }
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function ResultDetailDialog({
  result,
  primaryModelVersionId,
}: {
  result: BulkValidationResult
  primaryModelVersionId: string | null
}) {
  const modelResults = result.model_results as ModelPredictionResult[]

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8">
          <Eye className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Result Details</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Training Example ID</p>
              <p className="font-mono">{result.training_example_id}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Buck ID</p>
              <p className="font-mono">{result.buck_id || '-'}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Ground Truth (Gross)</p>
              <p className="font-mono text-lg">{result.ground_truth_gross.toFixed(1)}&quot;</p>
            </div>
            <div>
              <p className="text-muted-foreground">Ground Truth (Net)</p>
              <p className="font-mono text-lg">
                {result.ground_truth_net != null ? `${result.ground_truth_net.toFixed(1)}"` : '-'}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">State</p>
              <p>{result.state || '-'}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Rack Type</p>
              <p className="capitalize">{result.rack_type?.replace('_', ' ') || '-'}</p>
            </div>
          </div>

          <div className="border-t pt-4">
            <h4 className="font-medium mb-3">Model Results</h4>
            <div className="space-y-3">
              {modelResults.map((mr) => {
                const isPrimary = mr.model_version_id === primaryModelVersionId

                return (
                  <div
                    key={mr.model_version_id || 'primary'}
                    className={`p-3 rounded-lg border ${isPrimary ? 'bg-muted/50' : ''}`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <Badge variant={isPrimary ? 'default' : 'outline'}>
                        {mr.model_version_name || 'Unknown Model'}
                      </Badge>
                      <Badge variant="outline">
                        {mr.scoring_method || 'vision'}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-3 gap-4 text-sm">
                      <div>
                        <p className="text-muted-foreground">Raw Vision</p>
                        <p className="font-mono">
                          {mr.raw_vision_gross != null
                            ? `${mr.raw_vision_gross.toFixed(1)}"`
                            : '-'}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Normalized</p>
                        <p className="font-mono">
                          {mr.normalized_gross != null
                            ? `${mr.normalized_gross.toFixed(1)}"`
                            : '-'}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Final</p>
                        <p className="font-mono font-medium">{mr.final_gross.toFixed(1)}&quot;</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Error</p>
                        <p
                          className={`font-mono ${
                            Math.abs(mr.error_gross) <= 5
                              ? 'text-green-600'
                              : Math.abs(mr.error_gross) <= 10
                              ? 'text-blue-600'
                              : 'text-red-600'
                          }`}
                        >
                          {mr.error_gross > 0 ? '+' : ''}
                          {mr.error_gross.toFixed(1)}&quot;
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Confidence</p>
                        <p className="font-mono">
                          {mr.confidence_percent != null
                            ? `${mr.confidence_percent.toFixed(0)}%`
                            : '-'}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Time</p>
                        <p className="font-mono">
                          {mr.processing_time_ms != null
                            ? `${mr.processing_time_ms.toFixed(0)}ms`
                            : '-'}
                        </p>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
