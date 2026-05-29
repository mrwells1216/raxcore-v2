/**
 * Official score sheets are stored with a NESTED shape (left/right side objects),
 * e.g. { inside_spread, abnormal_points, left: { main_beam, g1..g5, h1..h4 },
 * right: { ... }, calculated_gross, ... }. The AI scorer and the
 * correction_events table both use FLAT Measurements keys (main_beam_left,
 * g2_right, h1_left, inside_spread, ...). These helpers bridge the two so
 * per-field comparison and bias aggregation align on the same key space.
 */

const TINE_FIELDS = ['g1', 'g2', 'g3', 'g4', 'g5'] as const
const CIRC_FIELDS = ['h1', 'h2', 'h3', 'h4'] as const

type SideData = Record<string, unknown> | null | undefined

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/**
 * Flatten nested official score_data into flat Measurements-style keys.
 * Only finite numeric values are included; absent/non-numeric fields are omitted.
 */
export function flattenOfficialScoreData(
  scoreData: unknown
): Record<string, number> {
  const out: Record<string, number> = {}
  if (!scoreData || typeof scoreData !== 'object') return out
  const data = scoreData as Record<string, unknown>

  const spread = num(data.inside_spread)
  if (spread != null) out.inside_spread = spread
  const abnormal = num(data.abnormal_points)
  if (abnormal != null) out.abnormal_points = abnormal

  const sides: Array<['left' | 'right', SideData]> = [
    ['left', data.left as SideData],
    ['right', data.right as SideData],
  ]
  for (const [side, sideData] of sides) {
    if (!sideData || typeof sideData !== 'object') continue
    const s = sideData as Record<string, unknown>
    const beam = num(s.main_beam)
    if (beam != null) out[`main_beam_${side}`] = beam
    for (const f of TINE_FIELDS) {
      const v = num(s[f])
      if (v != null) out[`${f}_${side}`] = v
    }
    for (const f of CIRC_FIELDS) {
      const v = num(s[f])
      if (v != null) out[`${f}_${side}`] = v
    }
  }

  return out
}

/**
 * Official gross score from score_data, tolerating both the form's stored
 * `calculated_gross` and any legacy `gross_score` field.
 */
export function officialGrossFromScoreData(scoreData: unknown): number | null {
  if (!scoreData || typeof scoreData !== 'object') return null
  const data = scoreData as Record<string, unknown>
  return num(data.calculated_gross) ?? num(data.gross_score)
}
