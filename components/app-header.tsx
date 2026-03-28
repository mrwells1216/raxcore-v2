/**
 * AppHeader — server component wrapper that injects the auth-aware notification bell
 * into the client Header component. Use this instead of <Header /> in pages.
 * Suspense boundary ensures a notification crash can never block the Header render.
 */
import { Suspense } from 'react'
import { Header } from '@/components/header'
import { NotificationBellLoader } from '@/components/notifications/notification-bell-loader'

export async function AppHeader() {
  return (
    <Header
      bellSlot={
        <Suspense fallback={null}>
          <NotificationBellLoader />
        </Suspense>
      }
    />
  )
}
