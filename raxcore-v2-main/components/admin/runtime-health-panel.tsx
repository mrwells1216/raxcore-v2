'use client'

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { 
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  Clock, 
  RefreshCw,
  Image as ImageIcon,
  Activity 
} from 'lucide-react'
import type { RuntimeHealthMetrics, FallbackReason, VisionRuntimeErrorType } from '@/lib/types'

interface RuntimeHealthPanelProps {
  metrics: RuntimeHealthMetrics
}

export function RuntimeHealthPanel({ metrics }: RuntimeHealthPanelProps) {
  // Determine overall health status
  const getHealthStatus = () => {
    if (metrics.visionSuccessRate >= 95 && metrics.timeoutRate < 2) {
      return { status: 'healthy', color: 'text-primary', icon: CheckCircle2 }
    }
    if (metrics.visionSuccessRate >= 85 && metrics.timeoutRate < 5) {
      return { status: 'degraded', color: 'text-yellow-600', icon: AlertTriangle }
    }
    return { status: 'unhealthy', color: 'text-destructive', icon: XCircle }
  }

  const health = getHealthStatus()
  const HealthIcon = health.icon

  // Format fallback reason for display
  const formatFallbackReason = (reason: FallbackReason): string => {
    const labels: Record<FallbackReason, string> = {
      vision_timeout: 'Timeout',
      vision_provider_error: 'Provider Error',
      vision_rate_limit: 'Rate Limited',
      vision_quota_exceeded: 'Quota Exceeded',
      vision_model_unavailable: 'Model Unavailable',
      vision_malformed_response: 'Bad Response',
      vision_validation_failed: 'Validation Failed',
      vision_content_blocked: 'Content Blocked',
      image_validation_failed: 'Image Invalid',
      no_valid_images: 'No Valid Images',
      all_images_inaccessible: 'Images Inaccessible',
      unknown_error: 'Unknown',
    }
    return labels[reason] || reason
  }

  // Get color for error type
  const getErrorTypeColor = (type: VisionRuntimeErrorType): string => {
    const colors: Record<VisionRuntimeErrorType, string> = {
      timeout: 'bg-yellow-100 text-yellow-800',
      rate_limit: 'bg-orange-100 text-orange-800',
      provider_error: 'bg-red-100 text-red-800',
      network_error: 'bg-red-100 text-red-800',
      malformed_response: 'bg-purple-100 text-purple-800',
      incomplete_response: 'bg-purple-100 text-purple-800',
      validation_error: 'bg-blue-100 text-blue-800',
      quota_exceeded: 'bg-red-100 text-red-800',
      model_unavailable: 'bg-gray-100 text-gray-800',
      content_policy: 'bg-pink-100 text-pink-800',
      unknown: 'bg-gray-100 text-gray-800',
    }
    return colors[type] || 'bg-gray-100 text-gray-800'
  }

  return (
    <div className="space-y-6">
      {/* Overall Health Status */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <HealthIcon className={`h-6 w-6 ${health.color}`} />
          <div>
            <p className="text-sm font-medium">System Health</p>
            <p className="text-xs text-muted-foreground capitalize">{health.status}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold">{metrics.visionSuccessRate.toFixed(1)}%</p>
          <p className="text-xs text-muted-foreground">Vision Success Rate</p>
        </div>
      </div>

      {/* Key Metrics Grid */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <div className="p-3 bg-muted/50 rounded-lg">
          <div className="flex items-center gap-2 mb-1">
            <Activity className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Total Predictions</span>
          </div>
          <p className="text-lg font-semibold">{metrics.totalPredictions.toLocaleString()}</p>
        </div>

        <div className="p-3 bg-muted/50 rounded-lg">
          <div className="flex items-center gap-2 mb-1">
            <RefreshCw className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Fallback Rate</span>
          </div>
          <p className="text-lg font-semibold">{metrics.fallbackRate.toFixed(1)}%</p>
        </div>

        <div className="p-3 bg-muted/50 rounded-lg">
          <div className="flex items-center gap-2 mb-1">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Timeout Rate</span>
          </div>
          <p className="text-lg font-semibold">{metrics.timeoutRate.toFixed(1)}%</p>
        </div>

        <div className="p-3 bg-muted/50 rounded-lg">
          <div className="flex items-center gap-2 mb-1">
            <ImageIcon className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Avg Valid Images</span>
          </div>
          <p className="text-lg font-semibold">{metrics.avgValidImagesPerRequest.toFixed(1)}</p>
        </div>
      </div>

      {/* Timing Stats */}
      <div className="space-y-2">
        <p className="text-sm font-medium">Response Timing</p>
        <div className="flex gap-4 text-sm">
          <div>
            <span className="text-muted-foreground">Avg: </span>
            <span className="font-medium">
              {metrics.avgVisionTimeMs ? `${Math.round(metrics.avgVisionTimeMs)}ms` : '-'}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">P95: </span>
            <span className="font-medium">
              {metrics.p95VisionTimeMs ? `${Math.round(metrics.p95VisionTimeMs)}ms` : '-'}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">Retry Rate: </span>
            <span className="font-medium">{metrics.retryRate.toFixed(1)}%</span>
          </div>
        </div>
      </div>

      {/* Error Type Breakdown */}
      {Object.keys(metrics.errorTypeCounts).length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Error Types (30d)</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(metrics.errorTypeCounts)
              .sort((a, b) => b[1] - a[1])
              .map(([type, count]) => (
                <Badge 
                  key={type} 
                  variant="secondary"
                  className={getErrorTypeColor(type as VisionRuntimeErrorType)}
                >
                  {type.replace('_', ' ')}: {count}
                </Badge>
              ))}
          </div>
        </div>
      )}

      {/* Fallback Reason Breakdown */}
      {Object.keys(metrics.fallbackReasonCounts).length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Fallback Reasons (30d)</p>
          <div className="space-y-1">
            {Object.entries(metrics.fallbackReasonCounts)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 5)
              .map(([reason, count]) => {
                const percent = (count / metrics.totalPredictions) * 100
                return (
                  <div key={reason} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      {formatFallbackReason(reason as FallbackReason)}
                    </span>
                    <span className="font-medium">{count} ({percent.toFixed(1)}%)</span>
                  </div>
                )
              })}
          </div>
        </div>
      )}

      {/* Common Image Issues */}
      {metrics.commonImageIssues.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Common Image Issues</p>
          <div className="flex flex-wrap gap-2">
            {metrics.commonImageIssues.map(issue => (
              <Badge key={issue.type} variant="outline" className="text-xs">
                {issue.type.replace('_', ' ')}: {issue.count}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* 7-Day Trend */}
      {metrics.healthTrend7d.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">7-Day Trend</p>
          <div className="overflow-x-auto">
            <div className="flex gap-2 min-w-max">
              {metrics.healthTrend7d.map((day, i) => (
                <div 
                  key={day.date} 
                  className={`p-2 rounded text-center min-w-[80px] ${
                    day.successRate >= 95 ? 'bg-primary/10' :
                    day.successRate >= 85 ? 'bg-yellow-50' :
                    'bg-red-50'
                  }`}
                >
                  <p className="text-xs text-muted-foreground">
                    {new Date(day.date).toLocaleDateString('en-US', { weekday: 'short' })}
                  </p>
                  <p className="text-sm font-semibold">{day.successRate.toFixed(0)}%</p>
                  <p className="text-xs text-muted-foreground">
                    {day.avgTimeMs > 0 ? `${Math.round(day.avgTimeMs)}ms` : '-'}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Compact version for overview cards
export function RuntimeHealthBadge({ metrics }: { metrics: RuntimeHealthMetrics | null }) {
  if (!metrics) {
    return <Badge variant="secondary">No Data</Badge>
  }

  if (metrics.visionSuccessRate >= 95 && metrics.timeoutRate < 2) {
    return (
      <Badge className="bg-primary/10 text-primary border-primary/20">
        <CheckCircle2 className="h-3 w-3 mr-1" />
        Healthy
      </Badge>
    )
  }

  if (metrics.visionSuccessRate >= 85) {
    return (
      <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200">
        <AlertTriangle className="h-3 w-3 mr-1" />
        Degraded
      </Badge>
    )
  }

  return (
    <Badge variant="destructive">
      <XCircle className="h-3 w-3 mr-1" />
      Issues
    </Badge>
  )
}
