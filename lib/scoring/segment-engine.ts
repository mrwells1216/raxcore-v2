/**
 * Phase 41: Elite Segmented Calibration Engine
 *
 * Responsibility:
 *   1. Classify an incoming scoring request into a set of matching segments
 *   2. Gate each segment by sample-size + stability thresholds
 *   3. Blend their calibration values (multiplier, bias, confidence_adjustment)
 *      into a single SegmentedCalibration object consumed by the score pipeline
 *   4. Persist an audit log row (prediction_segment_log) for every prediction
 */

import { createClient } from '@/lib/supabase/server'
import type { SourceType } from '@/lib/types'
import { HIGH_OUTPUT_STATES, LOW_OUTPUT_STATES, MIDWEST_STATES, PLAINS_STATES, NORTHEAST_STATES, SOUTH_STATES, WEST_STATES } from '@/lib/constants'

// ============================================================================
// CONSTANTS — data-quality gates
// ============================================================================

/** Minimum recorded samples before a segment can influence calibration */
const GATE_MIN_SAMPLES = 30

/** Minimum rolling stability score (0–1 MAE stability) before activation */
const GATE_MIN_STABILITY = 0.55

/** Max allowed weight for any single segment (prevents a noisy segment dominating) */
const MAX_SINGLE_WEIGHT = 0.85

// ============================================================================
// TYPES
// ============================================================================

export type ImageCountTier = 'single' | 'few' | 'many'
export type AngleQuality = 'weak' | 'usable' | 'strong'
export type Region = 'midwest' | 'south' | 'northeast' | 'plains' | 'west' | 'other'
export type ReferenceVisibility = 'strong' | 'partial' | 'weak'
export type LightingQuality = 'normal' | 'low_light' | 'harsh_shadow'

export interface SegmentContext {
  sourceType?: string
  imageCount: number
  angleDiversity: number       // 0–1
  rackType: 'typical' | 'non-typical'
  state: string
  earsFullyVisible?: boolean
  captureDevice?: string
  // These come from vision output when available
  referenceVisibility?: ReferenceVisibility
  lightingQuality?: LightingQuality
}

export interface SegmentCalibrationValue {
  measurementType: 'spread' | 'beam' | 'tine' | 'mass' | 'deduction'
  multiplier: number
  bias: number
  confidenceAdjustment: number
}

export interface SegmentedCalibration {
  /** Blended multiplier per measurement type */
  multipliers: Record<string, number>
  /** Blended additive bias per measurement type */
  biases: Record<string, number>
  /** Net confidence point adjustment to apply after calibration */
  confidenceAdjustment: number
  /** Ordered list of matched segments and their effective weights */
  matchedSegments: Array<{
    id: string
    name: string
    segmentType: string
    level: number
    effectiveWeight: number
    gated: boolean
    gateReason?: string
  }>
  /** Whether any non-global segment contributed */
  hasSpecificSegments: boolean
  /** Combined sample count across contributing segments */
  totalSampleCount: number
}

interface DbSegment {
  id: string
  name: string
  description: string | null
  parent_id: string | null
  level: number
  segment_type: string
  conditions: Record<string, unknown>
  sample_size: number
  stability_score: number
  activation_weight: number
  enabled: boolean
}

interface DbCalibrationValue {
  segment_id: string
  measurement_type: string
  multiplier: number
  bias: number
  confidence_adjustment: number
}

// ============================================================================
// SEGMENT CONTEXT DERIVATION
// ============================================================================

export function deriveImageCountTier(count: number): ImageCountTier {
  if (count <= 1) return 'single'
  if (count <= 3) return 'few'
  return 'many'
}

export function deriveAngleQuality(angleDiversity: number): AngleQuality {
  if (angleDiversity >= 0.75) return 'strong'
  if (angleDiversity >= 0.4) return 'usable'
  return 'weak'
}

export function deriveRegion(state: string): Region {
  if ((MIDWEST_STATES as readonly string[]).includes(state)) return 'midwest'
  if ((SOUTH_STATES as readonly string[]).includes(state)) return 'south'
  if ((NORTHEAST_STATES as readonly string[]).includes(state)) return 'northeast'
  if ((PLAINS_STATES as readonly string[]).includes(state)) return 'plains'
  if ((WEST_STATES as readonly string[]).includes(state)) return 'west'
  return 'other'
}

// ============================================================================
// CONDITION MATCHING
// ============================================================================

function matchesConditions(
  conditions: Record<string, unknown>,
  ctx: SegmentContext & {
    imageCountTier: ImageCountTier
    angleQuality: AngleQuality
    region: Region
  }
): boolean {
  // Global segment — always matches
  if (Object.keys(conditions).length === 0) return true

  for (const [key, value] of Object.entries(conditions)) {
    switch (key) {
      case 'source_type': {
        const allowed = Array.isArray(value) ? value : [value]
        if (!ctx.sourceType || !allowed.includes(ctx.sourceType)) return false
        break
      }
      case 'image_count_tier': {
        if (ctx.imageCountTier !== value) return false
        break
      }
      case 'angle_quality': {
        if (ctx.angleQuality !== value) return false
        break
      }
      case 'rack_type': {
        if (ctx.rackType !== value) return false
        break
      }
      case 'region': {
        if (ctx.region !== value) return false
        break
      }
      // PATCH C: explicit state matching
      case 'state': {
        const allowed = Array.isArray(value) ? value : [value]
        const normalised = ctx.state?.toUpperCase()
        if (!normalised || !allowed.map(s => String(s).toUpperCase()).includes(normalised)) return false
        break
      }
      case 'reference_visibility': {
        if (!ctx.referenceVisibility || ctx.referenceVisibility !== value) return false
        break
      }
      case 'lighting_quality': {
        if (!ctx.lightingQuality || ctx.lightingQuality !== value) return false
        break
      }
      default:
        // Unknown condition key — fail safe (do not match)
        return false
    }
  }
  return true
}

// ============================================================================
// DATA GATING
// ============================================================================

function gateSegment(
  seg: DbSegment
): { pass: boolean; reason?: string } {
  // Level-0 global always passes
  if (seg.level === 0) return { pass: true }

  if (seg.sample_size < GATE_MIN_SAMPLES) {
    return {
      pass: false,
      reason: `Insufficient samples (${seg.sample_size} < ${GATE_MIN_SAMPLES})`,
    }
  }
  if (seg.stability_score < GATE_MIN_STABILITY) {
    return {
      pass: false,
      reason: `Low stability score (${seg.stability_score.toFixed(2)} < ${GATE_MIN_STABILITY})`,
    }
  }
  return { pass: true }
}

// ============================================================================
// WEIGHT BLENDING — PATCH B + E: evidence-based, parent-aware
// ============================================================================

const MEASUREMENT_TYPES = ['spread', 'beam', 'tine', 'mass', 'deduction'] as const

/**
 * Compute an evidence score for a segment in [0, 1].
 *
 * Evidence = normalised sample size score * stability score, scaled by
 * the segment's own activation_weight cap.
 *
 * State-level segments (level 3+) are additionally penalised unless they
 * have strong evidence, to prevent tiny state sets from dominating.
 */
function evidenceScore(seg: DbSegment): number {
  // Sample size: log-scaled; saturates at 500 samples → 1.0
  const sampleScore = Math.min(1.0, Math.log1p(seg.sample_size) / Math.log1p(500))
  // Stability: direct 0-1
  const stabilityScore = Math.max(0, Math.min(1, seg.stability_score))
  // Combined evidence
  const base = sampleScore * stabilityScore * seg.activation_weight
  // Penalise high-specificity (state) segments unless evidence is strong
  const levelPenalty = seg.level >= 3 ? 0.75 : 1.0
  return base * levelPenalty
}

/**
 * PATCH B: Resolve a segment's calibration values via parent-chain shrinkage.
 *
 * If a child segment has weak evidence (sample_size < SHRINKAGE_THRESHOLD),
 * its calibration values are shrunk toward its parent's values proportionally.
 * If parent is unavailable, shrink toward global (identity).
 *
 * shrinkage_factor = 1 - clamp(sample_size / SHRINKAGE_THRESHOLD, 0, 1)
 *   → 0 means use child fully, 1 means use parent fully
 */
const SHRINKAGE_THRESHOLD = 200 // samples needed before a child stands on its own

function resolveWithShrinkage(
  seg: DbSegment,
  mt: string,
  allSegments: DbSegment[],
  valuesBySegment: Map<string, DbCalibrationValue[]>,
  visited = new Set<string>()
): { multiplier: number; bias: number; confidenceAdjustment: number } {
  const IDENTITY = { multiplier: 1.0, bias: 0.0, confidenceAdjustment: 0.0 }

  if (visited.has(seg.id)) return IDENTITY
  visited.add(seg.id)

  const vals = valuesBySegment.get(seg.id) ?? []
  const ownVal = vals.find(v => v.measurement_type === mt)
  const own = ownVal
    ? { multiplier: ownVal.multiplier, bias: ownVal.bias, confidenceAdjustment: ownVal.confidence_adjustment }
    : IDENTITY

  // Level 0 (global) — no shrinkage
  if (seg.level === 0) return own

  // Compute shrinkage factor: high when samples are few
  const shrinkage = Math.max(0, 1 - Math.min(1, seg.sample_size / SHRINKAGE_THRESHOLD))
  if (shrinkage < 0.001) return own // fully independent

  // Find parent
  const parent = seg.parent_id ? allSegments.find(s => s.id === seg.parent_id) : null
  const parentVal = parent
    ? resolveWithShrinkage(parent, mt, allSegments, valuesBySegment, visited)
    : IDENTITY

  // Blend child toward parent
  return {
    multiplier: own.multiplier * (1 - shrinkage) + parentVal.multiplier * shrinkage,
    bias: own.bias * (1 - shrinkage) + parentVal.bias * shrinkage,
    confidenceAdjustment: own.confidenceAdjustment * (1 - shrinkage) + parentVal.confidenceAdjustment * shrinkage,
  }
}

/**
 * PATCH E: Compute evidence-based blend weights, using each segment's
 * evidence score as the raw weight instead of fixed per-level pools.
 *
 * Safety caps:
 *  - Global always receives at least MIN_GLOBAL_WEIGHT
 *  - No single non-global segment exceeds MAX_SINGLE_WEIGHT
 *  - Weights are normalised to sum to 1.0
 */
const MIN_GLOBAL_WEIGHT = 0.10

function computeBlendWeights(
  passing: DbSegment[]
): Map<string, number> {
  const weights = new Map<string, number>()
  const global = passing.find(s => s.level === 0)
  const nonGlobal = passing.filter(s => s.level > 0)

  // Compute raw evidence scores for non-global segments
  const rawScores = new Map<string, number>()
  let totalRaw = 0
  for (const seg of nonGlobal) {
    const score = evidenceScore(seg)
    rawScores.set(seg.id, score)
    totalRaw += score
  }

  // Allocate up to (1 - MIN_GLOBAL_WEIGHT) to non-global segments
  const nonGlobalBudget = 1 - MIN_GLOBAL_WEIGHT
  for (const seg of nonGlobal) {
    const rawScore = rawScores.get(seg.id) ?? 0
    const proportional = totalRaw > 0 ? (rawScore / totalRaw) * nonGlobalBudget : 0
    weights.set(seg.id, Math.min(proportional, MAX_SINGLE_WEIGHT))
  }

  // Global fills remaining budget (always at least MIN_GLOBAL_WEIGHT)
  if (global) {
    const used = Array.from(weights.values()).reduce((s, v) => s + v, 0)
    const remaining = Math.max(MIN_GLOBAL_WEIGHT, 1 - used)
    weights.set(global.id, remaining)
  }

  // Final normalisation pass to ensure sum == 1.0
  const total = Array.from(weights.values()).reduce((s, v) => s + v, 0)
  if (total > 0 && Math.abs(total - 1.0) > 0.001) {
    for (const [id, w] of weights) {
      weights.set(id, w / total)
    }
  }

  return weights
}

// ============================================================================
// BLENDED CALIBRATION COMPUTATION — uses parent-chain shrinkage per value
// ============================================================================

function buildBlendedCalibration(
  passing: DbSegment[],
  allSegments: DbSegment[],
  weights: Map<string, number>,
  valuesBySegment: Map<string, DbCalibrationValue[]>
): Pick<SegmentedCalibration, 'multipliers' | 'biases' | 'confidenceAdjustment'> {
  const multipliers: Record<string, number> = {}
  const biases: Record<string, number> = {}
  let totalConfAdj = 0
  let totalConfWeight = 0

  for (const mt of MEASUREMENT_TYPES) {
    let blendedMult = 0
    let blendedBias = 0
    let totalWeight = 0

    for (const seg of passing) {
      const w = weights.get(seg.id) ?? 0
      if (w <= 0) continue
      // PATCH B: use shrinkage-resolved values, not raw DB values
      const resolved = resolveWithShrinkage(seg, mt, allSegments, valuesBySegment)
      blendedMult += resolved.multiplier * w
      blendedBias += resolved.bias * w
      totalWeight += w
    }

    multipliers[mt] = totalWeight > 0 ? blendedMult / totalWeight : 1.0
    biases[mt] = totalWeight > 0 ? blendedBias / totalWeight : 0.0
  }

  // Confidence adjustment: weighted average using shrinkage-resolved values
  for (const seg of passing) {
    const w = weights.get(seg.id) ?? 0
    if (w <= 0) continue
    // Average across measurement types for a single conf adjustment per segment
    let segConfSum = 0
    for (const mt of MEASUREMENT_TYPES) {
      const resolved = resolveWithShrinkage(seg, mt, allSegments, valuesBySegment)
      segConfSum += resolved.confidenceAdjustment
    }
    totalConfAdj += (segConfSum / MEASUREMENT_TYPES.length) * w
    totalConfWeight += w
  }

  const confidenceAdjustment = totalConfWeight > 0 ? totalConfAdj / totalConfWeight : 0

  return { multipliers, biases, confidenceAdjustment }
}

// ============================================================================
// PUBLIC API — resolveSegments
// ============================================================================

/** Fetch all enabled segments + their calibration values (with short-lived cache) */
let _segmentCache: { segments: DbSegment[]; values: Map<string, DbCalibrationValue[]> } | null = null
let _segmentCacheTs = 0
const SEGMENT_CACHE_TTL = 60_000 // 60 s

async function loadSegments(): Promise<{
  segments: DbSegment[]
  values: Map<string, DbCalibrationValue[]>
}> {
  const now = Date.now()
  if (_segmentCache && now - _segmentCacheTs < SEGMENT_CACHE_TTL) {
    return _segmentCache
  }

  const supabase = await createClient()

  const [segRes, valRes] = await Promise.all([
    supabase
      .from('calibration_segments')
      .select('id,name,description,parent_id,level,segment_type,conditions,sample_size,stability_score,activation_weight,enabled')
      .eq('enabled', true),
    supabase
      .from('calibration_values')
      .select('segment_id,measurement_type,multiplier,bias,confidence_adjustment'),
  ])

  const segments: DbSegment[] = segRes.data ?? []
  const values = new Map<string, DbCalibrationValue[]>()
  for (const v of (valRes.data ?? []) as DbCalibrationValue[]) {
    const existing = values.get(v.segment_id) ?? []
    existing.push(v)
    values.set(v.segment_id, existing)
  }

  _segmentCache = { segments, values }
  _segmentCacheTs = now
  return _segmentCache
}

/** Invalidate the in-memory segment cache (call after admin edits) */
export function invalidateSegmentCache(): void {
  _segmentCache = null
  _segmentCacheTs = 0
}

/**
 * Resolve the blended segmented calibration for a scoring request.
 * Returns identity calibration (multiplier=1, bias=0, conf=0) if the DB is
 * unavailable or no segments match — so the pipeline is never blocked.
 */
export async function resolveSegments(ctx: SegmentContext): Promise<SegmentedCalibration> {
  const IDENTITY: SegmentedCalibration = {
    multipliers: Object.fromEntries(MEASUREMENT_TYPES.map(t => [t, 1.0])),
    biases: Object.fromEntries(MEASUREMENT_TYPES.map(t => [t, 0.0])),
    confidenceAdjustment: 0,
    matchedSegments: [],
    hasSpecificSegments: false,
    totalSampleCount: 0,
  }

  try {
    const { segments, values: valuesBySegment } = await loadSegments()

    const imageCountTier = deriveImageCountTier(ctx.imageCount)
    const angleQuality = deriveAngleQuality(ctx.angleDiversity)
    const region = deriveRegion(ctx.state)

    const enrichedCtx = { ...ctx, imageCountTier, angleQuality, region }

    // Step 1: find all matching segments
    const matched: DbSegment[] = []
    for (const seg of segments) {
      if (matchesConditions(seg.conditions as Record<string, unknown>, enrichedCtx)) {
        matched.push(seg)
      }
    }

    if (matched.length === 0) return IDENTITY

    // Step 2: gate segments
    const passing: DbSegment[] = []
    const gatedInfo: Array<{ seg: DbSegment; reason: string }> = []
    for (const seg of matched) {
      const gate = gateSegment(seg)
      if (gate.pass) {
        passing.push(seg)
      } else {
        gatedInfo.push({ seg, reason: gate.reason! })
      }
    }

    // Always keep global even if gated (it's the identity fallback)
    const globalSeg = matched.find(s => s.level === 0)
    if (globalSeg && !passing.includes(globalSeg)) {
      passing.push(globalSeg)
    }

    // Step 3: compute evidence-based blend weights (PATCH E)
    const weights = computeBlendWeights(passing)

    // Step 4: blend calibration values with parent-chain shrinkage (PATCH B)
    const { multipliers, biases, confidenceAdjustment } = buildBlendedCalibration(
      passing,
      segments, // full segment list needed for parent chain traversal
      weights,
      valuesBySegment
    )

    // Step 5: build matched segment summary
    const matchedSegments = [
      ...passing.map(seg => ({
        id: seg.id,
        name: seg.name,
        segmentType: seg.segment_type,
        level: seg.level,
        effectiveWeight: weights.get(seg.id) ?? 0,
        gated: false,
      })),
      ...gatedInfo.map(({ seg, reason }) => ({
        id: seg.id,
        name: seg.name,
        segmentType: seg.segment_type,
        level: seg.level,
        effectiveWeight: 0,
        gated: true,
        gateReason: reason,
      })),
    ]

    const hasSpecificSegments = passing.some(s => s.level > 0)
    const totalSampleCount = passing.reduce((sum, s) => sum + s.sample_size, 0)

    return {
      multipliers,
      biases,
      confidenceAdjustment,
      matchedSegments,
      hasSpecificSegments,
      totalSampleCount,
    }
  } catch (err) {
    console.error('[segment-engine] resolveSegments error — using identity calibration:', err)
    return IDENTITY
  }
}

// ============================================================================
// PUBLIC API — logPredictionSegments
// ============================================================================

/**
 * Fire-and-forget audit log for which segments were used in a prediction.
 * Never throws.
 */
export function logPredictionSegments(params: {
  buckId?: string | null
  traceId?: string
  calibration: SegmentedCalibration
  calibrationDeltas?: Record<string, unknown>
}): void {
  const passing = params.calibration.matchedSegments.filter(s => !s.gated)
  if (passing.length === 0) return

  createClient().then(supabase => {
    supabase.from('prediction_segment_log').insert({
      buck_id: params.buckId ?? null,
      trace_id: params.traceId ?? null,
      segment_ids: passing.map(s => s.id),
      blend_weights: passing.map(s => s.effectiveWeight),
      calibration_deltas: params.calibrationDeltas ?? {},
    }).then(({ error }) => {
      if (error) console.warn('[segment-engine] logPredictionSegments insert error:', error.message)
    })
  }).catch(() => {/* ignore */})
}

// ============================================================================
// PUBLIC API — applySegmentedCalibration
// ============================================================================

/**
 * Apply the blended segment calibration to a set of raw measurements.
 *
 * Each measurement field is mapped to its category (spread, beam, tine, mass,
 * deduction) and corrected with:
 *   corrected = original * multiplier + bias
 *
 * Returns both corrected measurements and per-field deltas.
 */
export interface SegmentCorrectionResult {
  correctedMeasurements: Record<string, number | null>
  deltas: Record<string, number>
  grossDelta: number
}

const FIELD_CATEGORY_MAP: Record<string, 'spread' | 'beam' | 'tine' | 'mass' | 'deduction'> = {
  inside_spread: 'spread',
  main_beam_left: 'beam',
  main_beam_right: 'beam',
  g1_left: 'tine', g1_right: 'tine',
  g2_left: 'tine', g2_right: 'tine',
  g3_left: 'tine', g3_right: 'tine',
  g4_left: 'tine', g4_right: 'tine',
  g5_left: 'tine', g5_right: 'tine',
  h1_left: 'mass', h1_right: 'mass',
  h2_left: 'mass', h2_right: 'mass',
  h3_left: 'mass', h3_right: 'mass',
  h4_left: 'mass', h4_right: 'mass',
  deductions: 'deduction',
  abnormal_points: 'deduction',
}

export function applySegmentedCalibration(
  measurements: Record<string, number | null>,
  cal: SegmentedCalibration
): SegmentCorrectionResult {
  const correctedMeasurements: Record<string, number | null> = {}
  const deltas: Record<string, number> = {}
  let grossDelta = 0

  for (const [field, rawValue] of Object.entries(measurements)) {
    if (rawValue === null || rawValue === undefined) {
      correctedMeasurements[field] = rawValue
      continue
    }
    const category = FIELD_CATEGORY_MAP[field]
    if (!category) {
      correctedMeasurements[field] = rawValue
      continue
    }
    const mult = cal.multipliers[category] ?? 1.0
    const bias = cal.biases[category] ?? 0.0
    const corrected = Number((rawValue * mult + bias).toFixed(1))
    correctedMeasurements[field] = corrected
    const delta = corrected - rawValue
    deltas[field] = delta
    // Deductions reduce score — sign flip for grossDelta
    if (category === 'deduction') {
      grossDelta -= delta
    } else {
      grossDelta += delta
    }
  }

  return { correctedMeasurements, deltas, grossDelta: Number(grossDelta.toFixed(1)) }
}
