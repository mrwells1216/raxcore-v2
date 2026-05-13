-- ============================================================================
-- PHASE 50 — Reverse-Engineering Precision Pass
-- Tables:
--   reverse_runs, hypothesis_candidates, hypothesis_evaluations,
--   error_decompositions, reverse_jobs
-- Plus: minimal optional linkage columns on predictions
-- ============================================================================

-- Reverse runs
create table if not exists public.reverse_runs (
  id uuid primary key default gen_random_uuid(),
  prediction_id uuid not null references public.predictions(id) on delete cascade,
  buck_id uuid null references public.bucks(id) on delete set null,

  requested_by_user_id uuid null references public.profiles(id) on delete set null,
  mode text not null default 'precision_pass' check (mode in ('precision_pass')),

  status text not null default 'queued'
    check (status in ('queued','running','completed','failed','cancelled')),

  -- Snapshots and configuration
  baseline_snapshot jsonb null,
  settings jsonb null,

  -- Outputs
  best_hypothesis_id uuid null,
  best_summary jsonb null,

  -- If you later decide to materialize a new prediction row:
  best_prediction_id uuid null references public.predictions(id) on delete set null,

  created_at timestamptz not null default now(),
  started_at timestamptz null,
  completed_at timestamptz null,
  failed_at timestamptz null,
  failure_reason text null
);

create index if not exists idx_reverse_runs_prediction_id on public.reverse_runs(prediction_id);
create index if not exists idx_reverse_runs_status on public.reverse_runs(status);
create index if not exists idx_reverse_runs_created_at on public.reverse_runs(created_at desc);

-- Hypothesis candidates
create table if not exists public.hypothesis_candidates (
  id uuid primary key default gen_random_uuid(),
  reverse_run_id uuid not null references public.reverse_runs(id) on delete cascade,

  hypothesis_rank int not null default 0,
  hypothesis_type text not null
    check (hypothesis_type in ('noop','scale','spread','beam','tine','mass','deduction','swap_sides','combo')),

  params jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_hypothesis_candidates_run on public.hypothesis_candidates(reverse_run_id);
create index if not exists idx_hypothesis_candidates_rank on public.hypothesis_candidates(reverse_run_id, hypothesis_rank);

-- Hypothesis evaluations
create table if not exists public.hypothesis_evaluations (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.hypothesis_candidates(id) on delete cascade,

  total_score numeric(10,3) not null,
  geometry_score numeric(10,3) not null,
  change_penalty numeric(10,3) not null,
  plausibility_penalty numeric(10,3) not null,

  predicted_gross numeric(6,1) null,
  predicted_net numeric(6,1) null,
  delta_gross numeric(6,1) null,
  delta_net numeric(6,1) null,

  -- Optional uncertainty estimate (e.g. from Phase 47 recompute for best only)
  est_error_band_width numeric(6,2) null,

  flags jsonb null,
  computed_at timestamptz not null default now()
);

create index if not exists idx_hypothesis_evals_candidate on public.hypothesis_evaluations(candidate_id);
create index if not exists idx_hypothesis_evals_score on public.hypothesis_evaluations(total_score desc);

-- Error decomposition (root cause analysis)
create table if not exists public.error_decompositions (
  id uuid primary key default gen_random_uuid(),
  reverse_run_id uuid not null references public.reverse_runs(id) on delete cascade,

  causes jsonb not null, -- [{cause, weight, evidence}]
  primary_cause text null,

  confirmed_causes jsonb null,
  confirmed_by uuid null references public.profiles(id) on delete set null,
  confirmed_at timestamptz null,

  created_at timestamptz not null default now()
);

create index if not exists idx_error_decompositions_run on public.error_decompositions(reverse_run_id);

-- Reverse jobs link (Phase 46 durable jobs)
create table if not exists public.reverse_jobs (
  id uuid primary key default gen_random_uuid(),
  reverse_run_id uuid not null references public.reverse_runs(id) on delete cascade,
  job_id uuid not null references public.durable_jobs(id) on delete cascade,
  job_type text not null default 'reverse_precision_pass',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_reverse_jobs_unique on public.reverse_jobs(reverse_run_id, job_id);

-- Optional: link precision results back into predictions without mutating originals
alter table public.predictions
  add column if not exists is_precision_pass boolean not null default false;

alter table public.predictions
  add column if not exists precision_parent_prediction_id uuid null references public.predictions(id) on delete set null;

alter table public.predictions
  add column if not exists reverse_run_id uuid null references public.reverse_runs(id) on delete set null;

-- RLS (service-role write, user read own)
alter table public.reverse_runs enable row level security;
alter table public.hypothesis_candidates enable row level security;
alter table public.hypothesis_evaluations enable row level security;
alter table public.error_decompositions enable row level security;
alter table public.reverse_jobs enable row level security;

-- Read policy: authenticated users can read their own reverse runs via prediction->buck->user_id
drop policy if exists "reverse_runs_read_own" on public.reverse_runs;
create policy "reverse_runs_read_own"
on public.reverse_runs for select
to authenticated
using (
  exists (
    select 1 from public.predictions p
    join public.bucks b on b.id = p.buck_id
    where p.id = reverse_runs.prediction_id
      and b.user_id = auth.uid()
  )
);

-- Service write policy
drop policy if exists "reverse_runs_write_service" on public.reverse_runs;
create policy "reverse_runs_write_service"
on public.reverse_runs for all
to service_role
using (true)
with check (true);

drop policy if exists "hypothesis_candidates_read_via_run" on public.hypothesis_candidates;
create policy "hypothesis_candidates_read_via_run"
on public.hypothesis_candidates for select
to authenticated
using (
  exists (select 1 from public.reverse_runs rr where rr.id = hypothesis_candidates.reverse_run_id)
);

drop policy if exists "hypothesis_candidates_write_service" on public.hypothesis_candidates;
create policy "hypothesis_candidates_write_service"
on public.hypothesis_candidates for all
to service_role
using (true)
with check (true);

drop policy if exists "hypothesis_evals_read_via_candidate" on public.hypothesis_evaluations;
create policy "hypothesis_evals_read_via_candidate"
on public.hypothesis_evaluations for select
to authenticated
using (
  exists (
    select 1
    from public.hypothesis_candidates hc
    join public.reverse_runs rr on rr.id = hc.reverse_run_id
    where hc.id = hypothesis_evaluations.candidate_id
  )
);

drop policy if exists "hypothesis_evals_write_service" on public.hypothesis_evaluations;
create policy "hypothesis_evals_write_service"
on public.hypothesis_evaluations for all
to service_role
using (true)
with check (true);

drop policy if exists "error_decompositions_read_via_run" on public.error_decompositions;
create policy "error_decompositions_read_via_run"
on public.error_decompositions for select
to authenticated
using (
  exists (select 1 from public.reverse_runs rr where rr.id = error_decompositions.reverse_run_id)
);

drop policy if exists "error_decompositions_write_service" on public.error_decompositions;
create policy "error_decompositions_write_service"
on public.error_decompositions for all
to service_role
using (true)
with check (true);

drop policy if exists "reverse_jobs_read_via_run" on public.reverse_jobs;
create policy "reverse_jobs_read_via_run"
on public.reverse_jobs for select
to authenticated
using (
  exists (select 1 from public.reverse_runs rr where rr.id = reverse_jobs.reverse_run_id)
);

drop policy if exists "reverse_jobs_write_service" on public.reverse_jobs;
create policy "reverse_jobs_write_service"
on public.reverse_jobs for all
to service_role
using (true)
with check (true);

-- Grant basic access
grant select on public.reverse_runs to authenticated;
grant select on public.hypothesis_candidates to authenticated;
grant select on public.hypothesis_evaluations to authenticated;
grant select on public.error_decompositions to authenticated;
grant select on public.reverse_jobs to authenticated;

grant all on public.reverse_runs to service_role;
grant all on public.hypothesis_candidates to service_role;
grant all on public.hypothesis_evaluations to service_role;
grant all on public.error_decompositions to service_role;
grant all on public.reverse_jobs to service_role;
