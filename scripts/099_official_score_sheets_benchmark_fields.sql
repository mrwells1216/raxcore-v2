-- Add benchmark/promotion fields to official_score_sheets for WI-3 promote flow.
-- scoring_system column already exists from 097 migration; we only add new columns.
ALTER TABLE public.official_score_sheets
  ADD COLUMN IF NOT EXISTS is_benchmark        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS benchmark_pack_id   UUID REFERENCES public.benchmark_packs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS promoted_by         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS promoted_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS buck_name           TEXT,
  ADD COLUMN IF NOT EXISTS county              TEXT,
  ADD COLUMN IF NOT EXISTS year_taken          INTEGER,
  ADD COLUMN IF NOT EXISTS hunter_name         TEXT,
  ADD COLUMN IF NOT EXISTS ai_run_result       JSONB;

CREATE INDEX IF NOT EXISTS idx_official_sheets_benchmark   ON public.official_score_sheets(is_benchmark);
CREATE INDEX IF NOT EXISTS idx_official_sheets_pack        ON public.official_score_sheets(benchmark_pack_id);
