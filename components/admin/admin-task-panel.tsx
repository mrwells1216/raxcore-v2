'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import {
  CheckCircle, XCircle, AlertTriangle, AlertCircle,
  ChevronRight, ClipboardList, Settings, CheckCheck,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { AdminTask, AdminTaskPriority, AdminTaskType } from '@/lib/notifications/service'

const PRIORITY_META: Record<AdminTaskPriority, { icon: React.ElementType; cls: string; label: string }> = {
  low:      { icon: ChevronRight,  cls: 'text-muted-foreground', label: 'Low' },
  normal:   { icon: ChevronRight,  cls: 'text-foreground',       label: 'Normal' },
  high:     { icon: AlertTriangle, cls: 'text-amber-500',        label: 'High' },
  critical: { icon: AlertCircle,   cls: 'text-destructive',      label: 'Critical' },
}

const TYPE_LABEL: Record<AdminTaskType, string> = {
  review_example:      'Review',
  data_gap:            'Data Gap',
  suspect_duplicate:   'Duplicate',
  failed_validation:   'Validation',
  calibration_needed:  'Calibration',
  model_promotion:     'Promotion',
}

const TYPE_FILTERS: { value: 'all' | AdminTaskType; label: string }[] = [
  { value: 'all',                label: 'All' },
  { value: 'review_example',     label: 'Review' },
  { value: 'data_gap',           label: 'Data Gaps' },
  { value: 'failed_validation',  label: 'Validation' },
  { value: 'calibration_needed', label: 'Calibration' },
]

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

interface AdminTaskPanelProps {
  initialTasks: AdminTask[]
}

export function AdminTaskPanel({ initialTasks }: AdminTaskPanelProps) {
  const [tasks, setTasks] = useState(initialTasks)
  const [typeFilter, setTypeFilter] = useState<'all' | AdminTaskType>('all')
  const [, startTransition] = useTransition()

  const openTasks = tasks.filter(t => t.status === 'open')
  const filtered = typeFilter === 'all'
    ? openTasks
    : openTasks.filter(t => t.type === typeFilter)

  const criticalCount = openTasks.filter(t => t.priority === 'critical' || t.priority === 'high').length

  function handleResolve(id: string) {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, status: 'resolved' as const } : t))
    startTransition(async () => {
      const { updateAdminTaskStatus } = await import('@/lib/notifications/service')
      await updateAdminTaskStatus(id, 'resolved')
    })
  }

  function handleDismiss(id: string) {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, status: 'dismissed' as const } : t))
    startTransition(async () => {
      const { updateAdminTaskStatus } = await import('@/lib/notifications/service')
      await updateAdminTaskStatus(id, 'dismissed')
    })
  }

  function handleResolveAll() {
    setTasks(prev => prev.map(t =>
      t.status === 'open' && (typeFilter === 'all' || t.type === typeFilter)
        ? { ...t, status: 'resolved' as const }
        : t,
    ))
    startTransition(async () => {
      const { resolveAllAdminTasks } = await import('@/lib/notifications/service')
      await resolveAllAdminTasks()
    })
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5" />
            <CardTitle className="text-lg">Open Tasks</CardTitle>
            {criticalCount > 0 && (
              <Badge variant="destructive" className="text-xs">
                {criticalCount} urgent
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            {openTasks.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-muted-foreground gap-1"
                onClick={handleResolveAll}
              >
                <CheckCheck className="h-3.5 w-3.5" />
                Resolve all
              </Button>
            )}
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" asChild title="Task preferences">
              <Link href="/admin/settings">
                <Settings className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        </div>
        <CardDescription>
          Action items flagged by the system
          {openTasks.length > 0 && ` — ${openTasks.length} open`}
        </CardDescription>

        {/* Type filter pills */}
        {openTasks.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1">
            {TYPE_FILTERS.map(f => {
              const count = f.value === 'all'
                ? openTasks.length
                : openTasks.filter(t => t.type === f.value).length
              if (count === 0 && f.value !== 'all') return null
              return (
                <button
                  key={f.value}
                  onClick={() => setTypeFilter(f.value)}
                  className={cn(
                    'px-2 py-0.5 rounded-md text-xs font-medium transition-colors',
                    typeFilter === f.value
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:text-foreground',
                  )}
                >
                  {f.label}
                  <span className="ml-1 opacity-70">{count}</span>
                </button>
              )
            })}
          </div>
        )}
      </CardHeader>

      <CardContent>
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <CheckCircle className="h-8 w-8 text-primary/40" />
            <p className="text-sm text-muted-foreground">
              {openTasks.length === 0 ? 'No open tasks' : `No ${typeFilter} tasks`}
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {filtered.map(task => {
              const { icon: PriorityIcon, cls } = PRIORITY_META[task.priority]
              return (
                <li
                  key={task.id}
                  className="flex items-start gap-3 p-3 rounded-lg border border-border bg-card hover:bg-muted/30 transition-colors"
                >
                  <PriorityIcon className={cn('h-4 w-4 mt-0.5 shrink-0', cls)} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium leading-snug">{task.title}</span>
                      <Badge variant="outline" className="text-xs px-1.5 py-0 shrink-0">
                        {TYPE_LABEL[task.type] ?? task.type}
                      </Badge>
                    </div>
                    {task.body && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{task.body}</p>
                    )}
                    <div className="flex items-center gap-3 mt-1.5">
                      <span className="text-xs text-muted-foreground/60">{timeAgo(task.created_at)}</span>
                      {task.link_href && (
                        <Link
                          href={task.link_href}
                          className="text-xs text-primary hover:underline flex items-center gap-0.5"
                        >
                          View <ChevronRight className="h-3 w-3" />
                        </Link>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-primary hover:text-primary hover:bg-primary/10"
                      onClick={() => handleResolve(task.id)}
                      title="Mark resolved"
                    >
                      <CheckCircle className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-foreground"
                      onClick={() => handleDismiss(task.id)}
                      title="Dismiss"
                    >
                      <XCircle className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
