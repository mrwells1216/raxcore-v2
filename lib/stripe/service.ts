'use server'

import { stripe, isStripeConfigured } from './client'
import { createClient } from '@/lib/supabase/server'
import type { Subscription, Plan } from '@/lib/types'

// Re-export for use in server components
export { isStripeConfigured }

// ============================================================================
// PLAN PRODUCTS
// ============================================================================

export interface PlanProduct {
  id: string
  name: string
  description: string
  priceMonthly: number
  priceYearly: number
  features: string[]
  stripePriceIdMonthly?: string
  stripePriceIdYearly?: string
}

export const PLAN_PRODUCTS: PlanProduct[] = [
  {
    id: 'starter',
    name: 'Starter',
    description: 'For casual hunters who want more',
    priceMonthly: 9.99,
    priceYearly: 99.90,
    features: [
      '50 scores per month',
      '10 scores per day',
      'Up to 6 images per score',
      'Score history',
      'Collection management',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    description: 'Unlimited scoring with premium features',
    priceMonthly: 29.99,
    priceYearly: 299.90,
    features: [
      'Unlimited scores',
      'Up to 8 images per score',
      '3D render visualization',
      'Advanced analytics',
      'Collection management',
      'Priority support',
    ],
  },
]

// ============================================================================
// CUSTOMER MANAGEMENT
// ============================================================================

export async function getOrCreateStripeCustomer(userId: string, email: string): Promise<string> {
  if (!isStripeConfigured()) {
    throw new Error('Stripe is not configured. Please add STRIPE_SECRET_KEY to your environment variables.')
  }
  
  const supabase = await createClient()
  
  // Check if user already has a Stripe customer ID
  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('user_id', userId)
    .single()
  
  if (subscription?.stripe_customer_id) {
    return subscription.stripe_customer_id
  }
  
  // Create new Stripe customer
  const customer = await stripe.customers.create({
    email,
    metadata: {
      supabase_user_id: userId,
    },
  })
  
  return customer.id
}

// ============================================================================
// CHECKOUT SESSION
// ============================================================================

export interface CreateCheckoutSessionParams {
  userId: string
  email: string
  planId: string
  billingInterval: 'month' | 'year'
  successUrl: string
  cancelUrl: string
}

export async function createCheckoutSession(params: CreateCheckoutSessionParams): Promise<string> {
  if (!isStripeConfigured()) {
    throw new Error('Stripe is not configured. Please add STRIPE_SECRET_KEY to your environment variables.')
  }
  
  const { userId, email, planId, billingInterval, successUrl, cancelUrl } = params
  
  // Find the plan
  const plan = PLAN_PRODUCTS.find(p => p.id === planId)
  if (!plan) {
    throw new Error(`Plan not found: ${planId}`)
  }
  
  // Get or create Stripe customer
  const customerId = await getOrCreateStripeCustomer(userId, email)
  
  // Get price in cents
  const priceInCents = billingInterval === 'year' 
    ? Math.round(plan.priceYearly * 100)
    : Math.round(plan.priceMonthly * 100)
  
  // Create checkout session with price_data (no pre-configured Stripe products needed)
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [
      {
        price_data: {
          currency: 'usd',
          product_data: {
            name: `${plan.name} Plan`,
            description: plan.description,
          },
          unit_amount: priceInCents,
          recurring: {
            interval: billingInterval,
          },
        },
        quantity: 1,
      },
    ],
    success_url: successUrl,
    cancel_url: cancelUrl,
    subscription_data: {
      metadata: {
        supabase_user_id: userId,
        plan_id: planId,
      },
    },
    metadata: {
      supabase_user_id: userId,
      plan_id: planId,
    },
  })
  
  if (!session.url) {
    throw new Error('Failed to create checkout session')
  }
  
  return session.url
}

// ============================================================================
// SUBSCRIPTION MANAGEMENT
// ============================================================================

export async function getUserSubscription(userId: string): Promise<Subscription | null> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', userId)
    .single()
  
  if (error || !data) {
    return null
  }
  
  return data as Subscription
}

export async function cancelSubscription(userId: string): Promise<{ success: boolean; error?: string }> {
  if (!isStripeConfigured()) {
    return { success: false, error: 'Stripe is not configured' }
  }
  
  const supabase = await createClient()
  
  // Get the subscription
  const { data: subscription, error: fetchError } = await supabase
    .from('subscriptions')
    .select('stripe_subscription_id')
    .eq('user_id', userId)
    .single()
  
  if (fetchError || !subscription?.stripe_subscription_id) {
    return { success: false, error: 'Subscription not found' }
  }
  
  try {
    // Cancel at period end (user keeps access until billing period ends)
    await stripe.subscriptions.update(subscription.stripe_subscription_id, {
      cancel_at_period_end: true,
    })
    
    // Update local record
    await supabase
      .from('subscriptions')
      .update({
        cancel_at_period_end: true,
        canceled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
    
    return { success: true }
  } catch (error) {
    console.error('Failed to cancel subscription:', error)
    return { success: false, error: 'Failed to cancel subscription' }
  }
}

export async function reactivateSubscription(userId: string): Promise<{ success: boolean; error?: string }> {
  if (!isStripeConfigured()) {
    return { success: false, error: 'Stripe is not configured' }
  }
  
  const supabase = await createClient()
  
  // Get the subscription
  const { data: subscription, error: fetchError } = await supabase
    .from('subscriptions')
    .select('stripe_subscription_id')
    .eq('user_id', userId)
    .single()
  
  if (fetchError || !subscription?.stripe_subscription_id) {
    return { success: false, error: 'Subscription not found' }
  }
  
  try {
    // Remove cancellation
    await stripe.subscriptions.update(subscription.stripe_subscription_id, {
      cancel_at_period_end: false,
    })
    
    // Update local record
    await supabase
      .from('subscriptions')
      .update({
        cancel_at_period_end: false,
        canceled_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
    
    return { success: true }
  } catch (error) {
    console.error('Failed to reactivate subscription:', error)
    return { success: false, error: 'Failed to reactivate subscription' }
  }
}

export async function createBillingPortalSession(userId: string, returnUrl: string): Promise<string> {
  if (!isStripeConfigured()) {
    throw new Error('Stripe is not configured. Please add STRIPE_SECRET_KEY to your environment variables.')
  }
  
  const supabase = await createClient()
  
  // Get customer ID
  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('user_id', userId)
    .single()
  
  if (!subscription?.stripe_customer_id) {
    throw new Error('No subscription found')
  }
  
  const session = await stripe.billingPortal.sessions.create({
    customer: subscription.stripe_customer_id,
    return_url: returnUrl,
  })
  
  return session.url
}

// ============================================================================
// PAYMENT HISTORY
// ============================================================================

export async function getPaymentHistory(userId: string, limit = 10) {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('payment_history')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)
  
  if (error) {
    console.error('Failed to fetch payment history:', error)
    return []
  }
  
  return data
}

// ============================================================================
// PLAN HELPERS
// ============================================================================

export async function getPlans(): Promise<Plan[]> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('plans')
    .select('*')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
  
  if (error) {
    console.error('Failed to fetch plans:', error)
    return []
  }
  
  return data as Plan[]
}

export async function getPurchasablePlans(): Promise<Plan[]> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('plans')
    .select('*')
    .eq('is_active', true)
    .eq('is_purchasable', true)
    .order('sort_order', { ascending: true })
  
  if (error) {
    console.error('Failed to fetch purchasable plans:', error)
    return []
  }
  
  return data as Plan[]
}
