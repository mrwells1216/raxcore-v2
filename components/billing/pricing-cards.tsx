'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Check, Loader2 } from 'lucide-react'
import { startCheckout } from '@/app/actions/stripe'
import { PLAN_PRODUCTS, type PlanProduct } from '@/lib/stripe/service'

interface PricingCardsProps {
  currentPlanId?: string | null
  isSubscribed?: boolean
}

export function PricingCards({ currentPlanId, isSubscribed }: PricingCardsProps) {
  const [isYearly, setIsYearly] = useState(false)
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null)
  
  const handleSubscribe = async (planId: string) => {
    setLoadingPlan(planId)
    try {
      await startCheckout(planId, isYearly ? 'year' : 'month')
    } catch (error) {
      console.error('Checkout error:', error)
      setLoadingPlan(null)
    }
  }
  
  return (
    <div className="space-y-6">
      {/* Billing toggle */}
      <div className="flex items-center justify-center gap-3">
        <Label htmlFor="billing-toggle" className={!isYearly ? 'text-foreground' : 'text-muted-foreground'}>
          Monthly
        </Label>
        <Switch
          id="billing-toggle"
          checked={isYearly}
          onCheckedChange={setIsYearly}
        />
        <Label htmlFor="billing-toggle" className={isYearly ? 'text-foreground' : 'text-muted-foreground'}>
          Yearly
          <Badge variant="secondary" className="ml-2 text-xs">Save 17%</Badge>
        </Label>
      </div>
      
      {/* Pricing cards */}
      <div className="grid gap-6 md:grid-cols-2 max-w-3xl mx-auto">
        {PLAN_PRODUCTS.map((plan) => (
          <PricingCard
            key={plan.id}
            plan={plan}
            isYearly={isYearly}
            isCurrent={currentPlanId === plan.id}
            isSubscribed={isSubscribed}
            isLoading={loadingPlan === plan.id}
            onSubscribe={() => handleSubscribe(plan.id)}
          />
        ))}
      </div>
    </div>
  )
}

interface PricingCardProps {
  plan: PlanProduct
  isYearly: boolean
  isCurrent: boolean
  isSubscribed?: boolean
  isLoading: boolean
  onSubscribe: () => void
}

function PricingCard({ plan, isYearly, isCurrent, isSubscribed, isLoading, onSubscribe }: PricingCardProps) {
  const price = isYearly ? plan.priceYearly : plan.priceMonthly
  const displayPrice = isYearly ? (price / 12).toFixed(2) : price.toFixed(2)
  const isPro = plan.id === 'pro'
  
  return (
    <Card className={`relative flex flex-col ${isPro ? 'border-primary shadow-lg' : ''}`}>
      {isPro && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <Badge className="bg-primary text-primary-foreground">Most Popular</Badge>
        </div>
      )}
      
      <CardHeader className="text-center pb-2">
        <CardTitle className="text-xl">{plan.name}</CardTitle>
        <CardDescription>{plan.description}</CardDescription>
      </CardHeader>
      
      <CardContent className="flex-1">
        <div className="text-center mb-6">
          <span className="text-4xl font-bold">${displayPrice}</span>
          <span className="text-muted-foreground">/month</span>
          {isYearly && (
            <p className="text-sm text-muted-foreground mt-1">
              Billed ${price.toFixed(2)} yearly
            </p>
          )}
        </div>
        
        <ul className="space-y-3">
          {plan.features.map((feature, index) => (
            <li key={index} className="flex items-center gap-2">
              <Check className="h-4 w-4 text-primary flex-shrink-0" />
              <span className="text-sm">{feature}</span>
            </li>
          ))}
        </ul>
      </CardContent>
      
      <CardFooter>
        <Button
          className="w-full"
          variant={isPro ? 'default' : 'outline'}
          disabled={isCurrent || isLoading}
          onClick={onSubscribe}
        >
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Processing...
            </>
          ) : isCurrent ? (
            'Current Plan'
          ) : isSubscribed ? (
            'Switch Plan'
          ) : (
            'Subscribe'
          )}
        </Button>
      </CardFooter>
    </Card>
  )
}
