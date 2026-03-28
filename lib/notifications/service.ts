'use server'

import { createClient } from '@/lib/supabase/server'

// ============================================================
// TYPES
// ============================================================

export interface UserNotificationPrefs {
  user_id: string
  notify_render_updates: boolean
  notify_real_score_reminders: boolean
  notify_photo_quality: boolean
  notify_map_reminders: boolean
  noise_level: 'all' | 'important'
  quiet_period_hours: number
  updated_at: string
}

export interface AdminNotificationPrefs {
  user_id: string
  show_high_priority_only: boolean
  show_benchmark_warnings: boolean
  show_data_gap_reminders: boolean
  show_duplicate_reminders: boolean
  show_calibration_reminders: boolean
  show_model_promotion: boolean
  updated_at: string
}

export interface DigestItem {
  label: string
  link_href?: string
  buck_id?: string
}

export interface UserDigest {
  id: string
  user_id: string
  digest_type: 'unfinished_actions' | 'render_summary' | 'weekly'
  title: string
  items: DigestItem[]
  is_read: boolean
  created_at: string
}

export interface AdminDigest {
  id: string
  digest_type: 'pending_review' | 'benchmark_summary' | 'weekly'
  title: string
  items: DigestItem[]
  is_read: boolean
  created_at: string
}

export type NotificationType =
  | 'submit_real_score'
  | 'render_complete'
  | 'render_failed'
  | 'better_photos_needed'
  | 'missing_map'
  | 'missing_render'

export type NotificationPriority = 'low' | 'normal' | 'high'

export interface UserNotification {
  id: string
  user_id: string
  type: NotificationType
  title: string
  body: string | null
  link_href: string | null
  buck_id: string | null
  is_read: boolean
  is_dismissed: boolean
  priority: NotificationPriority
  created_at: string
}

export type AdminTaskType =
  | 'review_example'
  | 'data_gap'
  | 'suspect_duplicate'
  | 'failed_validation'
  | 'calibration_needed'
  | 'model_promotion'

export type AdminTaskPriority = 'low' | 'normal' | 'high' | 'critical'
export type AdminTaskStatus = 'open' | 'resolved' | 'dismissed'

export interface AdminTask {
  id: string
  type: AdminTaskType
  title: string
  body: string | null
  priority: AdminTaskPriority
  status: AdminTaskStatus
  link_href: string | null
  related_id: string | null
  related_type: string | null
  resolved_by: string | null
  resolved_at: string | null
  created_at: string
  updated_at: string
}

// ============================================================
// USER NOTIFICATIONS
// ============================================================

/**
 * Create a user notification. Safe to call from server actions / API routes.
 * Silently swallows errors so it never breaks the calling flow.
 */
export async function createUserNotification({
  userId,
  type,
  title,
  body,
  linkHref,
  buckId,
  priority = 'normal',
}: {
  userId: string
  type: NotificationType
  title: string
  body?: string
  linkHref?: string
  buckId?: string
  priority?: NotificationPriority
}): Promise<void> {
  try {
    const supabase = await createClient()
    await supabase.from('user_notifications').insert({
      user_id: userId,
      type,
      title,
      body: body ?? null,
      link_href: linkHref ?? null,
      buck_id: buckId ?? null,
      priority,
    })
  } catch (err) {
    console.error('[notifications] createUserNotification failed:', err)
  }
}

/**
 * List unread + undismissed notifications for the current user.
 */
export async function listMyNotifications(): Promise<UserNotification[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data, error } = await supabase
    .from('user_notifications')
    .select('*')
    .eq('user_id', user.id)
    .eq('is_dismissed', false)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) {
    console.error('[notifications] listMyNotifications error:', error)
    return []
  }
  return (data ?? []) as UserNotification[]
}

/**
 * Count unread notifications for the current user.
 */
export async function countUnreadNotifications(): Promise<number> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return 0

  const { count, error } = await supabase
    .from('user_notifications')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('is_read', false)
    .eq('is_dismissed', false)

  if (error) return 0
  return count ?? 0
}

/**
 * Mark one notification as read.
 */
export async function markNotificationRead(id: string): Promise<void> {
  const supabase = await createClient()
  await supabase
    .from('user_notifications')
    .update({ is_read: true })
    .eq('id', id)
}

/**
 * Mark all notifications as read for the current user.
 */
export async function markAllNotificationsRead(): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  await supabase
    .from('user_notifications')
    .update({ is_read: true })
    .eq('user_id', user.id)
    .eq('is_read', false)
}

/**
 * Dismiss a notification (hide it from the list).
 */
export async function dismissNotification(id: string): Promise<void> {
  const supabase = await createClient()
  await supabase
    .from('user_notifications')
    .update({ is_dismissed: true })
    .eq('id', id)
}

// ============================================================
// ADMIN TASKS
// ============================================================

/**
 * Create an admin task. Deduplicates by related_id + type to avoid flooding.
 */
export async function createAdminTask({
  type,
  title,
  body,
  priority = 'normal',
  linkHref,
  relatedId,
  relatedType,
}: {
  type: AdminTaskType
  title: string
  body?: string
  priority?: AdminTaskPriority
  linkHref?: string
  relatedId?: string
  relatedType?: string
}): Promise<void> {
  try {
    const supabase = await createClient()

    // Deduplicate: if an open task of the same type+relatedId exists, skip
    if (relatedId) {
      const { data: existing } = await supabase
        .from('admin_tasks')
        .select('id')
        .eq('type', type)
        .eq('related_id', relatedId)
        .eq('status', 'open')
        .maybeSingle()

      if (existing) return
    }

    await supabase.from('admin_tasks').insert({
      type,
      title,
      body: body ?? null,
      priority,
      link_href: linkHref ?? null,
      related_id: relatedId ?? null,
      related_type: relatedType ?? null,
    })
  } catch (err) {
    console.error('[notifications] createAdminTask failed:', err)
  }
}

/**
 * List admin tasks with optional status/priority filter.
 * Returns data + total count for pagination.
 */
export async function listAdminTasks({
  status,
  priority,
  type,
  limit = 20,
  offset = 0,
}: {
  status?: AdminTaskStatus
  priority?: AdminTaskPriority
  type?: AdminTaskType
  limit?: number
  offset?: number
} = {}): Promise<AdminTask[]> {
  const supabase = await createClient()

  let query = supabase
    .from('admin_tasks')
    .select('*', { count: 'exact' })
    .order('priority', { ascending: false })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (status) query = query.eq('status', status)
  if (priority) query = query.eq('priority', priority)
  if (type) query = query.eq('type', type)

  const { data, error } = await query
  if (error) {
    console.error('[notifications] listAdminTasks error:', error)
    return []
  }
  return (data ?? []) as AdminTask[]
}

/**
 * Count open admin tasks.
 */
export async function countOpenAdminTasks(): Promise<number> {
  const supabase = await createClient()
  const { count, error } = await supabase
    .from('admin_tasks')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'open')

  if (error) return 0
  return count ?? 0
}

/**
 * Resolve or dismiss an admin task.
 */
export async function updateAdminTaskStatus(
  id: string,
  status: 'resolved' | 'dismissed',
  resolvedById?: string,
): Promise<void> {
  const supabase = await createClient()
  await supabase
    .from('admin_tasks')
    .update({
      status,
      resolved_by: resolvedById ?? null,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', id)
}

/**
 * Bulk resolve all open admin tasks (used by "Clear All" action).
 */
export async function resolveAllAdminTasks(): Promise<void> {
  const supabase = await createClient()
  await supabase
    .from('admin_tasks')
    .update({ status: 'resolved', resolved_at: new Date().toISOString() })
    .eq('status', 'open')
}

// ============================================================
// USER NOTIFICATION PREFERENCES
// ============================================================

const DEFAULT_PREFS: Omit<UserNotificationPrefs, 'user_id' | 'updated_at'> = {
  notify_render_updates: true,
  notify_real_score_reminders: true,
  notify_photo_quality: true,
  notify_map_reminders: false,
  noise_level: 'all',
  quiet_period_hours: 24,
}

export async function getMyNotificationPrefs(): Promise<UserNotificationPrefs | null> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    const { data } = await supabase
      .from('user_notification_prefs')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle()

    if (!data) {
      // Return defaults if no row yet
      return { user_id: user.id, updated_at: new Date().toISOString(), ...DEFAULT_PREFS }
    }
    return data as UserNotificationPrefs
  } catch {
    return null
  }
}

export async function saveMyNotificationPrefs(
  prefs: Partial<Omit<UserNotificationPrefs, 'user_id' | 'updated_at'>>,
): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  await supabase
    .from('user_notification_prefs')
    .upsert({ user_id: user.id, ...prefs }, { onConflict: 'user_id' })
}

// ============================================================
// ADMIN NOTIFICATION PREFERENCES
// ============================================================

const DEFAULT_ADMIN_PREFS: Omit<AdminNotificationPrefs, 'user_id' | 'updated_at'> = {
  show_high_priority_only: false,
  show_benchmark_warnings: true,
  show_data_gap_reminders: true,
  show_duplicate_reminders: true,
  show_calibration_reminders: true,
  show_model_promotion: true,
}

export async function getMyAdminNotificationPrefs(): Promise<AdminNotificationPrefs | null> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    const { data } = await supabase
      .from('admin_notification_prefs')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle()

    if (!data) {
      return { user_id: user.id, updated_at: new Date().toISOString(), ...DEFAULT_ADMIN_PREFS }
    }
    return data as AdminNotificationPrefs
  } catch {
    return null
  }
}

export async function saveMyAdminNotificationPrefs(
  prefs: Partial<Omit<AdminNotificationPrefs, 'user_id' | 'updated_at'>>,
): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  await supabase
    .from('admin_notification_prefs')
    .upsert({ user_id: user.id, ...prefs }, { onConflict: 'user_id' })
}

// ============================================================
// QUIET PERIOD
// ============================================================

/**
 * Check if a notification of this type+buck is within the user's quiet period.
 * Returns true if notification should be SUPPRESSED.
 */
export async function isInQuietPeriod(
  userId: string,
  type: NotificationType,
  buckId?: string,
): Promise<boolean> {
  try {
    const supabase = await createClient()

    // Get quiet period setting
    const { data: prefs } = await supabase
      .from('user_notification_prefs')
      .select('quiet_period_hours')
      .eq('user_id', userId)
      .maybeSingle()

    const quietHours = (prefs?.quiet_period_hours as number) ?? 24
    const cutoff = new Date(Date.now() - quietHours * 60 * 60 * 1000).toISOString()

    let query = supabase
      .from('notification_quiet_log')
      .select('sent_at')
      .eq('user_id', userId)
      .eq('type', type)
      .gte('sent_at', cutoff)

    if (buckId) {
      query = query.eq('buck_id', buckId)
    } else {
      query = query.is('buck_id', null)
    }

    const { data } = await query.maybeSingle()
    return !!data
  } catch {
    return false
  }
}

/**
 * Record a notification send in the quiet log (upsert to avoid duplicates).
 */
export async function recordQuietLog(
  userId: string,
  type: NotificationType,
  buckId?: string,
): Promise<void> {
  try {
    const supabase = await createClient()
    await supabase
      .from('notification_quiet_log')
      .upsert(
        { user_id: userId, type, buck_id: buckId ?? null, sent_at: new Date().toISOString() },
        { onConflict: 'user_id,type,buck_id' },
      )
  } catch {
    // Non-critical
  }
}

/**
 * createUserNotification with quiet-period + preference gating.
 * Replaces direct createUserNotification calls at trigger sites.
 */
export async function createGatedUserNotification({
  userId,
  type,
  title,
  body,
  linkHref,
  buckId,
  priority = 'normal',
}: {
  userId: string
  type: NotificationType
  title: string
  body?: string
  linkHref?: string
  buckId?: string
  priority?: NotificationPriority
}): Promise<void> {
  try {
    const supabase = await createClient()

    // Check user preferences
    const { data: prefs } = await supabase
      .from('user_notification_prefs')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()

    if (prefs) {
      // Respect category preferences
      if (type === 'render_complete' || type === 'render_failed') {
        if (!prefs.notify_render_updates) return
      }
      if (type === 'submit_real_score') {
        if (!prefs.notify_real_score_reminders) return
      }
      if (type === 'better_photos_needed') {
        if (!prefs.notify_photo_quality) return
      }
      if (type === 'missing_map') {
        if (!prefs.notify_map_reminders) return
      }
      // Noise level: 'important' suppresses low/normal
      if (prefs.noise_level === 'important' && priority === 'normal') return
    }

    // Quiet period check
    const suppressed = await isInQuietPeriod(userId, type, buckId)
    if (suppressed) return

    // Create the notification
    await supabase.from('user_notifications').insert({
      user_id: userId,
      type,
      title,
      body: body ?? null,
      link_href: linkHref ?? null,
      buck_id: buckId ?? null,
      priority,
    })

    // Record in quiet log
    await recordQuietLog(userId, type, buckId)
  } catch (err) {
    console.error('[notifications] createGatedUserNotification failed:', err)
  }
}

// ============================================================
// DIGESTS
// ============================================================

export async function listMyDigests(): Promise<UserDigest[]> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return []

    const { data } = await supabase
      .from('user_digests')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20)

    return (data ?? []) as UserDigest[]
  } catch {
    return []
  }
}

export async function markDigestRead(id: string): Promise<void> {
  const supabase = await createClient()
  await supabase.from('user_digests').update({ is_read: true }).eq('id', id)
}

export async function listAdminDigests(): Promise<AdminDigest[]> {
  try {
    const supabase = await createClient()
    const { data } = await supabase
      .from('admin_digests')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20)

    return (data ?? []) as AdminDigest[]
  } catch {
    return []
  }
}

export async function markAdminDigestRead(id: string): Promise<void> {
  const supabase = await createClient()
  await supabase.from('admin_digests').update({ is_read: true }).eq('id', id)
}

/**
 * Dismiss all notifications for the current user (bulk clear).
 */
export async function dismissAllNotifications(): Promise<void> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    await supabase
      .from('user_notifications')
      .update({ is_dismissed: true })
      .eq('user_id', user.id)
      .eq('is_dismissed', false)
  } catch (err) {
    console.error('[notifications] dismissAllNotifications failed:', err)
  }
}
