-- =============================================================================
-- durable_jobs_schema_patch.sql
-- Phase 46 — Durable Job System Schema
-- Safe to run multiple times: uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.
-- Adds: durable_jobs, job_stage_history, scheduled_job_definitions tables,
--       required enums, indexes, RPC helper functions, and RLS policies.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- ENUMS
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE public.job_status AS ENUM (
    'queued', 'running', 'completed', 'failed', 'cancelled', 'dead_letter'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.job_priority AS ENUM (
    'critical', 'high', 'normal', 'low', 'background'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.stage_status AS ENUM (
    'started', 'completed', 'failed', 'skipped'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- TABLE: durable_jobs
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.durable_jobs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type              TEXT NOT NULL,
  idempotency_key       TEXT UNIQUE,
  status                TEXT NOT NULL DEFAULT 'queued',
  stage                 TEXT,
  progress_percent      INTEGER NOT NULL DEFAULT 0,
  priority              TEXT NOT NULL DEFAULT 'normal',
  scheduled_for         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload               JSONB NOT NULL DEFAULT '{}',
  result_summary        JSONB,
  error_summary         JSONB,
  retry_count           INTEGER NOT NULL DEFAULT 0,
  max_retries           INTEGER NOT NULL DEFAULT 3,
  next_retry_at         TIMESTAMPTZ,
  trace_id              TEXT,
  correlation_id        TEXT,
  requested_by_user_id  TEXT,
  buck_id               UUID,
  render_job_id         UUID,
  benchmark_pack_id     UUID,
  export_pack_id        UUID,
  worker_id             TEXT,
  locked_until          TIMESTAMPTZ,
  started_at            TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  failed_at             TIMESTAMPTZ,
  cancelled_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add any columns that may be missing from an older version of this table
ALTER TABLE public.durable_jobs ADD COLUMN IF NOT EXISTS idempotency_key       TEXT UNIQUE;
ALTER TABLE public.durable_jobs ADD COLUMN IF NOT EXISTS stage                 TEXT;
ALTER TABLE public.durable_jobs ADD COLUMN IF NOT EXISTS progress_percent      INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.durable_jobs ADD COLUMN IF NOT EXISTS priority              TEXT NOT NULL DEFAULT 'normal';
ALTER TABLE public.durable_jobs ADD COLUMN IF NOT EXISTS result_summary        JSONB;
ALTER TABLE public.durable_jobs ADD COLUMN IF NOT EXISTS error_summary         JSONB;
ALTER TABLE public.durable_jobs ADD COLUMN IF NOT EXISTS retry_count           INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.durable_jobs ADD COLUMN IF NOT EXISTS max_retries           INTEGER NOT NULL DEFAULT 3;
ALTER TABLE public.durable_jobs ADD COLUMN IF NOT EXISTS next_retry_at         TIMESTAMPTZ;
ALTER TABLE public.durable_jobs ADD COLUMN IF NOT EXISTS trace_id              TEXT;
ALTER TABLE public.durable_jobs ADD COLUMN IF NOT EXISTS correlation_id        TEXT;
ALTER TABLE public.durable_jobs ADD COLUMN IF NOT EXISTS requested_by_user_id  TEXT;
ALTER TABLE public.durable_jobs ADD COLUMN IF NOT EXISTS buck_id               UUID;
ALTER TABLE public.durable_jobs ADD COLUMN IF NOT EXISTS render_job_id         UUID;
ALTER TABLE public.durable_jobs ADD COLUMN IF NOT EXISTS benchmark_pack_id     UUID;
ALTER TABLE public.durable_jobs ADD COLUMN IF NOT EXISTS export_pack_id        UUID;
ALTER TABLE public.durable_jobs ADD COLUMN IF NOT EXISTS worker_id             TEXT;
ALTER TABLE public.durable_jobs ADD COLUMN IF NOT EXISTS locked_until          TIMESTAMPTZ;
ALTER TABLE public.durable_jobs ADD COLUMN IF NOT EXISTS started_at            TIMESTAMPTZ;
ALTER TABLE public.durable_jobs ADD COLUMN IF NOT EXISTS completed_at          TIMESTAMPTZ;
ALTER TABLE public.durable_jobs ADD COLUMN IF NOT EXISTS failed_at             TIMESTAMPTZ;
ALTER TABLE public.durable_jobs ADD COLUMN IF NOT EXISTS cancelled_at          TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- INDEXES: durable_jobs
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_durable_jobs_status        ON public.durable_jobs (status);
CREATE INDEX IF NOT EXISTS idx_durable_jobs_job_type      ON public.durable_jobs (job_type);
CREATE INDEX IF NOT EXISTS idx_durable_jobs_scheduled_for ON public.durable_jobs (scheduled_for);
CREATE INDEX IF NOT EXISTS idx_durable_jobs_buck_id       ON public.durable_jobs (buck_id);
CREATE INDEX IF NOT EXISTS idx_durable_jobs_trace_id      ON public.durable_jobs (trace_id);
CREATE INDEX IF NOT EXISTS idx_durable_jobs_user_id       ON public.durable_jobs (requested_by_user_id);
CREATE INDEX IF NOT EXISTS idx_durable_jobs_locked_until  ON public.durable_jobs (locked_until)
  WHERE status = 'running';
CREATE INDEX IF NOT EXISTS idx_durable_jobs_queued_claim  ON public.durable_jobs (priority, scheduled_for)
  WHERE status = 'queued';

-- ---------------------------------------------------------------------------
-- TABLE: job_stage_history
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.job_stage_history (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        UUID NOT NULL REFERENCES public.durable_jobs(id) ON DELETE CASCADE,
  stage         TEXT NOT NULL,
  status        TEXT NOT NULL,
  duration_ms   INTEGER,
  error_message TEXT,
  metadata      JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.job_stage_history ADD COLUMN IF NOT EXISTS duration_ms   INTEGER;
ALTER TABLE public.job_stage_history ADD COLUMN IF NOT EXISTS error_message TEXT;
ALTER TABLE public.job_stage_history ADD COLUMN IF NOT EXISTS metadata      JSONB NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_job_stage_history_job_id ON public.job_stage_history (job_id);

-- ---------------------------------------------------------------------------
-- TABLE: scheduled_job_definitions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.scheduled_job_definitions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL UNIQUE,
  job_type         TEXT NOT NULL,
  cron_expression  TEXT,
  interval_minutes INTEGER,
  payload          JSONB NOT NULL DEFAULT '{}',
  priority         TEXT NOT NULL DEFAULT 'normal',
  max_retries      INTEGER NOT NULL DEFAULT 3,
  is_enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  last_run_at      TIMESTAMPTZ,
  next_run_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.scheduled_job_definitions ADD COLUMN IF NOT EXISTS cron_expression  TEXT;
ALTER TABLE public.scheduled_job_definitions ADD COLUMN IF NOT EXISTS interval_minutes INTEGER;
ALTER TABLE public.scheduled_job_definitions ADD COLUMN IF NOT EXISTS last_run_at      TIMESTAMPTZ;
ALTER TABLE public.scheduled_job_definitions ADD COLUMN IF NOT EXISTS next_run_at      TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.durable_jobs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_stage_history      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduled_job_definitions ENABLE ROW LEVEL SECURITY;

-- Service-role bypass (anon/authenticated cannot touch jobs directly)
DROP POLICY IF EXISTS "service_role_all_durable_jobs"             ON public.durable_jobs;
DROP POLICY IF EXISTS "service_role_all_job_stage_history"        ON public.job_stage_history;
DROP POLICY IF EXISTS "service_role_all_scheduled_job_definitions" ON public.scheduled_job_definitions;

CREATE POLICY "service_role_all_durable_jobs"
  ON public.durable_jobs FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "service_role_all_job_stage_history"
  ON public.job_stage_history FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "service_role_all_scheduled_job_definitions"
  ON public.scheduled_job_definitions FOR ALL USING (auth.role() = 'service_role');

-- ---------------------------------------------------------------------------
-- RPC FUNCTION: claim_next_job
-- Called by claimNextJob() in lib/jobs/service.ts
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.claim_next_job(
  p_worker_id            TEXT,
  p_job_types            TEXT[] DEFAULT NULL,
  p_lock_duration_seconds INTEGER DEFAULT 300
)
RETURNS TABLE (
  job_id    UUID,
  job_type  TEXT,
  payload   JSONB,
  retry_count INTEGER,
  trace_id  TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_job_id UUID;
BEGIN
  -- Select and lock the highest-priority queued job
  SELECT id INTO v_job_id
  FROM public.durable_jobs
  WHERE status = 'queued'
    AND scheduled_for <= NOW()
    AND (p_job_types IS NULL OR job_type = ANY(p_job_types))
  ORDER BY
    CASE priority
      WHEN 'critical'   THEN 1
      WHEN 'high'       THEN 2
      WHEN 'normal'     THEN 3
      WHEN 'low'        THEN 4
      WHEN 'background' THEN 5
      ELSE 6
    END,
    scheduled_for ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_job_id IS NULL THEN
    RETURN;
  END IF;

  -- Mark as running
  UPDATE public.durable_jobs
  SET
    status       = 'running',
    worker_id    = p_worker_id,
    locked_until = NOW() + (p_lock_duration_seconds || ' seconds')::INTERVAL,
    started_at   = COALESCE(started_at, NOW()),
    retry_count  = retry_count + 1
  WHERE id = v_job_id;

  RETURN QUERY
    SELECT
      dj.id,
      dj.job_type,
      dj.payload,
      dj.retry_count,
      dj.trace_id
    FROM public.durable_jobs dj
    WHERE dj.id = v_job_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- RPC FUNCTION: complete_job
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.complete_job(
  p_job_id        UUID,
  p_result_summary TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.durable_jobs
  SET
    status         = 'completed',
    result_summary = CASE WHEN p_result_summary IS NOT NULL
                          THEN p_result_summary::JSONB
                          ELSE result_summary END,
    completed_at   = NOW(),
    locked_until   = NULL,
    worker_id      = NULL
  WHERE id = p_job_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- RPC FUNCTION: fail_job
-- Returns TRUE if job will retry, FALSE if moved to dead_letter
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fail_job(
  p_job_id              UUID,
  p_error_summary       TEXT DEFAULT NULL,
  p_retry_delay_seconds INTEGER DEFAULT 60
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_retry_count INTEGER;
  v_max_retries INTEGER;
  v_will_retry  BOOLEAN;
BEGIN
  SELECT retry_count, max_retries
  INTO   v_retry_count, v_max_retries
  FROM   public.durable_jobs
  WHERE  id = p_job_id;

  -- retry_count was already incremented by claim_next_job, so compare directly
  v_will_retry := v_retry_count < v_max_retries;

  IF v_will_retry THEN
    UPDATE public.durable_jobs
    SET
      status        = 'queued',
      error_summary = CASE WHEN p_error_summary IS NOT NULL
                           THEN p_error_summary::JSONB
                           ELSE error_summary END,
      next_retry_at = NOW() + (p_retry_delay_seconds || ' seconds')::INTERVAL,
      scheduled_for = NOW() + (p_retry_delay_seconds || ' seconds')::INTERVAL,
      locked_until  = NULL,
      worker_id     = NULL
    WHERE id = p_job_id;
  ELSE
    UPDATE public.durable_jobs
    SET
      status        = 'dead_letter',
      error_summary = CASE WHEN p_error_summary IS NOT NULL
                           THEN p_error_summary::JSONB
                           ELSE error_summary END,
      failed_at     = NOW(),
      locked_until  = NULL,
      worker_id     = NULL
    WHERE id = p_job_id;
  END IF;

  RETURN v_will_retry;
END;
$$;

-- ---------------------------------------------------------------------------
-- RPC FUNCTION: recover_stale_jobs
-- Called by recoverStaleJobs() in lib/jobs/service.ts
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.recover_stale_jobs(
  p_stale_threshold_minutes INTEGER DEFAULT 10
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE public.durable_jobs
  SET
    status       = 'queued',
    worker_id    = NULL,
    locked_until = NULL,
    scheduled_for = NOW()
  WHERE status       = 'running'
    AND locked_until < NOW() - (p_stale_threshold_minutes || ' minutes')::INTERVAL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- RPC FUNCTION: cleanup_old_jobs
-- Called by cleanupOldJobs() in lib/jobs/service.ts
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cleanup_old_jobs(
  p_retention_days INTEGER DEFAULT 30
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  DELETE FROM public.durable_jobs
  WHERE status IN ('completed', 'cancelled')
    AND created_at < NOW() - (p_retention_days || ' days')::INTERVAL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
