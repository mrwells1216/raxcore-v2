import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Target, TrendingUp, CheckCircle2, BarChart3, Layers, Ruler } from 'lucide-react'
import { getAccuracyMetrics, getAccuracyBreakdown, getErrorDistribution, getMeasurementAccuracyBreakdown } from '@/lib/validation/service'
import { AccuracyTrendChart } from '@/components/admin/accuracy-trend-chart'
import { ErrorDistributionChart } from '@/components/admin/error-distribution-chart'
import { AccuracyBreakdownTable } from '@/components/admin/accuracy-breakdown-table'
import { MeasurementAccuracyChart, MeasurementCategoryStatus } from '@/components/admin/measurement-accuracy-chart'

export default async function AccuracyPage() {
  const [metrics, byScoreBucket, byState, errorDistribution, measurementBreakdown] = await Promise.all([
    getAccuracyMetrics(),
    getAccuracyBreakdown('score_bucket'),
    getAccuracyBreakdown('state'),
    getErrorDistribution(),
    getMeasurementAccuracyBreakdown()
  ])

  return (
    <div className="p-4 lg:p-6 space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">Accuracy Dashboard</h1>
        <p className="text-muted-foreground">
          Real-time accuracy metrics and performance insights.
        </p>
      </div>

      {/* Key Metrics */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Target className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">
                  {metrics.mae_gross?.toFixed(1) || '-'}"
                </p>
                <p className="text-sm text-muted-foreground">MAE (Gross)</p>
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
                  {metrics.median_error_gross?.toFixed(1) || '-'}"
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
                  {metrics.total_with_ground_truth > 0 
                    ? `${((metrics.within_10_inches / metrics.total_with_ground_truth) * 100).toFixed(0)}%`
                    : '-'
                  }
                </p>
                <p className="text-sm text-muted-foreground">Within 10"</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <BarChart3 className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">
                  {metrics.rmse_gross?.toFixed(1) || '-'}"
                </p>
                <p className="text-sm text-muted-foreground">RMSE</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Layers className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">
                  {metrics.total_with_ground_truth}
                </p>
                <p className="text-sm text-muted-foreground">With Ground Truth</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Coverage Stats */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-8">
            <div>
              <p className="text-sm text-muted-foreground">Total Predictions</p>
              <p className="text-xl font-semibold">{metrics.total_predictions.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Ground Truth Coverage</p>
              <p className="text-xl font-semibold">{metrics.coverage_percent.toFixed(1)}%</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Current Model</p>
              <p className="text-xl font-semibold">{metrics.current_model_version || 'v1.0'}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Within 5"</p>
              <p className="text-xl font-semibold">{metrics.within_5_inches}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Within 15"</p>
              <p className="text-xl font-semibold">{metrics.within_15_inches}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Measurement-Level Accuracy (Phase 21) */}
      {measurementBreakdown.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Ruler className="h-5 w-5 text-primary" />
              <div>
                <CardTitle className="text-lg">Measurement-Level Accuracy</CardTitle>
                <CardDescription>
                  Per-category error before and after correction
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-6 lg:grid-cols-2">
              <div>
                <p className="text-sm font-medium mb-3">Before vs After Correction</p>
                <MeasurementAccuracyChart data={measurementBreakdown} />
              </div>
              <div>
                <p className="text-sm font-medium mb-3">Improvement by Category</p>
                <MeasurementAccuracyChart data={measurementBreakdown} showImprovement />
              </div>
            </div>
            <div>
              <p className="text-sm font-medium mb-3">Category Status</p>
              <MeasurementCategoryStatus 
                data={measurementBreakdown.map(m => ({
                  category: m.category,
                  status: m.improvement === null 
                    ? 'unchanged' 
                    : m.improvement > 0.25 
                      ? 'improved' 
                      : m.improvement < -0.25 
                        ? 'worsened' 
                        : 'unchanged',
                  changeAmount: m.improvement ?? 0,
                }))}
              />
            </div>
            <div className="grid gap-4 grid-cols-2 lg:grid-cols-4 pt-2 border-t border-border">
              {measurementBreakdown.map((m) => (
                <div key={m.category} className="text-center">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">{m.label}</p>
                  <div className="flex items-baseline justify-center gap-1 mt-1">
                    <span className="text-lg font-semibold">
                      {m.maeAfter?.toFixed(1) ?? m.maeBefore?.toFixed(1) ?? '-'}"
                    </span>
                    {m.improvement !== null && m.improvement !== 0 && (
                      <span className={`text-xs ${m.improvement > 0 ? 'text-primary' : 'text-destructive'}`}>
                        ({m.improvement > 0 ? '-' : '+'}{Math.abs(m.improvement).toFixed(1)}")
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {m.sampleCount} samples
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Charts Row */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Error Trend (30 Days)</CardTitle>
            <CardDescription>
              Mean absolute error over time
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AccuracyTrendChart data={metrics.error_trend_30d} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Error Distribution</CardTitle>
            <CardDescription>
              Distribution of prediction errors (negative = under-predicted)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ErrorDistributionChart data={errorDistribution} />
          </CardContent>
        </Card>
      </div>

      {/* Breakdown Tables */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Accuracy by Score Range</CardTitle>
            <CardDescription>
              Performance breakdown by ground truth score bucket
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AccuracyBreakdownTable data={byScoreBucket.breakdown} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Accuracy by State</CardTitle>
            <CardDescription>
              Regional performance differences
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AccuracyBreakdownTable data={byState.breakdown} />
          </CardContent>
        </Card>
      </div>

      {/* Model Version History */}
      {metrics.model_accuracy_history.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Model Version History</CardTitle>
            <CardDescription>
              Accuracy progression across model versions
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 px-2">Version</th>
                    <th className="text-right py-3 px-2">MAE</th>
                    <th className="text-right py-3 px-2">Samples</th>
                    <th className="text-left py-3 px-2">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.model_accuracy_history.map((model, idx) => (
                    <tr key={idx} className="border-b border-border last:border-0">
                      <td className="py-3 px-2 font-medium">{model.version_name}</td>
                      <td className="py-3 px-2 text-right font-mono">
                        {model.mae_gross?.toFixed(1) || '-'}"
                      </td>
                      <td className="py-3 px-2 text-right">
                        {model.sample_count.toLocaleString()}
                      </td>
                      <td className="py-3 px-2 text-muted-foreground">
                        {new Date(model.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
