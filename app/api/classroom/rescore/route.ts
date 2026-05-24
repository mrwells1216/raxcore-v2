import { NextResponse } from 'next/server'
import { recordCorrectionEvent } from '@/lib/training/correction-events'

export const runtime = 'nodejs'

const CATEGORY_KEYS = new Set([
  'expected_higher',
  'expected_lower',
  'left_antler_error',
  'right_antler_error',
])
const TINE_KEYS = new Set(['g1', 'g2', 'g3', 'g4', 'main_beam', 'dog_tine', 'irregular_point'])

interface RescoreBody {
  buckId?: string
  predictionId?: string | null
  oldGross?: number | null
  newGross?: number | null
  userId?: string | null
  categories?: string[]
  tineFlags?: { side?: string; tines?: string[] }[]
}

/**
 * POST /api/classroom/rescore
 * Records RAXrs error-category flags as correction_events (source
 * 'classroom_rescore'). The actual re-score goes through /api/score; this only
 * captures the user's qualitative feedback for the learning flywheel.
 */
export async function POST(req: Request) {
  let body: RescoreBody
  try {
    body = (await req.json()) as RescoreBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const buckId = typeof body.buckId === 'string' ? body.buckId : null
  if (!buckId) {
    return NextResponse.json({ error: 'buckId is required' }, { status: 400 })
  }

  const predictionId = typeof body.predictionId === 'string' ? body.predictionId : null
  const userId = typeof body.userId === 'string' ? body.userId : null
  const oldGross = typeof body.oldGross === 'number' ? body.oldGross : null
  const newGross = typeof body.newGross === 'number' ? body.newGross : null

  const events: Array<{ fieldKey: string; aiValue: number | null; userValue: number | null }> = []

  for (const cat of body.categories ?? []) {
    if (!CATEGORY_KEYS.has(cat)) continue
    if (cat === 'expected_higher' || cat === 'expected_lower') {
      // Direction flag on the overall score — encode direction in the key.
      events.push({ fieldKey: `classroom:overall:${cat}`, aiValue: oldGross, userValue: newGross })
    } else {
      events.push({ fieldKey: `classroom:${cat}`, aiValue: null, userValue: null })
    }
  }

  for (const flag of body.tineFlags ?? []) {
    const side = flag.side === 'left' || flag.side === 'right' ? flag.side : null
    if (!side) continue
    for (const tine of flag.tines ?? []) {
      if (!TINE_KEYS.has(tine)) continue
      events.push({ fieldKey: `classroom:${side}:${tine}`, aiValue: null, userValue: null })
    }
  }

  if (events.length === 0) {
    return NextResponse.json({ recorded: 0 })
  }

  await Promise.allSettled(
    events.map((e) =>
      recordCorrectionEvent({
        buckId,
        predictionId,
        userId,
        correctionSource: 'classroom_rescore',
        fieldKey: e.fieldKey,
        aiValue: e.aiValue,
        userValue: e.userValue,
      }),
    ),
  )

  return NextResponse.json({ recorded: events.length })
}
