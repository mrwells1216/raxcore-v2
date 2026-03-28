'use server'

/**
 * Phase 38: Billing-specific notification helpers.
 *
 * These helpers fire low-noise, deduplicated notifications when users
 * approach or hit their scoring limit. They write directly to user_notifications
 * rather than going through createGatedUserNotification (which has a fixed
 * NotificationType enum), using a billing-specific type column value.
 * The bell and notification list already display all user_notifications rows.
 */

import { createClient } from '@/lib/supabase/server'
import type { UserPlanStatus } from './service'

// How many hours to wait before re-notifying the same user about the same billing event.
const BILLING_QUIET_HOURS = 48

type BillingNotifType = 'plan_limit_reached' | 'plan_low_credits' | 'plan_changed' | 'credits_granted'

async function hasBillingNotifRecently(userId: string, type: BillingNotifType): Promise<boolean> {
  try {
    const supabase = await createClient()
    const since = new Date(Date.now() - BILLING_QUIET_HOURS * 3600_000).toISOString()
    const { count } = await supabase
      .from('user_notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('type', type)
      .gte('created_at', since)
    return (count ?? 0) > 0
  } catch {
    return false
  }
}

async function insertBillingNotif(
  userId: string,
  type: BillingNotifType,
  title: string,
  body: string,
  priority: 'low' | 'normal' | 'high' = 'normal'
): Promise<void> {
  try {
    const supabase = await createClient()
    await supabase.from('user_notifications').insert({
      user_id: userId,
      type,
      title,
      body,
      link_href: '/settings/plan',
      buck_id: null,
      priority,
    })
  } catch (err) {
    console.error('[billing:notifications] insertBillingNotif failed:', err)
  }
}

/**
 * Fire a "low credits" notification when a user has 2 or fewer scores left.
 * Silently deduplicates over a 48-hour window.
 */
export async function maybeNotifyLowCredits(
  userId: string,
  status: UserPlanStatus
): Promise<void> {
  if (status.plan_id === 'admin') return
  if (status.effective_monthly_limit === null) return // unlimited — no warning needed

  const remaining = Math.max(0, status.effective_monthly_limit - status.scores_used_this_period)
  if (remaining > 2) return

  const type: BillingNotifType = remaining === 0 ? 'plan_limit_reached' : 'plan_low_credits'
  const already = await hasBillingNotifRecently(userId, type)
  if (already) return

  if (remaining === 0) {
    await insertBillingNotif(
      userId,
      type,
      'Scoring limit reached',
      `You've used all ${status.effective_monthly_limit} scores on your ${status.plan_name} plan. Resets on ${new Date(status.period_end).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}.`,
      'high'
    )
  } else {
    await insertBillingNotif(
      userId,
      type,
      `${remaining} score${remaining !== 1 ? 's' : ''} remaining`,
      `You have ${remaining} score${remaining !== 1 ? 's' : ''} left on your ${status.plan_name} plan this period.`,
      'normal'
    )
  }
}

/**
 * Notify a user that their plan was changed by an admin.
 */
export async function notifyPlanChanged(
  userId: string,
  newPlanName: string
): Promise<void> {
  const already = await hasBillingNotifRecently(userId, 'plan_changed')
  if (already) return
  await insertBillingNotif(
    userId,
    'plan_changed',
    'Your plan has been updated',
    `Your account has been moved to the ${newPlanName} plan.`,
    'normal'
  )
}

/**
 * Notify a user that extra credits were granted.
 */
export async function notifyCreditsGranted(
  userId: string,
  additionalScores: number
): Promise<void> {
  await insertBillingNotif(
    userId,
    'credits_granted',
    `${additionalScores} extra score${additionalScores !== 1 ? 's' : ''} added`,
    `An admin has granted you ${additionalScores} additional score${additionalScores !== 1 ? 's' : ''} for this period.`,
    'normal'
  )
}
