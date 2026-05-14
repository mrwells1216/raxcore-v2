import type { Measurements } from '@/lib/types'
import type { HypothesisParams, HypothesisType } from './types'
import { DEFAULT_REVERSE_SETTINGS, clamp } from './config'

/** Paired left/right measurement fields */
const LEFT_RIGHT_FIELDS: Array<[keyof Measurements, keyof Measurements]> = [
  ['main_beam_left', 'main_beam_right'],
  ['g1_left', 'g1_right'],
  ['g2_left', 'g2_right'],
  ['g3_left', 'g3_right'],
  ['g4_left', 'g4_right'],
  ['g5_left', 'g5_right'],
  ['h1_left', 'h1_right'],
  ['h2_left', 'h2_right'],
  ['h3_left', 'h3_right'],
  ['h4_left', 'h4_right'],
]

/** Fields that should scale with reference */
const SCALE_FIELDS: (keyof Measurements)[] = [
  'inside_spread',
  'main_beam_left', 'main_beam_right',
  'g1_left', 'g1_right',
  'g2_left', 'g2_right',
  'g3_left', 'g3_right',
  'g4_left', 'g4_right',
  'g5_left', 'g5_right',
  'h1_left', 'h1_right',
  'h2_left', 'h2_right',
  'h3_left', 'h3_right',
  'h4_left', 'h4_right',
  'abnormal_points',
]

/**
 * Apply a hypothesis transformation to base measurements
 */
export function applyHypothesis(base: Measurements, params: HypothesisParams): Measurements {
  let m: Measurements = { ...base }

  // Swap sides (rare but catches left/right mis-association)
  if (params.swapSides) {
    const swapped: Measurements = { ...m }
    for (const [l, r] of LEFT_RIGHT_FIELDS) {
      swapped[l] = m[r] ?? null
      swapped[r] = m[l] ?? null
    }
    m = swapped
  }

  // Apply scale factor
  if (typeof params.scale === 'number' && Number.isFinite(params.scale)) {
    const s = params.scale
    const scaled: Measurements = { ...m }
    for (const f of SCALE_FIELDS) {
      const v = scaled[f]
      if (typeof v === 'number') {
        scaled[f] = Number((v * s).toFixed(1))
      }
    }
    m = scaled
  }

  // Symmetrize (blend toward average)
  if (params.symmetrize) {
    const { family, strength } = params.symmetrize
    const k = clamp(strength, 0, 1)

    const sym: Measurements = { ...m }
    
    let pairs: Array<[keyof Measurements, keyof Measurements]>
    if (family === 'beam') {
      pairs = [['main_beam_left', 'main_beam_right']]
    } else if (family === 'tine') {
      pairs = LEFT_RIGHT_FIELDS.filter(([l]) => String(l).startsWith('g'))
    } else {
      pairs = LEFT_RIGHT_FIELDS.filter(([l]) => String(l).startsWith('h'))
    }

    for (const [l, r] of pairs) {
      const lv = sym[l]
      const rv = sym[r]
      if (typeof lv === 'number' && typeof rv === 'number') {
        const avg = (lv + rv) / 2
        sym[l] = Number((lv + (avg - lv) * k).toFixed(1))
        sym[r] = Number((rv + (avg - rv) * k).toFixed(1))
      }
    }
    m = sym
  }

  // Apply direct overrides
  if (params.overrides) {
    const over: Measurements = { ...m }
    for (const [key, val] of Object.entries(params.overrides)) {
      if (val !== undefined) {
        (over as unknown as Record<string, unknown>)[key] = val
      }
    }
    m = over
  }

  // Clamp obvious numeric sanity
  if (typeof m.inside_spread === 'number') {
    m.inside_spread = clamp(m.inside_spread, 8, 40)
  }
  if (typeof m.deductions === 'number') {
    m.deductions = clamp(m.deductions, 0, 40)
  }
  if (typeof m.abnormal_points === 'number') {
    m.abnormal_points = clamp(m.abnormal_points, 0, 40)
  }

  return m
}

/**
 * Calculate gross and net scores from measurements
 */
export function calculateGrossNet(measurements: Measurements): { gross: number; net: number } {
  const vals = [
    measurements.inside_spread,
    measurements.main_beam_left, measurements.main_beam_right,
    measurements.g1_left, measurements.g1_right,
    measurements.g2_left, measurements.g2_right,
    measurements.g3_left, measurements.g3_right,
    measurements.g4_left, measurements.g4_right,
    measurements.g5_left, measurements.g5_right,
    measurements.h1_left, measurements.h1_right,
    measurements.h2_left, measurements.h2_right,
    measurements.h3_left, measurements.h3_right,
    measurements.h4_left, measurements.h4_right,
    measurements.abnormal_points,
  ].filter((v): v is number => v !== null && v !== undefined)

  const gross = vals.reduce((sum, v) => sum + v, 0)
  const net = gross - (measurements.deductions || 0) - (measurements.abnormal_points || 0)
  
  return { 
    gross: Number(gross.toFixed(1)), 
    net: Number(net.toFixed(1)) 
  }
}

/**
 * Generate hypothesis candidates based on baseline and error decomposition.
 *
 * Each hypothesis has a UNIQUE named type (scale_up / scale_down / spread_expand / …)
 * so the UI can show a clear human-readable label for every candidate instead of
 * repeating generic names like "scale" multiple times.
 */
export function generateHypotheses(input: {
  base: Measurements
  baseConfidence: number
  referenceQuality: number
  settings?: Partial<typeof DEFAULT_REVERSE_SETTINGS>
}): Array<{ type: HypothesisType; params: HypothesisParams }> {
  const settings = { ...DEFAULT_REVERSE_SETTINGS, ...(input.settings ?? {}) }
  const weakRef = input.referenceQuality < 0.6

  const out: Array<{ type: HypothesisType; params: HypothesisParams }> = []

  // ── 1. Baseline (no-op) — always first
  out.push({ type: 'noop', params: { notes: ['Baseline — no changes'] } })

  // ── 2. Scale hypotheses — large + small steps, unique types each direction
  // Large step
  out.push({
    type: 'scale_up',
    params: { scale: weakRef ? 1.05 : 1.015, notes: [] },
  })
  out.push({
    type: 'scale_down',
    params: { scale: weakRef ? 0.95 : 0.985, notes: [] },
  })
  // Small step (only add when weak reference warrants extra range)
  if (weakRef) {
    out.push({
      type: 'scale_up',
      params: { scale: 1.03, notes: ['small'] },
    })
    out.push({
      type: 'scale_down',
      params: { scale: 0.97, notes: ['small'] },
    })
  }

  // ── 3. Spread adjustments
  const baseSpread = input.base.inside_spread
  if (baseSpread !== null) {
    out.push({
      type: 'spread_expand',
      params: {
        overrides: { inside_spread: Number((baseSpread + 2).toFixed(1)) },
        notes: ['+2"'],
      },
    })
    out.push({
      type: 'spread_reduce',
      params: {
        overrides: { inside_spread: Number((baseSpread - 2).toFixed(1)) },
        notes: ['-2"'],
      },
    })
    // Half-inch fine tweaks
    out.push({
      type: 'spread_expand',
      params: {
        overrides: { inside_spread: Number((baseSpread + 0.5).toFixed(1)) },
        notes: ['+0.5"'],
      },
    })
    out.push({
      type: 'spread_reduce',
      params: {
        overrides: { inside_spread: Number((baseSpread - 0.5).toFixed(1)) },
        notes: ['-0.5"'],
      },
    })
  }

  // ── 4. Beam length adjustments (both sides simultaneously)
  const baseLeft = input.base.main_beam_left
  const baseRight = input.base.main_beam_right
  if (baseLeft !== null && baseRight !== null) {
    out.push({
      type: 'beam_extend',
      params: {
        overrides: {
          main_beam_left:  Number((baseLeft  + 3).toFixed(1)),
          main_beam_right: Number((baseRight + 3).toFixed(1)),
        },
        notes: ['+3"'],
      },
    })
    out.push({
      type: 'beam_reduce',
      params: {
        overrides: {
          main_beam_left:  Number((baseLeft  - 3).toFixed(1)),
          main_beam_right: Number((baseRight - 3).toFixed(1)),
        },
        notes: ['-3"'],
      },
    })
    out.push({
      type: 'beam_extend',
      params: {
        overrides: {
          main_beam_left:  Number((baseLeft  + 1).toFixed(1)),
          main_beam_right: Number((baseRight + 1).toFixed(1)),
        },
        notes: ['+1"'],
      },
    })
    out.push({
      type: 'beam_reduce',
      params: {
        overrides: {
          main_beam_left:  Number((baseLeft  - 1).toFixed(1)),
          main_beam_right: Number((baseRight - 1).toFixed(1)),
        },
        notes: ['-1"'],
      },
    })
  }

  // ── 5. Symmetry smoothing (perspective-confounded asymmetry)
  out.push({
    type: 'symmetry_beam',
    params: { symmetrize: { family: 'beam', strength: 0.6 }, notes: ['60%'] },
  })
  out.push({
    type: 'symmetry_tine',
    params: { symmetrize: { family: 'tine', strength: 0.6 }, notes: ['60%'] },
  })

  // ── 6. Mass (circumference) boost
  out.push({
    type: 'mass_boost',
    params: { scale: 1.0, overrides: {
      h1_left:  safeAdd(input.base.h1_left,  0.3),
      h1_right: safeAdd(input.base.h1_right, 0.3),
    }, notes: ['+0.3"'] },
  })
  out.push({
    type: 'mass_reduce',
    params: { overrides: {
      h1_left:  safeAdd(input.base.h1_left,  -0.3),
      h1_right: safeAdd(input.base.h1_right, -0.3),
    }, notes: ['-0.3"'] },
  })

  // ── 7. Deduction adjustments
  const baseDed = input.base.deductions
  if (baseDed !== null) {
    out.push({
      type: 'deduction_reduce',
      params: {
        overrides: { deductions: Number(Math.max(0, baseDed - 2).toFixed(1)) },
        notes: ['-2"'],
      },
    })
    out.push({
      type: 'deduction_increase',
      params: {
        overrides: { deductions: Number((baseDed + 2).toFixed(1)) },
        notes: ['+2"'],
      },
    })
  }

  // ── 8. Swap sides (catches left/right mis-association)
  out.push({
    type: 'swap_sides',
    params: { swapSides: true, notes: [] },
  })

  // ── 9. Combo: scale + symmetrize (weak reference path)
  if (weakRef) {
    out.push({
      type: 'combo',
      params: {
        scale: 0.97,
        symmetrize: { family: 'beam', strength: 0.4 },
        notes: ['Scale -3% + symmetrize beams'],
      },
    })
    out.push({
      type: 'combo',
      params: {
        scale: 1.03,
        symmetrize: { family: 'beam', strength: 0.4 },
        notes: ['Scale +3% + symmetrize beams'],
      },
    })
  }

  // Cap to maxCandidates (diversity-first ordering preserved)
  return out.slice(0, settings.maxCandidates)
}

/** Safely add a delta to a nullable measurement value */
function safeAdd(v: number | null | undefined, delta: number): number | null {
  if (v === null || v === undefined) return null
  return Number((v + delta).toFixed(1))
}

/**
 * Get a clear human-readable label for a hypothesis (used in UI and logs).
 * Each named type gets its own distinct label — no repeated "scale" entries.
 */
export function describeHypothesis(type: HypothesisType, params: HypothesisParams): string {
  const tag = params.notes?.filter(n => n && n !== 'small').join(', ') ?? ''

  switch (type) {
    // ── Scale
    case 'scale_up': {
      const pct = params.scale ? Math.round((params.scale - 1) * 100) : 0
      const size = params.notes?.includes('small') ? 'Fine' : 'Coarse'
      return `Scale Up +${pct}% (${size})`
    }
    case 'scale_down': {
      const pct = params.scale ? Math.round((1 - params.scale) * 100) : 0
      const size = params.notes?.includes('small') ? 'Fine' : 'Coarse'
      return `Scale Down -${pct}% (${size})`
    }
    case 'scale':
      if (params.scale === undefined) return 'Scale (unchanged)'
      return params.scale >= 1
        ? `Scale +${Math.round((params.scale - 1) * 100)}%`
        : `Scale -${Math.round((1 - params.scale) * 100)}%`

    // ── Spread
    case 'spread_expand': return `Expand Spread ${tag}`
    case 'spread_reduce': return `Reduce Spread ${tag}`
    case 'spread':        return `Adjust Spread${tag ? ` ${tag}` : ''}`

    // ── Beam
    case 'beam_extend': return `Increase Beam Length ${tag}`
    case 'beam_reduce': return `Reduce Beam Length ${tag}`
    case 'beam':        return `Adjust Beam Length${tag ? ` ${tag}` : ''}`

    // ── Tine
    case 'tine_extend': return `Increase Tine Lengths ${tag}`
    case 'tine_reduce': return `Reduce Tine Lengths ${tag}`
    case 'tine':        return `Adjust Tines${tag ? ` ${tag}` : ''}`

    // ── Mass / circumference
    case 'mass_boost':  return `Increase Mass (Circumference) ${tag}`
    case 'mass_reduce': return `Reduce Mass (Circumference) ${tag}`
    case 'mass':        return `Adjust Mass${tag ? ` ${tag}` : ''}`

    // ── Symmetry
    case 'symmetry_beam': return `Symmetrize Beams ${tag}`
    case 'symmetry_tine': return `Symmetrize Tines ${tag}`

    // ── Deductions
    case 'deduction_reduce':   return `Reduce Deductions ${tag}`
    case 'deduction_increase': return `Increase Deductions ${tag}`
    case 'deduction':          return `Adjust Deductions${tag ? ` ${tag}` : ''}`

    // ── Special
    case 'swap_sides': return 'Swap Left / Right Measurements'
    case 'combo':      return params.notes?.join(' + ') || 'Combination Adjustment'

    // ── Baseline
    case 'noop': return 'Baseline (No Changes)'

    default: return type
  }
}
