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

  const imageList = images as Array<{ image_url: string; image_type?: string | null }>

  // Batched, not fully sequential. Each scoreBuck fans out into several GPT-4o
  // calls, so all-at-once would hit rate limits — but one-at-a-time blew past
  // the 300s function budget at 11 images and the request died with a bare
  // "Load failed". Three in flight keeps us inside both limits.
  const BATCH_SIZE = 3
  const results: PerAngleResult[] = []

  const scoreOne = async (img: { image_url: string; image_type?: string | null }): Promise<PerAngleResult> => {
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

      return {
        ...base,
        gross,
        net,
        grossDelta: gross != null && officialGross != null ? gross - officialGross : null,
        netDelta: net != null && officialNet != null ? net - officialNet : null,
        fields,
      }
    } catch (err) {
      // One bad image must not lose the others.
      return {
        ...base,
        gross: null,
        net: null,
        grossDelta: null,
        netDelta: null,
        fields: [],
        error: err instanceof Error ? err.message : 'Scoring failed for this image',
      }
    }
  }

  for (let i = 0; i < imageList.length; i += BATCH_SIZE) {
    const batch = imageList.slice(i, i + BATCH_SIZE)
    const settled = await Promise.all(batch.map(scoreOne))
    results.push(...settled)

    // Persist after every batch so a timeout keeps the work already done
    // instead of discarding all of it.
    try {
      await adminDb
        .from('official_score_sheets')
        .update({ ai_run_per_angle: buildPayload(results, imageList.length, true) })
        .eq('id', id)
    } catch {
      // Best effort — the final write below is what matters.
    }
  }

  const payload = buildPayload(results, imageList.length, false)

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
        message: `Scored ${payload.scored_count}/${payload.image_count} angles but could not save: ${updateError.message}. Apply the ai_run_per_angle migration.`,
        result: payload,
      },
      { status: 200 },
    )
  }

  return NextResponse.json({ ok: true, result: payload })
}


/** Mean of the finite values, or null when there are none. */
function mean(values: number[]): number | null {
  const finite = values.filter(v => Number.isFinite(v))
  if (finite.length === 0) return null
  return finite.reduce((a, b) => a + b, 0) / finite.length
}

/**
 * Summary written to `ai_run_per_angle`.
 *
 * Repeated shots of the SAME angle are averaged into one entry: two photos
 * from front-center are two samples of how well that angle scores, and the
 * mean is a better estimate than either alone. Individual runs are kept in
 * `angles[]` so nothing is hidden behind the average.
 */
function buildPayload(
  results: PerAngleResult[],
  totalImages: number,
  partial: boolean,
) {
  const scored = results.filter(r => r.grossDelta != null)

  // Group by camera position.
  const byAngle = new Map<string, PerAngleResult[]>()
  for (const r of results) {
    const key = r.imageType ?? 'untagged'
    const list = byAngle.get(key) ?? []
    list.push(r)
    byAngle.set(key, list)
  }

  const angleSummaries = [...byAngle.entries()].map(([imageType, runs]) => {
    const ok = runs.filter(r => r.grossDelta != null)
    return {
      imageType,
      sampleCount: runs.length,
      scoredCount: ok.length,
      meanGross: mean(ok.map(r => r.gross as number)),
      meanGrossDelta: mean(ok.map(r => r.grossDelta as number)),
      meanAbsGrossDelta: mean(ok.map(r => Math.abs(r.grossDelta as number))),
      meanNetDelta: mean(ok.map(r => r.netDelta as number).filter(v => v != null)),
    }
  })

  const ranked = angleSummaries.filter(a => a.meanAbsGrossDelta != null)

  return {
    run_at: new Date().toISOString(),
    partial,
    image_count: totalImages,
    scored_count: scored.length,
    // Mean absolute gross error, one vote per ANGLE rather than per photo, so
    // an angle shot twice does not count double.
    mae_gross: ranked.length
      ? Number((ranked.reduce((s, a) => s + (a.meanAbsGrossDelta as number), 0) / ranked.length).toFixed(2))
      : null,
    best_angle: ranked.length
      ? ranked.reduce((a, b) => (a.meanAbsGrossDelta as number) <= (b.meanAbsGrossDelta as number) ? a : b).imageType
      : null,
    worst_angle: ranked.length
      ? ranked.reduce((a, b) => (a.meanAbsGrossDelta as number) >= (b.meanAbsGrossDelta as number) ? a : b).imageType
      : null,
    angle_summaries: angleSummaries,
    angles: results,
  }
}
