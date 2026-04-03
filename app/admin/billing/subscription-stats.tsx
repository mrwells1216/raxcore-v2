'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CreditCard, TrendingUp, Users, AlertTriangle, DollarSign } from 'lucide-react'

interface SubscriptionStatsProps {
  stats: {
    totalSubscriptions: number
    activeSubscriptions: number
    cancelingSubscriptions: number
    last30DaysRevenue: number
    mrr: number
  }
}

export function SubscriptionStats({ stats }: SubscriptionStatsProps) {
  return (
    <div className="space-y-6">
      {/* Revenue metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
              <DollarSign className="h-3.5 w-3.5" /> MRR
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">${(stats.mrr / 100).toFixed(2)}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Monthly recurring revenue</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
              <TrendingUp className="h-3.5 w-3.5" /> Last 30 Days
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">${(stats.last30DaysRevenue / 100).toFixed(2)}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Total revenue</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5" /> Active
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{stats.activeSubscriptions}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              of {stats.totalSubscriptions} total
            </p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5" /> Canceling
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{stats.cancelingSubscriptions}</p>
            <p className="text-xs text-muted-foreground mt-0.5">End of period</p>
          </CardContent>
        </Card>
      </div>
      
      {/* Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <CreditCard className="h-4 w-4" />
            Stripe Integration
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            Subscriptions are managed via Stripe. Webhook events automatically sync subscription
            status, payment history, and plan assignments.
          </p>
          <p>
            Configure <code className="bg-muted px-1.5 py-0.5 rounded text-xs">STRIPE_WEBHOOK_SECRET</code> to 
            enable real-time updates from Stripe.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
