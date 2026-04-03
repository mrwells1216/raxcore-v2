export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { getBenchmarkRun, getPromotionReadiness } from '@/lib/benchmark/service'
import { GuardrailResultsPanel } from '@/components/admin/guardrail-results-panel'
import { PromotionReadinessPanel } from '@/components/admin/promotion-readiness-panel'
import { ArrowLeft, Play, CheckCircle, XCircle, AlertTriangle, Clock } from 'lucide-react'
import Link from 'next/link'

export default async function BenchmarkRunDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const run = await getBenchmarkRun(id)

  if (!run) {
    notFound()
  }

  const isComplete = run.bulk_run_status === 'completed'
  const readiness = isComplete ? await getPromotionReadiness(id) : null

  const getStatusBadge = () => {
    switch (run.bulk_run_status) {
      case 'completed':
        return <Badge variant="secondary" className="bg-green-500/10 text-green-600">Completed</Badge>
      case 'running':
        return <Badge variant="secondary" className="bg-blue-500/10 text-blue-600">Running</Badge>
      case 'failed':
        return <Badge variant="destructive">Failed</Badge>
      case 'pending':
        return <Badge variant="outline">Pending</Badge>
      default:
        return <Badge variant="outline">{run.bulk_run_status}</Badge>
    }
  }

  const getGuardrailStatusIcon = () => {
    if (run.all_guardrails_passed === null) {
      return <Clock className="h-5 w-5 text-muted-foreground" />
    }
    if (run.all_guardrails_passed) {
      return <CheckCircle className="h-5 w-5 text-green-600" />
    }
    return <XCircle className="h-5 w-5 text-destructive" />
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  }

  return (
    <div className="p-4 lg:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <Link
          href="/admin/benchmarks?tab=runs"
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Runs
        </Link>
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-3">
              <Play className="h-6 w-6" />
              {run.pack_name}
              {getStatusBadge()}
            </h1>
            <p className="text-muted-foreground mt-1">
              {run.pack_example_count} examples | Created {formatDate(run.created_at)}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {getGuardrailStatusIcon()}
            <span className="text-sm">
              {run.all_guardrails_passed === null
                ? 'Guardrails pending'
                : run.all_guardrails_passed
                ? 'All guardrails passed'
                : 'Guardrails failed'}
            </span>
          </div>
        </div>
      </div>

      {/* Run Info */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Purpose</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant="outline" className="text-sm">
              {run.run_purpose === 'release_candidate'
                ? 'Release Candidate'
                : run.run_purpose === 'regression_test'
                ? 'Regression Test'
                : 'Ad Hoc'}
            </Badge>
            {run.run_notes && (
              <p className="text-sm text-muted-foreground mt-2">{run.run_notes}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Candidate Model</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-medium">{run.candidate_model_name || 'Not specified'}</p>
            {run.candidate_calibration_name && (
              <p className="text-sm text-muted-foreground">
                Calibration: {run.candidate_calibration_name}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Active Model (Baseline)</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-medium">{run.active_model_name || 'Not specified'}</p>
            {run.active_calibration_name && (
              <p className="text-sm text-muted-foreground">
                Calibration: {run.active_calibration_name}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Guardrail Results */}
      {isComplete && run.guardrail_results && (
        <GuardrailResultsPanel results={run.guardrail_results} />
      )}

      {/* Promotion Readiness */}
      {readiness && (
        <PromotionReadinessPanel readiness={readiness} benchmarkRunId={id} />
      )}

      {/* Progress for running */}
      {run.bulk_run_status === 'running' && (
        <Card>
          <CardHeader>
            <CardTitle>Run in Progress</CardTitle>
            <CardDescription>
              Processing {run.processed_examples} of {run.total_examples} examples
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="w-full bg-muted rounded-full h-3">
              <div
                className="bg-primary h-3 rounded-full transition-all"
                style={{
                  width: `${run.total_examples > 0 ? (run.processed_examples / run.total_examples) * 100 : 0}%`,
                }}
              />
            </div>
            <p className="text-sm text-muted-foreground mt-2">
              {run.total_examples > 0
                ? Math.round((run.processed_examples / run.total_examples) * 100)
                : 0}% complete
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
