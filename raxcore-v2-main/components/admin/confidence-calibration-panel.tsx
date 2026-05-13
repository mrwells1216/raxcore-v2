'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import type { ConfidenceCalibrationMetrics, ConfidenceCalibrationPoint, ConfidenceTier } from '@/lib/types'

interface ConfidenceCalibrationPanelProps {
  metrics: ConfidenceCalibrationMetrics
  calibrationPoints?: ConfidenceCalibrationPoint[]
}

const tierColors: Record<ConfidenceTier, string> = {
  very_high: 'bg-green-500',
  high: 'bg-emerald-500',
  medium: 'bg-yellow-500',
  low: 'bg-orange-500',
  very_low: 'bg-red-500',
}

const tierLabels: Record<ConfidenceTier, string> = {
  very_high: 'Very High',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  very_low: 'Very Low',
}

export function ConfidenceCalibrationPanel({ metrics, calibrationPoints }: ConfidenceCalibrationPanelProps) {
  const isWellCalibrated = metrics.calibrationR2 !== null && metrics.calibrationR2 > 0.5
  const hasGoodCorrelation = metrics.confidenceErrorCorrelation !== null && 
    Math.abs(metrics.confidenceErrorCorrelation) > 0.3

  return (
    <div className="space-y-6">
      {/* Overview Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="text-center p-3 bg-muted/50 rounded-lg">
          <div className="text-2xl font-bold">{metrics.totalPredictionsAnalyzed}</div>
          <div className="text-xs text-muted-foreground">Predictions Analyzed</div>
        </div>
        <div className="text-center p-3 bg-muted/50 rounded-lg">
          <div className="text-2xl font-bold">
            {metrics.calibrationR2 !== null ? (metrics.calibrationR2 * 100).toFixed(1) + '%' : 'N/A'}
          </div>
          <div className="text-xs text-muted-foreground">Calibration R²</div>
        </div>
        <div className="text-center p-3 bg-muted/50 rounded-lg">
          <div className="text-2xl font-bold text-orange-500">
            {metrics.overconfidentPercent.toFixed(1)}%
          </div>
          <div className="text-xs text-muted-foreground">Overconfident</div>
        </div>
        <div className="text-center p-3 bg-muted/50 rounded-lg">
          <div className="text-2xl font-bold text-blue-500">
            {metrics.underconfidentPercent.toFixed(1)}%
          </div>
          <div className="text-xs text-muted-foreground">Underconfident</div>
        </div>
      </div>

      {/* Calibration Status */}
      <div className="flex items-center gap-2">
        <Badge variant={isWellCalibrated ? 'default' : 'secondary'}>
          {isWellCalibrated ? 'Well Calibrated' : 'Needs Calibration'}
        </Badge>
        {hasGoodCorrelation && (
          <Badge variant="outline">
            Conf-Error Correlation: {(metrics.confidenceErrorCorrelation! * -1).toFixed(2)}
          </Badge>
        )}
      </div>

      {/* Tier Accuracy */}
      {metrics.tierAccuracy.length > 0 && (
        <div>
          <h4 className="text-sm font-medium mb-3">Accuracy by Confidence Tier</h4>
          <div className="space-y-3">
            {metrics.tierAccuracy.map((tier) => (
              <div key={tier.tier} className="flex items-center gap-3">
                <div className="w-20 flex items-center gap-2">
                  <div className={`w-3 h-3 rounded-full ${tierColors[tier.tier]}`} />
                  <span className="text-sm">{tierLabels[tier.tier]}</span>
                </div>
                <div className="flex-1">
                  <Progress value={tier.accuracy} className="h-2" />
                </div>
                <div className="w-32 text-xs text-muted-foreground text-right">
                  {tier.actualMae.toFixed(1)}" actual / {tier.predictedMae.toFixed(1)}" expected
                </div>
                <div className="w-16 text-xs text-right">
                  n={tier.sampleCount}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Trust Score Effectiveness */}
      {(metrics.highTrustAvgError !== null || metrics.lowTrustAvgError !== null) && (
        <div className="grid grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">High Trust Predictions</CardTitle>
              <CardDescription className="text-xs">Trust score 70+</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">
                {metrics.highTrustAvgError !== null ? metrics.highTrustAvgError.toFixed(1) + '"' : 'N/A'}
              </div>
              <div className="text-xs text-muted-foreground">Average Error</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Low Trust Predictions</CardTitle>
              <CardDescription className="text-xs">Trust score below 50</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">
                {metrics.lowTrustAvgError !== null ? metrics.lowTrustAvgError.toFixed(1) + '"' : 'N/A'}
              </div>
              <div className="text-xs text-muted-foreground">Average Error</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Calibration Points Chart (simple table view) */}
      {calibrationPoints && calibrationPoints.length > 0 && (
        <div>
          <h4 className="text-sm font-medium mb-3">Calibration by Confidence Bucket</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-2">Bucket</th>
                  <th className="text-right py-2 px-2">Raw Conf</th>
                  <th className="text-right py-2 px-2">Calibrated</th>
                  <th className="text-right py-2 px-2">Actual MAE</th>
                  <th className="text-right py-2 px-2">Within 5"</th>
                  <th className="text-right py-2 px-2">Within 10"</th>
                  <th className="text-right py-2 px-2">N</th>
                </tr>
              </thead>
              <tbody>
                {calibrationPoints.map((point) => (
                  <tr key={point.confidenceBucket} className="border-b">
                    <td className="py-2 px-2">{point.confidenceBucket}</td>
                    <td className="text-right py-2 px-2">{point.avgRawConfidence.toFixed(0)}%</td>
                    <td className="text-right py-2 px-2">{point.avgCalibratedConfidence.toFixed(0)}%</td>
                    <td className="text-right py-2 px-2">{point.actualMae.toFixed(1)}"</td>
                    <td className="text-right py-2 px-2">{point.within5InchesPercent.toFixed(0)}%</td>
                    <td className="text-right py-2 px-2">{point.within10InchesPercent.toFixed(0)}%</td>
                    <td className="text-right py-2 px-2 text-muted-foreground">{point.sampleCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

export function ConfidenceCalibrationBadge({ metrics }: { metrics: ConfidenceCalibrationMetrics }) {
  const isWellCalibrated = metrics.calibrationR2 !== null && metrics.calibrationR2 > 0.5
  
  return (
    <Badge variant={isWellCalibrated ? 'default' : 'secondary'} className="text-xs">
      Cal R²: {metrics.calibrationR2 !== null ? (metrics.calibrationR2 * 100).toFixed(0) + '%' : 'N/A'}
    </Badge>
  )
}
