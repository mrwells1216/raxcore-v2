'use client'

import { useState } from 'react'
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
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { ValidationResult } from '@/lib/types'

interface ValidationResultsTableProps {
  results: ValidationResult[]
  showError?: boolean
  paginated?: boolean
}

export function ValidationResultsTable({ results, showError, paginated }: ValidationResultsTableProps) {
  const [page, setPage] = useState(1)
  const limit = paginated ? 10 : results.length
  const totalPages = Math.ceil(results.length / limit)
  
  const displayResults = paginated 
    ? results.slice((page - 1) * limit, page * limit)
    : results

  const getErrorColor = (error: number) => {
    const abs = Math.abs(error)
    if (abs <= 5) return 'text-primary'
    if (abs <= 10) return 'text-amber-600 dark:text-amber-400'
    return 'text-red-600 dark:text-red-400'
  }

  const getPercentColor = (percent: number) => {
    const abs = Math.abs(percent)
    if (abs <= 5) return 'text-primary'
    if (abs <= 10) return 'text-amber-600 dark:text-amber-400'
    return 'text-red-600 dark:text-red-400'
  }

  if (results.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No results available
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-right">Actual</TableHead>
              <TableHead className="text-right">Predicted</TableHead>
              {showError && (
                <>
                  <TableHead className="text-right">Error</TableHead>
                  <TableHead className="text-right">% Error</TableHead>
                </>
              )}
              <TableHead>State</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Confidence</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayResults.map((result) => (
              <TableRow key={result.id}>
                <TableCell className="text-right font-mono font-medium">
                  {result.ground_truth_gross.toFixed(1)}"
                </TableCell>
                <TableCell className="text-right font-mono">
                  {result.predicted_gross.toFixed(1)}"
                </TableCell>
                {showError && (
                  <>
                    <TableCell className={`text-right font-mono ${getErrorColor(result.error_gross)}`}>
                      {result.error_gross > 0 ? '+' : ''}{result.error_gross.toFixed(1)}"
                    </TableCell>
                    <TableCell className={`text-right font-mono ${getPercentColor(result.percent_error_gross)}`}>
                      {result.percent_error_gross > 0 ? '+' : ''}{result.percent_error_gross.toFixed(1)}%
                    </TableCell>
                  </>
                )}
                <TableCell>
                  <Badge variant="outline" className="text-xs">
                    {result.state || 'Unknown'}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-xs capitalize">
                    {result.rack_type || 'Unknown'}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  {result.confidence_percent != null ? (
                    <span className="text-sm text-muted-foreground">
                      {result.confidence_percent.toFixed(0)}%
                    </span>
                  ) : '-'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {paginated && totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {(page - 1) * limit + 1} - {Math.min(page * limit, results.length)} of {results.length}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => p - 1)}
              disabled={page <= 1}
              className="min-h-[36px]"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => p + 1)}
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
