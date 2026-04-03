-- Training samples table for fine-tuning data collection
-- Stores input/output pairs from AI predictions and human corrections

create table if not exists training_samples (
  id uuid primary key default gen_random_uuid(),
  buck_id uuid references bucks(id) on delete cascade,
  prediction_id uuid references predictions(id) on delete cascade,
  input jsonb not null,
  ai_output jsonb not null,
  ground_truth jsonb not null,
  created_at timestamp with time zone default now()
);

-- Indexes for efficient querying
create index if not exists idx_training_samples_buck_id on training_samples(buck_id);
create index if not exists idx_training_samples_prediction_id on training_samples(prediction_id);
create index if not exists idx_training_samples_created_at on training_samples(created_at desc);

-- Prevent duplicate training samples per prediction
create unique index if not exists idx_training_samples_prediction_unique 
  on training_samples(prediction_id);
