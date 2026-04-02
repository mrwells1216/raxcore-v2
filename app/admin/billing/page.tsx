export const dynamic = 'force-dynamic'

import { AdminSidebar } from '@/components/admin/admin-sidebar'
import {
  listUserPlansForAdmin,
  getAdminUsageOverview,
  getAllPlans,
} from '@/lib/billing/service'
import { createClient } from '@/lib/supabase/server'
import { AdminBillingTable } from './admin-billing-table'
import { SubscriptionStats } from './subscription-stats'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Users, CheckCircle, XCircle, BarChart3 } from 'lucide-react'

export const metadata = { title: 'Billing | RaxCore Admin' }

async function getSubscriptionStats() {
  const supabase = await createClient()
  
  const [
    { count: totalSubscriptions },
    { count: activeSubscriptions },
    { count: cancelingSubscriptions },
    { data: recentPayments },
    { data: mrr },
  ] = await Promise.all([
    supabase.from('subscriptions').select('*', { count: 'exact', head: true }),
    supabase.from('subscriptions').select('*', { count: 'exact', head: true }).eq('status', 'active'),
    supabase.from('subscriptions').select('*', { count: 'exact', head: true }).eq('cancel_at_period_end', true),
    supabase.from('payment_history').select('amount_cents').eq('status', 'succeeded').gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()),
    supabase.from('subscriptions').select('plan_id').eq('status', 'active'),
  ])
  
  // Calculate MRR from active subscriptions
  const planPrices: Record<string, number> = { starter: 999, pro: 2999 }
  const monthlyRevenue = (mrr || []).reduce((sum, sub) => sum + (planPrices[sub.plan_id] || 0), 0)
  
  return {
    totalSubscriptions: totalSubscriptions || 0,
    activeSubscriptions: activeSubscriptions || 0,
    cancelingSubscriptions: cancelingSubscriptions || 0,
    last30DaysRevenue: (recentPayments || []).reduce((sum, p) => sum + p.amount_cents, 0),
    mrr: monthlyRevenue,
  }
}

export default async function AdminBillingPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; plan?: string; tab?: string }>
}) {
  const params = await searchParams
  const page = Math.max(1, Number(params.page ?? 1))
  const planFilter = (params.plan as string | undefined) || null
  const limit = 50
  const offset = (page - 1) * limit

  const [{ data: users, count }, overview, plans, subStats] = await Promise.all([
    listUserPlansForAdmin({ limit, offset, planFilter: planFilter as import('@/lib/billing/service').PlanId | null }),
    getAdminUsageOverview(),
    getAllPlans(),
    getSubscriptionStats(),
  ])

  const totalPages = Math.ceil((count ?? 0) / limit)

  return (
    <div className="flex h-svh overflow-hidden bg-background font-sans">
      <AdminSidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="p-6 max-w-6xl mx-auto">
          <h1 className="text-2xl font-semibold mb-6">Billing &amp; Usage Plans</h1>

          <Tabs defaultValue={params.tab || 'usage'} className="space-y-6">
            <TabsList>
              <TabsTrigger value="usage">Usage</TabsTrigger>
              <TabsTrigger value="subscriptions">Subscriptions</TabsTrigger>
            </TabsList>
            
            <TabsContent value="usage" className="space-y-6">
              {/* Overview stats */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                      <BarChart3 className="h-3.5 w-3.5" /> Total Runs
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-bold">{overview.totalScoringRuns.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{overview.todayRuns} today</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                      <Users className="h-3.5 w-3.5" /> Unique Users
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-bold">{overview.uniqueUsers.toLocaleString()}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                      <CheckCircle className="h-3.5 w-3.5" /> Successful
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-bold">
                      {(overview.totalScoringRuns - overview.totalBlocked).toLocaleString()}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                      <XCircle className="h-3.5 w-3.5" /> Blocked
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-bold">{overview.totalBlocked.toLocaleString()}</p>
                  </CardContent>
                </Card>
              </div>

              {/* Plan breakdown */}
              {overview.planBreakdown.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {overview.planBreakdown
                    .sort((a, b) => b.count - a.count)
                    .map(pb => (
                      <div key={pb.plan_id} className="rounded-full border px-3 py-1 text-xs font-medium">
                        {pb.plan_id}: {pb.count.toLocaleString()} runs
                      </div>
                    ))}
                </div>
              )}

              {/* User plan table */}
              <AdminBillingTable
                users={users}
                plans={plans}
                currentPage={page}
                totalPages={totalPages}
                totalCount={count ?? 0}
                currentPlanFilter={planFilter}
              />
            </TabsContent>
            
            <TabsContent value="subscriptions">
              <SubscriptionStats stats={subStats} />
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  )
}
