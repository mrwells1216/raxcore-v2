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
      swapped[l] = m[r]
      swapped[r] = m[l]
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
        (over as Record<string, unknown>)[key] = val
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
 * Generate hypothesis candidates based on baseline and error decomposition
 */
export function generateHypotheses(input: {
  base: Measurements
  baseConfidence: number
  referenceQuality: number
  settings?: Partial<typeof DEFAULT_REVERSE_SETTINGS>
}): Array<{ type: HypothesisType; params: HypothesisParams }> {
  const settings = { ...DEFAULT_REVERSE_SETTINGS, ...(input.settings ?? {}) }

  const out: Array<{ type: HypothesisType; params: HypothesisParams }> = []
  
  // Always include baseline (no-op)
  out.push({ type: 'noop', params: { notes: ['Baseline (no-op)'] } })

  // Scale hypotheses - more options when reference is weak
  const weakRef = input.referenceQuality < 0.6
  const scaleFactors = weakRef ? settings.scaleFactorsWeak : settings.scaleFactorsStrong
  for (const s of scaleFactors) {
    if (s === 1.0) continue
    out.push({ 
      type: 'scale', 
      params: { scale: s, notes: [`Scale factor ${s}`] } 
    })
  }

  // Spread delta hypotheses
  for (const d of settings.spreadDeltas) {
    const baseSpread = input.base.inside_spread
    if (baseSpread === null) continue
    out.push({
      type: 'spread',
      params: { 
        overrides: { inside_spread: Number((baseSpread + d).toFixed(1)) }, 
        notes: [`Spread delta ${d}"`] 
      }
    })
  }

  // Beam delta hypotheses
  for (const d of settings.beamDeltas) {
    const baseLeft = input.base.main_beam_left
    const baseRight = input.base.main_beam_right
    if (baseLeft === null || baseRight === null) continue
    out.push({
      type: 'beam',
      params: {
        overrides: {
          main_beam_left: Number((baseLeft + d).toFixed(1)),
          main_beam_right: Number((baseRight + d).toFixed(1)),
        },
        notes: [`Beam delta ${d}" both sides`],
      }
    })
  }

  // Symmetry smoothing (for perspective-confounded asymmetry)
  out.push({ 
    type: 'combo', 
    params: { symmetrize: { family: 'beam', strength: 0.6 }, notes: ['Symmetrize beams 0.6'] } 
  })
  out.push({ 
    type: 'combo', 
    params: { symmetrize: { family: 'tine', strength: 0.6 }, notes: ['Symmetrize tines 0.6'] } 
  })

  // Deduction tweaks
  for (const d of settings.deductionDeltas) {
    const baseDed = input.base.deductions
    if (baseDed === null) continue
    out.push({
      type: 'deduction',
      params: {
        overrides: { deductions: Number((baseDed + d).toFixed(1)) },
        notes: [`Deductions delta ${d}"`],
      }
    })
  }

  // Swap sides (rare but catches left/right mis-association)
  out.push({ 
    type: 'swap_sides', 
    params: { swapSides: true, notes: ['Swap left/right measurements'] } 
  })

  // Combo: scale + symmetrize (for weak reference + asymmetry confound)
  if (weakRef) {
    out.push({
      type: 'combo',
      params: {
        scale: 0.97,
        symmetrize: { family: 'beam', strength: 0.4 },
        notes: ['Scale 0.97 + symmetrize beams 0.4'],
      }
    })
    out.push({
      type: 'combo',
      params: {
        scale: 1.03,
        symmetrize: { family: 'beam', strength: 0.4 },
        notes: ['Scale 1.03 + symmetrize beams 0.4'],
      }
    })
  }

  // Cap to max candidates (keep diversity-first ordering)
  return out.slice(0, settings.maxCandidates)
}

/**
 * Get hypothesis description for display
 */
export function describeHypothesis(type: HypothesisType, params: HypothesisParams): string {
  const notes = params.notes?.join('; ') || ''
  
  switch (type) {
    case 'noop':
      return 'Baseline (no changes)'
    case 'scale':
      return `Scale by ${params.scale?.toFixed(3) ?? '?'}`
    case 'spread':
      return `Adjust spread${notes ? `: ${notes}` : ''}`
    case 'beam':
      return `Adjust beams${notes ? `: ${notes}` : ''}`
    case 'tine':
      return `Adjust tines${notes ? `: ${notes}` : ''}`
    case 'mass':
      return `Adjust mass${notes ? `: ${notes}` : ''}`
    case 'deduction':
      return `Adjust deductions${notes ? `: ${notes}` : ''}`
    case 'swap_sides':
      return 'Swap left/right measurements'
    case 'combo':
      return notes || 'Combination adjustment'
    default:
      return type
  }
}
