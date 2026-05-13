/**
 * Phase 30: Usage Tracking + Rate Limiting Service
 * 
 * Tracks API usage, enforces rate limits, and provides cost estimates.
 */

import { createClient } from '@/lib/supabase/server'
import { getServiceSupabase } from '@/lib/supabase/admin'
import type {
  UsageRecord,
  UsageRecordInput,
  UsageRecordUpdate,
  RateLimitConfig,
  RateLimitState,
  RateLimitCheckResult,
  CostEstimate,
  CostCalculation,
  ProductionConfig,
  DailyUsageSummary,
  HourlyUsageSummary,
  MonthlyUsageSummary,
  UsageReportSummary,
} from '@/lib/types'
import { DEFAULT_PRODUCTION_CONFIG } from '@/lib/types'

// ============================================================================
// CACHING
// ============================================================================

let cachedRateLimitConfig: RateLimitConfig | null = null
let rateLimitConfigCacheTime = 0
const RATE_LIMIT_CONFIG_CACHE_TTL = 60000 // 1 minute

let cachedProductionConfig: ProductionConfig | null = null
let productionConfigCacheTime = 0
const PRODUCTION_CONFIG_CACHE_TTL = 60000 // 1 minute

let cachedCostEstimate: CostEstimate | null = null
let costEstimateCacheTime = 0
const COST_ESTIMATE_CACHE_TTL = 300000 // 5 minutes

export function invalidateUsageConfigCache() {
  cachedRateLimitConfig = null
  cachedProductionConfig = null
  cachedCostEstimate = null
}

// ============================================================================
// RATE LIMIT CONFIGURATION
// ============================================================================

export async function getActiveRateLimitConfig(): Promise<RateLimitConfig> {
  const now = Date.now()
  if (cachedRateLimitConfig && now - rateLimitConfigCacheTime < RATE_LIMIT_CONFIG_CACHE_TTL) {
    return cachedRateLimitConfig
  }

  const supabase = await createClient()

  const { data, error } = await supabase
    .from('rate_limit_config')
    .select('*')
    .eq('is_active', true)
    .single()

  if (error || !data) {
    // Return safe defaults
    return {
      id: 'default',
      config_name: 'default',
      is_active: true,
      requests_per_minute: 10,
      images_per_minute: 40,
      requests_per_hour: 100,
      images_per_hour: 400,
      requests_per_day: 500,
      images_per_day: 2000,
      monthly_request_soft_limit: 10000,
      monthly_image_soft_limit: 40000,
      monthly_cost_soft_limit_cents: 10000,
      max_images_per_request: 6,
      max_retries_per_request: 2,
      request_timeout_ms: 60000,
      burst_window_seconds: 10,
      max_burst_requests: 5,
      duplicate_check_window_seconds: 30,
      created_by: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  }

  cachedRateLimitConfig = data
  rateLimitConfigCacheTime = now
  return data
}

export async function updateRateLimitConfig(
  configId: string,
  updates: Partial<RateLimitConfig>
): Promise<RateLimitConfig | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('rate_limit_config')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', configId)
    .select()
    .single()

  if (error) {
    console.error('Error updating rate limit config:', error)
    return null
  }

  invalidateUsageConfigCache()
  return data
}

// ============================================================================
// PRODUCTION CONFIGURATION
// ============================================================================

export async function getActiveProductionConfig(): Promise<ProductionConfig> {
  const now = Date.now()
  if (cachedProductionConfig && now - productionConfigCacheTime < PRODUCTION_CONFIG_CACHE_TTL) {
    return cachedProductionConfig
  }

  const supabase = await createClient()

  const { data, error } = await supabase
    .from('production_config')
    .select('*')
    .eq('is_active', true)
    .single()

  if (error || !data) {
    // Return safe defaults
    return {
      ...DEFAULT_PRODUCTION_CONFIG,
      id: 'default',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as ProductionConfig
  }

  cachedProductionConfig = data
  productionConfigCacheTime = now
  return data
}

export async function updateProductionConfig(
  configId: string,
  updates: Partial<ProductionConfig>
): Promise<ProductionConfig | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('production_config')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', configId)
    .select()
    .single()

  if (error) {
    console.error('Error updating production config:', error)
    return null
  }

  invalidateUsageConfigCache()
  return data
}

// ============================================================================
// COST ESTIMATION
// ============================================================================

export async function getActiveCostEstimate(
  provider: string = 'google',
  model: string = 'gemini-2.0-flash-001'
): Promise<CostEstimate | null> {
  const now = Date.now()
  if (cachedCostEstimate && now - costEstimateCacheTime < COST_ESTIMATE_CACHE_TTL) {
    return cachedCostEstimate
  }

  const supabase = await createClient()

  const { data, error } = await supabase
    .from('cost_estimates')
    .select('*')
    .eq('provider', provider)
    .eq('model', model)
    .eq('is_active', true)
    .single()

  if (error || !data) {
    // Return default Gemini cost estimate
    return {
      id: 'default',
      provider: 'google',
      model: 'gemini-2.0-flash-001',
      cost_per_image_mc: 13, // ~$0.00013 per image
      cost_per_request_mc: 5,
      cost_per_1k_tokens_input_mc: 0,
      cost_per_1k_tokens_output_mc: 0,
      effective_from: new Date().toISOString(),
      effective_to: null,
      is_active: true,
      notes: 'Default Gemini 2.0 Flash estimate',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  }

  cachedCostEstimate = data
  costEstimateCacheTime = now
  return data
}

export function calculateCost(
  images: number,
  visionCalls: number,
  costEstimate: CostEstimate
): CostCalculation {
  const totalImageCost = images * costEstimate.cost_per_image_mc
  const totalRequestCost = visionCalls * costEstimate.cost_per_request_mc
  const totalCostMc = totalImageCost + totalRequestCost

  return {
    images,
    vision_calls: visionCalls,
    cost_per_image_mc: costEstimate.cost_per_image_mc,
    cost_per_request_mc: costEstimate.cost_per_request_mc,
    total_image_cost_mc: totalImageCost,
    total_request_cost_mc: totalRequestCost,
    total_cost_mc: totalCostMc,
    total_cost_cents: Math.round(totalCostMc / 100),
    total_cost_dollars: Math.round(totalCostMc) / 100000,
  }
}

// ============================================================================
// USAGE RECORD TRACKING
// ============================================================================

export async function createUsageRecord(input: UsageRecordInput): Promise<UsageRecord | null> {
  // Use service role client for internal bookkeeping (bypasses RLS)
  const supabase = await getServiceSupabase()

  const { data, error } = await supabase
    .from('usage_records')
    .insert({
      request_id: input.request_id,
      session_id: input.session_id || null,
      buck_id: input.buck_id || null,
      endpoint: input.endpoint,
      method: input.method || 'POST',
      client_ip: input.client_ip || null,
      client_fingerprint: input.client_fingerprint || null,
      user_agent: input.user_agent || null,
      images_submitted: input.images_submitted || 0,
      status: 'pending',
      request_start_at: new Date().toISOString(),
    })
    .select()
    .single()

  if (error) {
    console.error('Error creating usage record:', error)
    return null
  }

  return data
}

/**
 * Returns true when the Supabase/PostgREST error is a PostgreSQL 42703
 * "undefined_column" — typically caused by a database trigger or generated
 * column referencing `updated_at` when the table schema has drifted.
 * This is non-fatal for usage bookkeeping.
 */
function isUpdatedAtSchemaMismatch(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as Record<string, unknown>
  return String(e.code ?? '') === '42703'
}

export async function updateUsageRecord(
  requestId: string,
  updates: UsageRecordUpdate
  ): Promise<UsageRecord | null> {
  // Use service role client for internal bookkeeping
  const supabase = await getServiceSupabase()
  
  const { data, error } = await supabase
  .from('usage_records')
  .update(updates)
  .eq('request_id', requestId)
  .select()
  .maybeSingle() // Use maybeSingle to handle zero rows gracefully

  if (error) {
    if (isUpdatedAtSchemaMismatch(error)) {
      console.warn('[usage] schema mismatch, skipping updated_at-dependent bookkeeping')
      return null
    }
    console.error('Error updating usage record:', error)
    return null
  }

  return data
}

export async function completeUsageRecord(
  requestId: string,
  success: boolean,
  details: {
    predictionId?: string
    imagesProcessed?: number
    visionCalls?: number
    retryCount?: number
    usedFallback?: boolean
    processingTimeMs?: number
    visionTimeMs?: number
    errorType?: string
    errorMessage?: string
    modelVersionId?: string
    visionModel?: string
  }
): Promise<UsageRecord | null> {
  // Get cost estimate
  const costEstimate = await getActiveCostEstimate()
  const cost = costEstimate
    ? calculateCost(details.imagesProcessed || 0, details.visionCalls || 1, costEstimate)
    : { total_cost_mc: 0 }

  return updateUsageRecord(requestId, {
    prediction_id: details.predictionId,
    images_processed: details.imagesProcessed,
    vision_calls: details.visionCalls,
    retry_count: details.retryCount,
    used_fallback: details.usedFallback,
    request_end_at: new Date().toISOString(),
    processing_time_ms: details.processingTimeMs,
    vision_time_ms: details.visionTimeMs,
    status: success ? 'success' : 'error',
    error_type: details.errorType,
    error_message: details.errorMessage,
    estimated_cost_mc: cost.total_cost_mc,
    model_version_id: details.modelVersionId,
    vision_model: details.visionModel,
  })
}

// ============================================================================
// RATE LIMITING
// ============================================================================

function getWindowBounds(windowType: 'minute' | 'hour' | 'day' | 'month' | 'burst', burstSeconds = 10): {
  start: Date
  end: Date
} {
  const now = new Date()
  let start: Date
  let end: Date

  switch (windowType) {
    case 'minute':
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes(), 0, 0)
      end = new Date(start.getTime() + 60000)
      break
    case 'hour':
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), 0, 0, 0)
      end = new Date(start.getTime() + 3600000)
      break
    case 'day':
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
      end = new Date(start.getTime() + 86400000)
      break
    case 'month':
      start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0)
      end = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0)
      break
    case 'burst':
      start = new Date(now.getTime() - burstSeconds * 1000)
      end = now
      break
  }

  return { start, end }
}

async function getOrCreateRateLimitState(
  clientKey: string,
  windowType: 'minute' | 'hour' | 'day' | 'month' | 'burst',
  burstSeconds = 10
): Promise<RateLimitState> {
  // Use service role client to bypass RLS for internal rate limit operations
  const supabase = await getServiceSupabase()
  const { start, end } = getWindowBounds(windowType, burstSeconds)

  // Try to get existing state
  const { data: existing } = await supabase
    .from('rate_limit_state')
    .select('*')
    .eq('client_key', clientKey)
    .eq('window_type', windowType)
    .eq('window_start', start.toISOString())
    .single()

  if (existing) return existing

  // Create new state
  const { data: created, error } = await supabase
    .from('rate_limit_state')
    .insert({
      client_key: clientKey,
      window_type: windowType,
      window_start: start.toISOString(),
      window_end: end.toISOString(),
      request_count: 0,
      image_count: 0,
      estimated_cost_mc: 0,
    })
    .select()
    .single()

  if (error) {
    // Race condition - try to get again
    const { data: retry } = await supabase
      .from('rate_limit_state')
      .select('*')
      .eq('client_key', clientKey)
      .eq('window_type', windowType)
      .eq('window_start', start.toISOString())
      .single()

    if (retry) return retry

    throw new Error(`Failed to create rate limit state: ${error.message}`)
  }

  return created
}

async function incrementRateLimitState(
  clientKey: string,
  windowType: 'minute' | 'hour' | 'day' | 'month' | 'burst',
  requestCount: number,
  imageCount: number,
  costMc: number,
  burstSeconds = 10
): Promise<RateLimitState> {
  // Use service role client to bypass RLS for internal rate limit operations
  const supabase = await getServiceSupabase()
  const { start } = getWindowBounds(windowType, burstSeconds)

  // Upsert with increment
  const { data, error } = await supabase.rpc('increment_rate_limit_state', {
    p_client_key: clientKey,
    p_window_type: windowType,
    p_window_start: start.toISOString(),
    p_request_count: requestCount,
    p_image_count: imageCount,
    p_cost_mc: costMc,
  })

  if (error) {
    // Fallback: get state and update manually
    const state = await getOrCreateRateLimitState(clientKey, windowType, burstSeconds)
    
    const { data: updated, error: updateError } = await supabase
      .from('rate_limit_state')
      .update({
        request_count: state.request_count + requestCount,
        image_count: state.image_count + imageCount,
        estimated_cost_mc: state.estimated_cost_mc + costMc,
        last_request_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', state.id)
      .select()
      .single()

    if (updateError) {
      if (isUpdatedAtSchemaMismatch(updateError)) {
        console.warn('[usage] schema mismatch, skipping updated_at-dependent bookkeeping')
        return state
      }
      throw updateError
    }

    return updated || state
  }

  return data
}

export async function checkRateLimit(
  clientKey: string,
  imageCount: number
): Promise<RateLimitCheckResult> {
  const config = await getActiveRateLimitConfig()
  const warnings: string[] = []

  // Check burst limit
  const burstState = await getOrCreateRateLimitState(clientKey, 'burst', config.burst_window_seconds)
  if (burstState.request_count >= config.max_burst_requests) {
    return {
      allowed: false,
      reason: 'Burst limit exceeded. Please wait a few seconds.',
      limit_type: 'burst',
      current_count: burstState.request_count,
      max_count: config.max_burst_requests,
      retry_after_seconds: config.burst_window_seconds,
      warnings: [],
    }
  }

  // Check minute limit
  const minuteState = await getOrCreateRateLimitState(clientKey, 'minute')
  if (minuteState.request_count >= config.requests_per_minute) {
    return {
      allowed: false,
      reason: 'Rate limit exceeded. Please wait a minute.',
      limit_type: 'minute_requests',
      current_count: minuteState.request_count,
      max_count: config.requests_per_minute,
      retry_after_seconds: 60,
      warnings: [],
    }
  }
  if (minuteState.image_count + imageCount > config.images_per_minute) {
    return {
      allowed: false,
      reason: 'Image limit exceeded. Please wait a minute.',
      limit_type: 'minute_images',
      current_count: minuteState.image_count,
      max_count: config.images_per_minute,
      retry_after_seconds: 60,
      warnings: [],
    }
  }

  // Check hour limit
  const hourState = await getOrCreateRateLimitState(clientKey, 'hour')
  if (hourState.request_count >= config.requests_per_hour) {
    return {
      allowed: false,
      reason: 'Hourly request limit exceeded.',
      limit_type: 'hour_requests',
      current_count: hourState.request_count,
      max_count: config.requests_per_hour,
      retry_after_seconds: 3600,
      warnings: [],
    }
  }
  if (hourState.image_count + imageCount > config.images_per_hour) {
    return {
      allowed: false,
      reason: 'Hourly image limit exceeded.',
      limit_type: 'hour_images',
      current_count: hourState.image_count,
      max_count: config.images_per_hour,
      retry_after_seconds: 3600,
      warnings: [],
    }
  }

  // Check day limit
  const dayState = await getOrCreateRateLimitState(clientKey, 'day')
  if (dayState.request_count >= config.requests_per_day) {
    return {
      allowed: false,
      reason: 'Daily request limit exceeded.',
      limit_type: 'day_requests',
      current_count: dayState.request_count,
      max_count: config.requests_per_day,
      retry_after_seconds: 86400,
      warnings: [],
    }
  }
  if (dayState.image_count + imageCount > config.images_per_day) {
    return {
      allowed: false,
      reason: 'Daily image limit exceeded.',
      limit_type: 'day_images',
      current_count: dayState.image_count,
      max_count: config.images_per_day,
      retry_after_seconds: 86400,
      warnings: [],
    }
  }

  // Check monthly soft limits (warnings only)
  const monthState = await getOrCreateRateLimitState(clientKey, 'month')
  if (config.monthly_request_soft_limit && monthState.request_count >= config.monthly_request_soft_limit * 0.9) {
    warnings.push(`Approaching monthly request limit (${monthState.request_count}/${config.monthly_request_soft_limit})`)
  }
  if (config.monthly_image_soft_limit && monthState.image_count >= config.monthly_image_soft_limit * 0.9) {
    warnings.push(`Approaching monthly image limit (${monthState.image_count}/${config.monthly_image_soft_limit})`)
  }

  return {
    allowed: true,
    reason: null,
    limit_type: null,
    current_count: null,
    max_count: null,
    retry_after_seconds: null,
    warnings,
  }
}

export async function recordUsage(
  clientKey: string,
  requestCount: number,
  imageCount: number,
  costMc: number
): Promise<void> {
  const config = await getActiveRateLimitConfig()

  // Update all relevant windows
  await Promise.all([
    incrementRateLimitState(clientKey, 'burst', requestCount, imageCount, costMc, config.burst_window_seconds),
    incrementRateLimitState(clientKey, 'minute', requestCount, imageCount, costMc),
    incrementRateLimitState(clientKey, 'hour', requestCount, imageCount, costMc),
    incrementRateLimitState(clientKey, 'day', requestCount, imageCount, costMc),
    incrementRateLimitState(clientKey, 'month', requestCount, imageCount, costMc),
  ])
}

// ============================================================================
// REQUEST-LEVEL VALIDATION
// ============================================================================

export interface RequestValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

export async function validateScoringRequest(
  imageCount: number,
  clientKey?: string
): Promise<RequestValidationResult> {
  const config = await getActiveProductionConfig()
  const rateLimitConfig = await getActiveRateLimitConfig()
  const errors: string[] = []
  const warnings: string[] = []

  // Check image count limits
  if (imageCount < config.min_images_per_request) {
    errors.push(`At least ${config.min_images_per_request} image is required.`)
  }
  if (imageCount > config.max_images_per_request) {
    errors.push(`Maximum ${config.max_images_per_request} images allowed per request.`)
  }

  // Check rate limits if client key provided
  if (clientKey) {
    const rateLimitResult = await checkRateLimit(clientKey, imageCount)
    if (!rateLimitResult.allowed) {
      errors.push(rateLimitResult.reason || 'Rate limit exceeded.')
    }
    warnings.push(...rateLimitResult.warnings)
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

// ============================================================================
// USAGE REPORTING
// ============================================================================

export async function getDailyUsageSummary(days: number = 30): Promise<DailyUsageSummary[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('daily_usage_summary')
    .select('*')
    .order('date', { ascending: false })
    .limit(days)

  if (error) {
    console.error('Error fetching daily usage:', error)
    return []
  }

  return data || []
}

export async function getHourlyUsageSummary(hours: number = 24): Promise<HourlyUsageSummary[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('hourly_usage_summary')
    .select('*')
    .order('hour', { ascending: false })
    .limit(hours)

  if (error) {
    console.error('Error fetching hourly usage:', error)
    return []
  }

  return data || []
}

export async function getMonthlyUsageSummary(months: number = 12): Promise<MonthlyUsageSummary[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('monthly_cost_summary')
    .select('*')
    .order('month', { ascending: false })
    .limit(months)

  if (error) {
    console.error('Error fetching monthly usage:', error)
    return []
  }

  return data || []
}

export async function getUsageReportSummary(
  period: 'day' | 'week' | 'month' = 'week'
): Promise<UsageReportSummary> {
  const supabase = await createClient()
  
  const intervalMap = {
    day: '1 day',
    week: '7 days',
    month: '30 days',
  }
  const interval = intervalMap[period]

  const now = new Date()
  const startDate = new Date(now.getTime() - (period === 'day' ? 86400000 : period === 'week' ? 604800000 : 2592000000))

  // Get aggregated stats
  const { data: stats } = await supabase
    .from('usage_records')
    .select('*')
    .gte('created_at', startDate.toISOString())

  const records = stats || []

  const totals = {
    requests: records.length,
    images_submitted: records.reduce((sum, r) => sum + (r.images_submitted || 0), 0),
    images_processed: records.reduce((sum, r) => sum + (r.images_processed || 0), 0),
    vision_calls: records.reduce((sum, r) => sum + (r.vision_calls || 0), 0),
    retries: records.reduce((sum, r) => sum + (r.retry_count || 0), 0),
    fallbacks: records.filter(r => r.used_fallback).length,
    errors: records.filter(r => r.status === 'error').length,
    cost_mc: records.reduce((sum, r) => sum + (r.estimated_cost_mc || 0), 0),
    cost_dollars: 0,
  }
  totals.cost_dollars = Math.round(totals.cost_mc) / 100000

  const successCount = records.filter(r => r.status === 'success').length
  const timeoutCount = records.filter(r => r.error_type === 'timeout').length
  const processingTimes = records.filter(r => r.processing_time_ms != null).map(r => r.processing_time_ms)
  const visionTimes = records.filter(r => r.vision_time_ms != null).map(r => r.vision_time_ms)

  const rates = {
    success_rate: totals.requests > 0 ? (successCount / totals.requests) * 100 : 0,
    fallback_rate: totals.requests > 0 ? (totals.fallbacks / totals.requests) * 100 : 0,
    timeout_rate: totals.requests > 0 ? (timeoutCount / totals.requests) * 100 : 0,
    retry_rate: totals.requests > 0 ? (totals.retries / totals.requests) * 100 : 0,
    avg_images_per_request: totals.requests > 0 ? totals.images_submitted / totals.requests : 0,
  }

  const timing = {
    avg_processing_ms: processingTimes.length > 0 
      ? processingTimes.reduce((a, b) => a + b, 0) / processingTimes.length 
      : null,
    p95_processing_ms: processingTimes.length > 0
      ? processingTimes.sort((a, b) => a - b)[Math.floor(processingTimes.length * 0.95)]
      : null,
    avg_vision_ms: visionTimes.length > 0
      ? visionTimes.reduce((a, b) => a + b, 0) / visionTimes.length
      : null,
  }

  // Error type breakdown
  const errorTypes = records
    .filter(r => r.error_type)
    .reduce((acc, r) => {
      acc[r.error_type!] = (acc[r.error_type!] || 0) + 1
      return acc
    }, {} as Record<string, number>)

  const topErrorTypes = (Object.entries(errorTypes) as Array<[string, number]>)
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)

  const uniqueClients = new Set(records.map(r => r.client_ip).filter(Boolean)).size

  return {
    period,
    start_date: startDate.toISOString(),
    end_date: now.toISOString(),
    totals,
    rates,
    timing,
    unique_clients: uniqueClients,
    top_error_types: topErrorTypes,
  }
}
