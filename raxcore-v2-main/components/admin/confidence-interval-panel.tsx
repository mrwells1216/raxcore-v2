'use client'

import { useState, useEffect } from 'react'
import useSWR from 'swr'
import { 
  Target, 
  TrendingUp, 
  TrendingDown, 
  BarChart3, 
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Camera,
  Info
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'

const fetcher = (url: string) => fetch(url).then(r => r.json())

interface ConfidenceIntervalPanelProps {
  className?: string
}

export function ConfidenceIntervalPanel({ className }: ConfidenceIntervalPanelProps) {
  const { data: calibrationData, error, mutate, isValidating } = useSWR(
    '/api/admin/confidence-intervals/calibration',
    fetcher,
    { revalidateOnFocus: false }
  )

  const { data: guidanceData } = useSWR(
    '/api/admin/confidence-intervals/guidance-effectiveness',
    fetcher,
    { revalidateOnFocus: false }
  )

  return (
    <div className={cn("space-y-6", className)}>
      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <OverviewCard
          title="Interval Coverage"
          value={calibrationData?.overallCoverage ?? '--'}
          suffix="%"
          description="Actuals within predicted band"
          trend={calibrationData?.coverageTrend}
          icon={Target}
        />
        <OverviewCard
          title="Avg Band Width"
          value={calibrationData?.avgBandWidth ?? '--'}
          suffix='"'
          description="Mean error band width"
          icon={BarChart3}
        />
        <OverviewCard
          title="Photo Guidance Shown"
          value={guidanceData?.totalShown ?? '--'}
          description="Recommendations displayed"
          icon={Camera}
        />
        <OverviewCard
          title="Photo Acceptance Rate"
          value={guidanceData?.acceptanceRate ?? '--'}
          suffix="%"
          description="Users who added photos"
          trend={guidanceData?.acceptanceTrend}
          icon={CheckCircle2}
        />
      </div>

      {/* Detailed Analysis Tabs */}
      <Tabs defaultValue="calibration" className="space-y-4">
        <TabsList>
          <TabsTrigger value="calibration">Interval Calibration</TabsTrigger>
          <TabsTrigger value="family">Family-Level</TabsTrigger>
          <TabsTrigger value="guidance">Photo Guidance</TabsTrigger>
          <TabsTrigger value="segments">By Segment</TabsTrigger>
        </TabsList>

        <TabsContent value="calibration">
          <IntervalCalibrationTable data={calibrationData?.calibrationSummary ?? []} />
        </TabsContent>

        <TabsContent value="family">
          <FamilyUncertaintyAnalysis data={calibrationData?.familyAnalysis ?? []} />
        </TabsContent>

        <TabsContent value="guidance">
          <PhotoGuidanceEffectiveness data={guidanceData?.effectiveness ?? []} />
        </TabsContent>

        <TabsContent value="segments">
          <SegmentIntervalPerformance data={calibrationData?.segmentPerformance ?? []} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// Overview Card Component
interface OverviewCardProps {
  title: string
  value: string | number
  suffix?: string
  description: string
  trend?: {
    direction: 'up' | 'down' | 'flat'
    value: number
  }
  icon: React.ComponentType<{ className?: string }>
}

function OverviewCard({ title, value, suffix = '', description, trend, icon: Icon }: OverviewCardProps) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{title}</p>
            <div className="flex items-baseline gap-1 mt-1">
              <span className="text-2xl font-bold tabular-nums">{value}</span>
              {suffix && <span className="text-lg text-muted-foreground">{suffix}</span>}
            </div>
            <p className="text-xs text-muted-foreground mt-1">{description}</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <Icon className="h-5 w-5 text-muted-foreground" />
            {trend && (
              <div className={cn(
                "flex items-center gap-0.5 text-xs",
                trend.direction === 'up' && "text-primary",
                trend.direction === 'down' && "text-red-500"
              )}>
                {trend.direction === 'up' ? (
                  <TrendingUp className="h-3 w-3" />
                ) : trend.direction === 'down' ? (
                  <TrendingDown className="h-3 w-3" />
                ) : null}
                <span>{trend.value > 0 ? '+' : ''}{trend.value.toFixed(1)}%</span>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// Interval Calibration Table
interface IntervalCalibrationTableProps {
  data: Array<{
    profileType: string
    segmentName: string | null
    sampleCount: number
    coveragePercent: number
    avgBandWidth: number
    avgActualError: number
    highConfMisses: number
    lowConfHits: number
  }>
}

function IntervalCalibrationTable({ data }: IntervalCalibrationTableProps) {
  if (data.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          <Info className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>No interval calibration data available yet.</p>
          <p className="text-sm">Run validation with predictions that include confidence intervals.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Interval Calibration by Profile</CardTitle>
        <CardDescription>
          How well predicted confidence intervals match actual outcomes
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Profile</TableHead>
              <TableHead className="text-right">Samples</TableHead>
              <TableHead className="text-right">Coverage</TableHead>
              <TableHead className="text-right">Avg Band</TableHead>
              <TableHead className="text-right">Avg Error</TableHead>
              <TableHead className="text-right">High Conf Misses</TableHead>
              <TableHead className="text-right">Low Conf Hits</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((row, i) => (
              <TableRow key={i}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      {row.profileType}
                    </Badge>
                    <span className="text-sm">
                      {row.segmentName || 'Global'}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">{row.sampleCount}</TableCell>
                <TableCell className="text-right">
                  <CoverageIndicator value={row.coveragePercent} />
                </TableCell>
                <TableCell className="text-right tabular-nums">{row.avgBandWidth.toFixed(1)}&quot;</TableCell>
                <TableCell className="text-right tabular-nums">{row.avgActualError.toFixed(1)}&quot;</TableCell>
                <TableCell className="text-right">
                  {row.highConfMisses > 0 ? (
                    <span className="text-red-600 dark:text-red-400">{row.highConfMisses}</span>
                  ) : (
                    <span className="text-muted-foreground">0</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {row.lowConfHits > 0 ? (
                    <span className="text-amber-600 dark:text-amber-400">{row.lowConfHits}</span>
                  ) : (
                    <span className="text-muted-foreground">0</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

function CoverageIndicator({ value }: { value: number }) {
  const color = value >= 80 ? 'text-primary' 
    : value >= 60 ? 'text-amber-600 dark:text-amber-400'
    : 'text-red-600 dark:text-red-400'
  
  return (
    <div className="flex items-center justify-end gap-2">
      <Progress 
        value={value} 
        className="w-16 h-1.5"
      />
      <span className={cn("tabular-nums text-sm font-medium", color)}>
        {value.toFixed(0)}%
      </span>
    </div>
  )
}

// Family Uncertainty Analysis
interface FamilyUncertaintyAnalysisProps {
  data: Array<{
    family: string
    avgConfidence: number
    avgError: number
    sampleCount: number
    withinBandPercent: number
  }>
}

function FamilyUncertaintyAnalysis({ data }: FamilyUncertaintyAnalysisProps) {
  if (data.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          <Info className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>No family-level uncertainty data available yet.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Family-Level Uncertainty Accuracy</CardTitle>
        <CardDescription>
          How well per-family confidence scores predict actual errors
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-5 gap-4">
          {data.map((fam) => (
            <div 
              key={fam.family}
              className="p-4 rounded-lg border bg-secondary/30 text-center"
            >
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {fam.family}
              </p>
              <p className="text-2xl font-bold mt-2 tabular-nums">
                {fam.avgConfidence.toFixed(0)}%
              </p>
              <p className="text-xs text-muted-foreground">avg confidence</p>
              <div className="mt-3 pt-3 border-t space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Avg Error</span>
                  <span className="tabular-nums">{fam.avgError.toFixed(1)}&quot;</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">In Band</span>
                  <span className={cn(
                    "tabular-nums",
                    fam.withinBandPercent >= 80 ? "text-primary" : "text-amber-600"
                  )}>
                    {fam.withinBandPercent.toFixed(0)}%
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Samples</span>
                  <span className="tabular-nums">{fam.sampleCount}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

// Photo Guidance Effectiveness
interface PhotoGuidanceEffectivenessProps {
  data: Array<{
    recommendationType: string
    decisionPolicy: string
    targetFamily: string | null
    timesShown: number
    photosAdded: number
    dismissed: number
    acceptanceRate: number
    avgExpectedImprovement: number
    avgActualImprovement: number | null
    improvementDelta: number | null
  }>
}

function PhotoGuidanceEffectiveness({ data }: PhotoGuidanceEffectivenessProps) {
  if (data.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          <Info className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>No photo guidance data available yet.</p>
          <p className="text-sm">Photo recommendations will be tracked as users interact with them.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Photo Guidance Effectiveness</CardTitle>
        <CardDescription>
          How often users follow recommendations and whether it helps
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Recommendation</TableHead>
              <TableHead>Decision</TableHead>
              <TableHead>Target</TableHead>
              <TableHead className="text-right">Shown</TableHead>
              <TableHead className="text-right">Added</TableHead>
              <TableHead className="text-right">Rate</TableHead>
              <TableHead className="text-right">Expected</TableHead>
              <TableHead className="text-right">Actual</TableHead>
              <TableHead className="text-right">Delta</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((row, i) => (
              <TableRow key={i}>
                <TableCell>
                  <Badge variant="outline" className="text-xs">
                    {formatRecommendationType(row.recommendationType)}
                  </Badge>
                </TableCell>
                <TableCell>
                  <span className={cn(
                    "text-xs",
                    row.decisionPolicy === 'strongly_recommend' && "text-amber-600 font-medium"
                  )}>
                    {formatDecisionPolicy(row.decisionPolicy)}
                  </span>
                </TableCell>
                <TableCell className="text-sm">
                  {row.targetFamily || '-'}
                </TableCell>
                <TableCell className="text-right tabular-nums">{row.timesShown}</TableCell>
                <TableCell className="text-right tabular-nums">{row.photosAdded}</TableCell>
                <TableCell className="text-right">
                  <span className={cn(
                    "tabular-nums",
                    row.acceptanceRate >= 50 ? "text-primary" : "text-muted-foreground"
                  )}>
                    {row.acceptanceRate.toFixed(0)}%
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  +{row.avgExpectedImprovement.toFixed(0)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.avgActualImprovement !== null 
                    ? `+${row.avgActualImprovement.toFixed(0)}`
                    : '-'}
                </TableCell>
                <TableCell className="text-right">
                  {row.improvementDelta !== null && (
                    <span className={cn(
                      "tabular-nums",
                      row.improvementDelta >= 0 ? "text-primary" : "text-red-500"
                    )}>
                      {row.improvementDelta >= 0 ? '+' : ''}{row.improvementDelta.toFixed(0)}
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

// Segment Interval Performance
interface SegmentIntervalPerformanceProps {
  data: Array<{
    segmentId: string
    segmentName: string
    level: number
    sampleCount: number
    avgAbsError: number
    p90Error: number
    intervalCoverage80: number | null
    intervalCoverage95: number | null
  }>
}

function SegmentIntervalPerformance({ data }: SegmentIntervalPerformanceProps) {
  if (data.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          <Info className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>No segment interval data available yet.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Interval Performance by Segment</CardTitle>
        <CardDescription>
          How well confidence intervals perform across different segments
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Segment</TableHead>
              <TableHead className="text-right">Level</TableHead>
              <TableHead className="text-right">Samples</TableHead>
              <TableHead className="text-right">Avg Error</TableHead>
              <TableHead className="text-right">P90 Error</TableHead>
              <TableHead className="text-right">80% Coverage</TableHead>
              <TableHead className="text-right">95% Coverage</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((row) => (
              <TableRow key={row.segmentId}>
                <TableCell className="font-medium">{row.segmentName}</TableCell>
                <TableCell className="text-right">
                  <Badge variant="secondary" className="text-xs">
                    L{row.level}
                  </Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">{row.sampleCount}</TableCell>
                <TableCell className="text-right tabular-nums">{row.avgAbsError.toFixed(1)}&quot;</TableCell>
                <TableCell className="text-right tabular-nums">{row.p90Error.toFixed(1)}&quot;</TableCell>
                <TableCell className="text-right">
                  {row.intervalCoverage80 !== null ? (
                    <CoverageIndicator value={row.intervalCoverage80} />
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {row.intervalCoverage95 !== null ? (
                    <CoverageIndicator value={row.intervalCoverage95} />
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

// Utility functions
function formatRecommendationType(type: string): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function formatDecisionPolicy(policy: string): string {
  switch (policy) {
    case 'proceed_current_only': return 'No ask'
    case 'proceed_but_recommend': return 'Suggest'
    case 'strongly_recommend_before_finalize': return 'Strong'
    default: return policy
  }
}
