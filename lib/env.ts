/**
 * Centralized environment variable validation.
 * Never falls back to empty strings. Fails fast with clear diagnostics.
 */

const REQUIRED_SERVER_VARS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'OPENAI_API_KEY',
] as const

type RequiredServerEnv = {
  NEXT_PUBLIC_SUPABASE_URL: string
  NEXT_PUBLIC_SUPABASE_ANON_KEY: string
  SUPABASE_SERVICE_ROLE_KEY: string
  OPENAI_API_KEY: string
}

/**
 * Check if all required server environment variables are present.
 * Returns { ok: true } or { ok: false, missing: [...] }
 */
export function hasRequiredServerEnv(): { ok: true } | { ok: false; missing: string[] } {
  const missing = REQUIRED_SERVER_VARS.filter(key => !process.env[key])
  if (missing.length > 0) {
    return { ok: false, missing }
  }
  return { ok: true }
}

/**
 * Get all required server environment variables.
 * Throws if any are missing — call hasRequiredServerEnv() first for graceful handling.
 */
export function requiredServerEnv(): RequiredServerEnv {
  const check = hasRequiredServerEnv()
  if (!check.ok) {
    throw new Error(
      `Missing required environment variables: ${check.missing.join(', ')}. ` +
      `Set these in Vercel/v0 project settings. Do not rely on .env file rewrites.`
    )
  }
  return {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY!,
  }
}

/**
 * Get boolean presence map for logging. Never logs actual values.
 */
export function envPresenceMap(): Record<string, boolean> {
  return {
    supabaseUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    supabaseServiceRoleKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    openaiApiKey: !!process.env.OPENAI_API_KEY,
  }
}

// Boot-time diagnostic log (server-side only, booleans only)
if (typeof window === 'undefined') {
  console.log('[env] loaded', envPresenceMap())
}
