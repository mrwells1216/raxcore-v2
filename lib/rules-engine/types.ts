/**
 * Boone & Crockett Rules Engine - Type Definitions
 * 
 * Canonical data shapes for measurement-based scoring.
 * These types are the single source of truth for score sheet data.
 * 
 * AI produces measurements -> Rules engine computes scores
 */

export type Side = 'left' | 'right'

export type MeasurementSource = 'ai' | 'reviewed' | 'precision_pass' | 'manual'

/**
 * Provenance source - where a measurement value came from
 */
export type ProvenanceSource = 'ai_raw' | 'precision_pass' | 'fallback' | 'human_review'

/**
 * Confidence bucket for measurement reliability
 */
export type ConfidenceBucket = 'high' | 'medium' | 'low'

/**
 * Edit status for tracking changes
 */
export type EditStatus = 'unchanged' | 'adjusted' | 'overridden'

/**
 * A measured field with full provenance metadata.
 * Used for traceability and trust in the scoring pipeline.
 */
export interface MeasuredField {
  /** The measurement value in inches (null if not available) */
  value: number | null
  /** Where this value came from */
  provenance: ProvenanceSource
  /** Reliability bucket */
  confidence?: ConfidenceBucket
  /** Numeric confidence 0-1 if available */
  confidenceScore?: number | null
  /** Original AI value before any adjustments */
  originalValue?: number | null
  /** Whether this field was edited by a human */
  wasEdited?: boolean
  /** Edit status for UI display */
  editStatus?: EditStatus
}

/**
 * Helper to create a MeasuredField from a raw value
 */
export function createMeasuredField(
  value: number | null,
  provenance: ProvenanceSource,
  options?: {
    confidence?: ConfidenceBucket
    confidenceScore?: number | null
    originalValue?: number | null
  }
): MeasuredField {
  return {
    value,
    provenance,
    confidence: options?.confidence ?? (provenance === 'fallback' ? 'low' : 'medium'),
    confidenceScore: options?.confidenceScore ?? null,
    originalValue: options?.originalValue ?? value,
    wasEdited: false,
    editStatus: 'unchanged',
  }
}

/**
 * Convert numeric confidence (0-1) to bucket
 */
export function confidenceToBucket(score: number | null | undefined): ConfidenceBucket {
  if (score === null || score === undefined) return 'medium'
  if (score >= 0.8) return 'high'
  if (score >= 0.5) return 'medium'
  return 'low'
}

/**
 * Mark a field as edited by human review
 */
export function markFieldEdited(
  field: MeasuredField,
  newValue: number | null
): MeasuredField {
  const wasChanged = field.originalValue !== newValue
  return {
    ...field,
    value: newValue,
    provenance: wasChanged ? 'human_review' : field.provenance,
    wasEdited: wasChanged,
    editStatus: wasChanged 
      ? (field.provenance === 'ai_raw' ? 'overridden' : 'adjusted')
      : 'unchanged',
  }
}

export type ScoringSystem = 
  | 'boone_and_crockett_typical'
  | 'boone_and_crockett_non_typical'
  | 'pope_and_young_typical'
  | 'pope_and_young_non_typical'

// ============================================================================
// MEASUREMENT PRIMITIVES
// ============================================================================

/**
 * A single tine measurement (G1-G7 typically)
 */
export interface TineMeasurement {
  /** Tine index: 1=G1 (brow), 2=G2, etc. */
  index: number
  /** Length in inches (null if not measurable/present) */
  length: number | null
  /** AI confidence 0-1 for this measurement */
  confidence?: number | null
  /** Where this measurement came from */
  source?: MeasurementSource
}

/**
 * A single mass/circumference measurement (H1-H4)
 */
export interface MassMeasurement {
  /** Mass index: 1=H1 (base), 2=H2, 3=H3, 4=H4 */
  index: number
  /** Circumference in inches (null if not measurable) */
  circumference: number | null
  /** AI confidence 0-1 for this measurement */
  confidence?: number | null
  /** Where this measurement came from */
  source?: MeasurementSource
}

/**
 * All measurements for one side (left or right antler)
 */
export interface SideBreakdown {
  /** Main beam length from burr to tip along outer curve */
  mainBeamLength: number | null
  /** Main beam confidence */
  mainBeamConfidence?: number | null
  /** Main beam source */
  mainBeamSource?: MeasurementSource
  /** All normal tines (G1-G7) - array allows variable point counts */
  tines: TineMeasurement[]
  /** All mass circumferences (H1-H4) */
  masses: MassMeasurement[]
  /** Abnormal points on this side (stickers, kickers, drop tines, etc.) */
  abnormalPoints?: TineMeasurement[]
}

/**
 * Deduction calculation breakdown
 */
export interface DeductionBreakdown {
  /** Sum of all left-right differences for each measurement */
  sideToSideDifferences: number | null
  /** Total length of abnormal points (deducted in typical scoring) */
  abnormalPointDeductions: number | null
  /** Total deductions applied to gross score */
  totalDeductions: number | null
}

// ============================================================================
// SCORE SHEET MEASUREMENTS
// ============================================================================

/**
 * Complete measurement set for a whitetail deer rack
 */
export interface ScoreSheetMeasurements {
  /** Inside spread at widest point (perpendicular to skull centerline) */
  insideSpread: number | null
  /** Greatest spread (may exceed inside spread due to angle) */
  greatestSpread?: number | null
  /** Tip to tip spread */
  tipToTipSpread?: number | null
  
  /** Left antler measurements */
  left: SideBreakdown
  /** Right antler measurements */
  right: SideBreakdown
  
  /** Deduction calculations */
  deductions: DeductionBreakdown
  
  /** Computed gross score (spread + left + right + abnormal) */
  grossScore: number | null
  /** Computed net score (gross - deductions) */
  netScore: number | null
  
  /** Overall confidence in the measurements (0-1) */
  confidence?: number | null
  /** Any notes about measurement quality or issues */
  notes?: string | null
}

// ============================================================================
// LANDMARK DATA (for future visual overlay)
// ============================================================================

export interface Point2D {
  x: number
  y: number
}

export interface LandmarkLine {
  start: Point2D
  end: Point2D
  label?: string
}

/**
 * Visual landmarks for overlaying measurements on images
 */
export interface ScoreSheetLandmarks {
  /** Image dimensions this was calibrated for */
  imageWidth?: number
  imageHeight?: number
  /** Scale factor (pixels per inch) if known */
  pixelsPerInch?: number | null
  
  insideSpread?: LandmarkLine
  leftMainBeam?: LandmarkLine
  rightMainBeam?: LandmarkLine
  leftTines?: LandmarkLine[]
  rightTines?: LandmarkLine[]
  leftMasses?: LandmarkLine[]
  rightMasses?: LandmarkLine[]
}

// ============================================================================
// SCORE SHEET PAYLOAD
// ============================================================================

/**
 * Per-field provenance metadata for auditing
 */
export interface FieldProvenanceMap {
  insideSpread?: MeasuredField
  leftMainBeam?: MeasuredField
  rightMainBeam?: MeasuredField
  leftTines?: Record<number, MeasuredField>
  rightTines?: Record<number, MeasuredField>
  leftMasses?: Record<number, MeasuredField>
  rightMasses?: Record<number, MeasuredField>
  abnormalPoints?: MeasuredField
  deductions?: MeasuredField
  grossScore?: MeasuredField
  netScore?: MeasuredField
}

/**
 * The canonical score sheet payload - the single source of truth
 * for all scoring data in the system.
 * 
 * Flow: AI Vision -> ScoreSheetPayload -> Rules Engine -> Scores
 */
export interface ScoreSheetPayload {
  /** Schema version for forward compatibility */
  version: 1
  /** Scoring system used */
  scoringSystem: ScoringSystem
  /** Where this data came from */
  source: MeasurementSource
  /** All measurements */
  measurements: ScoreSheetMeasurements
  /** Visual landmark data (optional, for overlay) */
  landmarks?: ScoreSheetLandmarks | null
  /** Raw notes from AI model */
  rawModelNotes?: string | null
  /** Timestamp of creation */
  createdAt?: string
  /** Timestamp of last modification */
  updatedAt?: string
  /** 
   * Per-field provenance metadata for auditing.
   * Tracks where each measurement came from and whether it was edited.
   */
  provenance?: FieldProvenanceMap | null
  /**
   * Whether any fields have been edited by a human reviewer
   */
  hasHumanEdits?: boolean
}

// ============================================================================
// COMPUTATION RESULT
// ============================================================================

/**
 * Result from the rules engine computation
 */
export interface ComputedScores {
  /** Gross score (all measurements summed) */
  gross: number
  /** Net score (gross minus deductions) */
  net: number
  /** Spread credit (capped by longest main beam) */
  spreadCredit: number
  /** Left side total */
  leftTotal: number
  /** Right side total */
  rightTotal: number
  /** Total abnormal points length */
  abnormalTotal: number
  /** Total deductions */
  totalDeductions: number
  /** Individual deduction breakdown */
  deductionBreakdown: {
    mainBeamDiff: number
    tineDiffs: number[]
    massDiffs: number[]
    abnormalDeduction: number
  }
}

// ============================================================================
// MUTATION TYPES (for precision pass field-level adjustments)
// ============================================================================

/**
 * Types of hypothesis mutations the precision pass can apply.
 * Each operates on specific measurement fields.
 */
export type HypothesisMutationType =
  | 'noop'
  | 'scale_up'
  | 'scale_down'
  | 'spread_expand'
  | 'spread_reduce'
  | 'beam_extend'
  | 'beam_reduce'
  | 'symmetry_beam'
  | 'symmetry_tine'
  | 'mass_boost'
  | 'mass_reduce'
  | 'deduction_reduce'
  | 'deduction_increase'
  | 'swap_sides'
  | 'tine_extend'
  | 'tine_reduce'
  | 'combo'

/**
 * A patch describing deltas to apply to measurement fields.
 * All values are deltas (positive or negative) to add to current values.
 */
export interface MeasurementPatch {
  insideSpreadDelta?: number
  leftMainBeamDelta?: number
  rightMainBeamDelta?: number
  /** Tine deltas by tine index (1-5 for G1-G5) */
  leftTineDeltas?: Record<number, number>
  rightTineDeltas?: Record<number, number>
  /** Mass deltas by circumference index (1-4 for H1-H4) */
  leftMassDeltas?: Record<number, number>
  rightMassDeltas?: Record<number, number>
  deductionDelta?: number
  abnormalPointsDelta?: number
}

/**
 * A mutation candidate with hypothesis type and patch.
 */
export interface SheetMutationCandidate {
  hypothesisType: HypothesisMutationType
  patch: MeasurementPatch
  notes?: string[]
}
