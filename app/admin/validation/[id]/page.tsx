export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Target, TrendingUp, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { getValidationSummary, getValidationResults } from '@/lib/validation/service'
import { ValidationBreakdownChart } from '@/components/admin/validation-breakdown-chart'
import { ValidationResultsTable } from '@/components/admin/validation-results-table'

const RESULTS_PAGE_SIZE = 25

export default async function ValidationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const { id } = await params
  const sp = await searchParams
  const resultsPage = Math.max(1, Number(sp.resultsPage) || 1)
  const resultsOffset = (resultsPage - 1) * RESULTS_PAGE_SIZE

  // Fetch summary (metrics + breakdowns + worst/best) and paginated full results in parallel
  const [summary, resultsResponse] = await Promise.all([
    getValidationSummary(id),
    getValidationResults(id, {
      limit: RESULTS_PAGE_SIZE,
      offset: resultsOffset,
      orderBy: 'abs_error_gross',
      ascending: false,
    }),
  ])

  if (!summary) {
    notFound()
  }

  const { run, by_state, by_rack_type, by_score_bucket, worst_predictions, best_predictions } = summary
  const { data: pagedResults, count: resultsTotal } = resultsResponse
  const resultsTotalPages = Math.ceil(resultsTotal / RESULTS_PAGE_SIZE)

  const getStatusBadge = (status: string) => {
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

  return (
    <div className="p-4 lg:p-6 space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/admin/validation">
          <Button variant="ghost" size="icon" className="h-10 w-10">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{run.run_name}</h1>
            {getStatusBadge(run.status)}
          </div>
          <p className="text-muted-foreground text-sm">
            {run.processed_examples} examples processed
            {run.completed_at && ` on ${new Date(run.completed_at).toLocaleDateString()}`}
          </p>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Target className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">
                  {run.mean_absolute_error_gross?.toFixed(1) || '-'}&quot;
                </p>
                <p className="text-sm text-muted-foreground">Mean Absolute Error</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <TrendingUp className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">
                  {run.median_absolute_error_gross?.toFixed(1) || '-'}&quot;
                </p>
                <p className="text-sm text-muted-foreground">Median Error</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <CheckCircle2 className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">
                  {run.within_10_percent?.toFixed(0) || '-'}%
                </p>
                <p className="text-sm text-muted-foreground">Within 10%</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <AlertTriangle className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">
                  {run.rmse_gross?.toFixed(1) || '-'}&quot;
                </p>
                <p className="text-sm text-muted-foreground">RMSE</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Breakdown Charts */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Error by Score Range</CardTitle>
            <CardDescription>How accuracy varies across different buck sizes</CardDescription>
          </CardHeader>
          <CardContent>
            <ValidationBreakdownChart
              data={by_score_bucket}
              valueKey="mae_gross"
              labelKey="category"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Error by State</CardTitle>
            <CardDescription>Regional accuracy variations</CardDescription>
          </CardHeader>
          <CardContent>
            <ValidationBreakdownChart
              data={by_state.slice(0, 8)}
              valueKey="mae_gross"
              labelKey="category"
            />
          </CardContent>
        </Card>
      </div>

      {/* Worst and Best Predictions */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg text-red-600">Worst Predictions</CardTitle>
            <CardDescription>Examples with the highest absolute error</CardDescription>
          </CardHeader>
          <CardContent>
            <ValidationResultsTable results={worst_predictions} showError />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg text-primary">Best Predictions</CardTitle>
            <CardDescription>Examples with the lowest absolute error</CardDescription>
          </CardHeader>
          <CardContent>
            <ValidationResultsTable results={best_predictions} showError />
          </CardContent>
        </Card>
      </div>

      {/* All Results — paginated via searchParams */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            All Results ({resultsTotal})
          </CardTitle>
          <CardDescription>
            Sorted by absolute error, highest first
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ValidationResultsTable results={pagedResults} showError />

          {resultsTotalPages > 1 && (
            <div className="flex items-center justify-between pt-2 border-t border-border">
              <p className="text-sm text-muted-foreground">
                {(resultsPage - 1) * RESULTS_PAGE_SIZE + 1}–
                {Math.min(resultsPage * RESULTS_PAGE_SIZE, resultsTotal)} of {resultsTotal}
              </p>
              <div className="flex gap-2">
                {resultsPage > 1 && (
                  <Button variant="outline" size="sm" asChild className="min-h-[36px]">
                    <Link href={`?resultsPage=${resultsPage - 1}`}>Previous</Link>
                  </Button>
                )}
                <span className="flex items-center px-2 text-sm text-muted-foreground">
                  {resultsPage} / {resultsTotalPages}
                </span>
                {resultsPage < resultsTotalPages && (
                  <Button variant="outline" size="sm" asChild className="min-h-[36px]">
                    <Link href={`?resultsPage=${resultsPage + 1}`}>Next</Link>
                  </Button>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
