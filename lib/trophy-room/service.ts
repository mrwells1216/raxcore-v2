import 'server-only'
import { getServiceSupabase } from '@/lib/supabase/admin'
import type { TrophyRoomEntry, TrophyScoringSystem } from './types'

export interface CreateTrophyEntryInput {
  userId: string
  buckId: string
  predictionId: string | null
  displayPhotoUrl: string
  displayLabel: string | null
  displayGross: number
  displayNet: number | null
  scoringSystem: TrophyScoringSystem
  confidenceTier: string
  isVerifiedScore: boolean
}

export async function createTrophyEntry(input: CreateTrophyEntryInput): Promise<TrophyRoomEntry> {
  const db = await getServiceSupabase()
  const { data, error } = await db
    .from('trophy_room_entries')
    .insert({
      user_id: input.userId,
      buck_id: input.buckId,
      prediction_id: input.predictionId,
      display_photo_url: input.displayPhotoUrl,
      display_label: input.displayLabel,
      display_gross: input.displayGross,
      display_net: input.displayNet,
      scoring_system: input.scoringSystem,
      confidence_tier: input.confidenceTier,
      is_verified_score: input.isVerifiedScore,
      watermark_status: 'pending',
    })
    .select('*')
    .single()
  if (error || !data) throw new Error(`Failed to create trophy entry: ${error?.message}`)
  return data as TrophyRoomEntry
}

export async function listTrophyEntries(
  userId: string,
  { limit = 20, cursor }: { limit?: number; cursor?: string },
): Promise<{ entries: TrophyRoomEntry[]; nextCursor: string | null }> {
  const db = await getServiceSupabase()
  let query = db
    .from('trophy_room_entries')
    .select('*')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit + 1)
  if (cursor) query = query.lt('created_at', cursor)

  const { data, error } = await query
  if (error) throw new Error(`Failed to list trophy entries: ${error.message}`)

  const rows = (data ?? []) as TrophyRoomEntry[]
  const hasMore = rows.length > limit
  const entries = hasMore ? rows.slice(0, limit) : rows
  const nextCursor = hasMore ? entries[entries.length - 1].created_at : null
  return { entries, nextCursor }
}

export async function getTrophyEntry(id: string, userId: string): Promise<TrophyRoomEntry | null> {
  const db = await getServiceSupabase()
  const { data } = await db
    .from('trophy_room_entries')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .is('deleted_at', null)
    .maybeSingle()
  return (data as TrophyRoomEntry) ?? null
}

export async function updateTrophyEntry(
  id: string,
  userId: string,
  patch: Partial<Pick<TrophyRoomEntry, 'display_label' | 'display_photo_url' | 'watermarked_url' | 'watermark_status'>>,
): Promise<TrophyRoomEntry | null> {
  const db = await getServiceSupabase()
  const { data, error } = await db
    .from('trophy_room_entries')
    .update(patch)
    .eq('id', id)
    .eq('user_id', userId)
    .is('deleted_at', null)
    .select('*')
    .maybeSingle()
  if (error) throw new Error(`Failed to update trophy entry: ${error.message}`)
  return (data as TrophyRoomEntry) ?? null
}

export async function softDeleteTrophyEntry(id: string, userId: string): Promise<boolean> {
  const db = await getServiceSupabase()
  const { error } = await db
    .from('trophy_room_entries')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', userId)
  return !error
}
