'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { toggleScheduledJobAction } from './actions'
import { Clock, Calendar, PlayCircle } from 'lucide-react'
import type { ScheduledJobDefinition } from '@/lib/jobs/types'

interface ScheduledJobsPanelProps {
  definitions: ScheduledJobDefinition[]
}

export function ScheduledJobsPanel({ definitions }: ScheduledJobsPanelProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const handleToggle = async (def: ScheduledJobDefinition) => {
    setTogglingId(def.id)
    startTransition(async () => {
      await toggleScheduledJobAction(def.id, !def.is_enabled)
      router.refresh()
      setTogglingId(null)
    })
  }

  const formatSchedule = (def: ScheduledJobDefinition) => {
    if (def.cron_expression) {
      return `Cron: ${def.cron_expression}`
    }
    if (def.interval_minutes) {
      if (def.interval_minutes < 60) {
        return `Every ${def.interval_minutes} min`
      }
      if (def.interval_minutes < 1440) {
        return `Every ${(def.interval_minutes / 60).toFixed(0)} hr`
      }
      return `Every ${(def.interval_minutes / 1440).toFixed(0)} day`
    }
    return 'No schedule'
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'Never'
    const date = new Date(dateStr)
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  if (definitions.length === 0) {
    return (
      <div className="rounded-lg border p-8 text-center text-muted-foreground">
        No scheduled jobs configured.
      </div>
    )
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {definitions.map((def) => (
        <Card key={def.id} className={def.is_enabled ? '' : 'opacity-60'}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium">
                {def.name.replace(/_/g, ' ')}
              </CardTitle>
              <Switch
                checked={def.is_enabled}
                onCheckedChange={() => handleToggle(def)}
                disabled={isPending && togglingId === def.id}
              />
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Calendar className="h-4 w-4" />
              <span>{formatSchedule(def)}</span>
            </div>

            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              <span>Last: {formatDate(def.last_run_at)}</span>
            </div>

            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <PlayCircle className="h-4 w-4" />
              <span>Next: {def.is_enabled ? formatDate(def.next_run_at) : 'Disabled'}</span>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <span className="text-xs text-muted-foreground">
                Type: {def.job_type}
              </span>
              <span className="text-xs text-muted-foreground">
                Priority: {def.priority}
              </span>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
