'use server'

/**
 * Phase 38: Billing / Credits / Usage Plans
 *
 * This service is intentionally separate from lib/usage/service.ts (Phase 30).
 * Phase 30 handles IP-level rate limiting and cost tracking.
 * Phase 38 handles per-user plan enforcement and usage ledger.
 *
 * Entry point: checkAndEnforceLimit() — call this before starting a score run.
 * Exit point:  recordScoringRun()    — call this after a successful score run.
 */

import { createClient } from '@/lib/supabase/server'

// ============================================================
// TYPES
// ============================================================

export type PlanId = 'guest' | 'free' | 'starter' | 'pro' | 'admin'

export interface Plan {
  id: PlanId
  display_name: string
  description: string | null
  scores_per_month: number | null   // null = unlimited
  scores_per_day: number | null     // null = no daily cap
  max_images_per_score: number
  render_enabled: boolean
  history_enabled: boolean
  collection_enabled: boolean
  advanced_analytics: boolean
  is_guest_plan: boolean
  sort_order: number
  is_active: boolean
}

export interface UserPlan {
  id: string
  user_id: string
  plan_id: PlanId
  period_start: string
  period_end: string
  scores_override: number | null
  is_active: boolean
  granted_by: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface UserPlanStatus {
  user_id: string
  plan_id: PlanId
  plan_name: string
  scores_per_month: number | null
  scores_per_day: number | null
  max_images_per_score: number
  render_enabled: boolean
  history_enabled: boolean
  collection_enabled: boolean
  advanced_analytics: boolean
  effective_monthly_limit: number | null
  period_start: string
  period_end: string
  scores_override: number | null
  scores_used_this_period: number
  scores_used_today: number
  updated_at: string
}

export interface UsageLedgerEntry {
  id: string
  user_id: string | null
  session_id: string | null
  client_ip: string | null
  event_type: string
  buck_id: string | null
  images_count: number
  plan_id: PlanId | null
  period_start: string | null
  period_end: string | null
  status: 'success' | 'blocked' | 'error'
  block_reason: string | null
  created_at: string
}

export type LimitCheckResult =
  | { allowed: true; remaining: number | null; plan: UserPlanStatus }
  | { allowed: false; reason: 'monthly_limit' | 'daily_limit' | 'image_limit' | 'plan_disabled'; userMessage: string; plan: UserPlanStatus | null }

// ============================================================
// PLAN FETCHING
// ============================================================

export async function getAllPlans(): Promise<Plan[]> {
  try {
    const supabase = await createClient()
    const { data } = await supabase
      .from('plans')
      .select('*')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
    return (data ?? []) as Plan[]
  } catch {
    return []
  }
}

// ============================================================
// USER PLAN STATUS
// ============================================================

/**
 * Get the current plan status for a user (reads from view).
 * Falls back to a safe free-plan default if no row exists.
 */
export async function getUserPlanStatus(userId: string): Promise<UserPlanStatus | null> {
  try {
    const supabase = await createClient()
    const { data } = await supabase
      .from('user_plan_status')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()

    if (!data) {
      // No plan row yet — auto-provision free plan then return default
      await ensureUserHasPlan(userId)
      return buildDefaultStatus(userId)
    }
    return data as UserPlanStatus
  } catch {
    return buildDefaultStatus(userId)
  }
}

/** Ensure a user_plans row exists (idempotent). */
export async function ensureUserHasPlan(userId: string): Promise<void> {
  try {
    const supabase = await createClient()
    const now = new Date()
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString()

    await supabase.from('user_plans').upsert(
      { user_id: userId, plan_id: 'free', period_start: periodStart, period_end: periodEnd },
      { onConflict: 'user_id' }
    )
  } catch (err) {
    console.error('[billing] ensureUserHasPlan failed:', err)
  }
}

function buildDefaultStatus(userId: string): UserPlanStatus {
  const now = new Date()
  return {
    user_id: userId,
    plan_id: 'free',
    plan_name: 'Free',
    scores_per_month: 10,
    scores_per_day: 3,
    max_images_per_score: 4,
    render_enabled: false,
    history_enabled: true,
    collection_enabled: false,
    advanced_analytics: false,
    effective_monthly_limit: 10,
    period_start: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
    period_end: new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString(),
    scores_override: null,
    scores_used_this_period: 0,
    scores_used_today: 0,
    updated_at: now.toISOString(),
  }
}

// ============================================================
// GUEST USAGE (session-based, stored in cookie / header)
// ============================================================

const GUEST_MONTHLY_LIMIT = 3
const GUEST_DAILY_LIMIT = 1

export async function getGuestUsageCount(sessionId: string): Promise<number> {
  try {
    const supabase = await createClient()
    const { count } = await supabase
      .from('usage_ledger')
      .select('id', { count: 'exact', head: true })
      .is('user_id', null)
      .eq('session_id', sessionId)
      .eq('event_type', 'score')
      .eq('status', 'success')
    return count ?? 0
  } catch {
    return 0
  }
}

// ============================================================
// LIMIT ENFORCEMENT
// ============================================================

/**
 * Check whether a scoring run is allowed for an authenticated user.
 * Does NOT modify state — call recordScoringRun() on success.
 */
export async function checkUserLimit(
  userId: string,
  imageCount: number
): Promise<LimitCheckResult> {
  try {
    const status = await getUserPlanStatus(userId)
    if (!status) {
      return { allowed: true, remaining: null, plan: buildDefaultStatus(userId) }
    }

    // admin plan: unlimited
    if (status.plan_id === 'admin') {
      return { allowed: true, remaining: null, plan: status }
    }

    // Image count cap
    if (imageCount > status.max_images_per_score) {
      return {
        allowed: false,
        reason: 'image_limit',
        userMessage: `Your ${status.plan_name} plan allows up to ${status.max_images_per_score} images per score. You submitted ${imageCount}.`,
        plan: status,
      }
    }

    // Monthly limit
    if (status.effective_monthly_limit !== null) {
      if (status.scores_used_this_period >= status.effective_monthly_limit) {
        return {
          allowed: false,
          reason: 'monthly_limit',
          userMessage: `You've used all ${status.effective_monthly_limit} scores for this month on your ${status.plan_name} plan. Your limit resets on ${new Date(status.period_end).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}.`,
          plan: status,
        }
      }
    }

    // Daily limit
    if (status.scores_per_day !== null) {
      if (status.scores_used_today >= status.scores_per_day) {
        return {
          allowed: false,
          reason: 'daily_limit',
          userMessage: `You've reached your daily limit of ${status.scores_per_day} scores on the ${status.plan_name} plan. Try again tomorrow.`,
          plan: status,
        }
      }
    }

    const remaining =
      status.effective_monthly_limit !== null
        ? Math.max(0, status.effective_monthly_limit - status.scores_used_this_period)
        : null

    return { allowed: true, remaining, plan: status }
  } catch (err) {
    console.error('[billing] checkUserLimit failed (fail-open):', err)
    // Fail-open: do not block scoring on billing errors
    return { allowed: true, remaining: null, plan: buildDefaultStatus(userId) }
  }
}

/**
 * Check whether a guest session can score.
 */
export async function checkGuestLimit(
  sessionId: string,
  imageCount: number
): Promise<LimitCheckResult> {
  try {
    const count = await getGuestUsageCount(sessionId)
    if (count >= GUEST_MONTHLY_LIMIT) {
      return {
        allowed: false,
        reason: 'monthly_limit',
        userMessage: `Guest scoring is limited to ${GUEST_MONTHLY_LIMIT} runs. Sign in for more scores.`,
        plan: null,
      }
    }
    if (imageCount > 4) {
      return {
        allowed: false,
        reason: 'image_limit',
        userMessage: `Guest scoring allows up to 4 images per run. Sign in to submit more.`,
        plan: null,
      }
    }
    return { allowed: true, remaining: GUEST_MONTHLY_LIMIT - count - 1, plan: null as unknown as UserPlanStatus }
  } catch {
    return { allowed: true, remaining: null, plan: null as unknown as UserPlanStatus }
  }
}

// ============================================================
// LEDGER — RECORD RUNS
// ============================================================

export interface RecordScoringRunInput {
  userId?: string | null
  sessionId?: string | null
  clientIp?: string | null
  buckId?: string | null
  imagesCount: number
  planId?: PlanId | null
  periodStart?: string | null
  periodEnd?: string | null
  status: 'success' | 'blocked' | 'error'
  blockReason?: string | null
}

export async function recordScoringRun(input: RecordScoringRunInput): Promise<void> {
  try {
    const supabase = await createClient()
    await supabase.from('usage_ledger').insert({
      user_id: input.userId ?? null,
      session_id: input.sessionId ?? null,
      client_ip: input.clientIp ?? null,
      event_type: 'score',
      buck_id: input.buckId ?? null,
      images_count: input.imagesCount,
      plan_id: input.planId ?? null,
      period_start: input.periodStart ?? null,
      period_end: input.periodEnd ?? null,
      status: input.status,
      block_reason: input.blockReason ?? null,
    })
  } catch (err) {
    console.error('[billing] recordScoringRun failed (non-critical):', err)
  }
}

// ============================================================
// ADMIN — USER MANAGEMENT
// ============================================================

export interface AdminUserPlanRow {
  user_id: string
  email: string | null
  plan_id: PlanId
  plan_name: string
  effective_monthly_limit: number | null
  scores_used_this_period: number
  scores_used_today: number
  period_end: string
  scores_override: number | null
  updated_at: string
}

export async function listUserPlansForAdmin(options?: {
  limit?: number
  offset?: number
  planFilter?: PlanId | null
}): Promise<{ data: AdminUserPlanRow[]; count: number }> {
  try {
    const supabase = await createClient()
    const limit = options?.limit ?? 50
    const offset = options?.offset ?? 0

    // Join user_plan_status with profiles for email
    let query = supabase
      .from('user_plan_status')
      .select(`
        user_id,
        plan_id,
        plan_name,
        effective_monthly_limit,
        scores_used_this_period,
        scores_used_today,
        period_end,
        scores_override,
        updated_at,
        profiles!user_plan_status_user_id_fkey (email)
      `, { count: 'exact' })
      .order('scores_used_this_period', { ascending: false })
      .range(offset, offset + limit - 1)

    if (options?.planFilter) {
      query = query.eq('plan_id', options.planFilter)
    }

    const { data, count, error } = await query

    if (error) throw error

    const rows = (data ?? []).map((row: Record<string, unknown>) => ({
      user_id: row.user_id as string,
      email: (row.profiles as Record<string, unknown> | null)?.email as string | null ?? null,
      plan_id: row.plan_id as PlanId,
      plan_name: row.plan_name as string,
      effective_monthly_limit: row.effective_monthly_limit as number | null,
      scores_used_this_period: row.scores_used_this_period as number,
      scores_used_today: row.scores_used_today as number,
      period_end: row.period_end as string,
      scores_override: row.scores_override as number | null,
      updated_at: row.updated_at as string,
    }))

    return { data: rows, count: count ?? 0 }
  } catch (err) {
    console.error('[billing] listUserPlansForAdmin failed:', err)
    return { data: [], count: 0 }
  }
}

export async function setUserPlan(
  userId: string,
  planId: PlanId,
  options?: { scoresOverride?: number | null; notes?: string; grantedBy?: string }
): Promise<void> {
  const supabase = await createClient()
  const now = new Date()
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString()

  await supabase.from('user_plans').upsert(
    {
      user_id: userId,
      plan_id: planId,
      period_start: periodStart,
      period_end: periodEnd,
      scores_override: options?.scoresOverride ?? null,
      is_active: true,
      granted_by: options?.grantedBy ?? null,
      notes: options?.notes ?? null,
      updated_at: now.toISOString(),
    },
    { onConflict: 'user_id' }
  )
}

export async function grantExtraCredits(
  userId: string,
  additionalScores: number,
  grantedBy?: string
): Promise<void> {
  const supabase = await createClient()

  // Get current plan to compute new override
  const { data: current } = await supabase
    .from('user_plan_status')
    .select('effective_monthly_limit, scores_override')
    .eq('user_id', userId)
    .maybeSingle()

  const currentLimit = (current?.scores_override as number | null) ?? (current?.effective_monthly_limit as number | null) ?? 10
  const newOverride = currentLimit + additionalScores

  await setUserPlan(userId, (await getUserPlanStatus(userId))?.plan_id ?? 'free', {
    scoresOverride: newOverride,
    grantedBy,
    notes: `+${additionalScores} credits granted`,
  })
}

// ============================================================
// USAGE STATS (for admin overview and user plan page)
// ============================================================

export async function getMyUsageLedger(limit = 20): Promise<UsageLedgerEntry[]> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return []

    const { data } = await supabase
      .from('usage_ledger')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(limit)

    return (data ?? []) as UsageLedgerEntry[]
  } catch {
    return []
  }
}

export async function getAdminUsageOverview(): Promise<{
  totalScoringRuns: number
  totalBlocked: number
  todayRuns: number
  uniqueUsers: number
  planBreakdown: { plan_id: string; count: number }[]
}> {
  try {
    const supabase = await createClient()
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const [allTime, todayResult, planBreakdown] = await Promise.all([
      supabase
        .from('usage_ledger')
        .select('id, status, user_id', { count: 'exact' })
        .eq('event_type', 'score'),
      supabase
        .from('usage_ledger')
        .select('id', { count: 'exact' })
        .eq('event_type', 'score')
        .gte('created_at', today.toISOString()),
      supabase
        .from('usage_ledger')
        .select('plan_id')
        .eq('event_type', 'score')
        .eq('status', 'success')
        .not('plan_id', 'is', null),
    ])

    const rows = allTime.data ?? []
    const blocked = rows.filter((r: Record<string, unknown>) => r.status === 'blocked').length
    const uniqueUsers = new Set(rows.map((r: Record<string, unknown>) => r.user_id).filter(Boolean)).size

    const planCounts: Record<string, number> = {}
    for (const row of planBreakdown.data ?? []) {
      const pid = (row as Record<string, unknown>).plan_id as string
      if (pid) planCounts[pid] = (planCounts[pid] ?? 0) + 1
    }

    return {
      totalScoringRuns: allTime.count ?? 0,
      totalBlocked: blocked,
      todayRuns: todayResult.count ?? 0,
      uniqueUsers,
      planBreakdown: Object.entries(planCounts).map(([plan_id, count]) => ({ plan_id, count })),
    }
  } catch {
    return { totalScoringRuns: 0, totalBlocked: 0, todayRuns: 0, uniqueUsers: 0, planBreakdown: [] }
  }
}
