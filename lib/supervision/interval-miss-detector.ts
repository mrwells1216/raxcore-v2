/**
 * Interval miss detector — pure helper for supervision hook wiring.
 *
 * Returns true when the verified ground truth falls outside the
 * model's predicted confidence interval, indicating the interval
 * was not well-calibrated for this prediction.
 */
export function isIntervalMiss(
  predictedLow: number,
  predictedHigh: number,
  groundTruth: number
): boolean {
  return groundTruth < predictedLow || groundTruth > predictedHigh
}

/**
 * Deviation magnitude: how many inches outside the interval the
 * ground truth fell.  Returns 0 when inside the interval.
 */
export function intervalMissDeviation(
  predictedLow: number,
  predictedHigh: number,
  groundTruth: number
): number {
  if (groundTruth < predictedLow) return predictedLow - groundTruth
  if (groundTruth > predictedHigh) return groundTruth - predictedHigh
  return 0
}
