'use client'

import { useState, useTransition } from 'react'
import { Bell } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { NotificationCenter } from './notification-center'
import type { UserNotification } from '@/lib/notifications/service'

interface NotificationBellProps {
  initialNotifications: UserNotification[]
  initialUnreadCount: number
}

export function NotificationBell({
  initialNotifications,
  initialUnreadCount,
}: NotificationBellProps) {
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState(initialNotifications)
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount)
  const [, startTransition] = useTransition()

  function handleOpen(isOpen: boolean) {
    setOpen(isOpen)
    // Mark all read when opening
    if (isOpen && unreadCount > 0) {
      startTransition(async () => {
        const { markAllNotificationsRead } = await import('@/lib/notifications/service')
        await markAllNotificationsRead()
        setUnreadCount(0)
        setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
      })
    }
  }

  function handleDismiss(id: string) {
    setNotifications(prev => prev.filter(n => n.id !== id))
    setUnreadCount(prev => {
      const n = notifications.find(x => x.id === id)
      return n && !n.is_read ? Math.max(0, prev - 1) : prev
    })
    startTransition(async () => {
      const { dismissNotification } = await import('@/lib/notifications/service')
      await dismissNotification(id)
    })
  }

  function handleDismissAll() {
    setNotifications([])
    setUnreadCount(0)
    // dismissAllNotifications is called from inside NotificationCenter
  }

  return (
    <Popover open={open} onOpenChange={handleOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-9 w-9"
          aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground leading-none">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-80 p-0"
        align="end"
        sideOffset={8}
      >
        <NotificationCenter
          notifications={notifications}
          onDismiss={handleDismiss}
          onDismissAll={handleDismissAll}
        />
      </PopoverContent>
    </Popover>
  )
}
