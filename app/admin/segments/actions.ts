'use server'

/**
 * Phase 41: Server actions for the admin segments calibration panel.
 */

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { invalidateSegmentCache } from '@/lib/scoring/segment-engine'

// ============================================================================
// UPDATE CALIBRATION VALUE
// ============================================================================

export async function updateSegmentCalibrationValue(params: {
  segmentId: string
  measurementType: string
  multiplier: number
  bias: number
  confidenceAdjustment: number
}) {
  const supabase = await createClient()

  const { error } = await supabase
    .from('calibration_values')
    .upsert(
      {
        segment_id: params.segmentId,
        measurement_type: params.measurementType,
        multiplier: params.multiplier,
        bias: params.bias,
        confidence_adjustment: params.confidenceAdjustment,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'segment_id,measurement_type' }
    )

  if (error) throw new Error(error.message)

  // Bust the in-process segment cache so next scoring request picks up the change
  invalidateSegmentCache()
  revalidatePath('/admin/segments')
}

// ============================================================================
// TOGGLE SEGMENT ENABLED
// ============================================================================

export async function toggleSegmentEnabled(segmentId: string, enabled: boolean) {
  const supabase = await createClient()

  const { error } = await supabase
    .from('calibration_segments')
    .update({ enabled, updated_at: new Date().toISOString() })
    .eq('id', segmentId)

  if (error) throw new Error(error.message)

  invalidateSegmentCache()
  revalidatePath('/admin/segments')
}
