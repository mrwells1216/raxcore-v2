'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { CheckCircle, XCircle, AlertTriangle, AlertCircle, ChevronRight, ClipboardList } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { AdminTask, AdminTaskPriority, AdminTaskType } from '@/lib/notifications/service'

const PRIORITY_META: Record<AdminTaskPriority, { label: string; icon: React.ElementType; cls: string }> = {
  low:      { label: 'Low',      icon: ChevronRight, cls: 'text-muted-foreground' },
  normal:   { label: 'Normal',   icon: ChevronRight, cls: 'text-foreground' },
  high:     { label: 'High',     icon: AlertTriangle, cls: 'text-amber-500' },
  critical: { label: 'Critical', icon: AlertCircle,  cls: 'text-destructive' },
}

const TYPE_LABEL: Record<AdminTaskType, string> = {
  review_example:      'Review Example',
  data_gap:            'Data Gap',
  suspect_duplicate:   'Suspect Duplicate',
  failed_validation:   'Failed Validation',
  calibration_needed:  'Calibration Needed',
  model_promotion:     'Model Promotion',
}

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
  const [, startTransition] = useTransition()

  const openTasks = tasks.filter(t => t.status === 'open')

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

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5" />
            <CardTitle className="text-lg">Open Tasks</CardTitle>
          </div>
          {openTasks.length > 0 && (
            <Badge variant="secondary" className="bg-destructive/10 text-destructive">
              {openTasks.length}
            </Badge>
          )}
        </div>
        <CardDescription>Action items flagged by the system</CardDescription>
      </CardHeader>
      <CardContent>
        {openTasks.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <CheckCircle className="h-8 w-8 text-primary/40" />
            <p className="text-sm text-muted-foreground">No open tasks</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {openTasks.map(task => {
              const { icon: PriorityIcon, cls } = PRIORITY_META[task.priority]
              return (
                <li
                  key={task.id}
                  className="flex items-start gap-3 p-3 rounded-lg border border-border bg-card hover:bg-muted/30 transition-colors"
                >
                  <PriorityIcon className={cn('h-4 w-4 mt-0.5 shrink-0', cls)} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">{task.title}</span>
                      <Badge variant="outline" className="text-xs px-1.5 py-0">
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
