/**
 * Phase 20: Centralized Calibration Utilities
 * 
 * Single source of truth for:
 * - Fetching active calibration profile
 * - Applying default calibration values
 * - Calibration profile merging with defaults
 * 
 * All scoring, validation, and preview should use these utilities.
 */

import { createClient } from '@/lib/supabase/server'
import type { CalibrationProfile } from '@/lib/types'

// ============================================================================
// DEFAULT CALIBRATION VALUES (Source of Truth)
// ============================================================================

export const DEFAULT_CALIBRATION = {
  spread_correction_weight: 1.0,
  beam_correction_weight: 1.0,
  tine_correction_weight: 1.0,
  mass_correction_weight: 1.0,
  deduction_correction_weight: 1.0,
  confidence_scaling: 1.0,
  learning_correction_strength: 1.0,
  max_total_correction: 8.0,
  max_spread_correction: 3.0,
  max_beam_correction: 4.0,
  max_tine_correction: 2.0,
  max_mass_correction: 1.0,
} as const

// ============================================================================
// SAFE RANGES FOR CALIBRATION VALUES
// ============================================================================

export const CALIBRATION_SAFE_RANGES = {
  spread_correction_weight: { min: 0.0, max: 2.0 },
  beam_correction_weight: { min: 0.0, max: 2.0 },
  tine_correction_weight: { min: 0.0, max: 2.0 },
  mass_correction_weight: { min: 0.0, max: 2.0 },
  deduction_correction_weight: { min: 0.0, max: 2.0 },
  confidence_scaling: { min: 0.5, max: 1.5 },
  learning_correction_strength: { min: 0.0, max: 2.0 },
  max_total_correction: { min: 1.0, max: 15.0 },
  max_spread_correction: { min: 0.5, max: 6.0 },
  max_beam_correction: { min: 0.5, max: 8.0 },
  max_tine_correction: { min: 0.5, max: 4.0 },
  max_mass_correction: { min: 0.2, max: 2.0 },
} as const

// ============================================================================
// CORE CALIBRATION FUNCTIONS
// ============================================================================

// Cache for active calibration profile (short TTL)
let cachedActiveProfile: CalibrationProfile | null = null
let cacheTimestamp = 0
const CACHE_TTL_MS = 30000 // 30 seconds

// Track if we've already warned about missing table
let hasWarnedMissingTable = false

/**
 * Get the currently active calibration profile.
 * Uses short-lived caching to reduce database calls during high-volume scoring.
 * Returns null if no active profile exists (defaults will be used).
 * Gracefully handles missing calibration_profiles table (returns null, uses defaults).
 */
export async function getActiveCalibrationProfile(): Promise<CalibrationProfile | null> {
  const now = Date.now()
  
  // Return cached value if fresh
  if (cachedActiveProfile !== null && (now - cacheTimestamp) < CACHE_TTL_MS) {
    return cachedActiveProfile
  }
  
  try {
    const supabase = await createClient()
    
    const { data, error } = await supabase
      .from('calibration_profiles')
      .select('*')
      .eq('is_active', true)
      .single()
    
    // Handle table not existing (42P01) or no rows (PGRST116) gracefully
    if (error) {
      const isTableMissing = error.code === '42P01' || error.message?.includes('does not exist')
      const isNoRows = error.code === 'PGRST116'
      
      if (isTableMissing) {
        if (!hasWarnedMissingTable) {
          console.warn('[calibration] calibration_profiles table not found - using defaults')
          hasWarnedMissingTable = true
        }
        cachedActiveProfile = null
        cacheTimestamp = now
        return null
      }
      
      if (!isNoRows) {
        console.error('Error fetching active calibration profile:', error)
      }
      return cachedActiveProfile // Return stale cache on other errors
    }
    
    cachedActiveProfile = data || null
    cacheTimestamp = now
    return cachedActiveProfile
  } catch {
    return cachedActiveProfile // Return stale cache on error
  }
}

/**
 * Get a specific calibration profile by ID.
 */
export async function getCalibrationProfileById(id: string): Promise<CalibrationProfile | null> {
  try {
    const supabase = await createClient()
    
    const { data, error } = await supabase
      .from('calibration_profiles')
      .select('*')
      .eq('id', id)
      .single()
    
    if (error) {
      return null
    }
    
    return data
  } catch {
    return null
  }
}

/**
 * Invalidate the active profile cache.
 * Call this after activating/deactivating profiles.
 */
export function invalidateCalibrationCache(): void {
  cachedActiveProfile = null
  cacheTimestamp = 0
}

/**
 * Ensure a calibration profile has all required fields.
 * Merges provided values with defaults.
 */
export function ensureCalibrationProfile(
  saved?: Partial<CalibrationProfile> | null
): CalibrationProfile {
  return {
    id: saved?.id || '',
    name: saved?.name || 'Default',
    description: saved?.description || null,
    is_active: saved?.is_active ?? true,
    model_version_id: saved?.model_version_id || null,
    spread_correction_weight: saved?.spread_correction_weight ?? DEFAULT_CALIBRATION.spread_correction_weight,
    beam_correction_weight: saved?.beam_correction_weight ?? DEFAULT_CALIBRATION.beam_correction_weight,
    tine_correction_weight: saved?.tine_correction_weight ?? DEFAULT_CALIBRATION.tine_correction_weight,
    mass_correction_weight: saved?.mass_correction_weight ?? DEFAULT_CALIBRATION.mass_correction_weight,
    deduction_correction_weight: saved?.deduction_correction_weight ?? DEFAULT_CALIBRATION.deduction_correction_weight,
    confidence_scaling: saved?.confidence_scaling ?? DEFAULT_CALIBRATION.confidence_scaling,
    learning_correction_strength: saved?.learning_correction_strength ?? DEFAULT_CALIBRATION.learning_correction_strength,
    max_total_correction: saved?.max_total_correction ?? DEFAULT_CALIBRATION.max_total_correction,
    max_spread_correction: saved?.max_spread_correction ?? DEFAULT_CALIBRATION.max_spread_correction,
    max_beam_correction: saved?.max_beam_correction ?? DEFAULT_CALIBRATION.max_beam_correction,
    max_tine_correction: saved?.max_tine_correction ?? DEFAULT_CALIBRATION.max_tine_correction,
    max_mass_correction: saved?.max_mass_correction ?? DEFAULT_CALIBRATION.max_mass_correction,
    created_at: saved?.created_at || new Date().toISOString(),
    updated_at: saved?.updated_at || new Date().toISOString(),
    created_by: saved?.created_by || null,
  }
}

/**
 * Get resolved calibration settings.
 * If a profile is provided, use it; otherwise fetch the active profile.
 * Falls back to defaults if nothing is available.
 */
export async function getResolvedCalibration(
  explicitProfile?: CalibrationProfile | null
): Promise<CalibrationProfile> {
  if (explicitProfile) {
    return ensureCalibrationProfile(explicitProfile)
  }
  
  const activeProfile = await getActiveCalibrationProfile()
  return ensureCalibrationProfile(activeProfile)
}

/**
 * Clamp a calibration value to its safe range.
 */
export function clampCalibrationValue(
  key: keyof typeof CALIBRATION_SAFE_RANGES,
  value: number
): number {
  const range = CALIBRATION_SAFE_RANGES[key]
  return Math.max(range.min, Math.min(range.max, value))
}

/**
 * Validate and clamp all calibration values.
 */
export function validateCalibrationValues(
  input: Partial<CalibrationProfile>
): Record<string, number> {
  const validated: Record<string, number> = {}
  
  for (const [key, range] of Object.entries(CALIBRATION_SAFE_RANGES)) {
    const value = input[key as keyof CalibrationProfile]
    if (typeof value === 'number') {
      validated[key] = Math.max(range.min, Math.min(range.max, value))
    }
  }
  
  return validated
}

// ============================================================================
// CALIBRATION APPLICATION HELPERS
// ============================================================================

export interface CalibrationApplicationResult {
  // Weights applied
  spreadWeight: number
  beamWeight: number
  tineWeight: number
  massWeight: number
  deductionWeight: number
  // Caps applied
  maxSpreadCorrection: number
  maxBeamCorrection: number
  maxTineCorrection: number
  maxMassCorrection: number
  maxTotalCorrection: number
  // Learning and confidence
  learningStrength: number
  confidenceScaling: number
}

/**
 * Extract application-ready calibration values from a profile.
 */
export function getCalibrationApplicationValues(
  profile: CalibrationProfile | null | undefined
): CalibrationApplicationResult {
  const resolved = ensureCalibrationProfile(profile)
  
  return {
    spreadWeight: resolved.spread_correction_weight,
    beamWeight: resolved.beam_correction_weight,
    tineWeight: resolved.tine_correction_weight,
    massWeight: resolved.mass_correction_weight,
    deductionWeight: resolved.deduction_correction_weight,
    maxSpreadCorrection: resolved.max_spread_correction,
    maxBeamCorrection: resolved.max_beam_correction,
    maxTineCorrection: resolved.max_tine_correction,
    maxMassCorrection: resolved.max_mass_correction,
    maxTotalCorrection: resolved.max_total_correction,
    learningStrength: resolved.learning_correction_strength,
    confidenceScaling: resolved.confidence_scaling,
  }
}

/**
 * Apply calibration weights to a correction value.
 */
export function applyCalibrationWeight(
  correction: number,
  weight: number,
  maxCorrection: number
): number {
  const weighted = correction * weight
  return Math.max(-maxCorrection, Math.min(maxCorrection, weighted))
}

/**
 * Apply total correction cap.
 */
export function applyTotalCorrectionCap(
  correction: number,
  maxTotal: number
): number {
  return Math.max(-maxTotal, Math.min(maxTotal, correction))
}
