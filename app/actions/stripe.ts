'use server'

import { createClient } from '@/lib/supabase/server'
import { createCheckoutSession, cancelSubscription, reactivateSubscription, createBillingPortalSession } from '@/lib/stripe/service'
import { redirect } from 'next/navigation'

export async function startCheckout(planId: string, billingInterval: 'month' | 'year' = 'month') {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    redirect('/auth/login?redirect=/settings/plan')
  }
  
  const origin = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
  
  const checkoutUrl = await createCheckoutSession({
    userId: user.id,
    email: user.email!,
    planId,
    billingInterval,
    successUrl: `${origin}/settings/plan?success=true`,
    cancelUrl: `${origin}/settings/plan?canceled=true`,
  })
  
  redirect(checkoutUrl)
}

export async function cancelUserSubscription() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    return { success: false, error: 'Not authenticated' }
  }
  
  return cancelSubscription(user.id)
}

export async function reactivateUserSubscription() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    return { success: false, error: 'Not authenticated' }
  }
  
  return reactivateSubscription(user.id)
}

export async function openBillingPortal() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    redirect('/auth/login')
  }
  
  const origin = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
  
  const portalUrl = await createBillingPortalSession(user.id, `${origin}/settings/plan`)
  
  redirect(portalUrl)
}
