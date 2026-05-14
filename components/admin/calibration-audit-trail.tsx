'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Loader2, Settings2, RotateCcw, Play, Edit, Plus } from 'lucide-react'
import type { CalibrationChange, ModelActivationEvent } from '@/lib/types'

interface CalibrationAuditTrailProps {
  changes: CalibrationChange[]
  events: ModelActivationEvent[]
  isLoading: boolean
}

const CHANGE_TYPE_CONFIG: Record<string, { label: string; icon: React.ComponentType<{ className?: string }>; color: string }> = {
  calibration_created: { label: 'Created', icon: Plus, color: 'text-green-600 bg-green-500/10' },
  calibration_updated: { label: 'Updated', icon: Edit, color: 'text-blue-600 bg-blue-500/10' },
  calibration_activated: { label: 'Activated', icon: Play, color: 'text-purple-600 bg-purple-500/10' },
  calibration_deactivated: { label: 'Deactivated', icon: Settings2, color: 'text-gray-600 bg-gray-500/10' },
  model_activated: { label: 'Model Activated', icon: Play, color: 'text-blue-600 bg-blue-500/10' },
  model_rollback: { label: 'Rollback', icon: RotateCcw, color: 'text-orange-600 bg-orange-500/10' },
}

export function CalibrationAuditTrail({
  changes,
  events,
  isLoading,
}: CalibrationAuditTrailProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-32">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Audit Trail</CardTitle>
        <CardDescription>
          Complete history of calibration changes and model activations
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="all">
          <TabsList className="mb-4">
            <TabsTrigger value="all">All Changes</TabsTrigger>
            <TabsTrigger value="calibration">Calibration</TabsTrigger>
            <TabsTrigger value="models">Model Versions</TabsTrigger>
          </TabsList>

          <TabsContent value="all">
            <AuditList 
              items={[
                ...changes.map(c => ({ type: 'calibration' as const, data: c, date: c.created_at })),
                ...events.map(e => ({ type: 'model' as const, data: e, date: e.activated_at })),
              ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())}
            />
          </TabsContent>

          <TabsContent value="calibration">
            <CalibrationChangesList changes={changes} />
          </TabsContent>

          <TabsContent value="models">
            <ModelActivationsList events={events} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}

function AuditList({ items }: { 
  items: Array<
    | { type: 'calibration'; data: CalibrationChange; date: string }
    | { type: 'model'; data: ModelActivationEvent; date: string }
  > 
}) {
  if (items.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No audit history available
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {items.slice(0, 30).map((item, index) => {
        if (item.type === 'calibration') {
          return <CalibrationChangeItem key={`cal-${index}`} change={item.data} />
        }
        return <ModelActivationItem key={`model-${index}`} event={item.data} />
      })}
    </div>
  )
}

function CalibrationChangesList({ changes }: { changes: CalibrationChange[] }) {
  if (changes.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No calibration changes recorded
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {changes.map((change, index) => (
        <CalibrationChangeItem key={index} change={change} />
      ))}
    </div>
  )
}

function CalibrationChangeItem({ change }: { change: CalibrationChange }) {
  const config = CHANGE_TYPE_CONFIG[change.change_type] || {
    label: change.change_type,
    icon: Settings2,
    color: 'text-gray-600 bg-gray-500/10',
  }
  const Icon = config.icon

  // Extract useful info from old/new values
  const changedFields = getChangedFields(change.old_values, change.new_values)

  return (
    <div className="p-3 rounded-lg border border-border bg-card">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className={`p-1.5 rounded-md ${config.color}`}>
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className={config.color.replace('bg-', 'border-').replace('/10', '/30')}>
                {config.label}
              </Badge>
              {change.changed_by && (
                <span className="text-xs text-muted-foreground">
                  by {change.changed_by}
                </span>
              )}
            </div>
            {change.reason && (
              <p className="text-sm text-muted-foreground mt-1">
                {change.reason}
              </p>
            )}
            {changedFields.length > 0 && (
              <div className="mt-2 text-xs text-muted-foreground">
                Changed: {changedFields.join(', ')}
              </div>
            )}
          </div>
        </div>
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {formatDate(change.created_at)}
        </span>
      </div>
    </div>
  )
}

function ModelActivationsList({ events }: { events: ModelActivationEvent[] }) {
  if (events.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No model activation events recorded
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {events.map((event, index) => (
        <ModelActivationItem key={index} event={event} />
      ))}
    </div>
  )
}

function ModelActivationItem({ event }: { event: ModelActivationEvent }) {
  const isRollback = event.is_rollback
  const Icon = isRollback ? RotateCcw : Play
  const colorClass = isRollback 
    ? 'text-orange-600 bg-orange-500/10' 
    : 'text-blue-600 bg-blue-500/10'

  return (
    <div className="p-3 rounded-lg border border-border bg-card">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className={`p-1.5 rounded-md ${colorClass}`}>
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge 
                variant="outline" 
                className={isRollback 
                  ? 'border-orange-500/30 text-orange-600' 
                  : 'border-blue-500/30 text-blue-600'
                }
              >
                {isRollback ? 'Rollback' : 'Activated'}
              </Badge>
              {event.activated_by && (
                <span className="text-xs text-muted-foreground">
                  by {event.activated_by}
                </span>
              )}
            </div>
            {event.reason && (
              <p className="text-sm text-muted-foreground mt-1">
                {event.reason}
              </p>
            )}
            {event.previous_model_version_id && (
              <div className="mt-1 text-xs text-muted-foreground">
                Previous: {event.previous_model_version_id.slice(0, 8)}...
              </div>
            )}
          </div>
        </div>
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {formatDate(event.activated_at)}
        </span>
      </div>
    </div>
  )
}

function getChangedFields(
  oldValues: Record<string, unknown> | null,
  newValues: Record<string, unknown> | null
): string[] {
  if (!oldValues || !newValues) return []
  
  const changed: string[] = []
  const checkFields = [
    'spread_correction_weight',
    'beam_correction_weight',
    'tine_correction_weight',
    'mass_correction_weight',
    'confidence_scaling',
    'learning_correction_strength',
    'max_total_correction',
  ]

  for (const field of checkFields) {
    if (oldValues[field] !== newValues[field]) {
      changed.push(field.replace(/_/g, ' ').replace('correction weight', '').trim())
    }
  }

  return changed.slice(0, 4)
}

function formatDate(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) {
    return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  }
  if (diffDays === 1) {
    return 'Yesterday'
  }
  if (diffDays < 7) {
    return `${diffDays} days ago`
  }
  return date.toLocaleDateString()
}
