import { AdminSidebar } from '@/components/admin/admin-sidebar'
import {
  listUserPlansForAdmin,
  getAdminUsageOverview,
  getAllPlans,
} from '@/lib/billing/service'
import { AdminBillingTable } from './admin-billing-table'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Users, CheckCircle, XCircle, BarChart3 } from 'lucide-react'

export const metadata = { title: 'Billing | RaxCore Admin' }

export default async function AdminBillingPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; plan?: string }>
}) {
  const params = await searchParams
  const page = Math.max(1, Number(params.page ?? 1))
  const planFilter = (params.plan as string | undefined) || null
  const limit = 50
  const offset = (page - 1) * limit

  const [{ data: users, count }, overview, plans] = await Promise.all([
    listUserPlansForAdmin({ limit, offset, planFilter: planFilter as import('@/lib/billing/service').PlanId | null }),
    getAdminUsageOverview(),
    getAllPlans(),
  ])

  const totalPages = Math.ceil((count ?? 0) / limit)

  return (
    <div className="flex h-svh overflow-hidden bg-background font-sans">
      <AdminSidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="p-6 max-w-6xl mx-auto">
          <h1 className="text-2xl font-semibold mb-6">Billing &amp; Usage Plans</h1>

          {/* Overview stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
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
            <div className="flex flex-wrap gap-2 mb-6">
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
        </div>
      </main>
    </div>
  )
}
