import { createClient } from '@/lib/supabase/server'
import { getUserPlanStatus } from '@/lib/billing/service'
import { UsageBadge } from './usage-badge'

/**
 * Server component — fetches plan status and renders UsageBadge.
 * Returns null for guests or on any error.
 */
export async function UsageBadgeLoader() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    const status = await getUserPlanStatus(user.id)
    return <UsageBadge status={status} />
  } catch {
    return null
  }
}
