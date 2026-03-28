import { AppHeader } from '@/components/app-header'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getUserPlanStatus, getMyUsageLedger } from '@/lib/billing/service'
import { PlanStatusCard } from './plan-status-card'

export const metadata = { title: 'Plan & Usage | RaxCore' }

export default async function PlanPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login?redirect=/settings/plan')

  const [status, ledger] = await Promise.all([
    getUserPlanStatus(user.id),
    getMyUsageLedger(10),
  ])

  return (
    <div className="min-h-screen bg-background font-sans">
      <AppHeader />
      <main className="mx-auto max-w-xl px-4 py-10">
        <h1 className="text-2xl font-semibold mb-1">Plan &amp; Usage</h1>
        <p className="text-sm text-muted-foreground mb-8">
          Your current scoring plan, usage this period, and recent activity.
        </p>
        <PlanStatusCard status={status} recentLedger={ledger} />
      </main>
    </div>
  )
}
