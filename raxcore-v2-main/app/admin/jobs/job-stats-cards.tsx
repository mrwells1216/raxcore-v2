'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { 
  Clock, 
  PlayCircle, 
  CheckCircle, 
  XCircle, 
  AlertTriangle,
  Zap 
} from 'lucide-react'
import type { JobStats } from '@/lib/jobs/types'

interface JobStatsCardsProps {
  stats: JobStats
}

export function JobStatsCards({ stats }: JobStatsCardsProps) {
  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
    return `${(ms / 60000).toFixed(1)}m`
  }

  const formatSuccessRate = (rate: number) => {
    return `${(rate * 100).toFixed(1)}%`
  }

  return (
    <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" /> Queued
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold">{stats.queued}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
            <PlayCircle className="h-3.5 w-3.5" /> Running
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
            {stats.running}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
            <CheckCircle className="h-3.5 w-3.5" /> Completed
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold text-green-600 dark:text-green-400">
            {stats.completed}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
            <XCircle className="h-3.5 w-3.5" /> Failed
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold text-red-600 dark:text-red-400">
            {stats.failed}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5" /> Dead Letter
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold text-orange-600 dark:text-orange-400">
            {stats.deadLetter}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
            <Zap className="h-3.5 w-3.5" /> Success Rate
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold">
            {formatSuccessRate(stats.successRate)}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Avg: {formatDuration(stats.avgDurationMs)}
          </p>
        </CardContent>
      </Card>

      {Object.keys(stats.byType).length > 0 && (
        <div className="col-span-full">
          <div className="flex flex-wrap gap-2">
            {Object.entries(stats.byType)
              .sort(([, a], [, b]) => b - a)
              .map(([type, count]) => (
                <div 
                  key={type} 
                  className="rounded-full border px-3 py-1 text-xs font-medium"
                >
                  {type}: {count}
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  )
}
