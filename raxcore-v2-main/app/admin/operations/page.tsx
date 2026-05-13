export const dynamic = 'force-dynamic'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Activity, Shield, Settings, CheckCircle, DollarSign } from 'lucide-react'
import { getRuntimeHealthMetrics } from '@/lib/validation/service'
import { getUsageReportSummary, getDailyUsageSummary, getMonthlyUsageSummary, getActiveRateLimitConfig, getActiveProductionConfig } from '@/lib/usage/service'
import { runReadinessChecks } from '@/lib/release/service'
import { RuntimeHealthPanel, RuntimeHealthBadge } from '@/components/admin/runtime-health-panel'
import { UsageCostPanel } from '@/components/admin/usage-cost-panel'
import { ReleaseReadinessPanel, ReleaseReadinessBadge } from '@/components/admin/release-readiness-panel'

export default async function OperationsPage() {
  // Fetch all data in parallel
  const [
    runtimeMetrics,
    usageSummary,
    dailyUsage,
    monthlyUsage,
    rateLimitConfig,
    productionConfig,
    readinessReport,
  ] = await Promise.all([
    getRuntimeHealthMetrics().catch(() => null),
    getUsageReportSummary('week').catch(() => null),
    getDailyUsageSummary(7).catch(() => []),
    getMonthlyUsageSummary(6).catch(() => []),
    getActiveRateLimitConfig().catch(() => null),
    getActiveProductionConfig().catch(() => null),
    runReadinessChecks().catch(() => null),
  ])

  return (
    <div className="p-4 lg:p-6 space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">Operations Center</h1>
        <p className="text-muted-foreground">Monitor production health, usage, and release readiness</p>
      </div>

      {/* Quick Status */}
      <div className="grid gap-4 grid-cols-1 md:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Activity className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Runtime Health</p>
                </div>
              </div>
              <RuntimeHealthBadge metrics={runtimeMetrics} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <DollarSign className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Weekly Cost</p>
                  <p className="text-lg font-semibold">
                    ${usageSummary ? usageSummary.totals.cost_dollars.toFixed(2) : '0.00'}
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <CheckCircle className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Release Status</p>
                </div>
              </div>
              {readinessReport && <ReleaseReadinessBadge status={readinessReport.status} />}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Tabs */}
      <Tabs defaultValue="runtime" className="space-y-4">
        <TabsList className="grid w-full grid-cols-4 lg:w-auto lg:inline-flex">
          <TabsTrigger value="runtime" className="gap-2">
            <Activity className="h-4 w-4" />
            <span className="hidden sm:inline">Runtime</span>
          </TabsTrigger>
          <TabsTrigger value="usage" className="gap-2">
            <DollarSign className="h-4 w-4" />
            <span className="hidden sm:inline">Usage</span>
          </TabsTrigger>
          <TabsTrigger value="readiness" className="gap-2">
            <CheckCircle className="h-4 w-4" />
            <span className="hidden sm:inline">Readiness</span>
          </TabsTrigger>
          <TabsTrigger value="config" className="gap-2">
            <Settings className="h-4 w-4" />
            <span className="hidden sm:inline">Config</span>
          </TabsTrigger>
        </TabsList>

        {/* Runtime Tab */}
        <TabsContent value="runtime">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5" />
                Runtime Health
              </CardTitle>
              <CardDescription>
                Vision API performance, fallback rates, and error monitoring
              </CardDescription>
            </CardHeader>
            <CardContent>
              {runtimeMetrics ? (
                <RuntimeHealthPanel metrics={runtimeMetrics} />
              ) : (
                <p className="text-muted-foreground text-center py-8">
                  No runtime data available. Make some scoring requests first.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Usage Tab */}
        <TabsContent value="usage">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="h-5 w-5" />
                Usage and Cost
              </CardTitle>
              <CardDescription>
                API usage tracking and estimated costs
              </CardDescription>
            </CardHeader>
            <CardContent>
              {usageSummary ? (
                <UsageCostPanel 
                  summary={usageSummary} 
                  dailyData={dailyUsage}
                  monthlyData={monthlyUsage}
                />
              ) : (
                <p className="text-muted-foreground text-center py-8">
                  No usage data available. Make some scoring requests first.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Readiness Tab */}
        <TabsContent value="readiness">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5" />
                Release Readiness
              </CardTitle>
              <CardDescription>
                Evaluate if the current model/calibration is safe to promote
              </CardDescription>
            </CardHeader>
            <CardContent>
              {readinessReport ? (
                <ReleaseReadinessPanel report={readinessReport} />
              ) : (
                <p className="text-muted-foreground text-center py-8">
                  Could not generate readiness report. Check error logs.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Config Tab */}
        <TabsContent value="config">
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Rate Limit Config */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="h-5 w-5" />
                  Rate Limits
                </CardTitle>
                <CardDescription>
                  Current rate limiting configuration
                </CardDescription>
              </CardHeader>
              <CardContent>
                {rateLimitConfig ? (
                  <div className="space-y-4">
                    <div className="grid gap-4 grid-cols-2">
                      <div className="p-3 bg-muted/30 rounded-lg">
                        <p className="text-xs text-muted-foreground">Per Minute</p>
                        <p className="text-lg font-semibold">{rateLimitConfig.requests_per_minute} req</p>
                        <p className="text-xs text-muted-foreground">{rateLimitConfig.images_per_minute} images</p>
                      </div>
                      <div className="p-3 bg-muted/30 rounded-lg">
                        <p className="text-xs text-muted-foreground">Per Hour</p>
                        <p className="text-lg font-semibold">{rateLimitConfig.requests_per_hour} req</p>
                        <p className="text-xs text-muted-foreground">{rateLimitConfig.images_per_hour} images</p>
                      </div>
                      <div className="p-3 bg-muted/30 rounded-lg">
                        <p className="text-xs text-muted-foreground">Per Day</p>
                        <p className="text-lg font-semibold">{rateLimitConfig.requests_per_day} req</p>
                        <p className="text-xs text-muted-foreground">{rateLimitConfig.images_per_day} images</p>
                      </div>
                      <div className="p-3 bg-muted/30 rounded-lg">
                        <p className="text-xs text-muted-foreground">Burst Protection</p>
                        <p className="text-lg font-semibold">{rateLimitConfig.max_burst_requests} req</p>
                        <p className="text-xs text-muted-foreground">per {rateLimitConfig.burst_window_seconds}s</p>
                      </div>
                    </div>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Max images/request</span>
                        <span className="font-medium">{rateLimitConfig.max_images_per_request}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Max retries/request</span>
                        <span className="font-medium">{rateLimitConfig.max_retries_per_request}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Request timeout</span>
                        <span className="font-medium">{rateLimitConfig.request_timeout_ms / 1000}s</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Monthly cost soft limit</span>
                        <span className="font-medium">
                          ${rateLimitConfig.monthly_cost_soft_limit_cents ? (rateLimitConfig.monthly_cost_soft_limit_cents / 100).toFixed(0) : 'N/A'}
                        </span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-muted-foreground text-center py-4">
                    Using default rate limits
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Production Config */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Settings className="h-5 w-5" />
                  Production Safeguards
                </CardTitle>
                <CardDescription>
                  Current production configuration and limits
                </CardDescription>
              </CardHeader>
              <CardContent>
                {productionConfig ? (
                  <div className="space-y-4">
                    <div className="grid gap-4 grid-cols-2">
                      <div className="p-3 bg-muted/30 rounded-lg">
                        <p className="text-xs text-muted-foreground">Images/Request</p>
                        <p className="text-lg font-semibold">{productionConfig.min_images_per_request}-{productionConfig.max_images_per_request}</p>
                      </div>
                      <div className="p-3 bg-muted/30 rounded-lg">
                        <p className="text-xs text-muted-foreground">Max Retries</p>
                        <p className="text-lg font-semibold">{productionConfig.max_retries}</p>
                      </div>
                      <div className="p-3 bg-muted/30 rounded-lg">
                        <p className="text-xs text-muted-foreground">Total Timeout</p>
                        <p className="text-lg font-semibold">{productionConfig.total_timeout_ms / 1000}s</p>
                      </div>
                      <div className="p-3 bg-muted/30 rounded-lg">
                        <p className="text-xs text-muted-foreground">Single Call Timeout</p>
                        <p className="text-lg font-semibold">{productionConfig.single_call_timeout_ms / 1000}s</p>
                      </div>
                    </div>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Max learning correction</span>
                        <span className="font-medium">{productionConfig.max_learning_correction_inches}"</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Confidence bounds</span>
                        <span className="font-medium">{productionConfig.min_confidence_percent}%-{productionConfig.max_confidence_percent}%</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Error band bounds</span>
                        <span className="font-medium">{productionConfig.min_error_band_inches}"-{productionConfig.max_error_band_inches}"</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Fallback penalty</span>
                        <span className="font-medium">-{productionConfig.fallback_confidence_penalty}%</span>
                      </div>
                    </div>
                    <div className="border-t pt-4 space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">Feature Flags</p>
                      <div className="flex flex-wrap gap-2">
                        <span className={`px-2 py-1 text-xs rounded ${productionConfig.vision_scoring_enabled ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
                          Vision Scoring
                        </span>
                        <span className={`px-2 py-1 text-xs rounded ${productionConfig.learning_correction_enabled ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
                          Learning Correction
                        </span>
                        <span className={`px-2 py-1 text-xs rounded ${productionConfig.two_pass_scoring_enabled ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
                          Two-Pass Scoring
                        </span>
                        <span className={`px-2 py-1 text-xs rounded ${productionConfig.fallback_enabled ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
                          Fallback Enabled
                        </span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-muted-foreground text-center py-4">
                    Using default production configuration
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
