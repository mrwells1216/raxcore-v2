/**
 * Vision Output Normalization Layer (Phase 9)
 * 
 * Takes raw vision output and normalizes it to ensure:
 * 1. Measurements fall within realistic anatomical ranges
 * 2. Extreme outliers are reduced
 * 3. Left/right symmetry is reasonable
 * 4. Proportions match known deer antler relationships
 */

import type { Measurements } from '@/lib/types'
import { ANATOMICAL_REFERENCES } from '@/lib/constants'

// Realistic measurement ranges for whitetail deer (in inches)
// Based on B&C data and biological constraints
export const MEASUREMENT_RANGES = {
  inside_spread: { min: 10, max: 32, typical_min: 14, typical_max: 24, outlier_threshold: 0.15 },
  main_beam: { min: 14, max: 34, typical_min: 20, typical_max: 28, outlier_threshold: 0.12 },
  g1: { min: 1, max: 14, typical_min: 3, typical_max: 7, outlier_threshold: 0.2 },
  g2: { min: 2, max: 18, typical_min: 7, typical_max: 13, outlier_threshold: 0.15 },
  g3: { min: 1, max: 16, typical_min: 6, typical_max: 12, outlier_threshold: 0.15 },
  g4: { min: 0, max: 14, typical_min: 3, typical_max: 9, outlier_threshold: 0.2 },
  g5: { min: 0, max: 10, typical_min: 1, typical_max: 5, outlier_threshold: 0.25 },
  h1: { min: 3, max: 8, typical_min: 4, typical_max: 5.5, outlier_threshold: 0.1 },
  h2: { min: 2.5, max: 7, typical_min: 3.5, typical_max: 5, outlier_threshold: 0.1 },
  h3: { min: 2, max: 7, typical_min: 3.5, typical_max: 5, outlier_threshold: 0.1 },
  h4: { min: 2, max: 6.5, typical_min: 3, typical_max: 4.5, outlier_threshold: 0.12 },
  abnormal_points: { min: 0, max: 60, typical_min: 0, typical_max: 20, outlier_threshold: 0.3 },
  deductions: { min: 0, max: 25, typical_min: 1, typical_max: 8, outlier_threshold: 0.25 },
} as const

// Known anatomical ratio constraints
const ANATOMICAL_RATIOS = {
  // Main beam is typically 1.0-1.5x the inside spread
  beam_to_spread: { min: 0.9, max: 1.6, ideal: 1.2 },
  // G2 is usually the longest tine, typically 35-55% of main beam
  g2_to_beam: { min: 0.28, max: 0.6, ideal: 0.42 },
  // G3 is typically 80-100% of G2
  g3_to_g2: { min: 0.65, max: 1.1, ideal: 0.85 },
  // G4 is typically 50-90% of G3
  g4_to_g3: { min: 0.35, max: 1.0, ideal: 0.7 },
  // H1 > H2 > H3 > H4 (typically)
  circumference_decay: { min: 0.85, max: 1.05 },
  // Left/right asymmetry cap (max difference as % of larger side)
  max_lr_asymmetry: 0.20,
} as const

export interface NormalizationResult {
  normalized: Measurements
  adjustments: NormalizationAdjustment[]
  totalAdjustmentMagnitude: number
  confidenceImpact: number
  outlierCount: number
  ratioViolations: string[]
}

export interface NormalizationAdjustment {
  field: string
  original: number
  normalized: number
  reason: string
  severity: 'minor' | 'moderate' | 'major'
}

/**
 * Clamp a value to be within min/max bounds with soft limits
 */
function clampWithSoftLimits(
  value: number,
  min: number,
  max: number,
  typicalMin: number,
  typicalMax: number,
  outlierThreshold: number
): { value: number; adjustment: number; reason: string | null } {
  // Hard clamp first
  if (value < min) {
    return { value: min, adjustment: min - value, reason: `below minimum (${min})` }
  }
  if (value > max) {
    return { value: max, adjustment: value - max, reason: `above maximum (${max})` }
  }

  // Soft pull toward typical range for extreme values
  if (value < typicalMin) {
    const distanceFromTypical = typicalMin - value
    const rangeSize = typicalMin - min
    const pullStrength = Math.min(1, distanceFromTypical / rangeSize) * outlierThreshold
    const pulled = value + distanceFromTypical * pullStrength
    if (pulled !== value) {
      return { 
        value: Number(pulled.toFixed(1)), 
        adjustment: pulled - value, 
        reason: `pulled toward typical range (${typicalMin}-${typicalMax})` 
      }
    }
  }
  if (value > typicalMax) {
    const distanceFromTypical = value - typicalMax
    const rangeSize = max - typicalMax
    const pullStrength = Math.min(1, distanceFromTypical / rangeSize) * outlierThreshold
    const pulled = value - distanceFromTypical * pullStrength
    if (pulled !== value) {
      return { 
        value: Number(pulled.toFixed(1)), 
        adjustment: value - pulled, 
        reason: `pulled toward typical range (${typicalMin}-${typicalMax})` 
      }
    }
  }

  return { value, adjustment: 0, reason: null }
}

/**
 * Balance left/right measurements to reduce excessive asymmetry
 */
function balanceLeftRight(
  left: number,
  right: number,
  maxAsymmetry: number = ANATOMICAL_RATIOS.max_lr_asymmetry
): { left: number; right: number; adjusted: boolean } {
  if (left <= 0 || right <= 0) return { left, right, adjusted: false }
  
  const larger = Math.max(left, right)
  const smaller = Math.min(left, right)
  const asymmetry = (larger - smaller) / larger

  if (asymmetry > maxAsymmetry) {
    // Pull both values toward each other
    const targetDiff = larger * maxAsymmetry
    const currentDiff = larger - smaller
    const adjustmentNeeded = (currentDiff - targetDiff) / 2
    
    const newLarger = larger - adjustmentNeeded
    const newSmaller = smaller + adjustmentNeeded

    return {
      left: left === larger ? Number(newLarger.toFixed(1)) : Number(newSmaller.toFixed(1)),
      right: right === larger ? Number(newLarger.toFixed(1)) : Number(newSmaller.toFixed(1)),
      adjusted: true,
    }
  }

  return { left, right, adjusted: false }
}

/**
 * Enforce anatomical ratio constraints
 */
function enforceRatioConstraint(
  value: number,
  referenceValue: number,
  ratio: { min: number; max: number; ideal: number },
  fieldName: string
): { value: number; violation: string | null } {
  if (referenceValue <= 0) return { value, violation: null }
  
  const actualRatio = value / referenceValue
  
  if (actualRatio < ratio.min) {
    const newValue = Number((referenceValue * ratio.min).toFixed(1))
    return { 
      value: newValue, 
      violation: `${fieldName} ratio too low (${actualRatio.toFixed(2)} < ${ratio.min})` 
    }
  }
  if (actualRatio > ratio.max) {
    const newValue = Number((referenceValue * ratio.max).toFixed(1))
    return { 
      value: newValue, 
      violation: `${fieldName} ratio too high (${actualRatio.toFixed(2)} > ${ratio.max})` 
    }
  }

  return { value, violation: null }
}

/**
 * Normalize vision output measurements
 */
export function normalizeMeasurements(raw: Measurements): NormalizationResult {
  const adjustments: NormalizationAdjustment[] = []
  const ratioViolations: string[] = []
  let outlierCount = 0
  
  // Start with raw measurements
  const normalized: Measurements = { ...raw }

  // Helper to record adjustment
  const recordAdjustment = (
    field: string, 
    original: number, 
    newValue: number, 
    reason: string
  ) => {
    const magnitude = Math.abs(newValue - original)
    const severity: NormalizationAdjustment['severity'] = 
      magnitude > 3 ? 'major' : magnitude > 1 ? 'moderate' : 'minor'
    
    if (magnitude >= 0.1) {
      adjustments.push({ field, original, normalized: newValue, reason, severity })
      if (severity === 'major') outlierCount++
    }
  }

  // 1. Normalize spread
  if (normalized.inside_spread !== null) {
    const range = MEASUREMENT_RANGES.inside_spread
    const result = clampWithSoftLimits(
      normalized.inside_spread, range.min, range.max, 
      range.typical_min, range.typical_max, range.outlier_threshold
    )
    if (result.reason) {
      recordAdjustment('inside_spread', normalized.inside_spread, result.value, result.reason)
    }
    normalized.inside_spread = result.value
  }

  // 2. Normalize main beams
  for (const side of ['left', 'right'] as const) {
    const key = `main_beam_${side}` as keyof Measurements
    const value = normalized[key]
    if (typeof value === 'number') {
      const range = MEASUREMENT_RANGES.main_beam
      const result = clampWithSoftLimits(
        value, range.min, range.max, 
        range.typical_min, range.typical_max, range.outlier_threshold
      )
      if (result.reason) {
        recordAdjustment(key, value, result.value, result.reason)
      }
      ;(normalized as Record<string, number | null>)[key] = result.value
    }
  }

  // Balance main beams
  if (normalized.main_beam_left !== null && normalized.main_beam_right !== null) {
    const balanced = balanceLeftRight(normalized.main_beam_left, normalized.main_beam_right)
    if (balanced.adjusted) {
      if (balanced.left !== normalized.main_beam_left) {
        recordAdjustment('main_beam_left', normalized.main_beam_left, balanced.left, 'asymmetry correction')
      }
      if (balanced.right !== normalized.main_beam_right) {
        recordAdjustment('main_beam_right', normalized.main_beam_right, balanced.right, 'asymmetry correction')
      }
      normalized.main_beam_left = balanced.left
      normalized.main_beam_right = balanced.right
    }
  }

  // 3. Normalize tines (G1-G5)
  const tineKeys = ['g1', 'g2', 'g3', 'g4', 'g5'] as const
  for (const tine of tineKeys) {
    const range = MEASUREMENT_RANGES[tine]
    for (const side of ['left', 'right'] as const) {
      const key = `${tine}_${side}` as keyof Measurements
      const value = normalized[key]
      if (typeof value === 'number' && value > 0) {
        const result = clampWithSoftLimits(
          value, range.min, range.max, 
          range.typical_min, range.typical_max, range.outlier_threshold
        )
        if (result.reason) {
          recordAdjustment(key, value, result.value, result.reason)
        }
        ;(normalized as Record<string, number | null>)[key] = result.value
      }
    }
  }

  // Balance tines left/right
  for (const tine of tineKeys) {
    const leftKey = `${tine}_left` as keyof Measurements
    const rightKey = `${tine}_right` as keyof Measurements
    const leftVal = normalized[leftKey]
    const rightVal = normalized[rightKey]
    
    if (typeof leftVal === 'number' && typeof rightVal === 'number' && leftVal > 0 && rightVal > 0) {
      const balanced = balanceLeftRight(leftVal, rightVal)
      if (balanced.adjusted) {
        if (balanced.left !== leftVal) {
          recordAdjustment(leftKey, leftVal, balanced.left, 'asymmetry correction')
        }
        if (balanced.right !== rightVal) {
          recordAdjustment(rightKey, rightVal, balanced.right, 'asymmetry correction')
        }
        ;(normalized as Record<string, number | null>)[leftKey] = balanced.left
        ;(normalized as Record<string, number | null>)[rightKey] = balanced.right
      }
    }
  }

  // 4. Normalize circumferences (H1-H4)
  const circumKeys = ['h1', 'h2', 'h3', 'h4'] as const
  for (const h of circumKeys) {
    const range = MEASUREMENT_RANGES[h]
    for (const side of ['left', 'right'] as const) {
      const key = `${h}_${side}` as keyof Measurements
      const value = normalized[key]
      if (typeof value === 'number') {
        const result = clampWithSoftLimits(
          value, range.min, range.max, 
          range.typical_min, range.typical_max, range.outlier_threshold
        )
        if (result.reason) {
          recordAdjustment(key, value, result.value, result.reason)
        }
        ;(normalized as Record<string, number | null>)[key] = result.value
      }
    }
  }

  // 5. Normalize abnormal points and deductions
  if (normalized.abnormal_points !== null) {
    const range = MEASUREMENT_RANGES.abnormal_points
    const result = clampWithSoftLimits(
      normalized.abnormal_points, range.min, range.max,
      range.typical_min, range.typical_max, range.outlier_threshold
    )
    if (result.reason) {
      recordAdjustment('abnormal_points', normalized.abnormal_points, result.value, result.reason)
    }
    normalized.abnormal_points = result.value
  }

  if (normalized.deductions !== null) {
    const range = MEASUREMENT_RANGES.deductions
    const result = clampWithSoftLimits(
      normalized.deductions, range.min, range.max,
      range.typical_min, range.typical_max, range.outlier_threshold
    )
    if (result.reason) {
      recordAdjustment('deductions', normalized.deductions, result.value, result.reason)
    }
    normalized.deductions = result.value
  }

  // 6. Enforce anatomical ratio constraints
  const avgBeam = (
    (normalized.main_beam_left ?? 0) + (normalized.main_beam_right ?? 0)
  ) / 2

  // Beam to spread ratio
  if (normalized.inside_spread !== null && avgBeam > 0) {
    const ratioResult = enforceRatioConstraint(
      avgBeam, normalized.inside_spread, ANATOMICAL_RATIOS.beam_to_spread, 'beam/spread'
    )
    if (ratioResult.violation) {
      ratioViolations.push(ratioResult.violation)
    }
  }

  // G2 to beam ratio
  const avgG2 = ((normalized.g2_left ?? 0) + (normalized.g2_right ?? 0)) / 2
  if (avgG2 > 0 && avgBeam > 0) {
    const ratioResult = enforceRatioConstraint(
      avgG2, avgBeam, ANATOMICAL_RATIOS.g2_to_beam, 'g2/beam'
    )
    if (ratioResult.violation) {
      ratioViolations.push(ratioResult.violation)
    }
  }

  // Calculate confidence impact from adjustments
  const totalAdjustmentMagnitude = adjustments.reduce((sum, adj) => 
    sum + Math.abs(adj.normalized - adj.original), 0
  )
  
  // Higher adjustments = lower confidence
  const majorAdjustments = adjustments.filter(a => a.severity === 'major').length
  const moderateAdjustments = adjustments.filter(a => a.severity === 'moderate').length
  
  let confidenceImpact = 0
  confidenceImpact -= majorAdjustments * 8
  confidenceImpact -= moderateAdjustments * 3
  confidenceImpact -= ratioViolations.length * 5
  confidenceImpact = Math.max(-25, confidenceImpact) // Cap negative impact

  return {
    normalized,
    adjustments,
    totalAdjustmentMagnitude,
    confidenceImpact,
    outlierCount,
    ratioViolations,
  }
}

/**
 * Get normalization summary for debugging/admin display
 */
export function getNormalizationSummary(result: NormalizationResult): string {
  if (result.adjustments.length === 0) {
    return 'All measurements within normal ranges.'
  }

  const major = result.adjustments.filter(a => a.severity === 'major')
  const moderate = result.adjustments.filter(a => a.severity === 'moderate')
  const minor = result.adjustments.filter(a => a.severity === 'minor')

  const parts: string[] = []
  if (major.length > 0) parts.push(`${major.length} major`)
  if (moderate.length > 0) parts.push(`${moderate.length} moderate`)
  if (minor.length > 0) parts.push(`${minor.length} minor`)

  return `Applied ${parts.join(', ')} correction(s). Confidence impact: ${result.confidenceImpact}%`
}
