/**
 * Measurement Display Confidence
 * 
 * Helper functions to derive field-level confidence for UI display.
 * Maps measurement metadata into color-coded trust levels.
 */

import type { MeasuredField, ProvenanceSource, ConfidenceBucket } from '@/lib/rules-engine/types'

export type MeasurementDisplayConfidence = 'high' | 'medium' | 'low' | 'unknown'

/**
 * Get display-level confidence for a measurement field.
 * 
 * Priority order:
 * 1. Human review => high
 * 2. Was edited => high
 * 3. Explicit confidence bucket if provided
 * 4. Numeric confidence score (0.8+ = high, 0.5+ = medium, < 0.5 = low)
 * 5. Provenance-based fallback
 */
export function getMeasurementDisplayConfidence(
  field: MeasuredField | null | undefined
): MeasurementDisplayConfidence {
  // Missing field => unknown
  if (!field || field.value === null) {
    return 'unknown'
  }

  // Human review or edited => high confidence
  if (field.provenance === 'human_review') {
    return 'high'
  }

  if (field.wasEdited === true) {
    return 'high'
  }

  if (field.editStatus === 'adjusted' || field.editStatus === 'overridden') {
    return 'high'
  }

  // Explicit confidence bucket if provided
  if (field.confidence) {
    switch (field.confidence) {
      case 'high':
        return 'high'
      case 'medium':
        return 'medium'
      case 'low':
        return 'low'
    }
  }

  // Numeric confidence score (0-1 scale)
  if (typeof field.confidenceScore === 'number') {
    if (field.confidenceScore >= 0.8) return 'high'
    if (field.confidenceScore >= 0.5) return 'medium'
    return 'low'
  }

  // Provenance-based fallback
  switch (field.provenance) {
    case 'precision_pass':
      return 'medium'
    case 'ai_raw':
      return 'medium'
    case 'fallback':
      return 'low'
    default:
      return 'unknown'
  }
}

/**
 * Get Tailwind CSS classes for confidence color-coding.
 * Returns classes for text color, border, and background.
 */
export function getMeasurementConfidenceColor(
  confidence: MeasurementDisplayConfidence
): string {
  switch (confidence) {
    case 'high':
      return 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10'
    case 'medium':
      return 'text-amber-300 border-amber-500/30 bg-amber-500/10'
    case 'low':
      return 'text-red-300 border-red-500/30 bg-red-500/10'
    case 'unknown':
      return 'text-zinc-300 border-zinc-500/20 bg-zinc-500/10'
  }
}

/**
 * Get a simple readable label for confidence level
 */
export function getMeasurementConfidenceLabel(
  confidence: MeasurementDisplayConfidence
): string {
  switch (confidence) {
    case 'high':
      return 'High'
    case 'medium':
      return 'Medium'
    case 'low':
      return 'Low'
    case 'unknown':
      return 'Unknown'
  }
}

/**
 * Get hex color code for use in canvas/SVG overlays
 */
export function getMeasurementConfidenceHex(
  confidence: MeasurementDisplayConfidence
): string {
  switch (confidence) {
    case 'high':
      return '#10b981' // emerald-500
    case 'medium':
      return '#f59e0b' // amber-500
    case 'low':
      return '#ef4444' // red-500
    case 'unknown':
      return '#71717a' // zinc-500
  }
}
