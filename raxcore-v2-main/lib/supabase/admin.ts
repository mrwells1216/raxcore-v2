import 'server-only'
import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'
import { requiredServerEnv, hasRequiredServerEnv } from '@/lib/env'

/**
 * Get a Supabase client with service role privileges.
 * This bypasses RLS and should only be used for server-side operations
 * that need to read/write data on behalf of the system.
 * Throws if required env vars are missing — no fallback.
 */
export async function getServiceSupabase(): Promise<SupabaseClient> {
  const env = requiredServerEnv()
  return createSupabaseClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/**
 * Helper to check if service role is available
 */
export function hasServiceRole(): boolean {
  const check = hasRequiredServerEnv()
  return check.ok
}

// ── Schema compatibility helpers ─────────────────────────────────────────────

/**
 * Detect whether a Supabase/PostgREST error represents a missing table (or
 * column) rather than a data or permission error.
 *
 * Supabase surfaces missing-table errors as:
 *  - code "42P01" (PostgreSQL: undefined_table)
 *  - message containing "schema cache" (schema not yet loaded)
 *  - message containing "does not exist"
 *  - message containing "relation" + "not exist" (PostgREST verbose)
 *
 * Pass any error object from a `.from().select()` / `.insert()` call.
 */
export function isOptionalTableError(error: unknown): boolean {
  if (!error) return false
  const msg = (
    (error as { message?: string }).message ??
    (error as { error?: string }).error ??
    String(error)
  ).toLowerCase()
  const code = (error as { code?: string }).code ?? ''
  return (
    code === '42P01' ||
    msg.includes('schema cache') ||
    msg.includes('does not exist') ||
    (msg.includes('relation') && msg.includes('not exist'))
  )
}

/**
 * Runtime-safe table probe: returns true if the named table can be queried.
 * Caches results per process lifetime to avoid repeated round-trips.
 *
 * Use this in optional feature paths (telemetry, config, map data) where the
 * table may not be present in all environments. Do NOT use it to guard required
 * tables — let those throw normally so errors are surfaced immediately.
 */
const _tableCache = new Map<string, boolean>()

export async function canTableBeQueried(tableName: string): Promise<boolean> {
  if (_tableCache.has(tableName)) return _tableCache.get(tableName)!
  try {
    const supabase = await getServiceSupabase()
    const { error } = await supabase.from(tableName).select('id').limit(1)
    const ok = !isOptionalTableError(error)
    _tableCache.set(tableName, ok)
    return ok
  } catch {
    _tableCache.set(tableName, false)
    return false
  }
}
