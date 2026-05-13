import { NextResponse } from 'next/server'
import { hasRequiredServerEnv, envPresenceMap } from '@/lib/env'

/**
 * Dev-only debug route to check environment variable presence.
 * Returns boolean presence map only — never actual secret values.
 * Returns 404 in production.
 */
export async function GET() {
  // Block in production
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const presence = envPresenceMap()
  const check = hasRequiredServerEnv()

  return NextResponse.json({
    env: presence,
    allPresent: check.ok,
    missing: check.ok ? [] : check.missing,
  })
}
