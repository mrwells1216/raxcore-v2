/**
 * Deprecated runtime helper.
 * The canonical calibration runtime now lives in: lib/calibration.ts
 * Kept for backward compatibility only — always returns null to avoid
 * querying columns that may not exist in the current schema.
 */

export async function getActiveCalibrationProfile(_params?: {
  state?: string | null
  rackType?: string | null
  imageCount?: number | null
}) {
  // Deprecated: this file previously queried `profile_key` which does not
  // exist in the current calibration_profiles schema. Return null so callers
  // fall through to safe defaults without spamming error logs.
  return null
}
