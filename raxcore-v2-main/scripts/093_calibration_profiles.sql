-- Calibration profiles table for bias correction derived from training samples
create table if not exists calibration_profiles (
  id uuid primary key default gen_random_uuid(),

  profile_key text not null unique,
  profile_type text not null, -- 'global', 'state', 'rack_type', 'state_rack_type'

  state text,
  rack_type text,

  sample_count integer not null default 0,

  gross_bias numeric not null default 0,
  net_bias numeric not null default 0,

  gross_mae numeric not null default 0,
  net_mae numeric not null default 0,

  confidence_multiplier numeric not null default 1.0,

  is_active boolean not null default true,

  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create index if not exists idx_calibration_profiles_profile_type
  on calibration_profiles(profile_type);

create index if not exists idx_calibration_profiles_state
  on calibration_profiles(state);

create index if not exists idx_calibration_profiles_rack_type
  on calibration_profiles(rack_type);

create index if not exists idx_calibration_profiles_is_active
  on calibration_profiles(is_active);
