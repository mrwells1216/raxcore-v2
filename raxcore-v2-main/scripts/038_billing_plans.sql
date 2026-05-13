-- ============================================================
-- Phase 38: Billing / Credits / Usage Plans
-- ============================================================

-- ----------------------------------------------------------------
-- 1. Plan definitions (static config table, admin-editable)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.plans (
  id TEXT PRIMARY KEY,                            -- 'free' | 'starter' | 'pro' | 'admin'
  display_name TEXT NOT NULL,
  description TEXT,
  -- Scoring limits (NULL = unlimited)
  scores_per_month INTEGER,                        -- monthly scoring runs allowed
  scores_per_day INTEGER,                          -- daily cap (NULL = no daily cap)
  max_images_per_score INTEGER NOT NULL DEFAULT 4, -- image cap per scoring run
  -- Feature flags
  render_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  history_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  collection_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  advanced_analytics BOOLEAN NOT NULL DEFAULT FALSE,
  -- Guest (unauthenticated) plan controls
  is_guest_plan BOOLEAN NOT NULL DEFAULT FALSE,
  -- Ordering / display
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed default plans
INSERT INTO public.plans (id, display_name, description, scores_per_month, scores_per_day, max_images_per_score, render_enabled, history_enabled, collection_enabled, advanced_analytics, is_guest_plan, sort_order)
VALUES
  ('guest',   'Guest',   'Unauthenticated free trial — up to 3 scores',  3,    1,    4,  FALSE, FALSE, FALSE, FALSE, TRUE,  0),
  ('free',    'Free',    'Registered free account',                       10,   3,    4,  FALSE, TRUE,  FALSE, FALSE, FALSE, 1),
  ('starter', 'Starter', 'Early-access scoring with increased limits',    50,   10,   6,  FALSE, TRUE,  TRUE,  FALSE, FALSE, 2),
  ('pro',     'Pro',     'Full access, unlimited scoring, all features',  NULL, NULL, 8,  TRUE,  TRUE,  TRUE,  TRUE,  FALSE, 3),
  ('admin',   'Admin',   'Internal override — no limits',                 NULL, NULL, 10, TRUE,  TRUE,  TRUE,  TRUE,  FALSE, 4)
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------
-- 2. User plan assignments
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES public.plans(id),
  -- Period tracking (rolling monthly window OR fixed calendar month)
  period_start TIMESTAMPTZ NOT NULL DEFAULT date_trunc('month', NOW()),
  period_end TIMESTAMPTZ NOT NULL DEFAULT (date_trunc('month', NOW()) + INTERVAL '1 month'),
  -- Credits override: if NOT NULL, use this instead of plan default
  scores_override INTEGER DEFAULT NULL,
  -- Status
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  granted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id)  -- one active plan per user (upsert pattern)
);

-- RLS
ALTER TABLE public.user_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_plans_select_own" ON public.user_plans
  FOR SELECT USING (auth.uid() = user_id);

-- Admins can do everything via service role (no policy needed for service role)

-- ----------------------------------------------------------------
-- 3. Usage ledger — one row per scoring run
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.usage_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Who
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,  -- NULL = guest
  session_id TEXT,                                             -- guest session fallback
  client_ip TEXT,
  -- What
  event_type TEXT NOT NULL DEFAULT 'score',                    -- 'score' | 'render' (future)
  buck_id UUID REFERENCES public.bucks(id) ON DELETE SET NULL,
  images_count INTEGER NOT NULL DEFAULT 1,
  -- Plan context at time of scoring
  plan_id TEXT REFERENCES public.plans(id),
  -- Period tracking snapshot
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  -- Outcome
  status TEXT NOT NULL DEFAULT 'success',                      -- 'success' | 'blocked' | 'error'
  block_reason TEXT,                                           -- populated when status = 'blocked'
  -- Timestamp
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usage_ledger_user_period
  ON public.usage_ledger (user_id, period_start, period_end, event_type);

CREATE INDEX IF NOT EXISTS idx_usage_ledger_session
  ON public.usage_ledger (session_id, created_at);

CREATE INDEX IF NOT EXISTS idx_usage_ledger_plan
  ON public.usage_ledger (plan_id, created_at);

-- RLS: users can read their own ledger rows
ALTER TABLE public.usage_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "usage_ledger_select_own" ON public.usage_ledger
  FOR SELECT USING (auth.uid() = user_id);

-- ----------------------------------------------------------------
-- 4. Add plan column to profiles (convenience denorm)
-- ----------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS plan_id TEXT REFERENCES public.plans(id) DEFAULT 'free';

-- ----------------------------------------------------------------
-- 5. Trigger: auto-create a free user_plan on profile creation
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user_plan()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.user_plans (user_id, plan_id, period_start, period_end)
  VALUES (
    NEW.id,
    'free',
    date_trunc('month', NOW()),
    date_trunc('month', NOW()) + INTERVAL '1 month'
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_profile_created_billing ON public.profiles;
CREATE TRIGGER on_profile_created_billing
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_plan();

-- ----------------------------------------------------------------
-- 6. Helper view: user plan status with usage counts
-- ----------------------------------------------------------------
CREATE OR REPLACE VIEW public.user_plan_status AS
SELECT
  up.user_id,
  up.plan_id,
  p.display_name AS plan_name,
  p.scores_per_month,
  p.scores_per_day,
  p.max_images_per_score,
  p.render_enabled,
  p.history_enabled,
  p.collection_enabled,
  p.advanced_analytics,
  COALESCE(up.scores_override, p.scores_per_month) AS effective_monthly_limit,
  up.period_start,
  up.period_end,
  up.scores_override,
  -- Count successful scoring runs in the current period
  COUNT(ul.id) FILTER (
    WHERE ul.event_type = 'score'
      AND ul.status = 'success'
      AND ul.created_at >= up.period_start
      AND ul.created_at < up.period_end
  ) AS scores_used_this_period,
  -- Count today
  COUNT(ul.id) FILTER (
    WHERE ul.event_type = 'score'
      AND ul.status = 'success'
      AND ul.created_at >= date_trunc('day', NOW())
  ) AS scores_used_today,
  up.updated_at
FROM public.user_plans up
JOIN public.plans p ON p.id = up.plan_id
LEFT JOIN public.usage_ledger ul ON ul.user_id = up.user_id
WHERE up.is_active = TRUE
GROUP BY
  up.user_id, up.plan_id, p.display_name, p.scores_per_month,
  p.scores_per_day, p.max_images_per_score, p.render_enabled,
  p.history_enabled, p.collection_enabled, p.advanced_analytics,
  up.scores_override, up.period_start, up.period_end, up.updated_at;
