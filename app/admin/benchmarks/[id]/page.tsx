export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { getBenchmarkPack, getBenchmarkPackExamples, listBenchmarkRuns } from '@/lib/benchmark/service'
import { ArrowLeft, Package, Play, Database } from 'lucide-react'

export default async function BenchmarkPackDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const [pack, examples, runsResult] = await Promise.all([
    getBenchmarkPack(id),
    getBenchmarkPackExamples(id),
    listBenchmarkRuns({ packId: id, limit: 5 }),
  ])

  if (!pack) {
    notFound()
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  // Group examples by state and rack type for stats
  const byState = examples.reduce((acc, ex) => {
    const state = ex.state || 'Unknown'
    acc[state] = (acc[state] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  const byRackType = examples.reduce((acc, ex) => {
    const type = ex.rack_type || 'Unknown'
    acc[type] = (acc[type] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  return (
    <div className="p-4 lg:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <Link
          href="/admin/benchmarks?tab=packs"
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Packs
        </Link>
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-3">
              <Package className="h-6 w-6" />
              {pack.name}
              {pack.is_archived && <Badge variant="secondary">Archived</Badge>}
            </h1>
            {pack.description && (
              <p className="text-muted-foreground mt-1">{pack.description}</p>
            )}
            <div className="flex flex-wrap gap-1 mt-2">
              {pack.tags.map((tag) => (
                <Badge key={tag} variant="outline" className="text-xs">
                  {tag}
                </Badge>
              ))}
            </div>
          </div>
          {!pack.is_archived && (
            <Button asChild>
              <Link href={`/admin/benchmarks/${id}/run`}>
                <Play className="h-4 w-4 mr-2" />
                Run Benchmark
              </Link>
            </Button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Examples</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{pack.example_count}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">States</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{Object.keys(byState).length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Rack Types</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{Object.keys(byRackType).length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Runs</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{runsResult.count}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Database className="h-5 w-5" />
              Example Distribution
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-2">By State</p>
              <div className="space-y-1">
                {Object.entries(byState)
                  .sort(([, a], [, b]) => b - a)
                  .slice(0, 10)
                  .map(([state, count]) => (
                    <div key={state} className="flex items-center justify-between text-sm">
                      <span>{state}</span>
                      <span className="text-muted-foreground">{count}</span>
                    </div>
                  ))}
                {Object.keys(byState).length > 10 && (
                  <p className="text-xs text-muted-foreground">
                    +{Object.keys(byState).length - 10} more states
                  </p>
                )}
              </div>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-2">By Rack Type</p>
              <div className="space-y-1">
                {Object.entries(byRackType)
                  .sort(([, a], [, b]) => b - a)
                  .map(([type, count]) => (
                    <div key={type} className="flex items-center justify-between text-sm">
                      <span>{type}</span>
                      <span className="text-muted-foreground">{count}</span>
                    </div>
                  ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Recent Runs */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Play className="h-5 w-5" />
              Recent Runs
            </CardTitle>
            <CardDescription>
              Last {runsResult.data.length} benchmark runs for this pack
            </CardDescription>
          </CardHeader>
          <CardContent>
            {runsResult.data.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No runs yet. Run a benchmark to see results here.
              </p>
            ) : (
              <div className="space-y-2">
                {runsResult.data.map((run) => (
                  <Link
                    key={run.id}
                    href={`/admin/benchmarks/runs/${run.id}`}
                    className="block p-3 border rounded-md hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">
                          {run.run_purpose === 'release_candidate'
                            ? 'Release Candidate'
                            : run.run_purpose === 'regression_test'
                            ? 'Regression Test'
                            : 'Ad Hoc'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(run.created_at)}
                        </p>
                      </div>
                      <Badge
                        variant={
                          run.all_guardrails_passed === true
                            ? 'secondary'
                            : run.all_guardrails_passed === false
                            ? 'destructive'
                            : 'outline'
                        }
                        className={
                          run.all_guardrails_passed === true
                            ? 'bg-green-500/10 text-green-600'
                            : ''
                        }
                      >
                        {run.all_guardrails_passed === true
                          ? 'Passed'
                          : run.all_guardrails_passed === false
                          ? 'Failed'
                          : run.bulk_run_status}
                      </Badge>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Pack Information</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <p>Created: {formatDate(pack.created_at)}</p>
          <p>Last Updated: {formatDate(pack.updated_at)}</p>
          {pack.created_by && <p>Created By: {pack.created_by}</p>}
        </CardContent>
      </Card>
    </div>
  )
}
