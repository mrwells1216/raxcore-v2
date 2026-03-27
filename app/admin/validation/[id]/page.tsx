import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Target, TrendingUp, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { getValidationSummary } from '@/lib/validation/service'
import { ValidationBreakdownChart } from '@/components/admin/validation-breakdown-chart'
import { ValidationResultsTable } from '@/components/admin/validation-results-table'

export default async function ValidationDetailPage({ 
  params 
}: { 
  params: Promise<{ id: string }> 
}) {
  const { id } = await params
  const summary = await getValidationSummary(id)

  if (!summary) {
    notFound()
  }

  const { run, results, by_state, by_rack_type, by_score_bucket, worst_predictions, best_predictions } = summary

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
                  {run.mean_absolute_error_gross?.toFixed(1) || '-'}"
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
                  {run.median_absolute_error_gross?.toFixed(1) || '-'}"
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
                  {run.rmse_gross?.toFixed(1) || '-'}"
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
            <CardDescription>
              How accuracy varies across different buck sizes
            </CardDescription>
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
            <CardDescription>
              Regional accuracy variations
            </CardDescription>
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
            <CardDescription>
              Examples with the highest absolute error
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ValidationResultsTable results={worst_predictions} showError />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg text-primary">Best Predictions</CardTitle>
            <CardDescription>
              Examples with the lowest absolute error
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ValidationResultsTable results={best_predictions} showError />
          </CardContent>
        </Card>
      </div>

      {/* All Results */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">All Results ({results.length})</CardTitle>
          <CardDescription>
            Complete list of validation results
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ValidationResultsTable results={results} showError paginated />
        </CardContent>
      </Card>
    </div>
  )
}
