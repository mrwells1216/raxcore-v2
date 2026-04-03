'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Shield,
  Target,
  Activity,
  Database,
  Settings,
  RefreshCw,
  Lightbulb,
} from 'lucide-react'
import type { 
  ReleaseReadinessReport, 
  ReleaseReadinessCategory, 
  ReleaseReadinessCheck,
  ReleaseReadinessStatus,
} from '@/lib/types'

interface ReleaseReadinessPanelProps {
  report: ReleaseReadinessReport
  onRefresh?: () => void
  loading?: boolean
}

const categoryIcons: Record<ReleaseReadinessCategory, React.ComponentType<{ className?: string }>> = {
  accuracy: Target,
  runtime: Activity,
  calibration: Settings,
  data_quality: Database,
  cost: Shield,
}

const categoryLabels: Record<ReleaseReadinessCategory, string> = {
  accuracy: 'Accuracy',
  runtime: 'Runtime',
  calibration: 'Calibration',
  data_quality: 'Data Quality',
  cost: 'Cost',
}

const statusConfig: Record<ReleaseReadinessStatus, { color: string; icon: React.ComponentType<{ className?: string }>; label: string }> = {
  ready: { color: 'text-primary bg-primary/10', icon: CheckCircle2, label: 'Ready to Promote' },
  warnings: { color: 'text-yellow-600 bg-yellow-100', icon: AlertTriangle, label: 'Warnings Present' },
  issues: { color: 'text-orange-600 bg-orange-100', icon: AlertTriangle, label: 'Issues Found' },
  blocked: { color: 'text-destructive bg-destructive/10', icon: XCircle, label: 'Blocked' },
}

function CheckRow({ check }: { check: ReleaseReadinessCheck }) {
  const [expanded, setExpanded] = useState(false)
  
  return (
    <div className="border-b border-border last:border-0 py-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {check.check_passed ? (
            <CheckCircle2 className="h-4 w-4 text-primary" />
          ) : check.severity === 'blocker' ? (
            <XCircle className="h-4 w-4 text-destructive" />
          ) : (
            <AlertTriangle className="h-4 w-4 text-yellow-600" />
          )}
          <span className="text-sm">{check.check_name}</span>
        </div>
        <div className="flex items-center gap-2">
          {check.check_value !== null && (
            <span className="text-sm text-muted-foreground">
              {typeof check.check_value === 'number' 
                ? check.check_value.toFixed(1) 
                : check.check_value}
              {check.check_threshold !== null && (
                <span className="text-xs"> / {check.check_threshold}</span>
              )}
            </span>
          )}
          {!check.check_passed && (
            <Badge 
              variant="secondary" 
              className={check.severity === 'blocker' ? 'bg-destructive/10 text-destructive' : 'bg-yellow-100 text-yellow-800'}
            >
              {check.severity}
            </Badge>
          )}
          {check.check_details && (
            <Button 
              variant="ghost" 
              size="sm" 
              className="h-6 w-6 p-0"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </Button>
          )}
        </div>
      </div>
      {expanded && check.check_details && (
        <div className="mt-2 ml-6 p-2 bg-muted/50 rounded text-xs text-muted-foreground">
          <pre className="whitespace-pre-wrap">
            {JSON.stringify(check.check_details, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}

function CategorySection({ 
  category, 
  checks 
}: { 
  category: ReleaseReadinessCategory
  checks: ReleaseReadinessCheck[] 
}) {
  const [open, setOpen] = useState(true)
  const Icon = categoryIcons[category]
  const passedCount = checks.filter(c => c.check_passed).length
  const hasFailures = checks.some(c => !c.check_passed)

  if (checks.length === 0) return null

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg cursor-pointer hover:bg-muted/50 transition-colors">
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">{categoryLabels[category]}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-sm ${hasFailures ? 'text-destructive' : 'text-primary'}`}>
              {passedCount}/{checks.length} passed
            </span>
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </div>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 space-y-1 px-2">
          {checks.map(check => (
            <CheckRow key={check.id} check={check} />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

export function ReleaseReadinessPanel({ report, onRefresh, loading }: ReleaseReadinessPanelProps) {
  const statusInfo = statusConfig[report.status]
  const StatusIcon = statusInfo.icon

  return (
    <div className="space-y-6">
      {/* Overall Status */}
      <div className={`p-4 rounded-lg ${statusInfo.color}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <StatusIcon className="h-6 w-6" />
            <div>
              <p className="font-semibold">{statusInfo.label}</p>
              <p className="text-sm opacity-80">
                {report.summary.passed_checks} of {report.summary.total_checks} checks passed
              </p>
            </div>
          </div>
          {onRefresh && (
            <Button 
              variant="outline" 
              size="sm" 
              onClick={onRefresh}
              disabled={loading}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          )}
        </div>
      </div>

      {/* Model/Calibration Info */}
      <div className="grid gap-4 grid-cols-2">
        <div className="p-3 bg-muted/30 rounded-lg">
          <p className="text-xs text-muted-foreground">Model Version</p>
          <p className="font-medium">{report.model_name || 'Default'}</p>
        </div>
        <div className="p-3 bg-muted/30 rounded-lg">
          <p className="text-xs text-muted-foreground">Calibration Profile</p>
          <p className="font-medium">{report.calibration_name || 'Default'}</p>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid gap-4 grid-cols-4">
        <div className="text-center p-3 bg-muted/30 rounded-lg">
          <p className="text-2xl font-bold">{report.summary.total_checks}</p>
          <p className="text-xs text-muted-foreground">Total Checks</p>
        </div>
        <div className="text-center p-3 bg-primary/10 rounded-lg">
          <p className="text-2xl font-bold text-primary">{report.summary.passed_checks}</p>
          <p className="text-xs text-muted-foreground">Passed</p>
        </div>
        <div className="text-center p-3 bg-destructive/10 rounded-lg">
          <p className="text-2xl font-bold text-destructive">{report.summary.blocker_count}</p>
          <p className="text-xs text-muted-foreground">Blockers</p>
        </div>
        <div className="text-center p-3 bg-yellow-100 rounded-lg">
          <p className="text-2xl font-bold text-yellow-800">{report.summary.warning_count}</p>
          <p className="text-xs text-muted-foreground">Warnings</p>
        </div>
      </div>

      {/* Blockers */}
      {report.blockers.length > 0 && (
        <Card className="border-destructive/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2 text-destructive">
              <XCircle className="h-5 w-5" />
              Blockers ({report.blockers.length})
            </CardTitle>
            <CardDescription>These must be resolved before promotion</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {report.blockers.map(check => (
                <CheckRow key={check.id} check={check} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Warnings */}
      {report.warnings.length > 0 && (
        <Card className="border-yellow-500/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2 text-yellow-700">
              <AlertTriangle className="h-5 w-5" />
              Warnings ({report.warnings.length})
            </CardTitle>
            <CardDescription>Review before promotion</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {report.warnings.map(check => (
                <CheckRow key={check.id} check={check} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* All Checks by Category */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">All Checks</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {(['accuracy', 'runtime', 'calibration', 'data_quality', 'cost'] as ReleaseReadinessCategory[]).map(category => (
            <CategorySection 
              key={category} 
              category={category} 
              checks={report.checks_by_category[category]} 
            />
          ))}
        </CardContent>
      </Card>

      {/* Recommendations */}
      {report.recommendations.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Lightbulb className="h-5 w-5 text-yellow-600" />
              Recommendations
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {report.recommendations.map((rec, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className="text-muted-foreground">{i + 1}.</span>
                  <span>{rec}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Promotion Safety */}
      <div className={`p-4 rounded-lg border ${report.is_safe_to_promote ? 'border-primary bg-primary/5' : 'border-destructive bg-destructive/5'}`}>
        <div className="flex items-center gap-2">
          {report.is_safe_to_promote ? (
            <>
              <CheckCircle2 className="h-5 w-5 text-primary" />
              <span className="font-medium text-primary">Safe to Promote</span>
            </>
          ) : (
            <>
              <XCircle className="h-5 w-5 text-destructive" />
              <span className="font-medium text-destructive">Not Safe to Promote</span>
            </>
          )}
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          {report.is_safe_to_promote 
            ? 'All blocking checks passed. Review warnings before promoting.'
            : `${report.summary.blocker_count} blocking issue${report.summary.blocker_count !== 1 ? 's' : ''} must be resolved.`
          }
        </p>
      </div>

      {/* Last Checked */}
      {report.last_checked_at && (
        <p className="text-xs text-muted-foreground text-center">
          Last checked: {new Date(report.last_checked_at).toLocaleString()}
        </p>
      )}
    </div>
  )
}

// Compact badge version for overview cards
export function ReleaseReadinessBadge({ status }: { status: ReleaseReadinessStatus }) {
  const config = statusConfig[status]
  const Icon = config.icon

  return (
    <Badge className={config.color}>
      <Icon className="h-3 w-3 mr-1" />
      {config.label}
    </Badge>
  )
}
