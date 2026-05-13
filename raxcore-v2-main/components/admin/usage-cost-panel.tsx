'use client'

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Activity,
  Image as ImageIcon,
  DollarSign,
  Clock,
  TrendingUp,
  AlertTriangle,
  Users,
  Zap,
} from 'lucide-react'
import type { UsageReportSummary, DailyUsageSummary, MonthlyUsageSummary } from '@/lib/types'

interface UsageCostPanelProps {
  summary: UsageReportSummary
  dailyData?: DailyUsageSummary[]
  monthlyData?: MonthlyUsageSummary[]
}

function formatCost(dollars: number): string {
  if (dollars < 0.01) return '<$0.01'
  if (dollars < 1) return `$${dollars.toFixed(2)}`
  return `$${dollars.toFixed(2)}`
}

function formatNumber(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return n.toString()
}

export function UsageCostPanel({ summary, dailyData, monthlyData }: UsageCostPanelProps) {
  const periodLabel = summary.period === 'day' ? 'Today' : summary.period === 'week' ? 'This Week' : 'This Month'
  
  return (
    <div className="space-y-6">
      {/* Key Metrics */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <div className="p-4 bg-muted/30 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <Activity className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Requests</span>
          </div>
          <p className="text-2xl font-bold">{formatNumber(summary.totals.requests)}</p>
          <p className="text-xs text-muted-foreground">{periodLabel}</p>
        </div>

        <div className="p-4 bg-muted/30 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <ImageIcon className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Images</span>
          </div>
          <p className="text-2xl font-bold">{formatNumber(summary.totals.images_processed)}</p>
          <p className="text-xs text-muted-foreground">{summary.rates.avg_images_per_request.toFixed(1)} per request</p>
        </div>

        <div className="p-4 bg-muted/30 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Vision Calls</span>
          </div>
          <p className="text-2xl font-bold">{formatNumber(summary.totals.vision_calls)}</p>
          <p className="text-xs text-muted-foreground">{summary.rates.success_rate.toFixed(1)}% success</p>
        </div>

        <div className="p-4 bg-primary/10 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign className="h-4 w-4 text-primary" />
            <span className="text-xs text-muted-foreground">Est. Cost</span>
          </div>
          <p className="text-2xl font-bold text-primary">{formatCost(summary.totals.cost_dollars)}</p>
          <p className="text-xs text-muted-foreground">{periodLabel}</p>
        </div>
      </div>

      {/* Success/Error Rates */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <div className="p-3 border rounded-lg">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Success Rate</span>
            <Badge className={summary.rates.success_rate >= 95 ? 'bg-primary/10 text-primary' : summary.rates.success_rate >= 85 ? 'bg-yellow-100 text-yellow-800' : 'bg-destructive/10 text-destructive'}>
              {summary.rates.success_rate.toFixed(1)}%
            </Badge>
          </div>
        </div>

        <div className="p-3 border rounded-lg">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Fallback Rate</span>
            <Badge className={summary.rates.fallback_rate <= 5 ? 'bg-primary/10 text-primary' : summary.rates.fallback_rate <= 15 ? 'bg-yellow-100 text-yellow-800' : 'bg-destructive/10 text-destructive'}>
              {summary.rates.fallback_rate.toFixed(1)}%
            </Badge>
          </div>
        </div>

        <div className="p-3 border rounded-lg">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Timeout Rate</span>
            <Badge className={summary.rates.timeout_rate <= 2 ? 'bg-primary/10 text-primary' : summary.rates.timeout_rate <= 5 ? 'bg-yellow-100 text-yellow-800' : 'bg-destructive/10 text-destructive'}>
              {summary.rates.timeout_rate.toFixed(1)}%
            </Badge>
          </div>
        </div>

        <div className="p-3 border rounded-lg">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Retry Rate</span>
            <Badge className={summary.rates.retry_rate <= 10 ? 'bg-primary/10 text-primary' : 'bg-yellow-100 text-yellow-800'}>
              {summary.rates.retry_rate.toFixed(1)}%
            </Badge>
          </div>
        </div>
      </div>

      {/* Timing Stats */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Response Timing
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 grid-cols-3">
            <div>
              <p className="text-sm text-muted-foreground">Avg Processing</p>
              <p className="text-xl font-semibold">
                {summary.timing.avg_processing_ms 
                  ? `${Math.round(summary.timing.avg_processing_ms)}ms`
                  : '-'}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">P95 Processing</p>
              <p className="text-xl font-semibold">
                {summary.timing.p95_processing_ms 
                  ? `${Math.round(summary.timing.p95_processing_ms)}ms`
                  : '-'}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Avg Vision</p>
              <p className="text-xl font-semibold">
                {summary.timing.avg_vision_ms 
                  ? `${Math.round(summary.timing.avg_vision_ms)}ms`
                  : '-'}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Error Breakdown */}
      {summary.top_error_types.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-600" />
              Error Types
            </CardTitle>
            <CardDescription>{summary.totals.errors} total errors</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {summary.top_error_types.map(({ type, count }) => {
                const percent = (count / summary.totals.requests) * 100
                return (
                  <div key={type} className="flex items-center justify-between">
                    <span className="text-sm capitalize">{type.replace('_', ' ')}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">{count}</span>
                      <Badge variant="outline" className="text-xs">
                        {percent.toFixed(1)}%
                      </Badge>
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Daily Trend */}
      {dailyData && dailyData.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Daily Usage (Last 7 Days)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <div className="flex gap-2 min-w-max">
                {dailyData.slice(0, 7).map((day) => (
                  <div 
                    key={day.date} 
                    className="p-3 bg-muted/30 rounded-lg text-center min-w-[100px]"
                  >
                    <p className="text-xs text-muted-foreground">
                      {new Date(day.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                    </p>
                    <p className="text-lg font-semibold mt-1">{day.total_requests}</p>
                    <p className="text-xs text-muted-foreground">requests</p>
                    <div className="flex justify-center gap-1 mt-2">
                      <Badge variant="outline" className="text-xs">
                        {formatCost(day.total_cost_mc / 100000)}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Monthly Cost Summary */}
      {monthlyData && monthlyData.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <DollarSign className="h-5 w-5" />
              Monthly Cost Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 font-medium">Month</th>
                    <th className="text-right py-2 font-medium">Requests</th>
                    <th className="text-right py-2 font-medium">Images</th>
                    <th className="text-right py-2 font-medium">Vision Calls</th>
                    <th className="text-right py-2 font-medium">Est. Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyData.slice(0, 6).map((month) => (
                    <tr key={month.month} className="border-b border-muted">
                      <td className="py-2">
                        {new Date(month.month).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                      </td>
                      <td className="text-right py-2">{formatNumber(month.total_requests)}</td>
                      <td className="text-right py-2">{formatNumber(month.total_images)}</td>
                      <td className="text-right py-2">{formatNumber(month.total_vision_calls)}</td>
                      <td className="text-right py-2 font-medium">{formatCost(month.total_cost_dollars)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Unique Clients */}
      <div className="p-4 bg-muted/30 rounded-lg flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Unique Clients ({periodLabel})</span>
        </div>
        <p className="text-lg font-semibold">{summary.unique_clients}</p>
      </div>
    </div>
  )
}

// Compact version for dashboard overview
export function UsageCostSummaryCard({ summary }: { summary: UsageReportSummary }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Activity className="h-5 w-5" />
          Usage Summary
        </CardTitle>
        <CardDescription>
          {summary.period === 'day' ? 'Today' : summary.period === 'week' ? 'This Week' : 'This Month'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 grid-cols-2">
          <div>
            <p className="text-2xl font-bold">{formatNumber(summary.totals.requests)}</p>
            <p className="text-xs text-muted-foreground">Requests</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-primary">{formatCost(summary.totals.cost_dollars)}</p>
            <p className="text-xs text-muted-foreground">Est. Cost</p>
          </div>
          <div>
            <p className="text-lg font-semibold">{summary.rates.success_rate.toFixed(1)}%</p>
            <p className="text-xs text-muted-foreground">Success Rate</p>
          </div>
          <div>
            <p className="text-lg font-semibold">{summary.rates.fallback_rate.toFixed(1)}%</p>
            <p className="text-xs text-muted-foreground">Fallback Rate</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
