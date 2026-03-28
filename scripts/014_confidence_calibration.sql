-- Phase 25: Confidence Calibration + Trust Scoring
-- Migration to add calibrated confidence and trust score columns

-- Add calibrated confidence and trust score columns to predictions
ALTER TABLE predictions 
ADD COLUMN IF NOT EXISTS raw_confidence INTEGER,
ADD COLUMN IF NOT EXISTS calibrated_confidence INTEGER,
ADD COLUMN IF NOT EXISTS confidence_tier TEXT,
ADD COLUMN IF NOT EXISTS expected_mae DECIMAL(4,1),
ADD COLUMN IF NOT EXISTS trust_score INTEGER,
ADD COLUMN IF NOT EXISTS trust_tier TEXT,
ADD COLUMN IF NOT EXISTS confidence_trust_metadata JSONB;

-- Add columns to training_examples for calibration analysis
ALTER TABLE training_examples
ADD COLUMN IF NOT EXISTS raw_confidence INTEGER,
ADD COLUMN IF NOT EXISTS calibrated_confidence INTEGER,
ADD COLUMN IF NOT EXISTS confidence_tier TEXT,
ADD COLUMN IF NOT EXISTS trust_score INTEGER,
ADD COLUMN IF NOT EXISTS trust_tier TEXT,
ADD COLUMN IF NOT EXISTS confidence_was_accurate BOOLEAN;

-- Add columns to validation_results for calibration tracking
ALTER TABLE validation_results
ADD COLUMN IF NOT EXISTS raw_confidence INTEGER,
ADD COLUMN IF NOT EXISTS calibrated_confidence INTEGER,
ADD COLUMN IF NOT EXISTS confidence_tier TEXT,
ADD COLUMN IF NOT EXISTS trust_score INTEGER,
ADD COLUMN IF NOT EXISTS trust_tier TEXT,
ADD COLUMN IF NOT EXISTS expected_mae DECIMAL(4,1),
ADD COLUMN IF NOT EXISTS confidence_accurate BOOLEAN;

-- Create confidence calibration data table for historical analysis
CREATE TABLE IF NOT EXISTS confidence_calibration_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Time period
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  
  -- Confidence bucket (e.g., "70-75", "75-80")
  confidence_bucket TEXT NOT NULL,
  bucket_min INTEGER NOT NULL,
  bucket_max INTEGER NOT NULL,
  
  -- Aggregated metrics
  sample_count INTEGER NOT NULL DEFAULT 0,
  avg_raw_confidence DECIMAL(5,2),
  avg_calibrated_confidence DECIMAL(5,2),
  actual_mae DECIMAL(5,2),
  within_5_inches_percent DECIMAL(5,2),
  within_10_inches_percent DECIMAL(5,2),
  
  -- Scenario breakdown (optional)
  scenario TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(period_start, period_end, confidence_bucket, scenario)
);

-- Create trust score effectiveness table
CREATE TABLE IF NOT EXISTS trust_score_analysis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Time period
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  
  -- Trust tier
  trust_tier TEXT NOT NULL,
  
  -- Metrics
  sample_count INTEGER NOT NULL DEFAULT 0,
  avg_trust_score DECIMAL(5,2),
  avg_error DECIMAL(5,2),
  median_error DECIMAL(5,2),
  within_5_inches_percent DECIMAL(5,2),
  within_10_inches_percent DECIMAL(5,2),
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(period_start, period_end, trust_tier)
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_predictions_confidence_tier ON predictions(confidence_tier);
CREATE INDEX IF NOT EXISTS idx_predictions_trust_tier ON predictions(trust_tier);
CREATE INDEX IF NOT EXISTS idx_predictions_calibrated_confidence ON predictions(calibrated_confidence);
CREATE INDEX IF NOT EXISTS idx_training_examples_confidence_tier ON training_examples(confidence_tier);
CREATE INDEX IF NOT EXISTS idx_confidence_calibration_data_bucket ON confidence_calibration_data(confidence_bucket);
CREATE INDEX IF NOT EXISTS idx_trust_score_analysis_tier ON trust_score_analysis(trust_tier);

-- Add validation run columns for calibration metrics
ALTER TABLE validation_runs
ADD COLUMN IF NOT EXISTS calibration_slope DECIMAL(6,4),
ADD COLUMN IF NOT EXISTS calibration_intercept DECIMAL(6,4),
ADD COLUMN IF NOT EXISTS calibration_r2 DECIMAL(6,4),
ADD COLUMN IF NOT EXISTS confidence_error_correlation DECIMAL(6,4),
ADD COLUMN IF NOT EXISTS trust_score_correlation DECIMAL(6,4),
ADD COLUMN IF NOT EXISTS overconfident_percent DECIMAL(5,2),
ADD COLUMN IF NOT EXISTS underconfident_percent DECIMAL(5,2);

-- Comment on tables
COMMENT ON TABLE confidence_calibration_data IS 'Historical confidence calibration data for analysis and model improvement';
COMMENT ON TABLE trust_score_analysis IS 'Trust score effectiveness analysis by tier';
