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

/**
 * Map an `official_score_images.image_type` tag to the production `AngleType`
 * the scorer understands.
 *
 * The previous inline mapping only recognised `image_type.includes('side')`,
 * so `angled`, `live`, `mounted`, `harvest` and `trail_cam` ALL silently
 * became `'front'` — which would have mislabelled most of a guide buck's
 * angles. Context tags (live/mounted/harvest/trail_cam) genuinely carry no
 * angle information, so they map to `'other'` rather than pretending to be a
 * front-on view.
 */
export function officialImageTypeToAngle(
  imageType: string | null | undefined,
): 'front' | 'left' | 'right' | 'back' | 'other' {
  const t = (imageType ?? '').trim().toLowerCase()
  if (!t) return 'other'

  // Rear tags first. `back_center_left` and the legacy `rear_left_135` both
  // contain "left" but are rear aspects — a naive includes() check would call
  // them left profiles.
  if (t === 'rear' || t.startsWith('rear') || t === 'back' || t.startsWith('back')) return 'back'

  // Irregular-point close-ups and unspecified positions carry no usable angle.
  if (t === 'irregular_points' || t === 'elevated' || t === 'angled') return 'other'

  // Context tags describe the situation, not the camera. They are their own
  // field now, but older rows stored them here.
  if (t === 'live' || t === 'mounted' || t === 'harvest' || t === 'trail_cam') return 'other'

  if (t.includes('left')) return 'left'
  if (t.includes('right')) return 'right'

  // front, front_center, front_top_center, front_bottom_center
  if (t === 'front' || t.startsWith('front')) return 'front'

  return 'other'
}

/**
 * Render a stored decimal measurement the way a scorer reads it: eighths.
 * `15.25` → `15 2/8`. Null/blank → an em dash.
 *
 * Values are stored as decimals but entered and read in eighths, so the
 * viewer should not make the operator convert in their head.
 */
export function formatInchesAsEighths(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  const sign = value < 0 ? '-' : ''
  const abs = Math.abs(value)
  let whole = Math.floor(abs)
  let eighths = Math.round((abs - whole) * 8)
  if (eighths >= 8) {
    whole += 1
    eighths = 0
  }
  if (eighths === 0) return `${sign}${whole}"`
  return `${sign}${whole} ${eighths}/8"`
}

/** Human label for a camera-position tag. Shared so the import form and the
 *  sheet viewer cannot drift apart. */
export const IMAGE_TYPE_LABELS: Record<string, string> = {
  front_center: 'Front-Center',
  front_center_left: 'Front-Center-Left',
  front_center_right: 'Front-Center-Right',
  front_top_center: 'Front-Top-Center',
  front_top_left: 'Front-Top-Left',
  front_top_right: 'Front-Top-Right',
  front_bottom_center: 'Front-Bottom-Center',
  front_bottom_left: 'Front-Bottom-Left',
  front_bottom_right: 'Front-Bottom-Right',
  back_center: 'Back-Center',
  back_center_left: 'Back-Center-Left',
  back_center_right: 'Back-Center-Right',
  back_top_center: 'Back-Top-Center',
  back_top_left: 'Back-Top-Left',
  back_top_right: 'Back-Top-Right',
  back_bottom_center: 'Back-Bottom-Center',
  back_bottom_left: 'Back-Bottom-Left',
  back_bottom_right: 'Back-Bottom-Right',
  irregular_points: 'Irregular Point/s',
  // Legacy values from before the 3x3 grid.
  front: 'Front',
  side_left: 'Left Side',
  side_right: 'Right Side',
  angled: 'Angled',
  rear: 'Rear',
  elevated: 'Elevated',
}

/** Human label for a photo-context tag. */
export const IMAGE_CONTEXT_LABELS: Record<string, string> = {
  mounted: 'Mounted',
  live: 'Live Buck',
  harvest: 'Harvest',
  trail_cam: 'Trail Cam',
  european: 'European Mount',
  other: 'Other',
}

/** Title-case fallback for any tag not in the maps above. */
export function humanizeTag(tag: string | null | undefined): string {
  if (!tag) return 'Untagged'
  return IMAGE_TYPE_LABELS[tag]
    ?? IMAGE_CONTEXT_LABELS[tag]
    ?? tag.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}
