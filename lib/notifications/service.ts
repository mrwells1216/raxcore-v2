'use server'

import { createClient } from '@/lib/supabase/server'

// ============================================================
// TYPES
// ============================================================

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
 */
export async function listAdminTasks({
  status,
  priority,
  type,
  limit = 50,
}: {
  status?: AdminTaskStatus
  priority?: AdminTaskPriority
  type?: AdminTaskType
  limit?: number
} = {}): Promise<AdminTask[]> {
  const supabase = await createClient()

  let query = supabase
    .from('admin_tasks')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)

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
