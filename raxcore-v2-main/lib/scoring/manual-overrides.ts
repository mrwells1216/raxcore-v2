/**
 * Manual Override Data Model
 *
 * Structured types and helpers for human measurement corrections.
 * Overrides are local-first but fully serializable for later persistence.
 */

// ============================================================================
// TYPES
// ============================================================================

export type ManualOverrideFieldKey =
  | 'inside_spread'
  | 'left_beam_length'
  | 'right_beam_length'
  | 'g1_left'
  | 'g2_left'
  | 'g3_left'
  | 'g4_left'
  | 'g5_left'
  | 'g1_right'
  | 'g2_right'
  | 'g3_right'
  | 'g4_right'
  | 'g5_right'
  | 'h1_left'
  | 'h2_left'
  | 'h3_left'
  | 'h4_left'
  | 'h1_right'
  | 'h2_right'
  | 'h3_right'
  | 'h4_right'
  | 'abnormal_points'
  | 'deductions'

export type ManualOverridePoint = {
  x: number
  y: number
}

export type ManualOverrideGeometry = {
  start?: ManualOverridePoint | null
  end?: ManualOverridePoint | null
  points?: ManualOverridePoint[] | null
}

export type ManualOverrideEntry = {
  fieldKey: ManualOverrideFieldKey
  value: number | null
  geometry?: ManualOverrideGeometry | null
  /** The original AI-predicted value before this override. */
  originalValue?: number | null
  source: 'human_review'
  createdAt: string
}

/** Keyed by fieldKey for fast lookup. */
export type ManualOverrideMap = Record<string, ManualOverrideEntry>

// ============================================================================
// FIELD LABELS
// ============================================================================

const FIELD_LABELS: Record<ManualOverrideFieldKey, string> = {
  inside_spread: 'Inside Spread',
  left_beam_length: 'Left Main Beam',
  right_beam_length: 'Right Main Beam',
  g1_left: 'G1 Left',
  g2_left: 'G2 Left',
  g3_left: 'G3 Left',
  g4_left: 'G4 Left',
  g5_left: 'G5 Left',
  g1_right: 'G1 Right',
  g2_right: 'G2 Right',
  g3_right: 'G3 Right',
  g4_right: 'G4 Right',
  g5_right: 'G5 Right',
  h1_left: 'H1 Left',
  h2_left: 'H2 Left',
  h3_left: 'H3 Left',
  h4_left: 'H4 Left',
  h1_right: 'H1 Right',
  h2_right: 'H2 Right',
  h3_right: 'H3 Right',
  h4_right: 'H4 Right',
  abnormal_points: 'Abnormal Points',
  deductions: 'Deductions',
}

export function getOverrideFieldLabel(fieldKey: ManualOverrideFieldKey | string): string {
  return FIELD_LABELS[fieldKey as ManualOverrideFieldKey] ?? fieldKey
}

// ============================================================================
// FACTORY HELPER
// ============================================================================

/**
 * Build a ManualOverrideEntry from user input.
 * Always immutable — does not mutate any existing object.
 */
export function buildManualOverrideEntry({
  fieldKey,
  value,
  geometry,
  originalValue,
}: {
  fieldKey: ManualOverrideFieldKey
  value: number | null
  geometry?: ManualOverrideGeometry | null
  originalValue?: number | null
}): ManualOverrideEntry {
  return {
    fieldKey,
    value,
    geometry: geometry ?? null,
    originalValue: originalValue ?? null,
    source: 'human_review',
    createdAt: new Date().toISOString(),
  }
}

// ============================================================================
// APPLY OVERRIDES TO MEASUREMENTS
// ============================================================================

/**
 * Apply manual overrides on top of an AI measurements object.
 *
 * Returns a new measurements object — does NOT mutate the input.
 * Overridden fields:
 *   - have their value replaced
 *   - get provenance = 'human_review'
 *   - preserve originalValue
 *   - wasEdited = true
 *   - editStatus = 'overridden'
 */
export function applyManualOverridesToMeasurements(
  measurements: Record<string, unknown> | null | undefined,
  overrides: ManualOverrideMap
): Record<string, unknown> {
  if (!measurements) return {}
  const result = { ...measurements }

  for (const entry of Object.values(overrides)) {
    const key = entry.fieldKey

    // The flat measurements object uses snake_case keys that match field keys directly.
    // e.g. 'inside_spread', 'g1_left', 'left_beam_length'
    const currentRaw = result[key]
    const currentValue =
      currentRaw != null && typeof currentRaw === 'object' && 'value' in (currentRaw as object)
        ? (currentRaw as { value: unknown }).value
        : currentRaw

    // Build an enriched MeasuredField-compatible value
    const overriddenField = {
      value: entry.value,
      provenance: 'human_review' as const,
      confidence: 'high' as const,
      confidenceScore: 1.0,
      originalValue: entry.originalValue ?? (typeof currentValue === 'number' ? currentValue : null),
      wasEdited: true,
      editStatus: 'overridden' as const,
    }

    // If the existing field is a plain number, also update the numeric alias
    result[key] = overriddenField

    // Support flat-numeric keys still used by legacy display
    const numericAliasKey = `${key}_raw`
    if (entry.value !== null) {
      result[numericAliasKey] = entry.value
    }
  }

  return result
}

/**
 * Merge overrides into a ScoreSheetPayload-style measurements block.
 * Works with the nested left/right breakdown used by the rules engine.
 * Returns a shallow-merged clone — safe to pass to computeAllScores.
 */
export function applyOverridesToPayloadMeasurements(
  measurements: Record<string, unknown> | null | undefined,
  overrides: ManualOverrideMap
): Record<string, unknown> {
  if (!measurements) return {}

  // Deep-clone to avoid mutating original
  let m = JSON.parse(JSON.stringify(measurements)) as Record<string, unknown>

  for (const entry of Object.values(overrides)) {
    m = patchPayloadField(m, entry.fieldKey, entry.value)
  }

  return m
}

/** Patch a single field inside a ScoreSheetPayload measurements block. */
function patchPayloadField(
  m: Record<string, unknown>,
  fieldKey: string,
  value: number | null
): Record<string, unknown> {
  const result = { ...m }

  switch (fieldKey) {
    case 'inside_spread':
      result.insideSpread = value
      break
    case 'left_beam_length': {
      const left = (result.left as Record<string, unknown> | undefined) ?? {}
      result.left = { ...left, mainBeamLength: value }
      break
    }
    case 'right_beam_length': {
      const right = (result.right as Record<string, unknown> | undefined) ?? {}
      result.right = { ...right, mainBeamLength: value }
      break
    }
    default: {
      // g1_left -> left.tines[0], g2_right -> right.tines[1], h1_left -> left.masses[0], etc.
      const tineMatch = fieldKey.match(/^g(\d)_(left|right)$/)
      const massMatch = fieldKey.match(/^h(\d)_(left|right)$/)

      if (tineMatch) {
        const idx = parseInt(tineMatch[1], 10) - 1
        const side = tineMatch[2] as 'left' | 'right'
        const sideObj = (result[side] as Record<string, unknown> | undefined) ?? {}
        const tines = [...((sideObj.tines as unknown[]) ?? [])]
        const existing = (tines[idx] as Record<string, unknown> | undefined) ?? { index: idx + 1 }
        tines[idx] = { ...existing, length: value }
        result[side] = { ...sideObj, tines }
      } else if (massMatch) {
        const idx = parseInt(massMatch[1], 10) - 1
        const side = massMatch[2] as 'left' | 'right'
        const sideObj = (result[side] as Record<string, unknown> | undefined) ?? {}
        const masses = [...((sideObj.masses as unknown[]) ?? [])]
        const existing = (masses[idx] as Record<string, unknown> | undefined) ?? { index: idx + 1 }
        masses[idx] = { ...existing, circumference: value }
        result[side] = { ...sideObj, masses }
      }
    }
  }

  return result
}
