import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getServiceSupabase } from '@/lib/supabase/admin'
import { scoreBuck } from '@/lib/scoring/ai-service'

export const runtime = 'nodejs'

/**
 * POST /api/admin/training-import/[id]/run-ai
 * Runs the AI scoring pipeline against the uploaded images for an official sheet,
 * then stores the comparison in official_score_sheets.ai_run_result.
 */
export async function POST(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const db = await createClient()
  const { data: { user } } = await db.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await db.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Load sheet + images
  const adminDb = await getServiceSupabase()
  const { data: sheet, error: sheetErr } = await adminDb
    .from('official_score_sheets')
    .select('*')
    .eq('id', id)
    .single()
  if (sheetErr || !sheet) return NextResponse.json({ error: 'Sheet not found' }, { status: 404 })

  const { data: images } = await adminDb
    .from('official_score_images')
    .select('*')
    .eq('sheet_id', id)
  if (!images?.length) return NextResponse.json({ error: 'No images attached to this sheet' }, { status: 400 })

  // Build scoring input
  const imageInputs = images.map((img: { image_url: string; image_type?: string }) => {
    const rawAngle = img.image_type?.includes('side')
      ? (img.image_type?.includes('right') ? 'right' : 'left')
      : 'front'
    const angleType = rawAngle as import('@/lib/types').AngleType
    return { imageUrl: img.image_url, angleType, width: 1024, height: 768 }
  })

  const rawRackType = (sheet.score_data as Record<string, string>)?.rack_type ?? 'typical'
  const rackType: 'typical' | 'non-typical' = rawRackType === 'non-typical' ? 'non-typical' : 'typical'

  // Run AI scorer (reuse existing scoreBuck pipeline)
  const scoringResult = await scoreBuck({
    images: imageInputs,
    state: (sheet.score_data as Record<string, string>)?.state ?? 'unknown',
    rackType,
  })

  // Build comparison: official vs AI per field
  const officialMeasurements = (sheet.score_data as Record<string, number>) ?? {}
  const aiMeasurements: Record<string, number> = {}
  if (scoringResult.measurements) {
    for (const [k, v] of Object.entries(scoringResult.measurements)) {
      if (typeof v === 'number') aiMeasurements[k] = v
    }
  }

  const comparisonFields: Array<{
    field: string
    official: number | null
    ai: number | null
    delta: number | null
    percent_off: number | null
  }> = []

  const allFields = new Set([...Object.keys(officialMeasurements), ...Object.keys(aiMeasurements)])
  for (const field of allFields) {
    if (field === 'grossScore' || field === 'netScore') continue
    const official = typeof officialMeasurements[field] === 'number' ? officialMeasurements[field] : null
    const ai = typeof aiMeasurements[field] === 'number' ? aiMeasurements[field] : null
    const delta = official != null && ai != null ? ai - official : null
    const percent_off = official != null && ai != null && official !== 0
      ? Math.round(((ai - official) / official) * 1000) / 10
      : null
    comparisonFields.push({ field, official, ai, delta, percent_off })
  }

  const officialGross = (sheet.score_data as Record<string, number>)?.gross_score ?? null
  const aiGross = scoringResult.predictedGross ?? null

  const aiRunResult = {
    run_at: new Date().toISOString(),
    ai_gross: aiGross,
    official_gross: officialGross,
    gross_delta: aiGross != null && officialGross != null ? aiGross - officialGross : null,
    fields: comparisonFields,
    ai_confidence_percent: scoringResult.confidencePercent ?? null,
  }

  // Persist back to sheet
  await adminDb
    .from('official_score_sheets')
    .update({ ai_run_result: aiRunResult })
    .eq('id', id)

  return NextResponse.json({ ok: true, comparison: aiRunResult })
}
