export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  getBulkValidationRun,
  getBulkValidationResults,
  buildComparisonDetails,
} from '@/lib/validation/bulk-service'
import { listModelVersions } from '@/lib/storage/service'
import {
  ArrowLeft,
  Download,
  FlaskConical,
  GitCompare,
  TrendingUp,
  TrendingDown,
  BarChart3,
} from 'lucide-react'
import { BulkRunMetricsCards } from '@/components/admin/bulk-run-metrics-cards'
import { BulkRunResultsTable } from '@/components/admin/bulk-run-results-table'
import { ModelComparisonView } from '@/components/admin/model-comparison-view'
import { BulkRunExecuteButton } from '@/components/admin/bulk-run-execute-button'
import { formatDistanceToNow, format } from 'date-fns'

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-500/10 text-yellow-700 border-yellow-500/30',
  running: 'bg-blue-500/10 text-blue-700 border-blue-500/30',
  completed: 'bg-green-500/10 text-green-700 border-green-500/30',
  failed: 'bg-red-500/10 text-red-700 border-red-500/30',
  cancelled: 'bg-gray-500/10 text-gray-700 border-gray-500/30',
}

export default async function BulkRunDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const { id } = await params
  const queryParams = await searchParams
  const resultsPage = Number(queryParams.resultsPage) || 1
  const resultsLimit = 25

  const run = await getBulkValidationRun(id)

  if (!run) {
    notFound()
  }

  const { data: results, count: resultsCount } = await getBulkValidationResults(id, {
    limit: resultsLimit,
    offset: (resultsPage - 1) * resultsLimit,
  })

  const modelVersions = await listModelVersions()
  const comparisonDetails = run.run_type === 'model_comparison' && results.length > 0
    ? buildComparisonDetails(results, run.primary_model_version_id)
    : null

  const getModelName = (modelVersionId: string | null) => {
    if (!modelVersionId) return 'Current Active Model'
    const model = modelVersions.find((m) => m.id === modelVersionId)
    return model?.version_name || 'Unknown'
  }

  return (
    <div className="p-4 lg:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/admin/bulk-validation">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">{run.run_name}</h1>
              <Badge variant="outline" className={statusColors[run.status]}>
                {run.status}
              </Badge>
              <Badge variant="outline" className="gap-1">
                {run.run_type === 'model_comparison' ? (
                  <>
                    <GitCompare className="h-3 w-3" />
                    Comparison
                  </>
                ) : (
                  <>
                    <FlaskConical className="h-3 w-3" />
                    Single Model
                  </>
                )}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Created {formatDistanceToNow(new Date(run.created_at), { addSuffix: true })}
              {run.completed_at && (
                <> &middot; Completed {format(new Date(run.completed_at), 'MMM d, yyyy h:mm a')}</>
              )}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {run.status === 'pending' && <BulkRunExecuteButton runId={id} />}
          {run.status === 'completed' && (
            <>
              <Button variant="outline" asChild>
                <a href={`/api/admin/bulk-validation/runs/${id}/export?format=csv`}>
                  <Download className="h-4 w-4 mr-2" />
                  Export CSV
                </a>
              </Button>
              <Button variant="outline" asChild>
                <a href={`/api/admin/bulk-validation/runs/${id}/export?format=json`}>
                  <Download className="h-4 w-4 mr-2" />
                  Export JSON
                </a>
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Run Info Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Run Configuration</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-sm text-muted-foreground">Primary Model</p>
              <p className="font-medium">{getModelName(run.primary_model_version_id)}</p>
            </div>
            {run.run_type === 'model_comparison' && run.comparison_model_version_ids.length > 0 && (
              <div>
                <p className="text-sm text-muted-foreground">Comparing Against</p>
                <div className="flex flex-wrap gap-1 mt-1">
                  {(run.comparison_model_version_ids as string[]).map((mvId) => (
                    <Badge key={mvId} variant="secondary" className="text-xs">
                      {getModelName(mvId)}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            <div>
              <p className="text-sm text-muted-foreground">Examples</p>
              <p className="font-medium">
                {run.processed_examples} / {run.total_examples}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Filters</p>
              <p className="text-sm">{run.filter_snapshot || 'No filters applied'}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Metrics and Results */}
      {run.summary_metrics && (
        <Tabs defaultValue="metrics" className="space-y-4">
          <TabsList>
            <TabsTrigger value="metrics" className="gap-1.5">
              <BarChart3 className="h-4 w-4" />
              Summary Metrics
            </TabsTrigger>
            {run.run_type === 'model_comparison' && (
              <TabsTrigger value="comparison" className="gap-1.5">
                <GitCompare className="h-4 w-4" />
                Model Comparison
              </TabsTrigger>
            )}
            <TabsTrigger value="results" className="gap-1.5">
              <FlaskConical className="h-4 w-4" />
              Per-Example Results
            </TabsTrigger>
          </TabsList>

          <TabsContent value="metrics" className="space-y-4">
            <BulkRunMetricsCards metrics={run.summary_metrics} />

            {/* Improvement Summary for Comparison Runs */}
            {run.run_type === 'model_comparison' && run.summary_metrics.improvement_vs_comparison && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <TrendingUp className="h-5 w-5" />
                    Improvement Summary
                  </CardTitle>
                  <CardDescription>
                    How the primary model compares against each comparison model
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {run.summary_metrics.improvement_vs_comparison.map((imp) => (
                      <div
                        key={imp.comparison_model_version_id}
                        className="flex items-center justify-between p-4 rounded-lg border"
                      >
                        <div>
                          <p className="font-medium">
                            vs {imp.comparison_model_version_name || 'Unknown Model'}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {imp.examples_improved} improved, {imp.examples_worsened} worsened,{' '}
                            {imp.examples_unchanged} unchanged
                          </p>
                        </div>
                        <div className="text-right">
                          <div
                            className={`flex items-center gap-1 text-lg font-semibold ${
                              imp.mae_improvement_inches > 0
                                ? 'text-green-600'
                                : imp.mae_improvement_inches < 0
                                ? 'text-red-600'
                                : 'text-muted-foreground'
                            }`}
                          >
                            {imp.mae_improvement_inches > 0 ? (
                              <TrendingUp className="h-5 w-5" />
                            ) : imp.mae_improvement_inches < 0 ? (
                              <TrendingDown className="h-5 w-5" />
                            ) : null}
                            {imp.mae_improvement_inches > 0 ? '+' : ''}
                            {imp.mae_improvement_inches.toFixed(1)}&quot;
                          </div>
                          <p className="text-sm text-muted-foreground">
                            ({imp.mae_improvement_percent > 0 ? '+' : ''}
                            {imp.mae_improvement_percent.toFixed(1)}%)
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {run.run_type === 'model_comparison' && (
            <TabsContent value="comparison" className="space-y-4">
              <ModelComparisonView
                primaryModelId={run.primary_model_version_id}
                comparisonDetails={comparisonDetails || []}
                modelVersions={modelVersions}
              />
            </TabsContent>
          )}

          <TabsContent value="results" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Per-Example Results ({resultsCount} total)
                </CardTitle>
                <CardDescription>
                  Detailed results for each training example in this run
                </CardDescription>
              </CardHeader>
              <CardContent>
                <BulkRunResultsTable
                  results={results}
                  total={resultsCount}
                  page={resultsPage}
                  limit={resultsLimit}
                  runId={id}
                  primaryModelVersionId={run.primary_model_version_id}
                />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}

      {/* Empty state for pending runs */}
      {!run.summary_metrics && run.status === 'pending' && (
        <Card>
          <CardContent className="py-12 text-center">
            <FlaskConical className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <h3 className="text-lg font-medium mb-2">Ready to Execute</h3>
            <p className="text-muted-foreground mb-4">
              Click the Execute button to run this validation test.
            </p>
            <BulkRunExecuteButton runId={id} />
          </CardContent>
        </Card>
      )}

      {/* Error state */}
      {run.status === 'failed' && run.error_message && (
        <Card className="border-destructive">
          <CardHeader>
            <CardTitle className="text-base text-destructive">Run Failed</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">{run.error_message}</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
