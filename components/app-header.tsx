/**
 * AppHeader — server component wrapper that injects the auth-aware notification bell
 * and usage badge into the client Header component.
 * Each slot is wrapped in Suspense so any crash cannot block the Header render.
 */
import { Suspense } from 'react'
import { Header } from '@/components/header'
import { NotificationBellLoader } from '@/components/notifications/notification-bell-loader'
import { UsageBadgeLoader } from '@/components/billing/usage-badge-loader'

export async function AppHeader() {
  return (
    <Header
      usageSlot={
        <Suspense fallback={null}>
          <UsageBadgeLoader />
        </Suspense>
      }
      bellSlot={
        <Suspense fallback={null}>
          <NotificationBellLoader />
        </Suspense>
      }
    />
  )
}
