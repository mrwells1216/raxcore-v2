import 'server-only'
import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'

/**
 * Get a Supabase client with service role privileges.
 * This bypasses RLS and should only be used for server-side operations
 * that need to read/write data on behalf of the system.
 */
export async function getServiceSupabase(): Promise<SupabaseClient> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (url && serviceKey) {
    return createSupabaseClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }

  // Fallback (dev): uses anon + cookies (may be limited by RLS)
  console.warn('[admin.ts] SUPABASE_SERVICE_ROLE_KEY not set, falling back to server client')
  return await createServerClient()
}

/**
 * Helper to check if service role is available
 */
export function hasServiceRole(): boolean {
  return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
}
