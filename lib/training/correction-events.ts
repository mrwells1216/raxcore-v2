import 'server-only'
import { getServiceSupabase } from '@/lib/supabase/admin'

export type CorrectionSource = 'score_editor' | 'dpad' | 'precision_pass' | 'review_sheet'

export interface CorrectionEventInput {
  buckId: string
  predictionId: string | null
  userId: string | null
  correctionSource: CorrectionSource
  fieldKey: string
  aiValue: number | null
  userValue: number | null
  confidenceTierBefore?: string | null
}

/**
 * Record a single user correction event in the correction_events table.
 * Always non-blocking — errors are logged but never rethrow.
 */
export async function recordCorrectionEvent(input: CorrectionEventInput): Promise<void> {
  try {
    const delta =
      input.userValue != null && input.aiValue != null
        ? input.userValue - input.aiValue
        : null

    const db = await getServiceSupabase()
    const { error } = await db.from('correction_events').insert({
      buck_id: input.buckId,
      prediction_id: input.predictionId,
      user_id: input.userId,
      correction_source: input.correctionSource,
      field_key: input.fieldKey,
      ai_value: input.aiValue,
      user_value: input.userValue,
      delta,
      confidence_tier_before: input.confidenceTierBefore ?? null,
    })
    if (error) {
      console.warn('[correction-events] insert failed (non-blocking)', error.message)
    }
  } catch (err) {
    console.warn('[correction-events] insert failed (non-blocking)', err)
  }
}

/**
 * Diff two measurement objects and record one correction event per changed field.
 * `aiMeasurements` and `userMeasurements` are plain objects keyed by field name.
 */
export async function recordMeasurementDiff(params: {
  buckId: string
  predictionId: string | null
  userId: string | null
  correctionSource: CorrectionSource
  aiMeasurements: Record<string, number | null | undefined>
  userMeasurements: Record<string, number | null | undefined>
  confidenceTierBefore?: string | null
}): Promise<void> {
  const allKeys = new Set([
    ...Object.keys(params.aiMeasurements),
    ...Object.keys(params.userMeasurements),
  ])

  const inserts: Promise<void>[] = []

  for (const key of allKeys) {
    const aiVal = params.aiMeasurements[key] ?? null
    const userVal = params.userMeasurements[key] ?? null

    // Only record when both sides are numeric and value actually changed
    if (typeof aiVal !== 'number' || typeof userVal !== 'number') continue
    if (Math.abs(aiVal - userVal) < 0.001) continue

    inserts.push(
      recordCorrectionEvent({
        buckId: params.buckId,
        predictionId: params.predictionId,
        userId: params.userId,
        correctionSource: params.correctionSource,
        fieldKey: key,
        aiValue: aiVal,
        userValue: userVal,
        confidenceTierBefore: params.confidenceTierBefore,
      })
    )
  }

  await Promise.allSettled(inserts)
}
