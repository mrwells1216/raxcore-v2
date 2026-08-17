import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getServiceSupabase } from '@/lib/supabase/admin'
import { scoreBuck } from '@/lib/scoring/ai-service'
import {
  flattenOfficialScoreData,
  officialGrossFromScoreData,
  officialImageTypeToAngle,
} from '@/lib/training/official-measurements'
import { probeImageDimensions } from '@/lib/scoring/vision-scorer'

export const runtime = 'nodejs'
// One scoreBuck call per image. A 9-angle guide buck is therefore ~9x a normal
// scoring run, so this needs the long budget (the §3.30 inline pattern).
export const maxDuration = 300

interface PerAngleFieldDelta {
  field: string
  official: number | null
  ai: number | null
  delta: number | null
  percent_off: number | null
}

interface PerAngleResult {
  imageType: string | null
  imageUrl: string
  angleType: string
  gross: number | null
  net: number | null
  grossDelta: number | null
  netDelta: number | null
  fields: PerAngleFieldDelta[]
  error?: string
}

/**
 * POST /api/admin/training-import/[id]/run-ai-per-angle
 *
 * Scores EACH image of an official sheet on its own and compares every result
 * against the same certified measurements. The existing `run-ai` route sends
 * all images to one `scoreBuck` call, which answers "how accurate is the AI on
 * this buck" but gives no signal about WHICH angles score well — the main
 * thing a guide buck shot from many positions can tell us.
 *
 * Writes an array to `official_score_sheets.ai_run_per_angle`. Purely an
 * accuracy measurement: nothing here feeds live scoring.
 */
export async function POST(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const db = await createClient()
  const { data: { user } } = await db.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await db.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

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
  if (!images?.length) {
    return NextResponse.json({ error: 'No images attached to this sheet' }, { status: 400 })
  }

  const officialMeasurements = flattenOfficialScoreData(sheet.score_data)
  const officialGross = officialGrossFromScoreData(sheet.score_data)
  const officialNetRaw = (sheet.score_data as Record<string, unknown>)?.calculated_net
  const officialNet = typeof officialNetRaw === 'number' ? officialNetRaw : null

  const rawRackType = (sheet.score_data as Record<string, string>)?.rack_type ?? 'typical'
  const rackType: 'typical' | 'non-typical' = rawRackType === 'non-typical' ? 'non-typical' : 'typical'
  const state = (sheet.score_data as Record<string, string>)?.state ?? 'unknown'

  // Sequential, not parallel: each scoreBuck fans out into several GPT-4o
  // calls of its own, so running 9 at once would hammer the rate limit.
  const results: PerAngleResult[] = []

  for (const img of images as Array<{ image_url: string; image_type?: string | null }>) {
    const angleType = officialImageTypeToAngle(img.image_type)
    const base: Omit<PerAngleResult, 'gross' | 'net' | 'grossDelta' | 'netDelta' | 'fields'> = {
      imageType: img.image_type ?? null,
      imageUrl: img.image_url,
      angleType,
    }

    try {
      // Real pixel dimensions rather than the 1024x768 placeholder the
      // original route used — wrong dimensions skew the geometry paths.
      const dims = await probeImageDimensions(img.image_url)

      const scoringResult = await scoreBuck({
        images: [{
          imageUrl: img.image_url,
          angleType,
          width: dims?.width ?? 1024,
          height: dims?.height ?? 768,
        }],
        state,
        rackType,
      })

      const aiMeasurements: Record<string, number> = {}
      if (scoringResult.measurements) {
        for (const [k, v] of Object.entries(scoringResult.measurements)) {
          if (typeof v === 'number') aiMeasurements[k] = v
        }
      }

      const fields: PerAngleFieldDelta[] = []
      const allFields = new Set([
        ...Object.keys(officialMeasurements),
        ...Object.keys(aiMeasurements),
      ])
      for (const field of allFields) {
        if (field === 'grossScore' || field === 'netScore') continue
        const official = typeof officialMeasurements[field] === 'number' ? officialMeasurements[field] : null
        const ai = typeof aiMeasurements[field] === 'number' ? aiMeasurements[field] : null
        const delta = official != null && ai != null ? ai - official : null
        const percent_off = official != null && ai != null && official !== 0
          ? Math.round(((ai - official) / official) * 1000) / 10
          : null
        fields.push({ field, official, ai, delta, percent_off })
      }

      const gross = scoringResult.predictedGross ?? null
      const net = scoringResult.predictedNet ?? null

      results.push({
        ...base,
        gross,
        net,
        grossDelta: gross != null && officialGross != null ? gross - officialGross : null,
        netDelta: net != null && officialNet != null ? net - officialNet : null,
        fields,
      })
    } catch (err) {
      // One bad image must not lose the other eight results.
      results.push({
        ...base,
        gross: null,
        net: null,
        grossDelta: null,
        netDelta: null,
        fields: [],
        error: err instanceof Error ? err.message : 'Scoring failed for this image',
      })
    }
  }

  const scored = results.filter(r => r.grossDelta != null)
  const summary = {
    run_at: new Date().toISOString(),
    image_count: results.length,
    scored_count: scored.length,
    official_gross: officialGross,
    official_net: officialNet,
    // Mean ABSOLUTE gross error across angles — the headline "how far off is
    // the scorer on this buck, on average, regardless of angle".
    mae_gross: scored.length
      ? Number((scored.reduce((s, r) => s + Math.abs(r.grossDelta as number), 0) / scored.length).toFixed(2))
      : null,
    best_angle: scored.length
      ? scored.reduce((a, b) => Math.abs(a.grossDelta as number) <= Math.abs(b.grossDelta as number) ? a : b).imageType
      : null,
    worst_angle: scored.length
      ? scored.reduce((a, b) => Math.abs(a.grossDelta as number) >= Math.abs(b.grossDelta as number) ? a : b).imageType
      : null,
  }

  const payload = { ...summary, angles: results }

  const { error: updateError } = await adminDb
    .from('official_score_sheets')
    .update({ ai_run_per_angle: payload })
    .eq('id', id)

  if (updateError) {
    // The numbers are still worth returning even if the column is missing.
    return NextResponse.json(
      {
        ok: false,
        error: 'per_angle_persist_failed',
        message: `Scored ${scored.length}/${results.length} angles but could not save: ${updateError.message}. Apply the ai_run_per_angle migration.`,
        result: payload,
      },
      { status: 200 },
    )
  }

  return NextResponse.json({ ok: true, result: payload })
}
