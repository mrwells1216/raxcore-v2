'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Layers, CheckCircle, AlertTriangle, XCircle, GitBranch, Images, BarChart3 } from 'lucide-react'

interface MVStats {
  totalSets: number
  completed: number
  fallbackUsed: number
  failed: number
  avgConnectivity: number
  avgImageCount: number
  avgDisagreement: number
  qualityTiers: {
    excellent: number
    good: number
    fair: number
    poor: number
    fallback: number
  }
}

interface MVStatsCardsProps {
  stats: MVStats
}

export function MVStatsCards({ stats }: MVStatsCardsProps) {
  const successRate = stats.totalSets > 0 
    ? ((stats.completed / stats.totalSets) * 100).toFixed(1) 
    : '0'
  
  const goodOrBetter = stats.qualityTiers.excellent + stats.qualityTiers.good
  const qualityRate = stats.totalSets > 0
    ? ((goodOrBetter / stats.totalSets) * 100).toFixed(1)
    : '0'
  
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {/* Total Sets */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Total MV Sets
          </CardTitle>
          <Layers className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{stats.totalSets}</div>
          <p className="text-xs text-muted-foreground mt-1">
            {stats.avgImageCount.toFixed(1)} images avg
          </p>
        </CardContent>
      </Card>

      {/* Success Rate */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Fusion Success
          </CardTitle>
          <CheckCircle className="h-4 w-4 text-green-600" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{successRate}%</div>
          <p className="text-xs text-muted-foreground mt-1">
            {stats.completed} completed
          </p>
        </CardContent>
      </Card>

      {/* Fallback Rate */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Fallback Used
          </CardTitle>
          <AlertTriangle className="h-4 w-4 text-amber-600" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{stats.fallbackUsed}</div>
          <p className="text-xs text-muted-foreground mt-1">
            {stats.totalSets > 0 
              ? ((stats.fallbackUsed / stats.totalSets) * 100).toFixed(1) 
              : 0}% of sets
          </p>
        </CardContent>
      </Card>

      {/* Quality Rate */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Good+ Quality
          </CardTitle>
          <BarChart3 className="h-4 w-4 text-blue-600" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{qualityRate}%</div>
          <p className="text-xs text-muted-foreground mt-1">
            {goodOrBetter} excellent/good
          </p>
        </CardContent>
      </Card>

      {/* Graph Connectivity */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Avg Connectivity
          </CardTitle>
          <GitBranch className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {(stats.avgConnectivity * 100).toFixed(0)}%
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Graph strength
          </p>
        </CardContent>
      </Card>

      {/* Avg Images */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Avg Images
          </CardTitle>
          <Images className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{stats.avgImageCount.toFixed(1)}</div>
          <p className="text-xs text-muted-foreground mt-1">
            Per MV set
          </p>
        </CardContent>
      </Card>

      {/* Avg Disagreement */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Avg Disagreement
          </CardTitle>
          <XCircle className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {(stats.avgDisagreement * 100).toFixed(0)}%
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Family conflict
          </p>
        </CardContent>
      </Card>

      {/* Failed */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Failed
          </CardTitle>
          <XCircle className="h-4 w-4 text-red-600" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{stats.failed}</div>
          <p className="text-xs text-muted-foreground mt-1">
            Processing errors
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
