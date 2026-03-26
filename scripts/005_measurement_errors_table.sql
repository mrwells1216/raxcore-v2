-- Measurement Errors Table (Phase 9)
-- Tracks detailed measurement-level errors for error pattern analysis

CREATE TABLE IF NOT EXISTS measurement_errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prediction_id UUID NOT NULL REFERENCES predictions(id) ON DELETE CASCADE,
  
  -- Individual measurement errors (predicted - ground_truth)
  -- Positive = over-estimate, Negative = under-estimate
  spread_error DECIMAL(5,2),
  beam_left_error DECIMAL(5,2),
  beam_right_error DECIMAL(5,2),
  g1_error DECIMAL(5,2),
  g2_error DECIMAL(5,2),
  g3_error DECIMAL(5,2),
  g4_error DECIMAL(5,2),
  g5_error DECIMAL(5,2),
  circumference_error DECIMAL(5,2),
  
  -- Score-level errors
  gross_error DECIMAL(6,2),
  net_error DECIMAL(6,2),
  
  -- Metadata
  scoring_method VARCHAR(20) DEFAULT 'vision', -- 'vision' or 'heuristic'
  model_version VARCHAR(50),
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Ensure one error record per prediction
  CONSTRAINT unique_prediction_error UNIQUE (prediction_id)
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_measurement_errors_created 
  ON measurement_errors(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_measurement_errors_method 
  ON measurement_errors(scoring_method);

-- Enable RLS
ALTER TABLE measurement_errors ENABLE ROW LEVEL SECURITY;

-- Policy: Allow read for authenticated users (admin analytics)
CREATE POLICY "Allow read for authenticated users" ON measurement_errors
  FOR SELECT TO authenticated USING (true);

-- Policy: Allow insert for authenticated users (system writes)
CREATE POLICY "Allow insert for authenticated users" ON measurement_errors
  FOR INSERT TO authenticated WITH CHECK (true);

-- Policy: Allow update for authenticated users
CREATE POLICY "Allow update for authenticated users" ON measurement_errors
  FOR UPDATE TO authenticated USING (true);
