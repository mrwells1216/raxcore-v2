'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertTriangle,
  CheckCircle,
  TrendingUp,
  TrendingDown,
  Activity,
  Shield,
  RefreshCw,
} from 'lucide-react'
import type { DriftAnalysisResult, DriftDetectionLog } from '@/lib/types'

const fetcher = (url: string) => fetch(url).then(res => res.json())

export function DriftAlertsPanel() {
  const { data: analysisData, isLoading: analysisLoading, mutate: mutateAnalysis } = useSWR<{ analysis: DriftAnalysisResult }>(
    '/api/admin/influence/drift?action=analyze',
    fetcher,
    { refreshInterval: 60000 }
  )
  
  const { data: alertsData, isLoading: alertsLoading, mutate: mutateAlerts } = useSWR<{ alerts: DriftDetectionLog[] }>(
    '/api/admin/influence/drift?action=alerts',
    fetcher,
    { refreshInterval: 60000 }
  )
  
  const [resolving, setResolving] = useState<string | null>(null)
  const [resolutionNotes, setResolutionNotes] = useState('')
  const [showResolveDialog, setShowResolveDialog] = useState(false)
  const [selectedAlert, setSelectedAlert] = useState<DriftDetectionLog | null>(null)
  
  const analysis = analysisData?.analysis
  const alerts = alertsData?.alerts || []
  
  const handleResolve = async () => {
    if (!selectedAlert) return
    
    setResolving(selectedAlert.id)
    
    try {
      const res = await fetch('/api/admin/influence/drift', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'resolve',
          alert_id: selectedAlert.id,
          resolution_notes: resolutionNotes,
          resolved_by: 'admin',
        }),
      })
      
      if (res.ok) {
        mutateAlerts()
        mutateAnalysis()
        setShowResolveDialog(false)
        setResolutionNotes('')
        setSelectedAlert(null)
      }
    } finally {
      setResolving(null)
    }
  }
  
  return (
    <div className="space-y-6">
      {/* Current Status Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Current Drift Status
          </CardTitle>
          <CardDescription>
            Real-time analysis of learning correction patterns
          </CardDescription>
        </CardHeader>
        <CardContent>
          {analysisLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : analysis ? (
            <div className="grid gap-4 md:grid-cols-3">
              <div className="bg-muted/50 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  {analysis.hasActiveDrift ? (
                    <AlertTriangle className="h-5 w-5 text-amber-500" />
                  ) : (
                    <CheckCircle className="h-5 w-5 text-emerald-500" />
                  )}
                  <span className="font-medium">Overall Status</span>
                </div>
                <div className={`text-2xl font-bold ${
                  analysis.hasActiveDrift ? 'text-amber-600' : 'text-emerald-600'
                }`}>
                  {analysis.hasActiveDrift ? 'Drift Detected' : 'Stable'}
                </div>
                {analysis.strengthMultiplier < 1 && (
                  <div className="text-sm text-muted-foreground mt-1">
                    Strength reduced to {(analysis.strengthMultiplier * 100).toFixed(0)}%
                  </div>
                )}
              </div>
              
              <div className="bg-muted/50 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  {analysis.currentBias.direction === 'positive' ? (
                    <TrendingUp className="h-5 w-5 text-emerald-500" />
                  ) : analysis.currentBias.direction === 'negative' ? (
                    <TrendingDown className="h-5 w-5 text-rose-500" />
                  ) : (
                    <Activity className="h-5 w-5 text-blue-500" />
                  )}
                  <span className="font-medium">Directional Bias</span>
                </div>
                <div className="text-2xl font-bold capitalize">
                  {analysis.currentBias.direction}
                </div>
                <div className="text-sm text-muted-foreground mt-1">
                  Ratio: {analysis.currentBias.ratio.toFixed(2)} | 
                  Magnitude: {analysis.currentBias.magnitude.toFixed(1)}&quot;
                </div>
              </div>
              
              <div className="bg-muted/50 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Shield className="h-5 w-5 text-blue-500" />
                  <span className="font-medium">Recommended Action</span>
                </div>
                <div className="text-lg font-medium">
                  {formatAction(analysis.recommendedAction)}
                </div>
                <div className="text-sm text-muted-foreground mt-1">
                  {analysis.driftAlerts.length} unresolved alert(s)
                </div>
              </div>
            </div>
          ) : (
            <div className="text-muted-foreground">Unable to load drift analysis</div>
          )}
        </CardContent>
      </Card>
      
      {/* Alerts List */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Drift Alerts</CardTitle>
              <CardDescription>
                Detected drift events requiring attention
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                mutateAlerts()
                mutateAnalysis()
              }}
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {alertsLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-24 w-full" />
              ))}
            </div>
          ) : alerts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <CheckCircle className="h-12 w-12 mb-3 text-emerald-500" />
              <span>No unresolved drift alerts</span>
            </div>
          ) : (
            <div className="space-y-3">
              {alerts.map((alert) => (
                <div
                  key={alert.id}
                  className="border rounded-lg p-4 bg-card"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant={getSeverityVariant(alert.severity)}>
                          {alert.severity}
                        </Badge>
                        <Badge variant="outline">
                          {formatDriftType(alert.drift_type)}
                        </Badge>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        Detected {new Date(alert.detected_at).toLocaleString()}
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSelectedAlert(alert)
                        setShowResolveDialog(true)
                      }}
                    >
                      Resolve
                    </Button>
                  </div>
                  
                  <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                    <div>Window: <span className="font-medium">{alert.detection_window_hours}h</span></div>
                    <div>Samples: <span className="font-medium">{alert.samples_analyzed}</span></div>
                    {alert.action_taken && (
                      <div className="col-span-2">
                        Action: <span className="font-medium">{formatAction(alert.action_taken)}</span>
                      </div>
                    )}
                  </div>
                  
                  {alert.drift_metrics && (
                    <div className="mt-2 text-xs text-muted-foreground">
                      {Object.entries(alert.drift_metrics)
                        .filter(([_, v]) => v !== undefined && v !== null)
                        .slice(0, 3)
                        .map(([k, v]) => `${k}: ${typeof v === 'number' ? v.toFixed(2) : v}`)
                        .join(' | ')}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      
      {/* Resolve Dialog */}
      <Dialog open={showResolveDialog} onOpenChange={setShowResolveDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resolve Drift Alert</DialogTitle>
            <DialogDescription>
              Mark this drift alert as resolved and add any notes about the resolution.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            {selectedAlert && (
              <div className="bg-muted/50 rounded-lg p-3 text-sm">
                <div className="font-medium mb-1">
                  {formatDriftType(selectedAlert.drift_type)} - {selectedAlert.severity}
                </div>
                <div className="text-muted-foreground">
                  Detected {new Date(selectedAlert.detected_at).toLocaleString()}
                </div>
              </div>
            )}
            
            <div>
              <label className="text-sm font-medium">Resolution Notes</label>
              <Textarea
                value={resolutionNotes}
                onChange={(e) => setResolutionNotes(e.target.value)}
                placeholder="Describe how this drift was addressed..."
                className="mt-1"
              />
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowResolveDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleResolve} disabled={resolving !== null}>
              {resolving ? 'Resolving...' : 'Resolve Alert'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function getSeverityVariant(severity: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (severity) {
    case 'critical': return 'destructive'
    case 'high': return 'destructive'
    case 'medium': return 'default'
    case 'low': return 'secondary'
    default: return 'outline'
  }
}

function formatDriftType(type: string): string {
  return type.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

function formatAction(action: string): string {
  if (action === 'none') return 'No Action'
  return action.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}
