-- Unified correction events table
-- Records every user-initiated correction to an AI prediction,
-- across all 4 correction sources: score_editor, dpad, precision_pass, review_sheet.
-- This is the primary flywheel data source for prompt bias detection (WI-5).

CREATE TABLE IF NOT EXISTS public.correction_events (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buck_id               UUID NOT NULL REFERENCES public.bucks(id) ON DELETE CASCADE,
  prediction_id         UUID REFERENCES public.predictions(id) ON DELETE SET NULL,
  user_id               UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  correction_source     TEXT NOT NULL CHECK (correction_source IN ('score_editor', 'dpad', 'precision_pass', 'review_sheet')),
  field_key             TEXT NOT NULL,
  ai_value              NUMERIC,
  user_value            NUMERIC,
  delta                 NUMERIC,
  confidence_tier_before TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_correction_events_buck       ON public.correction_events(buck_id);
CREATE INDEX IF NOT EXISTS idx_correction_events_prediction ON public.correction_events(prediction_id);
CREATE INDEX IF NOT EXISTS idx_correction_events_field      ON public.correction_events(field_key);
CREATE INDEX IF NOT EXISTS idx_correction_events_source     ON public.correction_events(correction_source);
CREATE INDEX IF NOT EXISTS idx_correction_events_created    ON public.correction_events(created_at DESC);

ALTER TABLE public.correction_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_read" ON public.correction_events FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND is_admin = true
  ));

CREATE POLICY "owner_insert" ON public.correction_events FOR INSERT
  WITH CHECK (user_id = auth.uid() OR user_id IS NULL);
