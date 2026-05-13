import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { requiredServerEnv } from '@/lib/env'

/**
 * Server-side Supabase client for use in Server Components, Route Handlers, and Server Actions.
 * Always create a new client within each function - don't store in global variable.
 */
export async function createClient() {
  const env = requiredServerEnv()
  const cookieStore = await cookies()

  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {
            // The "setAll" method was called from a Server Component.
            // This can be ignored if you have middleware refreshing user sessions.
          }
        },
      },
    },
  )
}
