'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { X, Bell, CheckCircle, AlertTriangle, Camera, Map, Box, Settings, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import type { UserNotification, NotificationType } from '@/lib/notifications/service'

const TYPE_META: Record<NotificationType, { icon: React.ElementType; color: string; label: string }> = {
  submit_real_score:    { icon: CheckCircle,   color: 'text-primary',          label: 'Score' },
  render_complete:      { icon: Box,           color: 'text-accent',           label: 'Render' },
  render_failed:        { icon: AlertTriangle, color: 'text-destructive',      label: 'Render' },
  better_photos_needed: { icon: Camera,        color: 'text-amber-500',        label: 'Photos' },
  missing_map:          { icon: Map,           color: 'text-amber-500',        label: 'Map' },
  missing_render:       { icon: Box,           color: 'text-muted-foreground', label: 'Render' },
}

const FILTER_GROUPS = [
  { value: 'all',    label: 'All' },
  { value: 'unread', label: 'Unread' },
  { value: 'action', label: 'Actions' },
] as const

type Filter = (typeof FILTER_GROUPS)[number]['value']

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

const ACTION_TYPES: NotificationType[] = ['submit_real_score', 'better_photos_needed', 'missing_map', 'missing_render']

interface NotificationCenterProps {
  notifications: UserNotification[]
  onDismiss: (id: string) => void
  onDismissAll?: () => void
}

export function NotificationCenter({ notifications, onDismiss, onDismissAll }: NotificationCenterProps) {
  const [filter, setFilter] = useState<Filter>('all')
  const [, startTransition] = useTransition()

  const active = notifications.filter(n => !n.is_dismissed)

  const filtered = active.filter(n => {
    if (filter === 'unread') return !n.is_read
    if (filter === 'action') return ACTION_TYPES.includes(n.type)
    return true
  })

  function handleDismissAll() {
    startTransition(async () => {
      const { dismissAllNotifications } = await import('@/lib/notifications/service')
      await dismissAllNotifications()
      onDismissAll?.()
    })
  }

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-border">
        <span className="text-sm font-semibold">Notifications</span>
        <div className="flex items-center gap-1">
          {active.length > 0 && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={handleDismissAll}
              title="Clear all"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            asChild
            title="Notification settings"
          >
            <Link href="/settings/notifications">
              <Settings className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 px-3 py-2 border-b border-border">
        {FILTER_GROUPS.map(f => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={cn(
              'px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
              filter === f.value
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted',
            )}
          >
            {f.label}
            {f.value === 'unread' && active.filter(n => !n.is_read).length > 0 && (
              <span className="ml-1 opacity-70">
                {active.filter(n => !n.is_read).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center px-4">
          <Bell className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            {filter === 'all' ? 'All caught up' : `No ${filter} notifications`}
          </p>
          <p className="text-xs text-muted-foreground/60">New activity will appear here</p>
        </div>
      ) : (
        <ScrollArea className="max-h-[340px]">
          <ul className="divide-y divide-border">
            {filtered.map(notification => {
              const meta = TYPE_META[notification.type] ?? { icon: Bell, color: 'text-muted-foreground', label: '' }
              const Icon = meta.icon

              const inner = (
                <div className={cn(
                  'flex items-start gap-3 px-4 py-3 group',
                  !notification.is_read && 'bg-primary/5',
                )}>
                  <div className={cn('mt-0.5 shrink-0', meta.color)}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={cn(
                      'text-sm leading-snug',
                      !notification.is_read && 'font-medium',
                    )}>
                      {notification.title}
                    </p>
                    {notification.body && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                        {notification.body}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground/60 mt-1">
                      {timeAgo(notification.created_at)}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={e => { e.preventDefault(); e.stopPropagation(); onDismiss(notification.id) }}
                    aria-label="Dismiss notification"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              )

              return (
                <li key={notification.id}>
                  {notification.link_href ? (
                    <Link href={notification.link_href} className="block hover:bg-muted/50 transition-colors">
                      {inner}
                    </Link>
                  ) : (
                    <div>{inner}</div>
                  )}
                </li>
              )
            })}
          </ul>
        </ScrollArea>
      )}

      {/* Footer link */}
      {active.length > 0 && (
        <div className="px-4 py-2 border-t border-border">
          <Link
            href="/settings/notifications"
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Manage notification preferences
          </Link>
        </div>
      )}
    </div>
  )
}
