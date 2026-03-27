-- Phase 13: Validation Runs Table
-- Stores validation harness results for known-score bucks

CREATE TABLE IF NOT EXISTS public.validation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Core references
  buck_id UUID NOT NULL REFERENCES public.bucks(id) ON DELETE CASCADE,
  prediction_id UUID REFERENCES public.predictions(id) ON DELETE SET NULL,
  training_example_id UUID REFERENCES public.training_examples(id) ON DELETE SET NULL,
  model_version_id UUID REFERENCES public.model_versions(id) ON DELETE SET NULL,
  
  -- Official scores (ground truth)
  official_gross NUMERIC(6,2) NOT NULL,
  official_net NUMERIC(6,2),
  
  -- Raw vision output (before any normalization/correction)
  raw_vision_gross NUMERIC(6,2),
  raw_vision_net NUMERIC(6,2),
  raw_vision_confidence NUMERIC(5,2),
  raw_vision_measurements JSONB,
  
  -- Normalized output (after stabilization)
  normalized_gross NUMERIC(6,2),
  normalized_net NUMERIC(6,2),
  normalized_confidence NUMERIC(5,2),
  normalization_adjustments JSONB,
  
  -- Corrected output (after learning correction)
  corrected_gross NUMERIC(6,2),
  corrected_net NUMERIC(6,2),
  corrected_confidence NUMERIC(5,2),
  learning_corrections JSONB,
  
  -- Final displayed output
  final_gross NUMERIC(6,2) NOT NULL,
  final_net NUMERIC(6,2),
  final_confidence NUMERIC(5,2),
  
  -- Error metrics
  gross_error NUMERIC(6,2) NOT NULL,
  net_error NUMERIC(6,2),
  abs_gross_error NUMERIC(6,2) NOT NULL,
  abs_net_error NUMERIC(6,2),
  
  -- Stage-by-stage errors
  raw_gross_error NUMERIC(6,2),
  normalized_gross_error NUMERIC(6,2),
  corrected_gross_error NUMERIC(6,2),
  
  -- Per-measurement errors
  spread_error NUMERIC(6,2),
  beam_error NUMERIC(6,2),
  tine_error NUMERIC(6,2),
  mass_error NUMERIC(6,2),
  deduction_error NUMERIC(6,2),
  measurement_errors JSONB,
  
  -- Metadata snapshot
  metadata_snapshot JSONB NOT NULL,
  
  -- Classification
  error_direction TEXT CHECK (error_direction IN ('over', 'under', 'accurate')),
  error_severity TEXT CHECK (error_severity IN ('minor', 'moderate', 'major', 'extreme')),
  stability_flag TEXT CHECK (stability_flag IN ('stable', 'unstable', 'unknown')),
  
  -- Run metadata
  run_notes TEXT,
  processing_time_ms INTEGER,
  scoring_method TEXT,
  vision_model_used TEXT,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by TEXT
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_validation_runs_buck_id ON public.validation_runs(buck_id);
CREATE INDEX IF NOT EXISTS idx_validation_runs_model_version ON public.validation_runs(model_version_id);
CREATE INDEX IF NOT EXISTS idx_validation_runs_created_at ON public.validation_runs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_validation_runs_error_direction ON public.validation_runs(error_direction);
CREATE INDEX IF NOT EXISTS idx_validation_runs_error_severity ON public.validation_runs(error_severity);
CREATE INDEX IF NOT EXISTS idx_validation_runs_abs_gross_error ON public.validation_runs(abs_gross_error);

-- Enable RLS
ALTER TABLE public.validation_runs ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Allow all operations (admin-only feature, app doesn't have user auth yet)
CREATE POLICY "Allow all for validation_runs" ON public.validation_runs 
  FOR ALL USING (true) WITH CHECK (true);

-- Function to automatically calculate error metrics on insert
CREATE OR REPLACE FUNCTION public.calculate_validation_errors()
RETURNS TRIGGER AS $$
BEGIN
  -- Calculate gross error
  NEW.gross_error := NEW.final_gross - NEW.official_gross;
  NEW.abs_gross_error := ABS(NEW.gross_error);
  
  -- Calculate net error if available
  IF NEW.final_net IS NOT NULL AND NEW.official_net IS NOT NULL THEN
    NEW.net_error := NEW.final_net - NEW.official_net;
    NEW.abs_net_error := ABS(NEW.net_error);
  END IF;
  
  -- Calculate stage errors
  IF NEW.raw_vision_gross IS NOT NULL THEN
    NEW.raw_gross_error := NEW.raw_vision_gross - NEW.official_gross;
  END IF;
  
  IF NEW.normalized_gross IS NOT NULL THEN
    NEW.normalized_gross_error := NEW.normalized_gross - NEW.official_gross;
  END IF;
  
  IF NEW.corrected_gross IS NOT NULL THEN
    NEW.corrected_gross_error := NEW.corrected_gross - NEW.official_gross;
  END IF;
  
  -- Determine error direction
  IF NEW.abs_gross_error <= 2.0 THEN
    NEW.error_direction := 'accurate';
  ELSIF NEW.gross_error > 0 THEN
    NEW.error_direction := 'over';
  ELSE
    NEW.error_direction := 'under';
  END IF;
  
  -- Determine error severity
  IF NEW.abs_gross_error <= 3.0 THEN
    NEW.error_severity := 'minor';
  ELSIF NEW.abs_gross_error <= 6.0 THEN
    NEW.error_severity := 'moderate';
  ELSIF NEW.abs_gross_error <= 12.0 THEN
    NEW.error_severity := 'major';
  ELSE
    NEW.error_severity := 'extreme';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for automatic error calculation
DROP TRIGGER IF EXISTS calculate_validation_errors_trigger ON public.validation_runs;
CREATE TRIGGER calculate_validation_errors_trigger
  BEFORE INSERT OR UPDATE ON public.validation_runs
  FOR EACH ROW
  EXECUTE FUNCTION public.calculate_validation_errors();
