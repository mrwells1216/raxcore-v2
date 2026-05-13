-- Phase 21: Measurement-Level Error Correction Schema Updates
-- Adds columns for storing per-measurement errors and corrections

-- Add measurement error columns to training_examples
-- These store the per-category errors (ground_truth - predicted) for learning
ALTER TABLE public.training_examples 
ADD COLUMN IF NOT EXISTS measurement_errors JSONB;

-- Add detailed ground truth measurement columns if not present
ALTER TABLE public.training_examples 
ADD COLUMN IF NOT EXISTS inside_spread NUMERIC(6,2);

ALTER TABLE public.training_examples 
ADD COLUMN IF NOT EXISTS main_beam_left NUMERIC(6,2);

ALTER TABLE public.training_examples 
ADD COLUMN IF NOT EXISTS main_beam_right NUMERIC(6,2);

ALTER TABLE public.training_examples 
ADD COLUMN IF NOT EXISTS tine_measurements JSONB;

ALTER TABLE public.training_examples 
ADD COLUMN IF NOT EXISTS circumference_measurements JSONB;

-- Add measurement correction summary to predictions
ALTER TABLE public.predictions 
ADD COLUMN IF NOT EXISTS measurement_correction_summary JSONB;

-- Add measurement-level accuracy tracking to validation_results
ALTER TABLE public.validation_results 
ADD COLUMN IF NOT EXISTS measurement_errors_before JSONB;

ALTER TABLE public.validation_results 
ADD COLUMN IF NOT EXISTS measurement_errors_after JSONB;

ALTER TABLE public.validation_results 
ADD COLUMN IF NOT EXISTS category_corrections_applied JSONB;

-- Add columns for tracking which categories improved
ALTER TABLE public.validation_runs 
ADD COLUMN IF NOT EXISTS spread_mae_before NUMERIC(6,2);

ALTER TABLE public.validation_runs 
ADD COLUMN IF NOT EXISTS spread_mae_after NUMERIC(6,2);

ALTER TABLE public.validation_runs 
ADD COLUMN IF NOT EXISTS beam_mae_before NUMERIC(6,2);

ALTER TABLE public.validation_runs 
ADD COLUMN IF NOT EXISTS beam_mae_after NUMERIC(6,2);

ALTER TABLE public.validation_runs 
ADD COLUMN IF NOT EXISTS tine_mae_before NUMERIC(6,2);

ALTER TABLE public.validation_runs 
ADD COLUMN IF NOT EXISTS tine_mae_after NUMERIC(6,2);

ALTER TABLE public.validation_runs 
ADD COLUMN IF NOT EXISTS mass_mae_before NUMERIC(6,2);

ALTER TABLE public.validation_runs 
ADD COLUMN IF NOT EXISTS mass_mae_after NUMERIC(6,2);

-- Add calibration profile settings for measurement-level correction
ALTER TABLE public.calibration_profiles 
ADD COLUMN IF NOT EXISTS deduction_correction_weight NUMERIC(4,2) DEFAULT 1.0;

ALTER TABLE public.calibration_profiles 
ADD COLUMN IF NOT EXISTS max_deduction_correction NUMERIC(4,2) DEFAULT 2.5;

-- Create index for measurement_errors queries
CREATE INDEX IF NOT EXISTS idx_training_examples_measurement_errors 
ON public.training_examples USING GIN (measurement_errors);

-- Create index for predictions with correction summary
CREATE INDEX IF NOT EXISTS idx_predictions_measurement_correction 
ON public.predictions USING GIN (measurement_correction_summary);

-- Comments for documentation
COMMENT ON COLUMN public.training_examples.measurement_errors IS 
  'Per-category errors (ground_truth - predicted) in inches: {spread, beam, tine, mass, deduction}';

COMMENT ON COLUMN public.training_examples.inside_spread IS 
  'Ground truth inside spread measurement in inches';

COMMENT ON COLUMN public.training_examples.main_beam_left IS 
  'Ground truth left main beam measurement in inches';

COMMENT ON COLUMN public.training_examples.main_beam_right IS 
  'Ground truth right main beam measurement in inches';

COMMENT ON COLUMN public.training_examples.tine_measurements IS 
  'Ground truth tine measurements as JSON: {g1_left, g1_right, g2_left, ...}';

COMMENT ON COLUMN public.training_examples.circumference_measurements IS 
  'Ground truth circumference (mass) measurements as JSON: {h1_left, h1_right, h2_left, ...}';

COMMENT ON COLUMN public.predictions.measurement_correction_summary IS 
  'Summary of measurement-level corrections applied during scoring';

COMMENT ON COLUMN public.validation_results.measurement_errors_before IS 
  'Per-category errors before measurement-level correction';

COMMENT ON COLUMN public.validation_results.measurement_errors_after IS 
  'Per-category errors after measurement-level correction';

COMMENT ON COLUMN public.validation_results.category_corrections_applied IS 
  'Corrections applied by category: {spread, beam, tine, mass, deduction}';
