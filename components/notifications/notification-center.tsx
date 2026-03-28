'use client'

import Link from 'next/link'
import { X, Bell, CheckCircle, AlertTriangle, Camera, Map, Box } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import type { UserNotification, NotificationType } from '@/lib/notifications/service'

const TYPE_META: Record<NotificationType, { icon: React.ElementType; color: string }> = {
  submit_real_score:    { icon: CheckCircle,    color: 'text-primary' },
  render_complete:      { icon: Box,            color: 'text-accent' },
  render_failed:        { icon: AlertTriangle,  color: 'text-destructive' },
  better_photos_needed: { icon: Camera,         color: 'text-amber-500' },
  missing_map:          { icon: Map,            color: 'text-amber-500' },
  missing_render:       { icon: Box,            color: 'text-muted-foreground' },
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

interface NotificationCenterProps {
  notifications: UserNotification[]
  onDismiss: (id: string) => void
}

export function NotificationCenter({ notifications, onDismiss }: NotificationCenterProps) {
  const active = notifications.filter(n => !n.is_dismissed)

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <span className="text-sm font-semibold">Notifications</span>
        {active.length > 0 && (
          <span className="text-xs text-muted-foreground">{active.length} item{active.length !== 1 ? 's' : ''}</span>
        )}
      </div>

      {active.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center px-4">
          <Bell className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">All caught up</p>
          <p className="text-xs text-muted-foreground/60">New activity will appear here</p>
        </div>
      ) : (
        <ScrollArea className="max-h-[360px]">
          <ul className="divide-y divide-border">
            {active.map(notification => {
              const meta = TYPE_META[notification.type] ?? { icon: Bell, color: 'text-muted-foreground' }
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
                      'text-sm leading-snug truncate',
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
    </div>
  )
}
