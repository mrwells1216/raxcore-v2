/**
 * Phase 39: Structured Runtime Event Logging + Observability
 *
 * Design principles:
 * - Fire-and-forget: never throw, never block main request
 * - Fail-open: if monitoring fails, the app continues normally
 * - No secrets: error messages are sanitised before storage
 * - Modular: one log() call wraps the entire event contract
 */

import { createClient } from '@/lib/supabase/server'

// ============================================================
// TYPES
// ============================================================

export type EventService = 'score' | 'vision' | 'render' | 'benchmark' | 'auth' | 'billing' | 'admin'

export type EventType =
  // Scoring
  | 'score_started'
  | 'score_completed'
  | 'score_failed'
  // Vision
  | 'vision_started'
  | 'vision_completed'
  | 'vision_failed'
  | 'vision_fallback'
  | 'vision_retry'
  | 'vision_output_invalid'
  // Render
  | 'render_started'
  | 'render_completed'
  | 'render_failed'
  // Benchmark
  | 'benchmark_started'
  | 'benchmark_completed'
  | 'benchmark_failed'
  // Auth
  | 'auth_error'
  // Billing
  | 'billing_limit_hit'
  | 'billing_guest_limit_hit'
  // Admin / misc
  | 'admin_bulk_action'
  | 'cleanup_run'

export type EventStatus = 'success' | 'failure' | 'warning' | 'info'

export type ErrorType =
  | 'timeout'
  | 'rate_limit'
  | 'provider_error'
  | 'network'
  | 'validation'
  | 'malformed_response'
  | 'quota_exceeded'
  | 'model_unavailable'
  | 'content_policy'
  | 'plan_limit'
  | 'unknown'

export interface RuntimeEventInput {
  traceId?: string
  eventType: EventType
  service: EventService
  route?: string
  status: EventStatus
  errorType?: ErrorType
  errorMessage?: string
  durationMs?: number
  modelUsed?: string
  modelVersion?: string
  calibrationVer?: string
  fallbackUsed?: boolean
  retryCount?: number
  imagesCount?: number
  userId?: string | null
  buckId?: string | null
  renderJobId?: string | null
  metadata?: Record<string, unknown>
}

export interface RuntimeEvent {
  id: string
  trace_id: string | null
  event_type: EventType
  service: EventService
  route: string | null
  status: EventStatus
  error_type: ErrorType | null
  error_message: string | null
  duration_ms: number | null
  model_used: string | null
  model_version: string | null
  calibration_ver: string | null
  fallback_used: boolean
  retry_count: number
  images_count: number | null
  user_id: string | null
  buck_id: string | null
  render_job_id: string | null
  metadata: Record<string, unknown>
  created_at: string
}

// ============================================================
// SANITISATION — never store secrets or tokens
// ============================================================

const SECRET_PATTERNS = [
  /bearer\s+[a-z0-9_\-.]+/gi,
  /api[_-]?key[=:\s]+[a-z0-9_\-.]+/gi,
  /sk-[a-z0-9]+/gi,
  /authorization:\s*\S+/gi,
]

function sanitiseMessage(msg: string): string {
  let out = msg
  for (const p of SECRET_PATTERNS) out = out.replace(p, '[redacted]')
  // Truncate to 1000 chars so no huge payloads land in the DB
  return out.slice(0, 1000)
}

// ============================================================
// PRIMARY LOGGER
// ============================================================

/**
 * Log a structured runtime event.
 * Always fire-and-forget — never throws, never blocks the caller.
 */
export async function logEvent(input: RuntimeEventInput): Promise<void> {
  try {
    const supabase = await createClient()
    const row = {
      trace_id: input.traceId ?? null,
      event_type: input.eventType,
      service: input.service,
      route: input.route ?? null,
      status: input.status,
      error_type: input.errorType ?? null,
      error_message: input.errorMessage ? sanitiseMessage(input.errorMessage) : null,
      duration_ms: input.durationMs ?? null,
      model_used: input.modelUsed ?? null,
      model_version: input.modelVersion ?? null,
      calibration_ver: input.calibrationVer ?? null,
      fallback_used: input.fallbackUsed ?? false,
      retry_count: input.retryCount ?? 0,
      images_count: input.imagesCount ?? null,
      user_id: input.userId ?? null,
      buck_id: input.buckId ?? null,
      render_job_id: input.renderJobId ?? null,
      metadata: input.metadata ?? {},
    }
    await supabase.from('runtime_events').insert(row)
  } catch {
    // Monitoring must never break the app
  }
}

/**
 * Convenience: fire logEvent without awaiting (true fire-and-forget).
 * Use in hot paths where you don't want any async overhead.
 */
export function logEventFireForget(input: RuntimeEventInput): void {
  logEvent(input).catch(() => {})
}

// ============================================================
// TIMING HELPER
// ============================================================

/**
 * Returns a stop() function that resolves the duration and logs the completed event.
 * Usage:
 *   const stop = startTimer({ traceId, service: 'score', route: '/api/score', ... })
 *   const result = await doWork()
 *   stop({ status: 'success', buckId: result.id })
 * 
 * NOTE: This is NOT exported as a Server Action because it returns a closure.
 * Import it directly for use in API routes / server components.
 */
export function startTimer(
  base: Omit<RuntimeEventInput, 'status' | 'durationMs'>,
): (overrides: Partial<RuntimeEventInput> & { status: EventStatus }) => void {
  const t0 = Date.now()
  return (overrides: Partial<RuntimeEventInput> & { status: EventStatus }) => {
    logEventFireForget({
      ...base,
      ...overrides,
      durationMs: Date.now() - t0,
    })
  }
}

// ============================================================
// QUERY HELPERS — used by admin pages
// ============================================================

export interface EventSummary {
  total: number
  failures: number
  warnings: number
  fallbacks: number
  retried: number
  avgDurationMs: number | null
  p95DurationMs: number | null
  errorRate: number
  fallbackRate: number
}

export interface RecentFailure {
  id: string
  trace_id: string | null
  event_type: string
  service: string
  route: string | null
  error_type: string | null
  error_message: string | null
  duration_ms: number | null
  fallback_used: boolean
  retry_count: number
  user_id: string | null
  buck_id: string | null
  render_job_id: string | null
  metadata: Record<string, unknown>
  created_at: string
}

export interface MetricRollup {
  service: string
  status: string
  error_type: string | null
  event_count: number
  avg_duration_ms: number | null
  p95_duration_ms: number | null
  fallback_count: number
  retry_count_events: number
}

/**
 * Fetch recent failure/warning events for the monitoring dashboard.
 */
export async function getRecentFailures(
  limit = 50,
  service?: EventService,
): Promise<RecentFailure[]> {
  try {
    const supabase = await createClient()
    let q = supabase
      .from('runtime_events')
      .select('*')
      .in('status', ['failure', 'warning'])
      .order('created_at', { ascending: false })
      .limit(limit)
    if (service) q = q.eq('service', service)
    const { data } = await q
    return (data ?? []) as RecentFailure[]
  } catch {
    return []
  }
}

/**
 * Get summary metrics for a time window (default: last 24 hours).
 */
export async function getEventSummary(
  windowHours = 24,
  service?: EventService,
): Promise<EventSummary> {
  try {
    const supabase = await createClient()
    const since = new Date(Date.now() - windowHours * 3600 * 1000).toISOString()
    let q = supabase
      .from('runtime_events')
      .select('status, fallback_used, retry_count, duration_ms')
      .gte('created_at', since)
    if (service) q = q.eq('service', service)
    const { data } = await q
    if (!data?.length) return { total: 0, failures: 0, warnings: 0, fallbacks: 0, retried: 0, avgDurationMs: null, p95DurationMs: null, errorRate: 0, fallbackRate: 0 }

    const total = data.length
    const failures = data.filter(r => r.status === 'failure').length
    const warnings = data.filter(r => r.status === 'warning').length
    const fallbacks = data.filter(r => r.fallback_used).length
    const retried = data.filter(r => (r.retry_count ?? 0) > 0).length

    const durations = data
      .map(r => r.duration_ms as number | null)
      .filter((d): d is number => typeof d === 'number' && d > 0)
      .sort((a, b) => a - b)

    const avgDurationMs = durations.length ? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length) : null
    const p95DurationMs = durations.length
      ? durations[Math.floor(durations.length * 0.95)]
      : null

    return {
      total,
      failures,
      warnings,
      fallbacks,
      retried,
      avgDurationMs,
      p95DurationMs,
      errorRate: total > 0 ? Math.round((failures / total) * 100) : 0,
      fallbackRate: total > 0 ? Math.round((fallbacks / total) * 100) : 0,
    }
  } catch {
    return { total: 0, failures: 0, warnings: 0, fallbacks: 0, retried: 0, avgDurationMs: null, p95DurationMs: null, errorRate: 0, fallbackRate: 0 }
  }
}

/**
 * Get error counts grouped by error_type for the last N hours.
 */
export async function getErrorBreakdown(
  windowHours = 24,
): Promise<{ error_type: string; count: number }[]> {
  try {
    const supabase = await createClient()
    const since = new Date(Date.now() - windowHours * 3600 * 1000).toISOString()
    const { data } = await supabase
      .from('runtime_events')
      .select('error_type')
      .eq('status', 'failure')
      .gte('created_at', since)
      .not('error_type', 'is', null)
    if (!data?.length) return []
    const counts: Record<string, number> = {}
    for (const row of data) {
      const k = row.error_type as string
      counts[k] = (counts[k] ?? 0) + 1
    }
    return Object.entries(counts)
      .map(([error_type, count]) => ({ error_type, count }))
      .sort((a, b) => b.count - a.count)
  } catch {
    return []
  }
}

/**
 * Get per-service summary for the last N hours.
 */
export async function getServiceSummaries(
  windowHours = 24,
): Promise<Record<string, EventSummary>> {
  const services: EventService[] = ['score', 'vision', 'render', 'benchmark']
  const results = await Promise.all(services.map(s => getEventSummary(windowHours, s).then(r => [s, r] as const)))
  return Object.fromEntries(results)
}

/**
 * Get a single event by ID (for drill-down).
 */
export async function getEventById(id: string): Promise<RuntimeEvent | null> {
  try {
    const supabase = await createClient()
    const { data } = await supabase
      .from('runtime_events')
      .select('*')
      .eq('id', id)
      .maybeSingle()
    return data as RuntimeEvent | null
  } catch {
    return null
  }
}

/**
 * Get all events in a trace (by trace_id).
 */
export async function getTraceEvents(traceId: string): Promise<RuntimeEvent[]> {
  try {
    const supabase = await createClient()
    const { data } = await supabase
      .from('runtime_events')
      .select('*')
      .eq('trace_id', traceId)
      .order('created_at', { ascending: true })
    return (data ?? []) as RuntimeEvent[]
  } catch {
    return []
  }
}

/**
 * Get recent events for admin list (paginated).
 */
export async function listEvents({
  limit = 50,
  offset = 0,
  service,
  status,
  errorType,
  since,
}: {
  limit?: number
  offset?: number
  service?: EventService
  status?: EventStatus
  errorType?: ErrorType
  since?: string
} = {}): Promise<{ data: RuntimeEvent[]; count: number }> {
  try {
    const supabase = await createClient()
    const windowStart = since ?? new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()

    let q = supabase
      .from('runtime_events')
      .select('*', { count: 'exact' })
      .gte('created_at', windowStart)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (service) q = q.eq('service', service)
    if (status) q = q.eq('status', status)
    if (errorType) q = q.eq('error_type', errorType)

    const { data, count } = await q
    return { data: (data ?? []) as RuntimeEvent[], count: count ?? 0 }
  } catch {
    return { data: [], count: 0 }
  }
}

/**
 * Get latency trend over the last N hours, bucketed by hour.
 */
export async function getLatencyTrend(
  windowHours = 48,
  service: EventService = 'score',
): Promise<{ hour: string; avg_ms: number; p95_ms: number; count: number }[]> {
  try {
    const supabase = await createClient()
    const since = new Date(Date.now() - windowHours * 3600 * 1000).toISOString()
    const { data } = await supabase
      .from('runtime_events')
      .select('created_at, duration_ms')
      .eq('service', service)
      .eq('status', 'success')
      .gte('created_at', since)
      .not('duration_ms', 'is', null)
      .order('created_at', { ascending: true })

    if (!data?.length) return []

    // Bucket into hours client-side (simpler than RPC for now)
    const buckets: Record<string, number[]> = {}
    for (const row of data) {
      const hour = new Date(row.created_at).toISOString().slice(0, 13) + ':00:00Z'
      if (!buckets[hour]) buckets[hour] = []
      if (typeof row.duration_ms === 'number') buckets[hour].push(row.duration_ms)
    }
    return Object.entries(buckets).map(([hour, vals]) => {
      const sorted = [...vals].sort((a, b) => a - b)
      const avg_ms = Math.round(sorted.reduce((s, v) => s + v, 0) / sorted.length)
      const p95_ms = sorted[Math.floor(sorted.length * 0.95)] ?? sorted[sorted.length - 1] ?? 0
      return { hour, avg_ms, p95_ms, count: sorted.length }
    }).sort((a, b) => a.hour.localeCompare(b.hour))
  } catch {
    return []
  }
}

/**
 * Trigger admin task creation if a service has a high recent error rate.
 * Called from monitoring cron / admin page refresh — not the hot path.
 */
export async function maybeCreateMonitoringAlerts(
  windowHours = 1,
  thresholdErrorRate = 30,
  thresholdFallbackRate = 50,
): Promise<void> {
  try {
    const { createAdminTask } = await import('@/lib/notifications/service')
    const services: EventService[] = ['score', 'vision', 'render']
    for (const svc of services) {
      const summary = await getEventSummary(windowHours, svc)
      if (summary.total < 3) continue  // not enough signal

      if (summary.errorRate >= thresholdErrorRate) {
        await createAdminTask({
          type: 'calibration_reminder',
          priority: 'high',
          title: `High ${svc} error rate: ${summary.errorRate}%`,
          description: `${summary.failures} of ${summary.total} ${svc} events failed in the last ${windowHours}h. Immediate investigation recommended.`,
          metadata: { service: svc, windowHours, errorRate: summary.errorRate, failures: summary.failures, total: summary.total },
        }).catch(() => {})
      } else if (summary.fallbackRate >= thresholdFallbackRate && svc === 'vision') {
        await createAdminTask({
          type: 'calibration_reminder',
          priority: 'medium',
          title: `High vision fallback rate: ${summary.fallbackRate}%`,
          description: `${summary.fallbacks} of ${summary.total} vision calls used fallback scoring in the last ${windowHours}h.`,
          metadata: { service: svc, windowHours, fallbackRate: summary.fallbackRate, fallbacks: summary.fallbacks, total: summary.total },
        }).catch(() => {})
      }
    }
  } catch {
    // Non-critical
  }
}

/**
 * Run the 30-day cleanup.
 * Call from a cron endpoint or admin action.
 */
export async function runEventCleanup(): Promise<{ deleted: number }> {
  try {
    const supabase = await createClient()
    const { data } = await supabase.rpc('cleanup_old_runtime_events')
    return { deleted: (data as number) ?? 0 }
  } catch {
    return { deleted: 0 }
  }
}
