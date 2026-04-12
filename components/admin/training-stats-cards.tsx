'use client'

import { Card, CardContent } from '@/components/ui/card'
import { CheckCircle2, AlertTriangle, TrendingDown, Target, Database } from 'lucide-react'

interface TrainingStatsCardsProps {
  totalSamples: number
  officialCount: number
  partialCount: number
  avgDelta: number
  avgAbsError: number
  largestError: number
}

export function TrainingStatsCards({
  totalSamples,
  officialCount,
  partialCount,
  avgDelta,
  avgAbsError,
  largestError,
}: TrainingStatsCardsProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Total Samples</span>
          </div>
          <div className="text-2xl font-bold mt-1">{totalSamples}</div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <span className="text-xs text-muted-foreground">Official</span>
          </div>
          <div className="text-2xl font-bold mt-1 text-green-600">{officialCount}</div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-yellow-600" />
            <span className="text-xs text-muted-foreground">Partial</span>
          </div>
          <div className="text-2xl font-bold mt-1 text-yellow-600">{partialCount}</div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-2">
            <TrendingDown className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Avg Bias</span>
          </div>
          <div className={`text-2xl font-bold mt-1 ${avgDelta > 0 ? 'text-green-600' : avgDelta < 0 ? 'text-red-600' : ''}`}>
            {avgDelta > 0 ? '+' : ''}{avgDelta.toFixed(1)}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Avg MAE</span>
          </div>
          <div className="text-2xl font-bold mt-1">{avgAbsError.toFixed(1)}</div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-600" />
            <span className="text-xs text-muted-foreground">Largest Error</span>
          </div>
          <div className="text-2xl font-bold mt-1 text-red-600">{largestError.toFixed(1)}</div>
        </CardContent>
      </Card>
    </div>
  )
}
