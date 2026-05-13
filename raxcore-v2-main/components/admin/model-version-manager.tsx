'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { 
  CheckCircle2, 
  AlertCircle, 
  Loader2, 
  RotateCcw,
  Play,
  History,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import type { ModelVersionWithCalibration } from '@/lib/types'

interface ModelVersionManagerProps {
  models: ModelVersionWithCalibration[]
  onUpdate: () => void
}

export function ModelVersionManager({
  models,
  onUpdate,
}: ModelVersionManagerProps) {
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null)
  const [showRollbackDialog, setShowRollbackDialog] = useState(false)
  const [rollbackReason, setRollbackReason] = useState('')
  const [includeCalibration, setIncludeCalibration] = useState(true)
  const [loading, setLoading] = useState(false)
  const [activating, setActivating] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [expandedHistory, setExpandedHistory] = useState<string | null>(null)

  const activeModel = models.find(m => m.is_active)

  const handleActivate = async (modelId: string) => {
    setActivating(modelId)
    setError(null)
    setSuccess(null)

    try {
      const response = await fetch('/api/admin/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: modelId }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to activate')
      }

      setSuccess('Model version activated successfully')
      onUpdate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to activate model')
    } finally {
      setActivating(null)
    }
  }

  const handleRollback = async () => {
    if (!selectedModelId || !rollbackReason.trim()) return
    
    setLoading(true)
    setError(null)
    setSuccess(null)

    try {
      const response = await fetch('/api/admin/models/rollback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_model_version_id: selectedModelId,
          reason: rollbackReason.trim(),
          include_calibration: includeCalibration,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to rollback')
      }

      const data = await response.json()
      
      setShowRollbackDialog(false)
      setRollbackReason('')
      setSelectedModelId(null)
      
      if (data.result.warnings?.length > 0) {
        setSuccess(`Rollback complete. Warnings: ${data.result.warnings.join(', ')}`)
      } else {
        setSuccess('Model version rolled back successfully')
      }
      
      onUpdate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rollback')
    } finally {
      setLoading(false)
    }
  }

  const openRollbackDialog = (modelId: string) => {
    setSelectedModelId(modelId)
    setRollbackReason('')
    setShowRollbackDialog(true)
    setError(null)
  }

  return (
    <div className="space-y-6">
      {/* Alerts */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {success && (
        <Alert className="border-green-500/20 bg-green-500/5">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <AlertDescription className="text-green-600">{success}</AlertDescription>
        </Alert>
      )}

      {/* Model Versions Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Model Versions</CardTitle>
          <CardDescription>
            Manage active model version and safely rollback to previous versions
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Version</TableHead>
                  <TableHead className="hidden sm:table-cell">Training Data</TableHead>
                  <TableHead className="hidden md:table-cell">Avg Error</TableHead>
                  <TableHead className="hidden md:table-cell">Last Active</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {models.map(model => {
                  const isActive = model.is_active
                  const isActivating = activating === model.id
                  const hasHistory = model.activation_history && model.activation_history.length > 0
                  const isExpanded = expandedHistory === model.id
                  
                  return (
                    <>
                      <TableRow key={model.id}>
                        <TableCell>
                          <div>
                            <div className="font-medium">{model.version_name}</div>
                            {model.description && (
                              <div className="text-xs text-muted-foreground line-clamp-1 max-w-[150px]">
                                {model.description}
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">
                          {model.training_data_count || 0}
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          {model.avg_gross_error !== null 
                            ? `${model.avg_gross_error.toFixed(1)}"`
                            : '-'
                          }
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          {model.last_activated_at 
                            ? new Date(model.last_activated_at).toLocaleDateString()
                            : '-'
                          }
                        </TableCell>
                        <TableCell>
                          {isActive ? (
                            <Badge className="bg-green-500/10 text-green-600 border-green-500/20">
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                              Active
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-muted-foreground">
                              Inactive
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            {hasHistory && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setExpandedHistory(isExpanded ? null : model.id)}
                              >
                                {isExpanded ? (
                                  <ChevronUp className="h-4 w-4" />
                                ) : (
                                  <ChevronDown className="h-4 w-4" />
                                )}
                              </Button>
                            )}
                            {!isActive && (
                              <>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleActivate(model.id)}
                                  disabled={isActivating}
                                >
                                  {isActivating ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <Play className="h-4 w-4" />
                                  )}
                                  <span className="sr-only sm:not-sr-only sm:ml-2">Activate</span>
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => openRollbackDialog(model.id)}
                                >
                                  <RotateCcw className="h-4 w-4" />
                                  <span className="sr-only sm:not-sr-only sm:ml-2">Rollback</span>
                                </Button>
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                      
                      {/* Expanded History */}
                      {isExpanded && hasHistory && (
                        <TableRow>
                          <TableCell colSpan={6} className="bg-muted/30">
                            <div className="py-2 px-4">
                              <div className="text-sm font-medium mb-2 flex items-center gap-2">
                                <History className="h-4 w-4" />
                                Activation History
                              </div>
                              <div className="space-y-2">
                                {model.activation_history?.slice(0, 5).map(event => (
                                  <div 
                                    key={event.id}
                                    className="flex items-center justify-between text-sm py-1 border-b border-border/50 last:border-0"
                                  >
                                    <div className="flex items-center gap-2">
                                      {event.is_rollback ? (
                                        <Badge variant="outline" className="text-orange-600 border-orange-500/20">
                                          Rollback
                                        </Badge>
                                      ) : (
                                        <Badge variant="outline" className="text-blue-600 border-blue-500/20">
                                          Activated
                                        </Badge>
                                      )}
                                      <span className="text-muted-foreground">
                                        {event.reason || 'No reason provided'}
                                      </span>
                                    </div>
                                    <span className="text-xs text-muted-foreground">
                                      {new Date(event.activated_at).toLocaleString()}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Rollback Warning */}
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          <strong>Safe Rollback:</strong> Rolling back to a previous model version only affects 
          future scoring runs. Historical predictions retain their original model_version and 
          will continue to display correctly.
        </AlertDescription>
      </Alert>

      {/* Rollback Dialog */}
      <Dialog open={showRollbackDialog} onOpenChange={setShowRollbackDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rollback Model Version</DialogTitle>
            <DialogDescription>
              This will change the active model version used for all future scoring runs.
              Historical predictions are not affected.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Target Version</Label>
              <div className="p-3 rounded-lg bg-muted">
                {models.find(m => m.id === selectedModelId)?.version_name || 'Unknown'}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="reason">Reason for Rollback *</Label>
              <Textarea
                id="reason"
                value={rollbackReason}
                onChange={(e) => setRollbackReason(e.target.value)}
                placeholder="Explain why you are rolling back (e.g., 'Model v2.1 shows increased errors on trail cam images')"
                rows={3}
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="includeCalibration"
                checked={includeCalibration}
                onChange={(e) => setIncludeCalibration(e.target.checked)}
                className="h-4 w-4 rounded border-border"
              />
              <Label htmlFor="includeCalibration" className="text-sm">
                Also restore the calibration profile that was active with this model
              </Label>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowRollbackDialog(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleRollback}
              disabled={!rollbackReason.trim() || loading}
              variant="destructive"
            >
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              <RotateCcw className="h-4 w-4 mr-2" />
              Confirm Rollback
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
