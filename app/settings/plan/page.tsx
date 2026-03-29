import { AppHeader } from '@/components/app-header'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getUserPlanStatus, getMyUsageLedger } from '@/lib/billing/service'
import { getUserSubscription, getPaymentHistory } from '@/lib/stripe/service'
import { PlanStatusCard } from './plan-status-card'
import { SubscriptionCard } from './subscription-card'
import { PricingCards } from '@/components/billing/pricing-cards'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export const metadata = { title: 'Plan & Usage | RaxCore' }

export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; canceled?: string }>
}) {
  const params = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login?redirect=/settings/plan')

  const [status, ledger, subscription, payments] = await Promise.all([
    getUserPlanStatus(user.id),
    getMyUsageLedger(10),
    getUserSubscription(user.id),
    getPaymentHistory(user.id, 5),
  ])

  const isSubscribed = subscription?.status === 'active' || subscription?.status === 'trialing'

  return (
    <div className="min-h-screen bg-background font-sans">
      <AppHeader />
      <main className="mx-auto max-w-4xl px-4 py-10">
        <h1 className="text-2xl font-semibold mb-1">Plan &amp; Usage</h1>
        <p className="text-sm text-muted-foreground mb-8">
          Manage your subscription, view usage, and upgrade your plan.
        </p>
        
        {params.success && (
          <div className="mb-6 rounded-lg border border-green-200 bg-green-50 p-4 text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-200">
            Your subscription has been activated successfully.
          </div>
        )}
        
        {params.canceled && (
          <div className="mb-6 rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-yellow-800 dark:border-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-200">
            Checkout was canceled. No charges were made.
          </div>
        )}
        
        <Tabs defaultValue={isSubscribed ? 'current' : 'plans'} className="space-y-6">
          <TabsList>
            <TabsTrigger value="current">Current Plan</TabsTrigger>
            <TabsTrigger value="plans">Upgrade</TabsTrigger>
            <TabsTrigger value="billing">Billing History</TabsTrigger>
          </TabsList>
          
          <TabsContent value="current" className="space-y-6">
            <div className="grid gap-6 md:grid-cols-2">
              <PlanStatusCard status={status} recentLedger={ledger} />
              {subscription && (
                <SubscriptionCard subscription={subscription} />
              )}
            </div>
          </TabsContent>
          
          <TabsContent value="plans">
            <PricingCards 
              currentPlanId={subscription?.plan_id} 
              isSubscribed={isSubscribed} 
            />
          </TabsContent>
          
          <TabsContent value="billing">
            <PaymentHistoryTable payments={payments} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  )
}

function PaymentHistoryTable({ payments }: { payments: Awaited<ReturnType<typeof getPaymentHistory>> }) {
  if (payments.length === 0) {
    return (
      <div className="rounded-lg border p-8 text-center text-muted-foreground">
        No payment history yet.
      </div>
    )
  }
  
  return (
    <div className="rounded-lg border">
      <table className="w-full">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="px-4 py-3 text-left text-sm font-medium">Date</th>
            <th className="px-4 py-3 text-left text-sm font-medium">Description</th>
            <th className="px-4 py-3 text-left text-sm font-medium">Amount</th>
            <th className="px-4 py-3 text-left text-sm font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((payment) => (
            <tr key={payment.id} className="border-b last:border-0">
              <td className="px-4 py-3 text-sm">
                {new Date(payment.created_at).toLocaleDateString()}
              </td>
              <td className="px-4 py-3 text-sm">
                {payment.description || 'Subscription payment'}
              </td>
              <td className="px-4 py-3 text-sm">
                ${(payment.amount_cents / 100).toFixed(2)}
              </td>
              <td className="px-4 py-3 text-sm">
                <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                  payment.status === 'succeeded' 
                    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' 
                    : payment.status === 'failed'
                    ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                    : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400'
                }`}>
                  {payment.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
