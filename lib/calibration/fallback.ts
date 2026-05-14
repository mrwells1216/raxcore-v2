/**
 * Graceful Calibration Profile Fallback
 * 
 * Always returns a usable profile - never throws, never returns null.
 * Handles missing table, empty table, or any errors gracefully.
 */

import { createClient } from '@/lib/supabase/server'
import type { CalibrationProfile } from '@/lib/types'

// Track if we've already warned about missing table (once per server lifetime)
let hasWarnedMissingTable = false

// Default profile returned when table is missing or empty
const DEFAULT_PROFILE = {
  id: 'default',
  name: 'default',
  is_active: true,
  adjustment_json: {},
  parameters: {},
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
}

/**
 * Get the active calibration profile or a sensible default.
 * Never throws - always returns a usable profile object.
 * Gracefully handles missing table, no rows, or any errors.
 * 
 * Usage:
 * ```ts
 * const profile = await getActiveCalibrationProfileOrDefault()
 * // profile is always defined - safe to use immediately
 * ```
 */
export async function getActiveCalibrationProfileOrDefault(): Promise<CalibrationProfile> {
  try {
    const supabase = await createClient()
    
    const { data, error } = await supabase
      .from('calibration_profiles')
      .select('*')
      .eq('is_active', true)
      .maybeSingle()
    
    if (error) {
      if (!hasWarnedMissingTable) {
        console.warn('[calibration] missing/optional calibration_profiles table; using default profile', {
          code: error.code,
          message: error.message,
        })
        hasWarnedMissingTable = true
      }
      return DEFAULT_PROFILE as unknown as CalibrationProfile
    }

    // No active profile found - return default
    if (!data) {
      return DEFAULT_PROFILE as unknown as CalibrationProfile
    }

    return data
  } catch {
    // On any unexpected error, return default
    return DEFAULT_PROFILE as unknown as CalibrationProfile
  }
}
