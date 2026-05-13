-- ============================================================
-- Phase 43: Plans Table (prerequisite for subscriptions)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  features JSONB DEFAULT '[]',
  limits JSONB DEFAULT '{}',
  price_cents INTEGER DEFAULT 0,
  price_yearly_cents INTEGER DEFAULT 0,
  stripe_price_id TEXT,
  stripe_price_yearly_id TEXT,
  is_purchasable BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default plans
INSERT INTO public.plans (id, name, description, price_cents, is_purchasable) VALUES
  ('guest', 'Guest', 'Limited guest access', 0, FALSE),
  ('free', 'Free', 'Free tier with basic features', 0, FALSE),
  ('starter', 'Starter', 'Starter plan with more features', 999, TRUE),
  ('pro', 'Pro', 'Professional plan with full features', 2999, TRUE),
  ('admin', 'Admin', 'Administrative access', 0, FALSE)
ON CONFLICT (id) DO NOTHING;
