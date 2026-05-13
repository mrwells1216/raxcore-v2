'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog'
import { Loader2, CreditCard, Calendar, AlertTriangle } from 'lucide-react'
import { cancelUserSubscription, reactivateUserSubscription, openBillingPortal } from '@/app/actions/stripe'
import { useRouter } from 'next/navigation'
import type { Subscription } from '@/lib/types'

interface SubscriptionCardProps {
  subscription: Subscription
}

export function SubscriptionCard({ subscription }: SubscriptionCardProps) {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)
  const [actionType, setActionType] = useState<'cancel' | 'reactivate' | 'portal' | null>(null)
  
  const isActive = subscription.status === 'active' || subscription.status === 'trialing'
  const isCanceling = subscription.cancel_at_period_end
  
  const handleCancel = async () => {
    setIsLoading(true)
    setActionType('cancel')
    try {
      const result = await cancelUserSubscription()
      if (result.success) {
        router.refresh()
      }
    } finally {
      setIsLoading(false)
      setActionType(null)
    }
  }
  
  const handleReactivate = async () => {
    setIsLoading(true)
    setActionType('reactivate')
    try {
      const result = await reactivateUserSubscription()
      if (result.success) {
        router.refresh()
      }
    } finally {
      setIsLoading(false)
      setActionType(null)
    }
  }
  
  const handleManageBilling = async () => {
    setIsLoading(true)
    setActionType('portal')
    try {
      await openBillingPortal()
    } catch (error) {
      console.error('Error opening billing portal:', error)
      setIsLoading(false)
      setActionType(null)
    }
  }
  
  const statusBadge = () => {
    switch (subscription.status) {
      case 'active':
        return <Badge variant="default" className="bg-green-600">Active</Badge>
      case 'trialing':
        return <Badge variant="secondary">Trial</Badge>
      case 'past_due':
        return <Badge variant="destructive">Past Due</Badge>
      case 'canceled':
        return <Badge variant="outline">Canceled</Badge>
      default:
        return <Badge variant="outline">{subscription.status}</Badge>
    }
  }
  
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Subscription</CardTitle>
          {statusBadge()}
        </div>
        <CardDescription>
          {subscription.plan_id.charAt(0).toUpperCase() + subscription.plan_id.slice(1)} Plan
        </CardDescription>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {isCanceling && (
          <div className="flex items-start gap-2 rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800 dark:border-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-200">
            <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium">Subscription ending</p>
              <p>Your subscription will end on {subscription.current_period_end ? new Date(subscription.current_period_end).toLocaleDateString() : 'the end of this period'}.</p>
            </div>
          </div>
        )}
        
        <div className="flex items-center gap-2 text-sm">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">
            {subscription.billing_interval === 'year' ? 'Yearly' : 'Monthly'} billing
          </span>
        </div>
        
        {subscription.current_period_end && (
          <div className="flex items-center gap-2 text-sm">
            <CreditCard className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">
              {isCanceling ? 'Access until' : 'Next payment'}: {new Date(subscription.current_period_end).toLocaleDateString()}
            </span>
          </div>
        )}
      </CardContent>
      
      <CardFooter className="flex gap-2">
        <Button 
          variant="outline" 
          size="sm"
          onClick={handleManageBilling}
          disabled={isLoading}
        >
          {isLoading && actionType === 'portal' ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : null}
          Manage Billing
        </Button>
        
        {isActive && !isCanceling && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
                Cancel
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Cancel subscription?</AlertDialogTitle>
                <AlertDialogDescription>
                  You&apos;ll keep access until the end of your current billing period. You can reactivate anytime before then.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep Subscription</AlertDialogCancel>
                <AlertDialogAction 
                  onClick={handleCancel}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {isLoading && actionType === 'cancel' ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  Cancel Subscription
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
        
        {isCanceling && (
          <Button 
            variant="default" 
            size="sm"
            onClick={handleReactivate}
            disabled={isLoading}
          >
            {isLoading && actionType === 'reactivate' ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            Reactivate
          </Button>
        )}
      </CardFooter>
    </Card>
  )
}
