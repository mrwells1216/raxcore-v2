import { listMyNotifications, countUnreadNotifications } from '@/lib/notifications/service'
import { NotificationBell } from './notification-bell'
import { createClient } from '@/lib/supabase/server'

/**
 * Server component — fetches notification data then passes it to the client bell.
 * Fail-open: returns null on any error so public pages always render.
 */
export async function NotificationBellLoader() {
  try {
    const supabase = await createClient()

    let user
    try {
      const { data } = await supabase.auth.getUser()
      user = data?.user
    } catch {
      return null
    }

    if (!user) return null

    let notifications: Awaited<ReturnType<typeof listMyNotifications>> = []
    let unreadCount = 0
    try {
      ;[notifications, unreadCount] = await Promise.all([
        listMyNotifications(),
        countUnreadNotifications(),
      ])
    } catch {
      // Notifications unavailable — still render bell with empty state
    }

    return (
      <NotificationBell
        initialNotifications={notifications}
        initialUnreadCount={unreadCount}
      />
    )
  } catch {
    return null
  }
}
