'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import {
  Target,
  TrendingUp,
  TrendingDown,
  BarChart3,
  Clock,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react'
import type { BulkRunSummaryMetrics, ModelRunMetrics } from '@/lib/types'

interface BulkRunMetricsCardsProps {
  metrics: BulkRunSummaryMetrics
}

export function BulkRunMetricsCards({ metrics }: BulkRunMetricsCardsProps) {
  const primary = metrics.primary_model

  return (
    <div className="space-y-6">
      {/* Primary Model Metrics */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Mean Absolute Error"
          value={`${primary.avg_gross_error.toFixed(1)}"`}
          subtitle="Average error (gross)"
          icon={Target}
          trend={primary.avg_gross_error <= 10 ? 'good' : primary.avg_gross_error <= 15 ? 'warning' : 'bad'}
        />
        <MetricCard
          title="Median Error"
          value={`${primary.median_gross_error.toFixed(1)}"`}
          subtitle="Middle value of errors"
          icon={BarChart3}
          trend={primary.median_gross_error <= 8 ? 'good' : primary.median_gross_error <= 12 ? 'warning' : 'bad'}
        />
        <MetricCard
          title="RMSE"
          value={`${primary.rmse_gross.toFixed(1)}"`}
          subtitle="Root mean square error"
          icon={TrendingUp}
          trend={primary.rmse_gross <= 12 ? 'good' : primary.rmse_gross <= 18 ? 'warning' : 'bad'}
        />
        <MetricCard
          title="Avg Confidence"
          value={primary.avg_confidence_percent != null ? `${primary.avg_confidence_percent.toFixed(0)}%` : '-'}
          subtitle="Model certainty"
          icon={CheckCircle2}
          trend={
            primary.avg_confidence_percent != null
              ? primary.avg_confidence_percent >= 70
                ? 'good'
                : primary.avg_confidence_percent >= 50
                ? 'warning'
                : 'bad'
              : 'neutral'
          }
        />
      </div>

      {/* Distribution Metrics */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Error Distribution</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <DistributionItem
              label="Within 5 inches"
              count={primary.within_5_inches}
              total={primary.example_count}
            />
            <DistributionItem
              label="Within 10 inches"
              count={primary.within_10_inches}
              total={primary.example_count}
            />
            <DistributionItem
              label="Within 5% error"
              count={primary.within_5_percent}
              total={primary.example_count}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-3 pt-4 border-t">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-red-500/10">
                <TrendingUp className="h-4 w-4 text-red-600" />
              </div>
              <div>
                <p className="font-medium">{primary.overestimation_count}</p>
                <p className="text-sm text-muted-foreground">Overestimations</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10">
                <TrendingDown className="h-4 w-4 text-blue-600" />
              </div>
              <div>
                <p className="font-medium">{primary.underestimation_count}</p>
                <p className="text-sm text-muted-foreground">Underestimations</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-500/10">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
              </div>
              <div>
                <p className="font-medium">{primary.exact_count}</p>
                <p className="text-sm text-muted-foreground">Exact Matches</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Comparison Models (if any) */}
      {metrics.comparison_models.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Model Comparison</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 pr-4 font-medium">Model</th>
                    <th className="text-right py-2 px-4 font-medium">MAE</th>
                    <th className="text-right py-2 px-4 font-medium">Median</th>
                    <th className="text-right py-2 px-4 font-medium">RMSE</th>
                    <th className="text-right py-2 px-4 font-medium">Within 10&quot;</th>
                    <th className="text-right py-2 pl-4 font-medium">Samples</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b bg-muted/50">
                    <td className="py-2 pr-4">
                      <Badge variant="default">{primary.model_version_name || 'Primary'}</Badge>
                    </td>
                    <td className="text-right py-2 px-4 font-mono">
                      {primary.avg_gross_error.toFixed(1)}&quot;
                    </td>
                    <td className="text-right py-2 px-4 font-mono">
                      {primary.median_gross_error.toFixed(1)}&quot;
                    </td>
                    <td className="text-right py-2 px-4 font-mono">
                      {primary.rmse_gross.toFixed(1)}&quot;
                    </td>
                    <td className="text-right py-2 px-4 font-mono">
                      {primary.example_count > 0
                        ? ((primary.within_10_inches / primary.example_count) * 100).toFixed(0)
                        : 0}
                      %
                    </td>
                    <td className="text-right py-2 pl-4">{primary.example_count}</td>
                  </tr>
                  {metrics.comparison_models.map((cm) => (
                    <ComparisonModelRow key={cm.model_version_id} model={cm} primary={primary} />
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Processing Stats */}
      {primary.avg_processing_time_ms != null && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Clock className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="font-medium">
                  {primary.avg_processing_time_ms.toFixed(0)}ms average
                </p>
                <p className="text-sm text-muted-foreground">
                  Processing time per example
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function MetricCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
}: {
  title: string
  value: string
  subtitle: string
  icon: React.ComponentType<{ className?: string }>
  trend: 'good' | 'warning' | 'bad' | 'neutral'
}) {
  const trendColors = {
    good: 'text-green-600',
    warning: 'text-yellow-600',
    bad: 'text-red-600',
    neutral: 'text-muted-foreground',
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className={`text-2xl font-bold ${trendColors[trend]}`}>{value}</p>
            <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
          </div>
          <div className={`p-2 rounded-lg bg-muted ${trendColors[trend]}`}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function DistributionItem({
  label,
  count,
  total,
}: {
  label: string
  count: number
  total: number
}) {
  const percent = total > 0 ? (count / total) * 100 : 0

  return (
    <div className="space-y-2">
      <div className="flex justify-between text-sm">
        <span>{label}</span>
        <span className="font-medium">
          {count} ({percent.toFixed(0)}%)
        </span>
      </div>
      <Progress value={percent} className="h-2" />
    </div>
  )
}

function ComparisonModelRow({
  model,
  primary,
}: {
  model: ModelRunMetrics
  primary: ModelRunMetrics
}) {
  const maeDiff = model.avg_gross_error - primary.avg_gross_error
  const isWorse = maeDiff > 0

  return (
    <tr className="border-b">
      <td className="py-2 pr-4">
        <Badge variant="outline">{model.model_version_name || 'Unknown'}</Badge>
      </td>
      <td className="text-right py-2 px-4 font-mono">
        <span className={isWorse ? 'text-red-600' : 'text-green-600'}>
          {model.avg_gross_error.toFixed(1)}&quot;
        </span>
        <span className="text-xs text-muted-foreground ml-1">
          ({maeDiff > 0 ? '+' : ''}
          {maeDiff.toFixed(1)})
        </span>
      </td>
      <td className="text-right py-2 px-4 font-mono">
        {model.median_gross_error.toFixed(1)}&quot;
      </td>
      <td className="text-right py-2 px-4 font-mono">
        {model.rmse_gross.toFixed(1)}&quot;
      </td>
      <td className="text-right py-2 px-4 font-mono">
        {model.example_count > 0
          ? ((model.within_10_inches / model.example_count) * 100).toFixed(0)
          : 0}
        %
      </td>
      <td className="text-right py-2 pl-4">{model.example_count}</td>
    </tr>
  )
}
