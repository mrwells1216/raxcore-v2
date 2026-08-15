// Client-safe calibration constants + types.
// Kept separate from lib/calibration.ts because that module imports the
// server-only Supabase client; importing it into a client component breaks the
// build. Anything a client component needs from calibration lives here.

// Seeded global correction applied when NO learned profile exists yet.
//
// Held at 0 deliberately. This was previously +6", inferred from two photos
// (IMG_6534/IMG_6535) that read low — a sample size of two, applied as a flat
// offset to every buck regardless of size, angle, or calibration quality. It
// also stacked on top of the double-applied per-field bias, compounding the
// drift. Do NOT set this from eyeballing a handful of runs: produce a measured
// MAE from a benchmark pack (§3.33, /admin/benchmarks) and use that number, or
// leave it at 0 and let learned profiles do the work.
export const DEFAULT_GLOBAL_GROSS_BIAS = 0
export const DEFAULT_GLOBAL_NET_BIAS = 0

/** Per-request override (e.g. from the Classroom) that supersedes the resolved profile. */
export interface CalibrationOverride {
  grossBias?: number | null
  netBias?: number | null
  grossMultiplier?: number | null
  netMultiplier?: number | null
  confidenceMultiplier?: number | null
}
