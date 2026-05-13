import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getServiceSupabase } from '@/lib/supabase/admin'
import { createTrainingPack, addItemsToTrainingPack } from '@/lib/training-packs/service'

export const runtime = 'nodejs'

/**
 * POST /api/admin/training-import/[id]/promote
 * Promotes an official score sheet to gold standard:
 * - Sets is_benchmark = true, records promoted_by + promoted_at
 * - Creates (or reuses named) a benchmark pack and adds the sheet as an item
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const db = await createClient()
  const { data: { user } } = await db.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await db.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const adminDb = await getServiceSupabase()

  // Load sheet
  const { data: sheet, error: sheetErr } = await adminDb
    .from('official_score_sheets')
    .select('*')
    .eq('id', id)
    .single()
  if (sheetErr || !sheet) return NextResponse.json({ error: 'Sheet not found' }, { status: 404 })

  if (sheet.is_benchmark) {
    return NextResponse.json({ error: 'Sheet is already promoted to gold standard' }, { status: 400 })
  }

  // Parse optional pack name from body
  let packName: string | null = null
  try {
    const body = await req.json().catch(() => ({}))
    packName = typeof body?.packName === 'string' ? body.packName : null
  } catch { /* no body */ }

  // Create a new pack (or find existing by name)
  const scoringSystem = sheet.scoring_system ?? sheet.score_data?.scoring_system ?? 'BC_TYPICAL'
  const resolvedPackName = packName ?? `Gold Standard — ${scoringSystem} ${new Date().toISOString().slice(0, 10)}`

  const pack = await createTrainingPack({
    name: resolvedPackName,
    description: `Official gold-standard sheet: ${sheet.buck_name ?? id}`,
    pack_type: 'baseline_supervision_pack',
  })

  // Add item to pack (uses sheet id as the buck_id proxy)
  await addItemsToTrainingPack(pack.id, [{
    prediction_id: null as unknown as string,
    buck_id: sheet.id,
    confidence_score: 1.0,
    item_quality_score: 1.0,
  }])

  // Mark sheet as promoted
  await adminDb
    .from('official_score_sheets')
    .update({
      is_benchmark: true,
      benchmark_pack_id: pack.id,
      promoted_by: user.id,
      promoted_at: new Date().toISOString(),
    })
    .eq('id', id)

  return NextResponse.json({
    ok: true,
    packId: pack.id,
    packName: pack.name,
  })
}
