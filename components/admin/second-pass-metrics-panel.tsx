'use client'

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import type { SecondPassAccuracyMetrics, FinalSelectionMethod, SelfCheckIssueType } from '@/lib/types'

interface SecondPassMetricsPanelProps {
  metrics: SecondPassAccuracyMetrics
}

const selectionMethodLabels: Record<FinalSelectionMethod, string> = {
  first_pass: 'First Pass',
  second_pass: 'Second Pass',
  blend_weighted: 'Weighted Blend',
  blend_conservative: 'Conservative Blend',
}

const issueTypeLabels: Partial<Record<SelfCheckIssueType, string>> = {
  spread_ear_mismatch: 'Spread/Ear Mismatch',
  beam_angle_inconsistency: 'Beam Angle Issue',
  tine_pattern_inconsistent: 'Tine Pattern',
  mass_out_of_range: 'Mass Out of Range',
  extreme_asymmetry: 'Extreme Asymmetry',
  image_disagreement: 'Image Disagreement',
  confidence_stability_mismatch: 'Confidence/Stability',
  anatomical_ratio_violation: 'Ratio Violation',
  normalization_heavy: 'Heavy Normalization',
  landmark_consistency_poor: 'Poor Landmarks',
  measurement_correction_large: 'Large Correction',
  score_range_implausible: 'Implausible Score',
  component_variance_high: 'High Variance',
}

export function SecondPassMetricsPanel({ metrics }: SecondPassMetricsPanelProps) {
  const totalSelections = Object.values(metrics.selection_method_counts).reduce((a, b) => a + b, 0)
  const totalStability = metrics.stable_count + metrics.uncertain_count + metrics.unstable_count

  return (
    <div className="space-y-6">
      {/* Key Metrics Row */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Trigger Rate"
          value={`${metrics.second_pass_trigger_rate.toFixed(1)}%`}
          sublabel={`${metrics.total_predictions_with_two_pass} predictions`}
          status={metrics.second_pass_trigger_rate < 30 ? 'good' : metrics.second_pass_trigger_rate < 50 ? 'warning' : 'alert'}
        />
        <MetricCard
          label="MAE Improvement"
          value={metrics.mae_improvement !== null ? `${metrics.mae_improvement > 0 ? '-' : '+'}${Math.abs(metrics.mae_improvement).toFixed(2)}"` : '-'}
          sublabel={metrics.mae_improvement !== null ? (metrics.mae_improvement > 0 ? 'Better with 2-pass' : 'No improvement') : 'Insufficient data'}
          status={metrics.mae_improvement !== null && metrics.mae_improvement > 0.5 ? 'good' : 'neutral'}
        />
        <MetricCard
          label="First Pass MAE"
          value={metrics.first_pass_only_mae !== null ? `${metrics.first_pass_only_mae.toFixed(2)}"` : '-'}
          sublabel="Before second pass"
          status="neutral"
        />
        <MetricCard
          label="Final MAE"
          value={metrics.with_second_pass_mae !== null ? `${metrics.with_second_pass_mae.toFixed(2)}"` : '-'}
          sublabel="After two-pass"
          status={metrics.with_second_pass_mae !== null && metrics.with_second_pass_mae < 5 ? 'good' : 'neutral'}
        />
      </div>

      {/* Selection Method and Stability */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Selection Method Distribution</CardTitle>
            <CardDescription>How final results are selected</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {(Object.entries(metrics.selection_method_counts) as [FinalSelectionMethod, number][]).map(([method, count]) => {
              const percent = totalSelections > 0 ? (count / totalSelections) * 100 : 0
              return (
                <div key={method} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span>{selectionMethodLabels[method]}</span>
                    <span className="font-mono text-muted-foreground">
                      {count} ({percent.toFixed(0)}%)
                    </span>
                  </div>
                  <Progress value={percent} className="h-2" />
                </div>
              )
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Stability Distribution</CardTitle>
            <CardDescription>Self-check stability assessment</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <StabilityBar 
              label="Stable" 
              count={metrics.stable_count} 
              total={totalStability} 
              color="bg-primary" 
            />
            <StabilityBar 
              label="Uncertain" 
              count={metrics.uncertain_count} 
              total={totalStability} 
              color="bg-amber-500" 
            />
            <StabilityBar 
              label="Unstable" 
              count={metrics.unstable_count} 
              total={totalStability} 
              color="bg-destructive" 
            />
          </CardContent>
        </Card>
      </div>

      {/* Issue Type Frequency */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Self-Check Issue Frequency</CardTitle>
          <CardDescription>Most common issues detected during self-check</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {Object.entries(metrics.issue_type_frequency)
              .sort(([, a], [, b]) => b - a)
              .slice(0, 10)
              .map(([type, count]) => (
                <Badge key={type} variant="secondary" className="text-xs">
                  {issueTypeLabels[type as SelfCheckIssueType] || type}: {count}
                </Badge>
              ))}
          </div>
        </CardContent>
      </Card>

      {/* Best Improvement Scenarios */}
      {metrics.best_improvement_scenarios.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Best Improvement Scenarios</CardTitle>
            <CardDescription>Where second-pass scoring helps most</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {metrics.best_improvement_scenarios.map((scenario, idx) => (
                <div 
                  key={idx} 
                  className="flex items-center justify-between py-2 border-b border-border last:border-0"
                >
                  <span className="text-sm">{scenario.scenario}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-muted-foreground">
                      {scenario.sampleCount} samples
                    </span>
                    <Badge variant="default" className="text-xs">
                      {scenario.improvement.toFixed(0)}% improved
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function MetricCard({ 
  label, 
  value, 
  sublabel, 
  status 
}: { 
  label: string
  value: string
  sublabel: string
  status: 'good' | 'warning' | 'alert' | 'neutral'
}) {
  const statusColors = {
    good: 'bg-primary/10 text-primary',
    warning: 'bg-amber-500/10 text-amber-600',
    alert: 'bg-destructive/10 text-destructive',
    neutral: 'bg-muted text-foreground',
  }

  return (
    <Card>
      <CardContent className="pt-4">
        <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
        <p className={`text-2xl font-bold mt-1 ${statusColors[status].split(' ')[1]}`}>{value}</p>
        <p className="text-xs text-muted-foreground mt-1">{sublabel}</p>
      </CardContent>
    </Card>
  )
}

function StabilityBar({ 
  label, 
  count, 
  total, 
  color 
}: { 
  label: string
  count: number
  total: number
  color: string
}) {
  const percent = total > 0 ? (count / total) * 100 : 0
  
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span>{label}</span>
        <span className="font-mono text-muted-foreground">
          {count} ({percent.toFixed(0)}%)
        </span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div 
          className={`h-full ${color} rounded-full transition-all`} 
          style={{ width: `${percent}%` }} 
        />
      </div>
    </div>
  )
}
