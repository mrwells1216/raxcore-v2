export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  GitBranch,
  RotateCcw,
  Server,
  Zap,
  Eye,
  Film,
  Activity,
} from 'lucide-react'
import {
  getEventSummary,
  getRecentFailures,
  getErrorBreakdown,
  getServiceSummaries,
  getLatencyTrend,
  type EventSummary,
} from '@/lib/monitoring/service'
import { MonitoringRefreshButton } from '@/components/admin/monitoring-refresh-button'

function StatusBadge({ rate, thresholdWarn = 10, thresholdBad = 25 }: {
  rate: number
  thresholdWarn?: number
  thresholdBad?: number
}) {
  if (rate >= thresholdBad) return <Badge variant="destructive">{rate}%</Badge>
  if (rate >= thresholdWarn) return <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/20">{rate}%</Badge>
  return <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/20">{rate}%</Badge>
}

function MetricCard({
  label,
  value,
  sub,
  icon: Icon,
  alert,
}: {
  label: string
  value: string | number
  sub?: string
  icon: React.ComponentType<{ className?: string }>
  alert?: 'warn' | 'bad' | null
}) {
  return (
    <Card className={alert === 'bad' ? 'border-destructive/50' : alert === 'warn' ? 'border-amber-500/40' : ''}>
      <CardContent className="pt-5 pb-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3">
            <div className={`flex h-9 w-9 items-center justify-center rounded-lg shrink-0 ${alert === 'bad' ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary'}`}>
              <Icon className="h-4 w-4" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground leading-tight">{label}</p>
              <p className="text-xl font-bold leading-tight">{value}</p>
              {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function ServiceRow({
  name,
  icon: Icon,
  summary,
}: {
  name: string
  icon: React.ComponentType<{ className?: string }>
  summary: EventSummary
}) {
  return (
    <div className="flex items-center gap-3 py-3 border-b last:border-0">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted shrink-0">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium capitalize">{name}</p>
        <p className="text-xs text-muted-foreground">
          {summary.total} events &middot; avg {summary.avgDurationMs ? `${summary.avgDurationMs}ms` : '--'}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <StatusBadge rate={summary.errorRate} />
        {summary.fallbackRate > 0 && (
          <span className="text-xs text-muted-foreground">
            {summary.fallbackRate}% fallback
          </span>
        )}
      </div>
    </div>
  )
}

const SERVICE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  score: Activity,
  vision: Eye,
  render: Film,
  benchmark: Server,
}

export default async function MonitoringPage() {
  const window24h = 24
  const window1h = 1

  const [
    summary24h,
    summary1h,
    errorBreakdown,
    recentFailures,
    serviceSummaries,
    scoreLatency,
  ] = await Promise.all([
    getEventSummary(window24h).catch(() => null),
    getEventSummary(window1h).catch(() => null),
    getErrorBreakdown(window24h).catch(() => []),
    getRecentFailures(25).catch(() => []),
    getServiceSummaries(window24h).catch(() => ({})),
    getLatencyTrend(24, 'score').catch(() => []),
  ])

  const errorRate1h = summary1h?.errorRate ?? 0
  const fallbackRate1h = summary1h?.fallbackRate ?? 0

  return (
    <div className="p-4 lg:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Monitoring</h1>
          <p className="text-muted-foreground text-sm">
            Live observability — scoring, vision, render, fallback rates
          </p>
        </div>
        <MonitoringRefreshButton />
      </div>

      {/* 1-hour alert strip */}
      {(errorRate1h >= 25 || fallbackRate1h >= 50) && (
        <div className="flex items-center gap-3 rounded-lg border border-destructive/50 bg-destructive/5 px-4 py-3">
          <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
          <div className="text-sm">
            <span className="font-semibold text-destructive">Elevated error rate in the last hour:</span>{' '}
            {errorRate1h}% errors
            {fallbackRate1h >= 50 && `, ${fallbackRate1h}% vision fallback`}.
            Check recent failures below.
          </div>
        </div>
      )}

      {/* 24h KPI row */}
      <div>
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">
          Last 24 Hours
        </h2>
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="Total Events"
            value={summary24h?.total ?? 0}
            icon={Activity}
          />
          <MetricCard
            label="Error Rate"
            value={`${summary24h?.errorRate ?? 0}%`}
            sub={`${summary24h?.failures ?? 0} failures`}
            icon={AlertTriangle}
            alert={(summary24h?.errorRate ?? 0) >= 25 ? 'bad' : (summary24h?.errorRate ?? 0) >= 10 ? 'warn' : null}
          />
          <MetricCard
            label="Fallback Rate"
            value={`${summary24h?.fallbackRate ?? 0}%`}
            sub={`${summary24h?.fallbacks ?? 0} fallbacks`}
            icon={GitBranch}
            alert={(summary24h?.fallbackRate ?? 0) >= 50 ? 'bad' : (summary24h?.fallbackRate ?? 0) >= 25 ? 'warn' : null}
          />
          <MetricCard
            label="Avg Latency"
            value={summary24h?.avgDurationMs ? `${summary24h.avgDurationMs}ms` : '--'}
            sub={summary24h?.p95DurationMs ? `p95: ${summary24h.p95DurationMs}ms` : undefined}
            icon={Clock}
          />
        </div>
      </div>

      {/* 1h quick stats */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Card className="col-span-2 lg:col-span-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Last 1 Hour</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-muted-foreground">Events</p>
                <p className="text-2xl font-bold">{summary1h?.total ?? 0}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Errors</p>
                <p className="text-2xl font-bold">{summary1h?.failures ?? 0}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Fallbacks</p>
                <p className="text-2xl font-bold">{summary1h?.fallbacks ?? 0}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Retried</p>
                <p className="text-2xl font-bold">{summary1h?.retried ?? 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Service breakdown + error type breakdown */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Service breakdown */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Server className="h-4 w-4" />
              Service Error Rates (24h)
            </CardTitle>
            <CardDescription>Per-service event volume and error rate</CardDescription>
          </CardHeader>
          <CardContent>
            {Object.keys(serviceSummaries).length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No events recorded yet.</p>
            ) : (
              <div>
                {(['score', 'vision', 'render', 'benchmark'] as const).map(svc => {
                  const s = (serviceSummaries as Record<string, import('@/lib/monitoring/service').EventSummary | undefined>)[svc]
                  if (!s || s.total === 0) return null
                  return (
                    <ServiceRow
                      key={svc}
                      name={svc}
                      icon={SERVICE_ICONS[svc] ?? Activity}
                      summary={s}
                    />
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Error type breakdown */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Zap className="h-4 w-4" />
              Error Types (24h)
            </CardTitle>
            <CardDescription>Failures grouped by classified error type</CardDescription>
          </CardHeader>
          <CardContent>
            {errorBreakdown.length === 0 ? (
              <div className="flex items-center gap-2 py-6 justify-center text-sm text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-4 w-4" />
                No failures in the last 24h
              </div>
            ) : (
              <div className="space-y-2">
                {errorBreakdown.map(({ error_type, count }) => (
                  <div key={error_type} className="flex items-center gap-2">
                    <div className="flex-1 flex items-center justify-between text-sm">
                      <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{error_type}</span>
                      <span className="font-medium">{count}</span>
                    </div>
                    <div className="w-24 bg-muted rounded-full h-1.5 overflow-hidden">
                      <div
                        className="h-full bg-destructive/60 rounded-full"
                        style={{ width: `${Math.min(100, (count / (errorBreakdown[0]?.count ?? 1)) * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent failures table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4" />
              Recent Failures
            </CardTitle>
            <CardDescription>Last 25 failure/warning events across all services</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {recentFailures.length === 0 ? (
            <div className="flex items-center gap-2 py-8 justify-center text-sm text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4" />
              No recent failures — looking good
            </div>
          ) : (
            <div className="overflow-x-auto -mx-2">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="px-2 py-2 text-xs font-medium text-muted-foreground">Time</th>
                    <th className="px-2 py-2 text-xs font-medium text-muted-foreground">Service</th>
                    <th className="px-2 py-2 text-xs font-medium text-muted-foreground">Event</th>
                    <th className="px-2 py-2 text-xs font-medium text-muted-foreground">Error</th>
                    <th className="px-2 py-2 text-xs font-medium text-muted-foreground">Flags</th>
                    <th className="px-2 py-2 text-xs font-medium text-muted-foreground">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {recentFailures.map((ev) => (
                    <tr key={ev.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-2 py-2 text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(ev.created_at).toLocaleString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="px-2 py-2">
                        <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{ev.service}</span>
                      </td>
                      <td className="px-2 py-2 text-xs text-muted-foreground font-mono">{ev.event_type}</td>
                      <td className="px-2 py-2">
                        {ev.error_type ? (
                          <span className="font-mono text-xs bg-destructive/10 text-destructive px-1.5 py-0.5 rounded">
                            {ev.error_type}
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex gap-1">
                          {ev.fallback_used && (
                            <span title="Fallback used">
                              <GitBranch className="h-3.5 w-3.5 text-amber-500" />
                            </span>
                          )}
                          {(ev.retry_count ?? 0) > 0 && (
                            <span title={`${ev.retry_count} retries`}>
                              <RotateCcw className="h-3.5 w-3.5 text-muted-foreground" />
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-2">
                        <Link
                          href={`/admin/monitoring/event/${ev.id}`}
                          className="text-xs text-primary underline-offset-2 hover:underline"
                        >
                          View
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Latency trend (score service, last 24h) */}
      {scoreLatency.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="h-4 w-4" />
              Score Latency Trend (24h, hourly)
            </CardTitle>
            <CardDescription>Average and p95 latency per hour for scoring requests</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto -mx-2">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-left">
                    <th className="px-2 py-2 text-muted-foreground">Hour</th>
                    <th className="px-2 py-2 text-muted-foreground">Count</th>
                    <th className="px-2 py-2 text-muted-foreground">Avg</th>
                    <th className="px-2 py-2 text-muted-foreground">p95</th>
                  </tr>
                </thead>
                <tbody>
                  {scoreLatency.slice(-12).reverse().map((row) => (
                    <tr key={row.hour} className="border-b last:border-0">
                      <td className="px-2 py-1.5 text-muted-foreground">
                        {new Date(row.hour).toLocaleString(undefined, {
                          month: 'short', day: 'numeric',
                          hour: '2-digit', minute: '2-digit',
                        })}
                      </td>
                      <td className="px-2 py-1.5">{row.count}</td>
                      <td className="px-2 py-1.5">
                        <span className={row.avg_ms > 10000 ? 'text-destructive font-medium' : row.avg_ms > 5000 ? 'text-amber-600' : ''}>
                          {(row.avg_ms / 1000).toFixed(1)}s
                        </span>
                      </td>
                      <td className="px-2 py-1.5">
                        <span className={row.p95_ms > 15000 ? 'text-destructive font-medium' : ''}>
                          {(row.p95_ms / 1000).toFixed(1)}s
                        </span>
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
