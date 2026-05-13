-- Calibration profiles table for bias correction and confidence scaling
create table if not exists calibration_profiles (
  id uuid primary key default gen_random_uuid(),
  profile_key text not null unique,
  scope jsonb not null default '{}'::jsonb,
  sample_count integer not null default 0,
  gross_bias numeric not null default 0,
  net_bias numeric not null default 0,
  gross_mae numeric not null default 0,
  net_mae numeric not null default 0,
  confidence_scale numeric not null default 1,
  is_active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

-- Index for quick lookup of active profiles
create index if not exists idx_calibration_profiles_active 
  on calibration_profiles(profile_key, is_active) 
  where is_active = true;
