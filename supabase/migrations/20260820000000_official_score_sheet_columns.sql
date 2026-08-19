-- Backfill the columns the app writes to and reads from official_score_sheets
-- and official_score_images.
--
-- These tables were created outside version control with a minimal schema, so
-- the code and the database had drifted: importing a sheet failed with
-- "Could not find the 'buck_name' column of 'official_score_sheets' in the
-- schema cache". buck_name was simply the first column PostgREST tripped on;
-- the rest would have failed in turn. Same class of gap as the missing
-- profiles table.
--
-- Every statement is guarded, so this is a clean no-op against whatever
-- already exists.

-- ── official_score_sheets ───────────────────────────────────────────────────
-- Written by app/api/admin/training-import/route.ts, read by the pending and
-- gold-standard lists, updated by run-ai, run-ai-per-angle and promote.
ALTER TABLE public.official_score_sheets
  ADD COLUMN IF NOT EXISTS user_id           UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS buck_name         TEXT,
  ADD COLUMN IF NOT EXISTS year_taken        INTEGER,
  ADD COLUMN IF NOT EXISTS state             TEXT,
  ADD COLUMN IF NOT EXISTS county            TEXT,
  ADD COLUMN IF NOT EXISTS hunter_name       TEXT,
  ADD COLUMN IF NOT EXISTS created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- NOT NULL DEFAULT FALSE matters: both list queries filter on
  -- .eq('is_benchmark', false/true), and a nullable column would make freshly
  -- imported sheets invisible in the pending list.
  ADD COLUMN IF NOT EXISTS is_benchmark      BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS benchmark_pack_id UUID,
  ADD COLUMN IF NOT EXISTS promoted_by       UUID,
  ADD COLUMN IF NOT EXISTS promoted_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_run_result     JSONB,
  ADD COLUMN IF NOT EXISTS ai_run_per_angle  JSONB;

-- ── official_score_images ───────────────────────────────────────────────────
ALTER TABLE public.official_score_images
  ADD COLUMN IF NOT EXISTS sheet_id      UUID REFERENCES public.official_score_sheets(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS image_url     TEXT,
  -- Camera position (front_center, back_top_left, irregular_points, …)
  ADD COLUMN IF NOT EXISTS image_type    TEXT,
  -- What the photo is OF (mounted, live, harvest, trail_cam, european, …) —
  -- an axis independent of camera position.
  ADD COLUMN IF NOT EXISTS image_context TEXT,
  ADD COLUMN IF NOT EXISTS uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_official_score_images_sheet
  ON public.official_score_images (sheet_id);
