-- ============================================================================
-- Script 102: Training Submission Backfill
-- Keeps user-submitted training scores aligned with the live correction layer.
-- Safe to run more than once.
-- ============================================================================

-- Ensure the user-facing ground truth aliases stay populated.
ALTER TABLE public.ground_truth_scores
  ADD COLUMN IF NOT EXISTS official_score NUMERIC(6,2) NULL;

UPDATE public.ground_truth_scores
SET
  official_score = COALESCE(official_score, official_gross),
  official_gross = COALESCE(official_gross, official_score)
WHERE official_score IS NULL
   OR official_gross IS NULL;

-- Keep prediction aliases available for older environments.
ALTER TABLE public.predictions
  ADD COLUMN IF NOT EXISTS estimated_score NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS score_range_low NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS score_range_high NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS used_fallback BOOLEAN DEFAULT false;

-- Ensure the enriched training columns used by correction-profile jobs exist.
ALTER TABLE public.training_examples
  ADD COLUMN IF NOT EXISTS prediction_id UUID REFERENCES public.predictions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ground_truth_id UUID REFERENCES public.ground_truth_scores(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS state TEXT,
  ADD COLUMN IF NOT EXISTS rack_type TEXT,
  ADD COLUMN IF NOT EXISTS source_type TEXT,
  ADD COLUMN IF NOT EXISTS image_count INTEGER,
  ADD COLUMN IF NOT EXISTS confidence_label TEXT CHECK (confidence_label IN ('low', 'medium', 'high')),
  ADD COLUMN IF NOT EXISTS fallback_used BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS predicted_gross NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS predicted_net NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS predicted_range_low NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS predicted_range_high NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS actual_gross NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS actual_net NUMERIC(6,2);

-- Create missing training_examples for ground truth rows that were saved before
-- the API accepted official_gross/official_net from the UI.
WITH latest_predictions AS (
  SELECT DISTINCT ON (p.buck_id)
    p.*
  FROM public.predictions p
  ORDER BY p.buck_id, p.created_at DESC
),
image_rollup AS (
  SELECT
    bi.buck_id,
    array_remove(
      array_agg(COALESCE(bi.image_url, bi.public_url) ORDER BY bi.display_order NULLS LAST, bi.created_at),
      NULL
    ) AS image_urls
  FROM public.buck_images bi
  GROUP BY bi.buck_id
)
INSERT INTO public.training_examples (
  buck_id,
  prediction_id,
  ground_truth_id,
  image_urls,
  ground_truth_score,
  predicted_score,
  error_amount,
  main_beam_left,
  main_beam_right,
  inside_spread,
  points_left,
  points_right,
  tine_measurements,
  circumference_measurements,
  verified_for_training,
  source,
  notes,
  state,
  rack_type,
  source_type,
  image_count,
  confidence_label,
  fallback_used,
  predicted_gross,
  predicted_net,
  predicted_range_low,
  predicted_range_high,
  actual_gross,
  actual_net
)
SELECT
  gt.buck_id,
  p.id,
  gt.id,
  COALESCE(ir.image_urls, ARRAY[]::text[]),
  COALESCE(gt.official_score, gt.official_gross),
  COALESCE(p.predicted_gross, p.estimated_score),
  COALESCE(gt.official_score, gt.official_gross) - COALESCE(p.predicted_gross, p.estimated_score),
  gt.main_beam_left,
  gt.main_beam_right,
  gt.inside_spread,
  gt.points_left,
  gt.points_right,
  jsonb_build_object(
    'g1_left', gt.g1_left,
    'g1_right', gt.g1_right,
    'g2_left', gt.g2_left,
    'g2_right', gt.g2_right,
    'g3_left', gt.g3_left,
    'g3_right', gt.g3_right,
    'g4_left', gt.g4_left,
    'g4_right', gt.g4_right
  ),
  jsonb_build_object(
    'h1_left', gt.h1_left,
    'h1_right', gt.h1_right,
    'h2_left', gt.h2_left,
    'h2_right', gt.h2_right,
    'h3_left', gt.h3_left,
    'h3_right', gt.h3_right,
    'h4_left', gt.h4_left,
    'h4_right', gt.h4_right
  ),
  false,
  'user_submission',
  concat_ws(
    E'\n',
    NULLIF(gt.scorer_notes, ''),
    NULLIF(gt.notes, ''),
    '[meta] backfilled from ground_truth_scores by script 102'
  ),
  b.state,
  b.rack_type,
  b.source_type,
  COALESCE(p.images_used, array_length(ir.image_urls, 1)),
  CASE
    WHEN p.confidence_percent >= 75 THEN 'high'
    WHEN p.confidence_percent >= 50 THEN 'medium'
    WHEN p.confidence_percent IS NOT NULL THEN 'low'
    ELSE NULL
  END,
  COALESCE(p.used_fallback, false),
  COALESCE(p.predicted_gross, p.estimated_score),
  p.predicted_net,
  p.score_range_low,
  p.score_range_high,
  COALESCE(gt.official_score, gt.official_gross),
  gt.official_net
FROM public.ground_truth_scores gt
JOIN public.bucks b
  ON b.id = gt.buck_id
JOIN latest_predictions p
  ON p.buck_id = gt.buck_id
LEFT JOIN image_rollup ir
  ON ir.buck_id = gt.buck_id
WHERE COALESCE(gt.official_score, gt.official_gross) IS NOT NULL
  AND COALESCE(p.predicted_gross, p.estimated_score) IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.training_examples te
    WHERE te.buck_id = gt.buck_id
  );

-- The learning layer applies error_amount as actual - predicted:
-- positive means the AI under-estimated and needs an upward correction.
UPDATE public.training_examples
SET
  error_amount = ground_truth_score - predicted_score,
  predicted_gross = COALESCE(predicted_gross, predicted_score),
  actual_gross = COALESCE(actual_gross, ground_truth_score),
  image_count = COALESCE(image_count, array_length(image_urls, 1))
WHERE ground_truth_score IS NOT NULL
  AND predicted_score IS NOT NULL;

-- Backfill context fields from bucks/predictions where links are available.
UPDATE public.training_examples te
SET
  state = COALESCE(te.state, b.state),
  rack_type = COALESCE(te.rack_type, b.rack_type),
  source_type = COALESCE(te.source_type, b.source_type),
  image_count = COALESCE(te.image_count, p.images_used),
  predicted_range_low = COALESCE(te.predicted_range_low, p.score_range_low),
  predicted_range_high = COALESCE(te.predicted_range_high, p.score_range_high),
  predicted_net = COALESCE(te.predicted_net, p.predicted_net),
  confidence_label = COALESCE(
    te.confidence_label,
    CASE
      WHEN p.confidence_percent >= 75 THEN 'high'
      WHEN p.confidence_percent >= 50 THEN 'medium'
      WHEN p.confidence_percent IS NOT NULL THEN 'low'
      ELSE NULL
    END
  )
FROM public.bucks b
LEFT JOIN public.predictions p
  ON p.buck_id = b.id
WHERE te.buck_id = b.id;
