-- ============================================================
-- Phase 44: Payment Integration + Subscription Lifecycle
-- ============================================================

-- ----------------------------------------------------------------
-- 1. Extend plans table with pricing information
-- ----------------------------------------------------------------
ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS price_cents INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS price_yearly_cents INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stripe_price_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_price_yearly_id TEXT,
  ADD COLUMN IF NOT EXISTS is_purchasable BOOLEAN DEFAULT FALSE;

-- Update plan pricing
UPDATE public.plans SET price_cents = 0, is_purchasable = FALSE WHERE id = 'guest';
UPDATE public.plans SET price_cents = 0, is_purchasable = FALSE WHERE id = 'free';
UPDATE public.plans SET price_cents = 999, price_yearly_cents = 9990, is_purchasable = TRUE WHERE id = 'starter';
UPDATE public.plans SET price_cents = 2999, price_yearly_cents = 29990, is_purchasable = TRUE WHERE id = 'pro';
UPDATE public.plans SET price_cents = 0, is_purchasable = FALSE WHERE id = 'admin';

-- ----------------------------------------------------------------
-- 2. Subscriptions table
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Stripe identifiers
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT UNIQUE,
  stripe_price_id TEXT,
  -- Status
  status TEXT NOT NULL DEFAULT 'inactive' CHECK (status IN (
    'incomplete', 'incomplete_expired', 'trialing', 'active', 
    'past_due', 'canceled', 'unpaid', 'paused', 'inactive'
  )),
  -- Plan mapping
  plan_id TEXT REFERENCES public.plans(id),
  -- Billing period
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  -- Cancellation
  cancel_at_period_end BOOLEAN DEFAULT FALSE,
  canceled_at TIMESTAMPTZ,
  -- Trial (if applicable)
  trial_start TIMESTAMPTZ,
  trial_end TIMESTAMPTZ,
  -- Metadata
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON public.subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer ON public.subscriptions(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON public.subscriptions(status);

-- RLS
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "subscriptions_select_own" ON public.subscriptions
  FOR SELECT USING (auth.uid() = user_id);

-- ----------------------------------------------------------------
-- 3. Billing events log (for audit and debugging)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.billing_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  stripe_event_id TEXT UNIQUE,
  event_type TEXT NOT NULL,
  event_data JSONB,
  processed_at TIMESTAMPTZ DEFAULT NOW(),
  processing_error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_billing_events_user ON public.billing_events(user_id);
CREATE INDEX IF NOT EXISTS idx_billing_events_type ON public.billing_events(event_type);
CREATE INDEX IF NOT EXISTS idx_billing_events_created ON public.billing_events(created_at DESC);

-- RLS
ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "billing_events_select_own" ON public.billing_events
  FOR SELECT USING (auth.uid() = user_id);

-- ----------------------------------------------------------------
-- 4. Payment methods (simplified)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_payment_method_id TEXT UNIQUE,
  card_brand TEXT,
  card_last4 TEXT,
  card_exp_month INTEGER,
  card_exp_year INTEGER,
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_methods_user ON public.payment_methods(user_id);

-- RLS
ALTER TABLE public.payment_methods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payment_methods_select_own" ON public.payment_methods
  FOR SELECT USING (auth.uid() = user_id);

-- ----------------------------------------------------------------
-- 5. Sync subscription status to user_plans for unified enforcement
-- ----------------------------------------------------------------
-- The billing service will call setUserPlan() when subscription changes,
-- keeping user_plans as the authoritative source for limit enforcement
-- and subscriptions as the payment/billing state.

-- ----------------------------------------------------------------
-- 6. Add subscription_id reference to profiles for quick access
-- ----------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;

-- ----------------------------------------------------------------
-- 7. Trigger to update updated_at on subscriptions
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_subscription_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS subscription_updated_at ON public.subscriptions;
CREATE TRIGGER subscription_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_subscription_updated_at();
