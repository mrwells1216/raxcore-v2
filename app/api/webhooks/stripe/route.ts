import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe/client'
import { createClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'

// Use service role for webhook handlers (bypasses RLS)
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(request: NextRequest) {
  const body = await request.text()
  const signature = request.headers.get('stripe-signature')
  
  if (!signature) {
    return NextResponse.json({ error: 'No signature' }, { status: 400 })
  }
  
  let event: Stripe.Event
  
  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    )
  } catch (err) {
    console.error('Webhook signature verification failed:', err)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }
  
  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session)
        break
        
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription)
        break
        
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription)
        break
        
      case 'invoice.paid':
        await handleInvoicePaid(event.data.object as Stripe.Invoice)
        break
        
      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice)
        break
        
      default:
        console.log(`Unhandled event type: ${event.type}`)
    }
    
    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('Webhook handler error:', error)
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 })
  }
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const userId = session.metadata?.supabase_user_id
  const planId = session.metadata?.plan_id
  
  if (!userId || !planId) {
    console.error('Missing metadata in checkout session')
    return
  }
  
  // Get subscription details
  const subscription = await stripe.subscriptions.retrieve(session.subscription as string)
  
  // Upsert subscription record
  await supabaseAdmin
    .from('subscriptions')
    .upsert({
      user_id: userId,
      plan_id: planId,
      status: subscription.status,
      stripe_customer_id: session.customer as string,
      stripe_subscription_id: subscription.id,
      stripe_price_id: subscription.items.data[0]?.price.id,
      billing_interval: subscription.items.data[0]?.price.recurring?.interval || 'month',
      current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
      current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
      cancel_at_period_end: subscription.cancel_at_period_end,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'user_id',
    })
  
  // Update user_plans table to sync with subscription
  await supabaseAdmin
    .from('user_plans')
    .upsert({
      user_id: userId,
      plan_id: planId,
      period_start: new Date(subscription.current_period_start * 1000).toISOString(),
      period_end: new Date(subscription.current_period_end * 1000).toISOString(),
      is_active: true,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'user_id',
    })
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  const userId = subscription.metadata?.supabase_user_id
  
  if (!userId) {
    // Try to find by stripe_subscription_id
    const { data } = await supabaseAdmin
      .from('subscriptions')
      .select('user_id, plan_id')
      .eq('stripe_subscription_id', subscription.id)
      .single()
    
    if (!data) {
      console.error('No subscription found for:', subscription.id)
      return
    }
    
    await updateSubscriptionRecord(data.user_id, subscription, data.plan_id)
  } else {
    const planId = subscription.metadata?.plan_id || 'starter'
    await updateSubscriptionRecord(userId, subscription, planId)
  }
}

async function updateSubscriptionRecord(userId: string, subscription: Stripe.Subscription, planId: string) {
  await supabaseAdmin
    .from('subscriptions')
    .upsert({
      user_id: userId,
      plan_id: planId,
      status: subscription.status,
      stripe_subscription_id: subscription.id,
      stripe_price_id: subscription.items.data[0]?.price.id,
      billing_interval: subscription.items.data[0]?.price.recurring?.interval || 'month',
      current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
      current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
      cancel_at_period_end: subscription.cancel_at_period_end,
      canceled_at: subscription.canceled_at ? new Date(subscription.canceled_at * 1000).toISOString() : null,
      ended_at: subscription.ended_at ? new Date(subscription.ended_at * 1000).toISOString() : null,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'user_id',
    })
  
  // Sync user_plans status
  const isActive = subscription.status === 'active' || subscription.status === 'trialing'
  await supabaseAdmin
    .from('user_plans')
    .upsert({
      user_id: userId,
      plan_id: isActive ? planId : 'free',
      period_start: new Date(subscription.current_period_start * 1000).toISOString(),
      period_end: new Date(subscription.current_period_end * 1000).toISOString(),
      is_active: true,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'user_id',
    })
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  // Find subscription by stripe_subscription_id
  const { data } = await supabaseAdmin
    .from('subscriptions')
    .select('user_id')
    .eq('stripe_subscription_id', subscription.id)
    .single()
  
  if (!data) {
    console.error('No subscription found to delete:', subscription.id)
    return
  }
  
  // Update subscription status
  await supabaseAdmin
    .from('subscriptions')
    .update({
      status: 'canceled',
      ended_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('stripe_subscription_id', subscription.id)
  
  // Downgrade user to free plan
  await supabaseAdmin
    .from('user_plans')
    .upsert({
      user_id: data.user_id,
      plan_id: 'free',
      period_start: new Date().toISOString(),
      period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      is_active: true,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'user_id',
    })
}

async function handleInvoicePaid(invoice: Stripe.Invoice) {
  if (!invoice.subscription) return
  
  // Find user by subscription
  const { data: subscription } = await supabaseAdmin
    .from('subscriptions')
    .select('user_id, id')
    .eq('stripe_subscription_id', invoice.subscription as string)
    .single()
  
  if (!subscription) return
  
  // Record payment
  await supabaseAdmin
    .from('payment_history')
    .insert({
      user_id: subscription.user_id,
      subscription_id: subscription.id,
      stripe_invoice_id: invoice.id,
      stripe_payment_intent_id: invoice.payment_intent as string,
      amount_cents: invoice.amount_paid,
      currency: invoice.currency,
      status: 'succeeded',
      description: invoice.lines.data[0]?.description || 'Subscription payment',
      invoice_pdf_url: invoice.invoice_pdf,
    })
}

async function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
  if (!invoice.subscription) return
  
  // Find user by subscription
  const { data: subscription } = await supabaseAdmin
    .from('subscriptions')
    .select('user_id, id')
    .eq('stripe_subscription_id', invoice.subscription as string)
    .single()
  
  if (!subscription) return
  
  // Record failed payment
  await supabaseAdmin
    .from('payment_history')
    .insert({
      user_id: subscription.user_id,
      subscription_id: subscription.id,
      stripe_invoice_id: invoice.id,
      stripe_payment_intent_id: invoice.payment_intent as string,
      amount_cents: invoice.amount_due,
      currency: invoice.currency,
      status: 'failed',
      description: 'Payment failed - ' + (invoice.lines.data[0]?.description || 'Subscription payment'),
    })
  
  // Update subscription status to past_due
  await supabaseAdmin
    .from('subscriptions')
    .update({
      status: 'past_due',
      updated_at: new Date().toISOString(),
    })
    .eq('stripe_subscription_id', invoice.subscription as string)
}
