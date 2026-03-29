/**
 * Phase 47: Segment-Aware Confidence Interval System
 *
 * Produces practical confidence intervals and expected error bands tied to:
 * - Segmented context (source type, region, image count, angle quality, rack type)
 * - Geometry consistency score
 * - Landmark/reference quality
 * - Per-measurement-family reliability
 * - Historical validation/residual behavior
 *
 * This system outputs family-level uncertainty and overall score error bands.
 */

import { createClient } from '@/lib/supabase/server'
import type { SegmentContext, SegmentedCalibration } from './segment-engine'
import type { GeometryConsistencyResult } from './geometry-consistency'
import type { TrustScoreResult, TrustTier } from './trust-score'
import type { ConfidenceTier } from './calibrated-confidence'
import type { AngleType, SourceType, Measurements, LandmarksDetected } from '@/lib/types'

// ============================================================================
// TYPES
// ============================================================================

export type MeasurementFamily = 'spread' | 'beam' | 'tine' | 'mass' | 'deduction'

export interface FamilyUncertainty {
  family: MeasurementFamily
  confidenceScore: number // 0-100
  expectedErrorBand: number // +/- inches
  tier: 'high' | 'medium' | 'low' | 'very_low'
  contributingFactors: string[]
  limitingFactors: string[]
}

export interface ConfidenceIntervalProfile {
  id: string
  segmentKey: string
  sampleCount: number
  avgAbsError: number
  medianAbsError: number
  p25Error: number
  p75Error: number
  p90Error: number
  stdDev: number
  lastUpdated: string
}

export interface SegmentConfidenceIntervalResult {
  // Overall score bands
  grossScoreExpectedErrorBand: {
    low: number
    high: number
    expectedValue: number
    width: number
  }
  netScoreExpectedErrorBand: {
    low: number
    high: number
    expectedValue: number
    width: number
  }

  // Calibrated confidence
  calibratedConfidenceTier: ConfidenceTier
  calibratedConfidencePercent: number

  // Trust tier (input quality)
  trustTier: TrustTier

  // Family-level uncertainty
  familyUncertainty: FamilyUncertainty[]
  weakestFamily: MeasurementFamily | null
  strongestFamily: MeasurementFamily | null

  // Explanation
  confidenceExplanationSummary: string
  detailedExplanation: string[]

  // Profile used
  intervalProfileUsed: {
    profileType: 'segment_specific' | 'parent_fallback' | 'global_default'
    segmentName: string | null
    sampleCount: number
    shrinkageFactor: number
  }

  // Raw inputs used
  inputSignals: {
    segmentTotalSamples: number
    geometryConsistencyScore: number
    referenceQuality: number
    angleDiversity: number
    imageCount: number
  }
}

export interface ConfidenceIntervalInput {
  // Raw measurements
  measurements: Measurements
  predictedGross: number
  predictedNet: number

  // Segment calibration result
  segmentCalibration: SegmentedCalibration
  segmentContext: SegmentContext

  // Geometry consistency result
  geometryConsistency: GeometryConsistencyResult

  // Trust score result
  trustScore: TrustScoreResult

  // Image/landmark data
  landmarks: LandmarksDetected
  angleTypes: AngleType[]
  imageCount: number
  angleDiversity: number

  // Optional: raw confidence from vision
  rawVisionConfidence?: number
}

// ============================================================================
// CONSTANTS
// ============================================================================

// Base error expectations by segment sample depth
const BASE_ERROR_BY_SAMPLE_DEPTH = {
  sparse: { avgError: 10.0, p90Error: 18.0 },      // < 30 samples
  limited: { avgError: 7.5, p90Error: 14.0 },      // 30-100 samples
  moderate: { avgError: 6.0, p90Error: 11.0 },     // 100-300 samples
  substantial: { avgError: 4.5, p90Error: 8.5 },   // 300-1000 samples
  deep: { avgError: 3.5, p90Error: 6.5 },          // 1000+ samples
}

// Minimum samples before using segment-specific intervals
const MIN_SEGMENT_SAMPLES_FOR_INTERVAL = 20
const SHRINKAGE_SAMPLE_THRESHOLD = 100

// Family baseline error expectations (inches)
const FAMILY_BASE_ERRORS: Record<MeasurementFamily, { base: number; ceiling: number }> = {
  spread: { base: 1.5, ceiling: 5.0 },
  beam: { base: 1.0, ceiling: 4.0 },
  tine: { base: 0.8, ceiling: 3.5 },
  mass: { base: 0.3, ceiling: 1.5 },
  deduction: { base: 1.5, ceiling: 6.0 },
}

// Angle coverage impact on family confidence
const ANGLE_IMPACT_ON_FAMILY: Record<MeasurementFamily, { requiredAngles: AngleType[]; impact: number }> = {
  spread: { requiredAngles: ['front'], impact: 0.4 },
  beam: { requiredAngles: ['left', 'right'], impact: 0.35 },
  tine: { requiredAngles: ['left', 'right'], impact: 0.3 },
  mass: { requiredAngles: ['left', 'right'], impact: 0.2 },
  deduction: { requiredAngles: ['front', 'left', 'right'], impact: 0.25 },
}

// ============================================================================
// RESIDUAL HISTORY CACHE
// ============================================================================

interface SegmentResidualProfile {
  segmentId: string
  sampleCount: number
  avgAbsGrossError: number
  medianAbsGrossError: number
  p75GrossError: number
  p90GrossError: number
  stdDevGross: number
  avgAbsNetError: number | null
  lastComputedAt: string
  // Family-level if available
  familyErrors?: Partial<Record<MeasurementFamily, {
    avgError: number
    sampleCount: number
  }>>
}

let _residualCache: Map<string, SegmentResidualProfile> = new Map()
let _residualCacheTs = 0
const RESIDUAL_CACHE_TTL = 5 * 60 * 1000 // 5 minutes

async function loadSegmentResidualProfiles(): Promise<Map<string, SegmentResidualProfile>> {
  const now = Date.now()
  if (_residualCache.size > 0 && now - _residualCacheTs < RESIDUAL_CACHE_TTL) {
    return _residualCache
  }

  try {
    const supabase = await createClient()

    // Load from segment_metrics table
    const { data: metrics } = await supabase
      .from('segment_metrics')
      .select('segment_id, avg_abs_gross_error, avg_gross_error, confidence_calib_error, evaluated_at')
      .order('evaluated_at', { ascending: false })
      .limit(500)

    const profiles = new Map<string, SegmentResidualProfile>()

    // Group by segment_id, take latest
    const latestBySegment = new Map<string, typeof metrics extends (infer T)[] ? T : never>()
    for (const m of metrics ?? []) {
      if (!latestBySegment.has(m.segment_id)) {
        latestBySegment.set(m.segment_id, m)
      }
    }

    // Also get validation_results aggregates if available
    const { data: validationAgg } = await supabase
      .from('validation_results')
      .select('state, rack_type, abs_error_gross, abs_error_net, percent_error_gross')
      .not('abs_error_gross', 'is', null)
      .order('created_at', { ascending: false })
      .limit(2000)

    // Build profiles from segment_metrics
    for (const [segId, m] of latestBySegment) {
      profiles.set(segId, {
        segmentId: segId,
        sampleCount: 0, // We'll estimate from other sources
        avgAbsGrossError: m.avg_abs_gross_error ?? 8.0,
        medianAbsGrossError: (m.avg_abs_gross_error ?? 8.0) * 0.85,
        p75GrossError: (m.avg_abs_gross_error ?? 8.0) * 1.3,
        p90GrossError: (m.avg_abs_gross_error ?? 8.0) * 1.8,
        stdDevGross: (m.avg_abs_gross_error ?? 8.0) * 0.6,
        avgAbsNetError: null,
        lastComputedAt: m.evaluated_at,
      })
    }

    // Build global profile from validation_results
    if (validationAgg && validationAgg.length > 0) {
      const grossErrors = validationAgg.map(v => v.abs_error_gross!).sort((a, b) => a - b)
      const avgError = grossErrors.reduce((a, b) => a + b, 0) / grossErrors.length
      const medianError = grossErrors[Math.floor(grossErrors.length / 2)]
      const p75Error = grossErrors[Math.floor(grossErrors.length * 0.75)]
      const p90Error = grossErrors[Math.floor(grossErrors.length * 0.90)]

      profiles.set('_global', {
        segmentId: '_global',
        sampleCount: grossErrors.length,
        avgAbsGrossError: avgError,
        medianAbsGrossError: medianError,
        p75GrossError: p75Error,
        p90GrossError: p90Error,
        stdDevGross: calculateStdDev(grossErrors, avgError),
        avgAbsNetError: null,
        lastComputedAt: new Date().toISOString(),
      })
    }

    _residualCache = profiles
    _residualCacheTs = now
    return profiles
  } catch (err) {
    console.error('[segment-confidence-interval] loadSegmentResidualProfiles error:', err)
    return _residualCache
  }
}

function calculateStdDev(values: number[], mean: number): number {
  if (values.length < 2) return 0
  const squaredDiffs = values.map(v => Math.pow(v - mean, 2))
  return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / values.length)
}

// ============================================================================
// MAIN FUNCTION
// ============================================================================

export async function computeSegmentConfidenceInterval(
  input: ConfidenceIntervalInput
): Promise<SegmentConfidenceIntervalResult> {
  const residualProfiles = await loadSegmentResidualProfiles()

  // 1. Determine which interval profile to use
  const intervalProfile = selectIntervalProfile(input.segmentCalibration, residualProfiles)

  // 2. Compute family-level uncertainty
  const familyUncertainty = computeFamilyUncertainty(input, residualProfiles)

  // 3. Compute overall error bands using segment history + adjustments
  const errorBands = computeErrorBands(input, intervalProfile, familyUncertainty)

  // 4. Determine calibrated confidence tier
  const { tier: confidenceTier, percent: confidencePercent } = computeCalibratedConfidenceTier(
    input,
    errorBands,
    familyUncertainty
  )

  // 5. Find weakest/strongest families
  const sortedFamilies = [...familyUncertainty].sort((a, b) => a.confidenceScore - b.confidenceScore)
  const weakestFamily = sortedFamilies[0]?.confidenceScore < 50 ? sortedFamilies[0].family : null
  const strongestFamily = sortedFamilies[sortedFamilies.length - 1]?.confidenceScore >= 70
    ? sortedFamilies[sortedFamilies.length - 1].family
    : null

  // 6. Build explanation
  const { summary, detailed } = buildExplanation(
    input,
    intervalProfile,
    familyUncertainty,
    errorBands,
    weakestFamily
  )

  return {
    grossScoreExpectedErrorBand: {
      low: input.predictedGross - errorBands.grossLow,
      high: input.predictedGross + errorBands.grossHigh,
      expectedValue: input.predictedGross,
      width: errorBands.grossLow + errorBands.grossHigh,
    },
    netScoreExpectedErrorBand: {
      low: input.predictedNet - errorBands.netLow,
      high: input.predictedNet + errorBands.netHigh,
      expectedValue: input.predictedNet,
      width: errorBands.netLow + errorBands.netHigh,
    },
    calibratedConfidenceTier: confidenceTier,
    calibratedConfidencePercent: confidencePercent,
    trustTier: input.trustScore.tier,
    familyUncertainty,
    weakestFamily,
    strongestFamily,
    confidenceExplanationSummary: summary,
    detailedExplanation: detailed,
    intervalProfileUsed: {
      profileType: intervalProfile.type,
      segmentName: intervalProfile.segmentName,
      sampleCount: intervalProfile.sampleCount,
      shrinkageFactor: intervalProfile.shrinkage,
    },
    inputSignals: {
      segmentTotalSamples: input.segmentCalibration.totalSampleCount,
      geometryConsistencyScore: input.geometryConsistency.consistencyScore,
      referenceQuality: computeReferenceQuality(input.landmarks, input.segmentContext),
      angleDiversity: input.angleDiversity,
      imageCount: input.imageCount,
    },
  }
}

// ============================================================================
// INTERVAL PROFILE SELECTION
// ============================================================================

interface SelectedIntervalProfile {
  type: 'segment_specific' | 'parent_fallback' | 'global_default'
  segmentName: string | null
  sampleCount: number
  shrinkage: number
  avgError: number
  p90Error: number
  stdDev: number
}

function selectIntervalProfile(
  segmentCalibration: SegmentedCalibration,
  residualProfiles: Map<string, SegmentResidualProfile>
): SelectedIntervalProfile {
  // Find the most specific matching segment with sufficient data
  const matchedSegments = segmentCalibration.matchedSegments
    .filter(s => !s.gated && s.directMatch)
    .sort((a, b) => b.level - a.level) // Most specific first

  for (const seg of matchedSegments) {
    const profile = residualProfiles.get(seg.id)
    if (profile && profile.sampleCount >= MIN_SEGMENT_SAMPLES_FOR_INTERVAL) {
      // Compute shrinkage based on sample depth
      const shrinkage = Math.max(0, 1 - Math.min(1, profile.sampleCount / SHRINKAGE_SAMPLE_THRESHOLD))
      return {
        type: 'segment_specific',
        segmentName: seg.name,
        sampleCount: profile.sampleCount,
        shrinkage,
        avgError: profile.avgAbsGrossError,
        p90Error: profile.p90GrossError,
        stdDev: profile.stdDevGross,
      }
    }
  }

  // Fall back to parent segments
  for (const seg of matchedSegments) {
    if (seg.level > 0) {
      // Check parent via segment tree
      const parentSeg = segmentCalibration.matchedSegments.find(
        s => !s.gated && s.level === seg.level - 1
      )
      if (parentSeg) {
        const profile = residualProfiles.get(parentSeg.id)
        if (profile && profile.sampleCount >= MIN_SEGMENT_SAMPLES_FOR_INTERVAL) {
          return {
            type: 'parent_fallback',
            segmentName: parentSeg.name,
            sampleCount: profile.sampleCount,
            shrinkage: 0.3, // Higher shrinkage for parent fallback
            avgError: profile.avgAbsGrossError,
            p90Error: profile.p90GrossError,
            stdDev: profile.stdDevGross,
          }
        }
      }
    }
  }

  // Fall back to global
  const globalProfile = residualProfiles.get('_global')
  if (globalProfile) {
    return {
      type: 'global_default',
      segmentName: 'Global',
      sampleCount: globalProfile.sampleCount,
      shrinkage: 0.5, // Higher shrinkage for global fallback
      avgError: globalProfile.avgAbsGrossError,
      p90Error: globalProfile.p90GrossError,
      stdDev: globalProfile.stdDevGross,
    }
  }

  // Ultimate fallback to conservative defaults
  const sampleDepth = getSampleDepthCategory(segmentCalibration.totalSampleCount)
  const baseErrors = BASE_ERROR_BY_SAMPLE_DEPTH[sampleDepth]
  return {
    type: 'global_default',
    segmentName: null,
    sampleCount: 0,
    shrinkage: 0.7,
    avgError: baseErrors.avgError,
    p90Error: baseErrors.p90Error,
    stdDev: baseErrors.avgError * 0.6,
  }
}

function getSampleDepthCategory(sampleCount: number): keyof typeof BASE_ERROR_BY_SAMPLE_DEPTH {
  if (sampleCount >= 1000) return 'deep'
  if (sampleCount >= 300) return 'substantial'
  if (sampleCount >= 100) return 'moderate'
  if (sampleCount >= 30) return 'limited'
  return 'sparse'
}

// ============================================================================
// FAMILY-LEVEL UNCERTAINTY
// ============================================================================

function computeFamilyUncertainty(
  input: ConfidenceIntervalInput,
  _residualProfiles: Map<string, SegmentResidualProfile>
): FamilyUncertainty[] {
  const families: MeasurementFamily[] = ['spread', 'beam', 'tine', 'mass', 'deduction']
  const result: FamilyUncertainty[] = []

  for (const family of families) {
    const { confidenceScore, errorBand, contributingFactors, limitingFactors } =
      computeSingleFamilyUncertainty(family, input)

    const tier = confidenceScore >= 75 ? 'high'
      : confidenceScore >= 50 ? 'medium'
      : confidenceScore >= 25 ? 'low'
      : 'very_low'

    result.push({
      family,
      confidenceScore,
      expectedErrorBand: errorBand,
      tier,
      contributingFactors,
      limitingFactors,
    })
  }

  return result
}

function computeSingleFamilyUncertainty(
  family: MeasurementFamily,
  input: ConfidenceIntervalInput
): {
  confidenceScore: number
  errorBand: number
  contributingFactors: string[]
  limitingFactors: string[]
} {
  const baseErrors = FAMILY_BASE_ERRORS[family]
  const angleImpact = ANGLE_IMPACT_ON_FAMILY[family]
  const contributingFactors: string[] = []
  const limitingFactors: string[] = []

  let confidenceScore = 50 // Start at baseline
  let errorBand = baseErrors.base

  // 1. Angle coverage impact
  const hasRequiredAngles = angleImpact.requiredAngles.every(a => input.angleTypes.includes(a))
  const hasAnyRequiredAngle = angleImpact.requiredAngles.some(a => input.angleTypes.includes(a))

  if (hasRequiredAngles) {
    confidenceScore += 20 * angleImpact.impact * 2
    contributingFactors.push(`All key angles for ${family} measurement available`)
  } else if (hasAnyRequiredAngle) {
    confidenceScore += 10 * angleImpact.impact * 2
    errorBand += 0.5
    limitingFactors.push(`Missing some angles for ${family} measurement`)
  } else {
    confidenceScore -= 15
    errorBand += 1.5
    limitingFactors.push(`No ideal angles for ${family} measurement`)
  }

  // 2. Geometry consistency impact
  const geometryTrustPenalty = input.geometryConsistency.measurementTrustPenalties[family] ?? 0
  if (geometryTrustPenalty > 0.2) {
    confidenceScore -= geometryTrustPenalty * 30
    errorBand += geometryTrustPenalty * 2
    limitingFactors.push(`Geometry flags for ${family}`)
  } else if (input.geometryConsistency.consistencyScore > 0.85) {
    confidenceScore += 10
    contributingFactors.push(`Strong geometry consistency`)
  }

  // 3. Reference quality impact (especially for spread)
  const refContrib = input.geometryConsistency.referenceContributions[family]
  if (refContrib) {
    if (refContrib.quality >= 0.8) {
      confidenceScore += 12
      errorBand *= 0.9
      contributingFactors.push(`Strong scaling reference for ${family}`)
    } else if (refContrib.quality < 0.5) {
      confidenceScore -= 10
      errorBand += 0.5
      limitingFactors.push(`Weak scaling reference for ${family}`)
    }
  }

  // 4. Landmark visibility impact
  if (family === 'spread') {
    if (input.landmarks.ears_visible && input.segmentContext.earsFullyVisible) {
      confidenceScore += 15
      contributingFactors.push('Ears fully visible for spread scaling')
    } else if (input.landmarks.ears_visible) {
      confidenceScore += 5
    } else {
      confidenceScore -= 10
      errorBand += 1.0
      limitingFactors.push('Ears not clearly visible')
    }
  }

  // 5. Trust score impact
  const trustImpact = input.trustScore.components.find(c =>
    (family === 'spread' && c.name.includes('Angle')) ||
    (family === 'beam' && c.name.includes('Angle')) ||
    c.name.includes('Landmark')
  )
  if (trustImpact && trustImpact.score < 50) {
    confidenceScore -= 8
    limitingFactors.push(`Low trust in ${trustImpact.name.toLowerCase()}`)
  }

  // 6. Image count impact
  if (input.imageCount >= 3) {
    confidenceScore += 8
    contributingFactors.push('Multiple images allow cross-validation')
  } else if (input.imageCount === 1) {
    confidenceScore -= 10
    errorBand += 0.8
    limitingFactors.push('Single image limits verification')
  }

  // Clamp values
  confidenceScore = Math.max(5, Math.min(95, confidenceScore))
  errorBand = Math.max(baseErrors.base * 0.5, Math.min(baseErrors.ceiling, errorBand))

  return { confidenceScore, errorBand, contributingFactors, limitingFactors }
}

// ============================================================================
// ERROR BAND COMPUTATION
// ============================================================================

interface ErrorBandResult {
  grossLow: number
  grossHigh: number
  netLow: number
  netHigh: number
}

function computeErrorBands(
  input: ConfidenceIntervalInput,
  profile: SelectedIntervalProfile,
  familyUncertainty: FamilyUncertainty[]
): ErrorBandResult {
  // Start with profile-based estimate
  let baseError = profile.avgError

  // Apply shrinkage toward conservative global estimate
  if (profile.shrinkage > 0) {
    const conservativeEstimate = 8.0 // Global baseline
    baseError = baseError * (1 - profile.shrinkage) + conservativeEstimate * profile.shrinkage
  }

  // Adjust for geometry consistency
  if (input.geometryConsistency.consistencyScore < 0.5) {
    baseError *= 1.4
  } else if (input.geometryConsistency.consistencyScore > 0.85) {
    baseError *= 0.9
  }

  // Adjust for trust score
  switch (input.trustScore.tier) {
    case 'excellent':
      baseError *= 0.85
      break
    case 'good':
      baseError *= 0.95
      break
    case 'fair':
      baseError *= 1.1
      break
    case 'limited':
      baseError *= 1.3
      break
    case 'uncertain':
      baseError *= 1.6
      break
  }

  // Adjust for family weakness
  const avgFamilyConfidence = familyUncertainty.reduce((s, f) => s + f.confidenceScore, 0) / familyUncertainty.length
  if (avgFamilyConfidence < 40) {
    baseError *= 1.3
  } else if (avgFamilyConfidence > 70) {
    baseError *= 0.9
  }

  // Adjust for segment sample depth
  const sampleDepth = getSampleDepthCategory(input.segmentCalibration.totalSampleCount)
  if (sampleDepth === 'sparse') {
    baseError *= 1.4
  } else if (sampleDepth === 'deep') {
    baseError *= 0.85
  }

  // Compute asymmetric bands (slightly wider on high end for safety)
  const grossLow = Number((baseError * 0.9).toFixed(1))
  const grossHigh = Number((baseError * 1.1).toFixed(1))

  // Net error typically similar but may have additional deduction uncertainty
  const deductionUncertainty = familyUncertainty.find(f => f.family === 'deduction')
  const netMultiplier = deductionUncertainty && deductionUncertainty.confidenceScore < 50 ? 1.15 : 1.0
  const netLow = Number((grossLow * netMultiplier).toFixed(1))
  const netHigh = Number((grossHigh * netMultiplier).toFixed(1))

  return { grossLow, grossHigh, netLow, netHigh }
}

// ============================================================================
// CALIBRATED CONFIDENCE TIER
// ============================================================================

function computeCalibratedConfidenceTier(
  input: ConfidenceIntervalInput,
  errorBands: ErrorBandResult,
  familyUncertainty: FamilyUncertainty[]
): { tier: ConfidenceTier; percent: number } {
  // Start with raw vision confidence if available
  let basePercent = input.rawVisionConfidence ?? 60

  // Adjust based on error band width
  const errorWidth = (errorBands.grossLow + errorBands.grossHigh) / 2
  if (errorWidth <= 4) {
    basePercent += 10
  } else if (errorWidth <= 6) {
    basePercent += 5
  } else if (errorWidth >= 12) {
    basePercent -= 15
  } else if (errorWidth >= 9) {
    basePercent -= 8
  }

  // Adjust for family confidence spread
  const minFamilyConf = Math.min(...familyUncertainty.map(f => f.confidenceScore))
  if (minFamilyConf < 30) {
    basePercent -= 10
  } else if (minFamilyConf < 50) {
    basePercent -= 5
  }

  // Adjust for trust tier
  switch (input.trustScore.tier) {
    case 'excellent':
      basePercent += 5
      break
    case 'limited':
      basePercent -= 10
      break
    case 'uncertain':
      basePercent -= 20
      break
  }

  // Adjust for geometry consistency
  basePercent += input.geometryConsistency.confidenceAdjustment * 0.5

  // Clamp
  const percent = Math.max(10, Math.min(95, Math.round(basePercent)))

  // Determine tier
  let tier: ConfidenceTier
  if (percent >= 85) tier = 'very_high'
  else if (percent >= 70) tier = 'high'
  else if (percent >= 50) tier = 'medium'
  else if (percent >= 30) tier = 'low'
  else tier = 'very_low'

  return { tier, percent }
}

// ============================================================================
// EXPLANATION BUILDER
// ============================================================================

function buildExplanation(
  input: ConfidenceIntervalInput,
  profile: SelectedIntervalProfile,
  familyUncertainty: FamilyUncertainty[],
  errorBands: ErrorBandResult,
  weakestFamily: MeasurementFamily | null
): { summary: string; detailed: string[] } {
  const detailed: string[] = []

  // Profile source
  if (profile.type === 'segment_specific') {
    detailed.push(`Using segment-specific error profile (${profile.sampleCount} samples)`)
  } else if (profile.type === 'parent_fallback') {
    detailed.push(`Using parent segment profile due to limited specific data`)
  } else {
    detailed.push(`Using global error estimates (limited segment-specific data)`)
  }

  // Family notes
  for (const fam of familyUncertainty) {
    if (fam.tier === 'very_low') {
      detailed.push(`${capitalize(fam.family)} confidence is low: ${fam.limitingFactors.join(', ')}`)
    } else if (fam.tier === 'high' && fam.contributingFactors.length > 0) {
      detailed.push(`${capitalize(fam.family)} confidence is strong: ${fam.contributingFactors[0]}`)
    }
  }

  // Trust impact
  if (input.trustScore.tier === 'excellent' || input.trustScore.tier === 'good') {
    detailed.push(`Input quality is ${input.trustScore.tier}: ${input.trustScore.summary}`)
  } else if (input.trustScore.tier === 'limited' || input.trustScore.tier === 'uncertain') {
    detailed.push(`Input quality is ${input.trustScore.tier}, widening error band`)
  }

  // Geometry notes
  if (input.geometryConsistency.tier === 'excellent' || input.geometryConsistency.tier === 'good') {
    detailed.push('Measurements are geometrically consistent')
  } else if (input.geometryConsistency.tier === 'poor' || input.geometryConsistency.tier === 'implausible') {
    detailed.push(`Geometry issues detected: ${input.geometryConsistency.summary}`)
  }

  // Build summary
  const avgError = (errorBands.grossLow + errorBands.grossHigh) / 2
  let summary: string
  if (avgError <= 5) {
    summary = weakestFamily
      ? `High confidence overall, though ${weakestFamily} measurement is less certain.`
      : 'High confidence with tight error bands.'
  } else if (avgError <= 8) {
    summary = weakestFamily
      ? `Good confidence, with ${weakestFamily} being the least certain measurement.`
      : 'Good confidence with moderate error bands.'
  } else {
    summary = weakestFamily
      ? `Wider error bands due to ${weakestFamily} uncertainty and input limitations.`
      : 'Wider error bands due to input quality or limited segment data.'
  }

  return { summary, detailed }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function computeReferenceQuality(landmarks: LandmarksDetected, context: SegmentContext): number {
  let quality = 0.3

  if (landmarks.ears_visible) {
    quality += 0.3
    if (context.earsFullyVisible) {
      quality += 0.15
    }
  }

  if (landmarks.eyes_visible) {
    quality += 0.15
  }

  if (landmarks.ear_tip_to_tip && landmarks.ear_tip_to_tip > 0) {
    quality += 0.1
  }

  return Math.min(1.0, quality)
}

// ============================================================================
// EXPORT INTERVAL DATA FOR STORAGE
// ============================================================================

export interface ConfidenceIntervalMetadata {
  calibratedConfidencePercent: number
  calibratedConfidenceTier: ConfidenceTier
  grossErrorBandLow: number
  grossErrorBandHigh: number
  netErrorBandLow: number
  netErrorBandHigh: number
  weakestFamily: MeasurementFamily | null
  strongestFamily: MeasurementFamily | null
  familyUncertainty: Array<{
    family: MeasurementFamily
    confidence: number
    tier: string
  }>
  intervalProfileType: string
  intervalProfileSegment: string | null
  intervalProfileSamples: number
  confidenceExplanationSummary: string
}

export function extractConfidenceIntervalMetadata(
  result: SegmentConfidenceIntervalResult
): ConfidenceIntervalMetadata {
  return {
    calibratedConfidencePercent: result.calibratedConfidencePercent,
    calibratedConfidenceTier: result.calibratedConfidenceTier,
    grossErrorBandLow: result.grossScoreExpectedErrorBand.low,
    grossErrorBandHigh: result.grossScoreExpectedErrorBand.high,
    netErrorBandLow: result.netScoreExpectedErrorBand.low,
    netErrorBandHigh: result.netScoreExpectedErrorBand.high,
    weakestFamily: result.weakestFamily,
    strongestFamily: result.strongestFamily,
    familyUncertainty: result.familyUncertainty.map(f => ({
      family: f.family,
      confidence: f.confidenceScore,
      tier: f.tier,
    })),
    intervalProfileType: result.intervalProfileUsed.profileType,
    intervalProfileSegment: result.intervalProfileUsed.segmentName,
    intervalProfileSamples: result.intervalProfileUsed.sampleCount,
    confidenceExplanationSummary: result.confidenceExplanationSummary,
  }
}
