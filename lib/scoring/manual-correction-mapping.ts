/**
 * Manual Correction Mapping
 *
 * Maps a selected score-sheet field to the overlay geometry it needs
 * for drag-handle correction.  Returns null when no geometric mapping
 * is available yet (user falls back to numeric input only).
 */

// ============================================================================
// TYPES
// ============================================================================

export type CorrectionHandleMode = 'segment' | 'point_pair'

export type CorrectionHandleDefinition = {
  fieldKey: string
  label: string
  /** How the correction geometry is defined */
  mode: CorrectionHandleMode
  /** Key in the DetailedLandmarks object for the start anchor (normalized 0-1) */
  startLandmarkKey?: string | null
  /** Key in the DetailedLandmarks object for the end anchor */
  endLandmarkKey?: string | null
  /** Human-readable description of what the handles represent */
  startLabel?: string
  endLabel?: string
}

// ============================================================================
// MAPPING TABLE
// ============================================================================

const CORRECTION_MAPPING: Record<string, CorrectionHandleDefinition> = {
  inside_spread: {
    fieldKey: 'inside_spread',
    label: 'Inside Spread',
    mode: 'point_pair',
    startLandmarkKey: 'spread_left',
    endLandmarkKey: 'spread_right',
    startLabel: 'Left edge',
    endLabel: 'Right edge',
  },
  left_beam_length: {
    fieldKey: 'left_beam_length',
    label: 'Left Main Beam',
    mode: 'segment',
    startLandmarkKey: 'beam_base_left',
    endLandmarkKey: 'beam_tip_left',
    startLabel: 'Base',
    endLabel: 'Tip',
  },
  right_beam_length: {
    fieldKey: 'right_beam_length',
    label: 'Right Main Beam',
    mode: 'segment',
    startLandmarkKey: 'beam_base_right',
    endLandmarkKey: 'beam_tip_right',
    startLabel: 'Base',
    endLabel: 'Tip',
  },
  g1_left: {
    fieldKey: 'g1_left',
    label: 'G1 Left (Brow Tine)',
    mode: 'segment',
    startLandmarkKey: 'g1_base_left',
    endLandmarkKey: 'g1_tip_left',
    startLabel: 'Base',
    endLabel: 'Tip',
  },
  g1_right: {
    fieldKey: 'g1_right',
    label: 'G1 Right (Brow Tine)',
    mode: 'segment',
    startLandmarkKey: 'g1_base_right',
    endLandmarkKey: 'g1_tip_right',
    startLabel: 'Base',
    endLabel: 'Tip',
  },
  g2_left: {
    fieldKey: 'g2_left',
    label: 'G2 Left',
    mode: 'segment',
    startLandmarkKey: 'g2_base_left',
    endLandmarkKey: 'g2_tip_left',
    startLabel: 'Base',
    endLabel: 'Tip',
  },
  g2_right: {
    fieldKey: 'g2_right',
    label: 'G2 Right',
    mode: 'segment',
    startLandmarkKey: 'g2_base_right',
    endLandmarkKey: 'g2_tip_right',
    startLabel: 'Base',
    endLabel: 'Tip',
  },
  g3_left: {
    fieldKey: 'g3_left',
    label: 'G3 Left',
    mode: 'segment',
    startLandmarkKey: 'g3_base_left',
    endLandmarkKey: 'g3_tip_left',
    startLabel: 'Base',
    endLabel: 'Tip',
  },
  g3_right: {
    fieldKey: 'g3_right',
    label: 'G3 Right',
    mode: 'segment',
    startLandmarkKey: 'g3_base_right',
    endLandmarkKey: 'g3_tip_right',
    startLabel: 'Base',
    endLabel: 'Tip',
  },
  g4_left: {
    fieldKey: 'g4_left',
    label: 'G4 Left',
    mode: 'segment',
    startLandmarkKey: null,
    endLandmarkKey: null,
    startLabel: 'Base',
    endLabel: 'Tip',
  },
  g4_right: {
    fieldKey: 'g4_right',
    label: 'G4 Right',
    mode: 'segment',
    startLandmarkKey: null,
    endLandmarkKey: null,
    startLabel: 'Base',
    endLabel: 'Tip',
  },
  g5_left: {
    fieldKey: 'g5_left',
    label: 'G5 Left',
    mode: 'segment',
    startLandmarkKey: null,
    endLandmarkKey: null,
    startLabel: 'Base',
    endLabel: 'Tip',
  },
  g5_right: {
    fieldKey: 'g5_right',
    label: 'G5 Right',
    mode: 'segment',
    startLandmarkKey: null,
    endLandmarkKey: null,
    startLabel: 'Base',
    endLabel: 'Tip',
  },
  h1_left: {
    fieldKey: 'h1_left',
    label: 'H1 Left (Base)',
    mode: 'point_pair',
    startLandmarkKey: 'h1_a_left',
    endLandmarkKey: 'h1_b_left',
    startLabel: 'Point A',
    endLabel: 'Point B',
  },
  h1_right: {
    fieldKey: 'h1_right',
    label: 'H1 Right (Base)',
    mode: 'point_pair',
    startLandmarkKey: 'h1_a_right',
    endLandmarkKey: 'h1_b_right',
    startLabel: 'Point A',
    endLabel: 'Point B',
  },
  h2_left: { fieldKey: 'h2_left', label: 'H2 Left', mode: 'point_pair', startLandmarkKey: null, endLandmarkKey: null },
  h2_right: { fieldKey: 'h2_right', label: 'H2 Right', mode: 'point_pair', startLandmarkKey: null, endLandmarkKey: null },
  h3_left: { fieldKey: 'h3_left', label: 'H3 Left', mode: 'point_pair', startLandmarkKey: null, endLandmarkKey: null },
  h3_right: { fieldKey: 'h3_right', label: 'H3 Right', mode: 'point_pair', startLandmarkKey: null, endLandmarkKey: null },
  h4_left: { fieldKey: 'h4_left', label: 'H4 Left', mode: 'point_pair', startLandmarkKey: null, endLandmarkKey: null },
  h4_right: { fieldKey: 'h4_right', label: 'H4 Right', mode: 'point_pair', startLandmarkKey: null, endLandmarkKey: null },
  abnormal_points: {
    fieldKey: 'abnormal_points',
    label: 'Abnormal Points',
    mode: 'segment',
    startLandmarkKey: null,
    endLandmarkKey: null,
  },
  deductions: {
    fieldKey: 'deductions',
    label: 'Total Deductions',
    mode: 'segment',
    startLandmarkKey: null,
    endLandmarkKey: null,
  },
}

// ============================================================================
// LOOKUP
// ============================================================================

/**
 * Get the correction handle definition for a field.
 * Returns null if the field is not correctable with geometry.
 */
export function getCorrectionHandleDefinition(
  fieldKey: string
): CorrectionHandleDefinition | null {
  return CORRECTION_MAPPING[fieldKey] ?? null
}

/**
 * Resolve landmark positions from a landmarks object for the given field.
 * Returns normalized { x, y } coordinates (0-1) or null if not present.
 */
export function resolveLandmarkHandles(
  definition: CorrectionHandleDefinition,
  landmarks: Record<string, unknown> | null | undefined
): {
  start: { x: number; y: number } | null
  end: { x: number; y: number } | null
} {
  if (!landmarks) return { start: null, end: null }

  const resolvePoint = (key: string | null | undefined): { x: number; y: number } | null => {
    if (!key) return null
    const pt = landmarks[key] as { x?: number; y?: number } | null | undefined
    if (!pt || typeof pt.x !== 'number' || typeof pt.y !== 'number') return null
    return { x: pt.x, y: pt.y }
  }

  return {
    start: resolvePoint(definition.startLandmarkKey),
    end: resolvePoint(definition.endLandmarkKey),
  }
}

/**
 * Estimate a pixel distance between two normalized points given image dimensions.
 * Returns null if either point is absent.
 */
export function estimatePixelDistance(
  start: { x: number; y: number } | null,
  end: { x: number; y: number } | null,
  imageWidth: number,
  imageHeight: number
): number | null {
  if (!start || !end) return null
  const dx = (end.x - start.x) * imageWidth
  const dy = (end.y - start.y) * imageHeight
  return Math.sqrt(dx * dx + dy * dy)
}
