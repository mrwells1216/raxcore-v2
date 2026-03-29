import { createBrowserClient } from '@supabase/ssr'

let client: ReturnType<typeof createBrowserClient> | null = null

export function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    // Return a mock client that does nothing when env vars aren't available
    // This prevents crashes during initial load before env vars propagate
    return {
      auth: {
        getUser: async () => ({ data: { user: null }, error: null }),
        getSession: async () => ({ data: { session: null }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
        signInWithPassword: async () => ({ data: { user: null, session: null }, error: new Error('Supabase not configured') }),
        signUp: async () => ({ data: { user: null, session: null }, error: new Error('Supabase not configured') }),
        signOut: async () => ({ error: null }),
      },
      from: () => ({
        select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }) }) }),
        insert: async () => ({ data: null, error: new Error('Supabase not configured') }),
        update: async () => ({ data: null, error: new Error('Supabase not configured') }),
        delete: async () => ({ data: null, error: new Error('Supabase not configured') }),
      }),
    } as unknown as ReturnType<typeof createBrowserClient>
  }

  // Use singleton pattern to reuse the same client
  if (!client) {
    client = createBrowserClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        // Disable lock to prevent issues with React Strict Mode double-mounting
        lock: { acquireLockOnlyOnce: true },
        // Reduce lock timeout to recover faster in development
        lockAcquireTimeout: 2000,
      },
    })
  }
  
  return client
}
