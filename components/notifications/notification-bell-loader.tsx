import { listMyNotifications, countUnreadNotifications } from '@/lib/notifications/service'
import { NotificationBell } from './notification-bell'
import { createClient } from '@/lib/supabase/server'

/**
 * Server component — fetches notification data then passes it to the client bell.
 * Returns null if not authenticated.
 */
export async function NotificationBellLoader() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const [notifications, unreadCount] = await Promise.all([
    listMyNotifications(),
    countUnreadNotifications(),
  ])

  return (
    <NotificationBell
      initialNotifications={notifications}
      initialUnreadCount={unreadCount}
    />
  )
}
