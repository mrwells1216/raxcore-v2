import type { Measurements } from '@/lib/types'

export type ReferenceType =
  | 'none'
  | 'ruler'
  | 'credit_card'
  | 'coin'
  | 'aruco_marker'
  | 'other_known_object'

export type ReferenceModeSummary = {
  precisionModeEnabled: boolean
  referenceType: ReferenceType
  referencePresent: boolean
  referenceNotes: string | null
  supportsScaleCalibration: boolean
}

export type PrecisionReferenceObservation = {
  detected?: boolean
  type?: string | null
  quality?: number | null
  distortion?: number | null
  estimated_long_edge_inches?: number | null
  estimated_short_edge_inches?: number | null
  estimated_diameter_inches?: number | null
  visible_span_inches?: number | null
  notes?: string[] | null
}

export type PrecisionReferenceDimension = {
  label: string
  inches: number
  observationField:
    | 'estimated_long_edge_inches'
    | 'estimated_short_edge_inches'
    | 'estimated_diameter_inches'
  weight: number
}

export type PrecisionReferenceProfile = {
  summary: ReferenceModeSummary
  typeLabel: string
  hardScaleEligible: boolean
  knownDimensions: PrecisionReferenceDimension[]
  promptBlock: string | null
  confidenceBoost: number
  notes: string[]
}

export type PrecisionReferenceScaleResult = {
  applied: boolean
  detected: boolean
  referenceType: ReferenceType
  scaleFactor: number
  adjustedMeasurements: Measurements
  confidenceBoost: number
  qualityScore: number
  dominantMeasurement: string | null
  summary: string
  notes: string[]
}

const CREDIT_CARD_DIMENSIONS: PrecisionReferenceDimension[] = [
  {
    label: 'credit card long edge',
    inches: 3.37,
    observationField: 'estimated_long_edge_inches',
    weight: 0.65,
  },
  {
    label: 'credit card short edge',
    inches: 2.125,
    observationField: 'estimated_short_edge_inches',
    weight: 0.35,
  },
]

const COIN_DIAMETERS: Record<string, { label: string; inches: number }> = {
  quarter: { label: 'US quarter diameter', inches: 0.955 },
  nickel: { label: 'US nickel diameter', inches: 0.835 },
  dime: { label: 'US dime diameter', inches: 0.705 },
  penny: { label: 'US penny diameter', inches: 0.75 },
}

const SCALE_MIN = 0.82
const SCALE_MAX = 1.18
const MIN_REFERENCE_QUALITY = 0.55

export function buildReferenceModeSummary(params: {
  precisionModeEnabled?: boolean | null
  referenceType?: ReferenceType | null
  referenceNotes?: string | null
}): ReferenceModeSummary {
  const precisionModeEnabled = Boolean(params.precisionModeEnabled)
  const referenceType = params.referenceType ?? 'none'
  const referenceNotes =
    typeof params.referenceNotes === 'string' && params.referenceNotes.trim()
      ? params.referenceNotes.trim()
      : null

  const referencePresent =
    precisionModeEnabled && referenceType !== 'none'

  const supportsScaleCalibration = referencePresent

  return {
    precisionModeEnabled,
    referenceType,
    referencePresent,
    referenceNotes,
    supportsScaleCalibration,
  }
}

export function buildPrecisionReferenceProfile(params: {
  precisionModeEnabled?: boolean | null
  referenceType?: ReferenceType | null
  referenceNotes?: string | null
}): PrecisionReferenceProfile | null {
  const summary = buildReferenceModeSummary(params)
  if (!summary.referencePresent) return null

  const noteText = summary.referenceNotes ?? ''
  const noteMeasurements = extractMeasurementsInInches(noteText)
  const notes: string[] = []
  let typeLabel = summary.referenceType.replaceAll('_', ' ')
  let knownDimensions: PrecisionReferenceDimension[] = []

  switch (summary.referenceType) {
    case 'credit_card':
      typeLabel = 'credit card'
      knownDimensions = CREDIT_CARD_DIMENSIONS
      notes.push('Use ISO ID-1 card dimensions as a hard scale anchor.')
      break
    case 'ruler':
      typeLabel = 'ruler or tape measure'
      notes.push('Use visible ruler graduations as a hard scale anchor when markings are readable.')
      break
    case 'aruco_marker': {
      typeLabel = 'printed fiducial marker'
      const parsedEdge = noteMeasurements[0]
      if (parsedEdge) {
        knownDimensions = [
          {
            label: 'fiducial marker edge',
            inches: parsedEdge,
            observationField: 'estimated_long_edge_inches',
            weight: 1,
          },
        ]
        notes.push(`Use the printed marker edge length of ${parsedEdge.toFixed(2)}".`)
      } else {
        notes.push('Marker selected, but no printed edge size was provided in notes.')
      }
      break
    }
    case 'coin': {
      typeLabel = 'coin'
      const matchedCoin = findCoinDiameter(noteText)
      if (matchedCoin) {
        knownDimensions = [
          {
            label: matchedCoin.label,
            inches: matchedCoin.inches,
            observationField: 'estimated_diameter_inches',
            weight: 1,
          },
        ]
        notes.push(`Use ${matchedCoin.label.toLowerCase()} as the hard circular reference.`)
      } else {
        notes.push('Coin selected, but denomination was not specified in notes.')
      }
      break
    }
    case 'other_known_object': {
      typeLabel = 'known-size object'
      if (noteMeasurements.length >= 2) {
        const sorted = [...noteMeasurements].sort((a, b) => b - a)
        knownDimensions = [
          {
            label: 'object long edge',
            inches: sorted[0],
            observationField: 'estimated_long_edge_inches',
            weight: 0.65,
          },
          {
            label: 'object short edge',
            inches: sorted[1],
            observationField: 'estimated_short_edge_inches',
            weight: 0.35,
          },
        ]
      } else if (noteMeasurements.length === 1) {
        knownDimensions = [
          {
            label: 'known object span',
            inches: noteMeasurements[0],
            observationField: 'estimated_long_edge_inches',
            weight: 1,
          },
        ]
      }
      if (knownDimensions.length > 0) {
        notes.push('Use the user-specified object dimensions as a hard scale anchor.')
      } else {
        notes.push('Known-size object selected, but exact dimensions were not provided in notes.')
      }
      break
    }
    default:
      break
  }

  const hardScaleEligible =
    summary.referenceType === 'ruler'
      ? true
      : knownDimensions.length > 0

  const promptLines: string[] = [
    `Reference type: ${typeLabel}.`,
  ]

  if (summary.referenceNotes) {
    promptLines.push(`User notes: ${summary.referenceNotes}`)
  }

  if (summary.referenceType === 'ruler') {
    promptLines.push(
      'If ruler or tape marks are readable, use those markings as the primary scale anchor instead of anatomy.'
    )
    promptLines.push(
      'When marks are readable, set visible_span_inches to the actual readable span and estimated_long_edge_inches to how long that same ruler span would measure under your current non-reference anatomical scale.'
    )
  } else if (knownDimensions.length > 0) {
    const dimensionSummary = knownDimensions
      .map((dimension) => `${dimension.label} = ${dimension.inches.toFixed(3)}"`)
      .join('; ')
    promptLines.push(
      `Known dimensions: ${dimensionSummary}. If this object is clearly visible, it outranks ear and eye scaling.`
    )
    promptLines.push(
      'Return the reference object edge or diameter estimate under your current non-reference anatomical scale so downstream calibration can correct the rack.'
    )
  } else {
    promptLines.push(
      'Use this object only as a secondary cue unless its exact size can be read directly in the image.'
    )
  }

  return {
    summary,
    typeLabel,
    hardScaleEligible,
    knownDimensions,
    promptBlock: promptLines.join(' '),
    confidenceBoost: hardScaleEligible ? 6 : 3,
    notes,
  }
}

export function applyPrecisionReferenceScaling(params: {
  profile: PrecisionReferenceProfile | null | undefined
  observation?: PrecisionReferenceObservation | null
  measurements: Measurements
}): PrecisionReferenceScaleResult {
  const profile = params.profile ?? null
  const observation = params.observation ?? null
  const referenceType = profile?.summary.referenceType ?? 'none'
  const defaultResult: PrecisionReferenceScaleResult = {
    applied: false,
    detected: Boolean(observation?.detected),
    referenceType,
    scaleFactor: 1,
    adjustedMeasurements: params.measurements,
    confidenceBoost: 0,
    qualityScore: 0,
    dominantMeasurement: null,
    summary: 'No precision reference scaling applied.',
    notes: [],
  }

  if (!profile || !profile.summary.referencePresent) {
    return defaultResult
  }

  const quality = clamp(Number(observation?.quality ?? 0), 0, 1)
  const distortion = clamp(Number(observation?.distortion ?? 0.35), 0, 1)
  const qualityScore = clamp(quality * (1 - distortion), 0, 1)

  if (!observation?.detected) {
    return {
      ...defaultResult,
      qualityScore,
      summary: `Precision reference selected (${profile.typeLabel}) but not confidently detected.`,
      notes: [...profile.notes],
    }
  }

  if (!profile.hardScaleEligible || qualityScore < MIN_REFERENCE_QUALITY) {
    const summary = profile.hardScaleEligible
      ? `Precision reference detected, but quality ${(qualityScore * 100).toFixed(0)}% was too weak for hard rescaling.`
      : `Precision reference detected (${profile.typeLabel}), but only prompt-level guidance was available.`

    return {
      ...defaultResult,
      detected: true,
      qualityScore,
      confidenceBoost: qualityScore >= 0.65 ? Math.min(3, profile.confidenceBoost) : 0,
      summary,
      notes: [...profile.notes],
    }
  }

  const candidates: Array<{
    label: string
    scaleFactor: number
    weight: number
  }> = []

  if (profile.summary.referenceType === 'ruler') {
    const visibleSpan = observation?.visible_span_inches
    const anatomicalEstimate =
      observation?.estimated_long_edge_inches ??
      observation?.estimated_short_edge_inches

    if (
      typeof visibleSpan === 'number' &&
      Number.isFinite(visibleSpan) &&
      visibleSpan > 0 &&
      typeof anatomicalEstimate === 'number' &&
      Number.isFinite(anatomicalEstimate) &&
      anatomicalEstimate > 0
    ) {
      const rawScale = visibleSpan / anatomicalEstimate
      if (Number.isFinite(rawScale) && rawScale >= 0.6 && rawScale <= 1.4) {
        candidates.push({
          label: 'readable ruler span',
          scaleFactor: rawScale,
          weight: qualityScore,
        })
      }
    }
  } else {
    for (const dimension of profile.knownDimensions) {
      const observedValue = observation?.[dimension.observationField]
      if (typeof observedValue !== 'number' || !Number.isFinite(observedValue) || observedValue <= 0) {
        continue
      }

      const rawScale = dimension.inches / observedValue
      if (!Number.isFinite(rawScale) || rawScale < 0.6 || rawScale > 1.4) {
        continue
      }

      candidates.push({
        label: dimension.label,
        scaleFactor: rawScale,
        weight: dimension.weight * qualityScore,
      })
    }
  }

  if (!candidates.length) {
    return {
      ...defaultResult,
      detected: true,
      qualityScore,
      summary: `Precision reference detected (${profile.typeLabel}), but no usable scale observation was returned.`,
      notes: [...profile.notes],
    }
  }

  const totalWeight = candidates.reduce((sum, candidate) => sum + candidate.weight, 0) || 1
  const combinedScale = candidates.reduce(
    (sum, candidate) => sum + candidate.scaleFactor * candidate.weight,
    0,
  ) / totalWeight

  const clampedScale = clamp(combinedScale, SCALE_MIN, SCALE_MAX)
  const dominant = candidates.reduce((best, current) =>
    current.weight > best.weight ? current : best,
  )

  return {
    applied: Math.abs(clampedScale - 1) >= 0.01,
    detected: true,
    referenceType,
    scaleFactor: Number(clampedScale.toFixed(4)),
    adjustedMeasurements: scaleMeasurements(params.measurements, clampedScale),
    confidenceBoost: profile.confidenceBoost,
    qualityScore: Number(qualityScore.toFixed(3)),
    dominantMeasurement: dominant.label,
    summary:
      Math.abs(clampedScale - 1) >= 0.01
        ? `Applied ${profile.typeLabel} scale correction (${formatPercentDelta(clampedScale)}).`
        : `Detected ${profile.typeLabel}, but scale adjustment was negligible.`,
    notes: [
      ...profile.notes,
      `Dominant reference measurement: ${dominant.label}.`,
    ],
  }
}

function scaleMeasurements(measurements: Measurements, scaleFactor: number): Measurements {
  const adjusted = { ...measurements }
  for (const [field, value] of Object.entries(adjusted)) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      ;(adjusted as Record<string, number | null>)[field] = Number((value * scaleFactor).toFixed(1))
    }
  }
  return adjusted
}

function findCoinDiameter(notes: string): { label: string; inches: number } | null {
  const normalized = notes.toLowerCase()
  for (const [keyword, value] of Object.entries(COIN_DIAMETERS)) {
    if (normalized.includes(keyword)) {
      return value
    }
  }
  return null
}

function extractMeasurementsInInches(notes: string): number[] {
  const matches = Array.from(
    notes.matchAll(/(\d+(?:\.\d+)?)\s*(mm|millimeters?|millimetres?|cm|centimeters?|centimetres?|in|inch|inches|")/gi),
  )

  return matches
    .map((match) => toInches(Number(match[1]), match[2]))
    .filter((value): value is number => Number.isFinite(value) && value > 0)
}

function toInches(value: number, unitRaw: string): number {
  const unit = unitRaw.toLowerCase()
  if (unit === 'mm' || unit.startsWith('millimeter') || unit.startsWith('millimetre')) {
    return value / 25.4
  }
  if (unit === 'cm' || unit.startsWith('centimeter') || unit.startsWith('centimetre')) {
    return value / 2.54
  }
  return value
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function formatPercentDelta(scaleFactor: number): string {
  const percent = (scaleFactor - 1) * 100
  return `${percent >= 0 ? '+' : ''}${percent.toFixed(1)}%`
}
