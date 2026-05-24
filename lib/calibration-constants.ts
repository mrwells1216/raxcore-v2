// Client-safe calibration constants + types.
// Kept separate from lib/calibration.ts because that module imports the
// server-only Supabase client; importing it into a client component breaks the
// build. Anything a client component needs from calibration lives here.

// Seeded global correction applied when NO learned profile exists yet.
// The AI vision model reads ~5-8" low; this re-centers the point estimate.
// Learned profiles (from ground-truth + classroom rescore deltas) supersede it.
export const DEFAULT_GLOBAL_GROSS_BIAS = 6
export const DEFAULT_GLOBAL_NET_BIAS = 6

/** Per-request override (e.g. from the Classroom) that supersedes the resolved profile. */
export interface CalibrationOverride {
  grossBias?: number | null
  netBias?: number | null
  grossMultiplier?: number | null
  netMultiplier?: number | null
  confidenceMultiplier?: number | null
}
