import { getMyAdminNotificationPrefs } from '@/lib/notifications/service'
import { AdminNotificationPrefs } from '@/components/admin/admin-notification-prefs'

export const metadata = { title: 'Admin Settings | RaxCore' }

export default async function AdminSettingsPage() {
  const prefs = await getMyAdminNotificationPrefs()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Admin Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Configure task panel and notification preferences.</p>
      </div>
      <div className="max-w-lg">
        <AdminNotificationPrefs initialPrefs={prefs} />
      </div>
    </div>
  )
}
