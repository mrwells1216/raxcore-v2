-- Trophy Room — curated gallery of bucks the user has scored, gated by high
-- confidence (Verified Score or confidence_tier in {'high','very_high'}).
-- Soft delete via deleted_at.

CREATE TABLE IF NOT EXISTS public.trophy_room_entries (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  buck_id             UUID NOT NULL REFERENCES public.bucks(id) ON DELETE CASCADE,
  prediction_id       UUID REFERENCES public.predictions(id) ON DELETE SET NULL,

  -- Display state
  display_photo_url   TEXT NOT NULL,
  watermarked_url     TEXT,
  watermark_status    TEXT NOT NULL DEFAULT 'pending'
                      CHECK (watermark_status IN ('pending', 'generating', 'ready', 'failed')),

  -- Score snapshot at time of approval (frozen — does not change if buck is re-scored)
  display_label       TEXT,
  display_gross       NUMERIC NOT NULL,
  display_net         NUMERIC,
  scoring_system      TEXT NOT NULL
                      CHECK (scoring_system IN ('bc_typical', 'bc_nontypical', 'py_typical', 'py_nontypical')),
  confidence_tier     TEXT NOT NULL,
  is_verified_score   BOOLEAN NOT NULL DEFAULT FALSE,

  -- Workflow
  approved_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trophy_room_user
  ON public.trophy_room_entries(user_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_trophy_room_buck
  ON public.trophy_room_entries(buck_id);

CREATE INDEX IF NOT EXISTS idx_trophy_room_created
  ON public.trophy_room_entries(created_at DESC);

ALTER TABLE public.trophy_room_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "trophy_owner_select" ON public.trophy_room_entries
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "trophy_owner_insert" ON public.trophy_room_entries
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "trophy_owner_update" ON public.trophy_room_entries
  FOR UPDATE USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION update_trophy_room_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trophy_room_updated_at_trigger ON public.trophy_room_entries;
CREATE TRIGGER trophy_room_updated_at_trigger
  BEFORE UPDATE ON public.trophy_room_entries
  FOR EACH ROW EXECUTE FUNCTION update_trophy_room_updated_at();

-- Storage bucket for watermarked images (public read so URLs can be shared)
INSERT INTO storage.buckets (id, name, public)
  VALUES ('trophy-watermarks', 'trophy-watermarks', true)
  ON CONFLICT (id) DO NOTHING;
