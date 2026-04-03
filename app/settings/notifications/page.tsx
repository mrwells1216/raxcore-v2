export const dynamic = 'force-dynamic'

import { AppHeader } from '@/components/app-header'
import { getMyNotificationPrefs } from '@/lib/notifications/service'
import { NotificationPrefsForm } from './notification-prefs-form'

export const metadata = { title: 'Notification Settings | RaxCore' }

export default async function NotificationSettingsPage() {
  const prefs = await getMyNotificationPrefs()

  return (
    <div className="min-h-screen bg-background font-sans">
      <AppHeader />
      <main className="mx-auto max-w-xl px-4 py-10">
        <h1 className="text-2xl font-semibold mb-1">Notification Settings</h1>
        <p className="text-sm text-muted-foreground mb-8">
          Control which alerts you receive and how often.
        </p>
        <NotificationPrefsForm initialPrefs={prefs} />
      </main>
    </div>
  )
}
