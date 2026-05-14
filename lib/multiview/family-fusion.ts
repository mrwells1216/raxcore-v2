/**
 * Phase 49: Cross-View Family Fusion Engine
 * 
 * Fuses measurements by family, not just one flat score.
 * Each family uses different preferred views and fusion strategies.
 */

import type {
  MeasurementFamily,
  FamilyFusionInput,
  FamilyFusionResult,
  SupportQuality,
  ViewGraph,
  AngleClass,
} from './types'
import type { Measurements } from '@/lib/types'
import { getFamilyAnglePreference } from './pair-matcher'

// ============================================================================
// CONSTANTS
// ============================================================================

const FAMILIES: MeasurementFamily[] = ['spread', 'beam', 'tine', 'mass']

// Thresholds for fusion quality
const HIGH_AGREEMENT_THRESHOLD = 0.8
const MODERATE_AGREEMENT_THRESHOLD = 0.5
const ROBUST_FUSION_THRESHOLD = 0.4 // Use robust stats when disagreement is high

// Outlier rejection thresholds (in standard deviations)
const OUTLIER_STD_DEV_THRESHOLD = 2.0

// ============================================================================
// SPREAD FUSION
// ============================================================================

interface SpreadViewData {
  viewIndex: number
  angleClass: AngleClass
  insideSpread: number
  confidence: number
  referenceQuality: number
}

/**
 * Fuse spread measurements across views
 * Prefers frontal views for spread measurement
 */
function fuseSpread(
  views: SpreadViewData[],
  edges: { viewAIndex: number; viewBIndex: number; agreement: number; weight: number }[]
): FamilyFusionResult {
  if (views.length === 0) {
    return createEmptyResult('spread')
  }

  if (views.length === 1) {
    return createSingleViewResult('spread', views[0])
  }

  // Score each view for spread measurement quality
  const scoredViews = views.map(v => ({
    ...v,
    score: computeSpreadViewScore(v),
  }))

  // Sort by score
  scoredViews.sort((a, b) => b.score - a.score)

  // Primary view is the best-scored frontal view
  const primaryView = scoredViews[0]
  const secondaryViews = scoredViews.slice(1)

  // Check agreement with secondary views
  const { fusedValue, disagreementScore, maxDeviation, usedRobust } = fuseWithRobustStats(
    scoredViews.map(v => ({ value: v.insideSpread, weight: v.score })),
    ROBUST_FUSION_THRESHOLD
  )

  return {
    family: 'spread',
    fusedValue,
    uncertainty: computeUncertainty(scoredViews.map(v => v.insideSpread), disagreementScore),
    primaryViewIndex: primaryView.viewIndex,
    primaryViewWeight: primaryView.score,
    secondaryViewIndices: secondaryViews.map(v => v.viewIndex),
    secondaryViewWeights: secondaryViews.map(v => v.score),
    disagreementScore,
    maxDeviation,
    supportQuality: computeSupportQuality(scoredViews.length, disagreementScore),
    usedRobustFusion: usedRobust,
  }
}

function computeSpreadViewScore(view: SpreadViewData): number {
  // Frontal views are best for spread
  const anglePreference = getFamilyAnglePreference('spread', view.angleClass)
  return anglePreference * 0.5 + view.confidence * 0.3 + view.referenceQuality * 0.2
}

// ============================================================================
// BEAM FUSION
// ============================================================================

interface BeamViewData {
  viewIndex: number
  angleClass: AngleClass
  mainBeamLeft: number | null
  mainBeamRight: number | null
  confidence: number
  referenceQuality: number
}

/**
 * Fuse beam measurements across views
 * Prefers side views with clear beam continuity
 */
function fuseBeam(
  views: BeamViewData[],
  edges: { viewAIndex: number; viewBIndex: number; agreement: number; weight: number }[]
): FamilyFusionResult {
  if (views.length === 0) {
    return createEmptyResult('beam')
  }

  // Compute beam average for each view
  const viewsWithBeam = views
    .map(v => ({
      ...v,
      beamAvg: computeBeamAverage(v.mainBeamLeft, v.mainBeamRight),
    }))
    .filter(v => v.beamAvg !== null) as (BeamViewData & { beamAvg: number })[]

  if (viewsWithBeam.length === 0) {
    return createEmptyResult('beam')
  }

  if (viewsWithBeam.length === 1) {
    return {
      ...createSingleViewResult('beam', viewsWithBeam[0]),
      fusedValue: viewsWithBeam[0].beamAvg,
    }
  }

  // Score each view for beam measurement quality
  const scoredViews = viewsWithBeam.map(v => ({
    ...v,
    score: computeBeamViewScore(v),
  }))

  scoredViews.sort((a, b) => b.score - a.score)

  const primaryView = scoredViews[0]
  const secondaryViews = scoredViews.slice(1)

  const { fusedValue, disagreementScore, maxDeviation, usedRobust } = fuseWithRobustStats(
    scoredViews.map(v => ({ value: v.beamAvg, weight: v.score })),
    ROBUST_FUSION_THRESHOLD
  )

  return {
    family: 'beam',
    fusedValue,
    uncertainty: computeUncertainty(scoredViews.map(v => v.beamAvg), disagreementScore),
    primaryViewIndex: primaryView.viewIndex,
    primaryViewWeight: primaryView.score,
    secondaryViewIndices: secondaryViews.map(v => v.viewIndex),
    secondaryViewWeights: secondaryViews.map(v => v.score),
    disagreementScore,
    maxDeviation,
    supportQuality: computeSupportQuality(scoredViews.length, disagreementScore),
    usedRobustFusion: usedRobust,
  }
}

function computeBeamAverage(left: number | null, right: number | null): number | null {
  if (left !== null && right !== null) return (left + right) / 2
  if (left !== null) return left
  if (right !== null) return right
  return null
}

function computeBeamViewScore(view: BeamViewData): number {
  // Side views are best for beam
  const anglePreference = getFamilyAnglePreference('beam', view.angleClass)
  const hasComplete = view.mainBeamLeft !== null && view.mainBeamRight !== null ? 0.1 : 0
  return anglePreference * 0.5 + view.confidence * 0.25 + view.referenceQuality * 0.15 + hasComplete
}

// ============================================================================
// TINE FUSION
// ============================================================================

interface TineViewData {
  viewIndex: number
  angleClass: AngleClass
  tines: { g1Left: number | null; g1Right: number | null; g2Left: number | null; g2Right: number | null;
           g3Left: number | null; g3Right: number | null; g4Left: number | null; g4Right: number | null }
  confidence: number
  referenceQuality: number
}

/**
 * Fuse tine measurements across views
 * Prefers views with strongest tine visibility
 */
function fuseTine(
  views: TineViewData[],
  edges: { viewAIndex: number; viewBIndex: number; agreement: number; weight: number }[]
): FamilyFusionResult {
  if (views.length === 0) {
    return createEmptyResult('tine')
  }

  // Compute tine total for each view
  const viewsWithTine = views
    .map(v => ({
      ...v,
      tineTotal: computeTineTotal(v.tines),
      tineCount: countValidTines(v.tines),
    }))
    .filter(v => v.tineTotal !== null) as (TineViewData & { tineTotal: number; tineCount: number })[]

  if (viewsWithTine.length === 0) {
    return createEmptyResult('tine')
  }

  if (viewsWithTine.length === 1) {
    return {
      ...createSingleViewResult('tine', viewsWithTine[0]),
      fusedValue: viewsWithTine[0].tineTotal,
    }
  }

  // Score each view for tine measurement quality
  const scoredViews = viewsWithTine.map(v => ({
    ...v,
    score: computeTineViewScore(v),
  }))

  scoredViews.sort((a, b) => b.score - a.score)

  const primaryView = scoredViews[0]
  const secondaryViews = scoredViews.slice(1)

  const { fusedValue, disagreementScore, maxDeviation, usedRobust } = fuseWithRobustStats(
    scoredViews.map(v => ({ value: v.tineTotal, weight: v.score })),
    ROBUST_FUSION_THRESHOLD
  )

  return {
    family: 'tine',
    fusedValue,
    uncertainty: computeUncertainty(scoredViews.map(v => v.tineTotal), disagreementScore),
    primaryViewIndex: primaryView.viewIndex,
    primaryViewWeight: primaryView.score,
    secondaryViewIndices: secondaryViews.map(v => v.viewIndex),
    secondaryViewWeights: secondaryViews.map(v => v.score),
    disagreementScore,
    maxDeviation,
    supportQuality: computeSupportQuality(scoredViews.length, disagreementScore),
    usedRobustFusion: usedRobust,
  }
}

function computeTineTotal(tines: TineViewData['tines']): number | null {
  const values = [
    tines.g1Left, tines.g1Right, tines.g2Left, tines.g2Right,
    tines.g3Left, tines.g3Right, tines.g4Left, tines.g4Right,
  ].filter((t): t is number => t !== null)
  return values.length >= 4 ? values.reduce((a, b) => a + b, 0) : null
}

function countValidTines(tines: TineViewData['tines']): number {
  return [
    tines.g1Left, tines.g1Right, tines.g2Left, tines.g2Right,
    tines.g3Left, tines.g3Right, tines.g4Left, tines.g4Right,
  ].filter(t => t !== null).length
}

function computeTineViewScore(view: TineViewData & { tineCount: number }): number {
  const anglePreference = getFamilyAnglePreference('tine', view.angleClass)
  const completenessBonus = view.tineCount / 8 * 0.2
  return anglePreference * 0.4 + view.confidence * 0.25 + view.referenceQuality * 0.15 + completenessBonus
}

// ============================================================================
// MASS FUSION
// ============================================================================

interface MassViewData {
  viewIndex: number
  angleClass: AngleClass
  masses: { h1Left: number | null; h1Right: number | null; h2Left: number | null; h2Right: number | null;
            h3Left: number | null; h3Right: number | null; h4Left: number | null; h4Right: number | null }
  confidence: number
  referenceQuality: number
}

/**
 * Fuse mass measurements across views
 * Prefers views with clean lower-beam visibility
 */
function fuseMass(
  views: MassViewData[],
  edges: { viewAIndex: number; viewBIndex: number; agreement: number; weight: number }[]
): FamilyFusionResult {
  if (views.length === 0) {
    return createEmptyResult('mass')
  }

  // Compute mass total for each view
  const viewsWithMass = views
    .map(v => ({
      ...v,
      massTotal: computeMassTotal(v.masses),
      massCount: countValidMasses(v.masses),
    }))
    .filter(v => v.massTotal !== null) as (MassViewData & { massTotal: number; massCount: number })[]

  if (viewsWithMass.length === 0) {
    return createEmptyResult('mass')
  }

  if (viewsWithMass.length === 1) {
    return {
      ...createSingleViewResult('mass', viewsWithMass[0]),
      fusedValue: viewsWithMass[0].massTotal,
    }
  }

  // Score each view for mass measurement quality
  const scoredViews = viewsWithMass.map(v => ({
    ...v,
    score: computeMassViewScore(v),
  }))

  scoredViews.sort((a, b) => b.score - a.score)

  const primaryView = scoredViews[0]
  const secondaryViews = scoredViews.slice(1)

  const { fusedValue, disagreementScore, maxDeviation, usedRobust } = fuseWithRobustStats(
    scoredViews.map(v => ({ value: v.massTotal, weight: v.score })),
    ROBUST_FUSION_THRESHOLD
  )

  return {
    family: 'mass',
    fusedValue,
    uncertainty: computeUncertainty(scoredViews.map(v => v.massTotal), disagreementScore),
    primaryViewIndex: primaryView.viewIndex,
    primaryViewWeight: primaryView.score,
    secondaryViewIndices: secondaryViews.map(v => v.viewIndex),
    secondaryViewWeights: secondaryViews.map(v => v.score),
    disagreementScore,
    maxDeviation,
    supportQuality: computeSupportQuality(scoredViews.length, disagreementScore),
    usedRobustFusion: usedRobust,
  }
}

function computeMassTotal(masses: MassViewData['masses']): number | null {
  const values = [
    masses.h1Left, masses.h1Right, masses.h2Left, masses.h2Right,
    masses.h3Left, masses.h3Right, masses.h4Left, masses.h4Right,
  ].filter((t): t is number => t !== null)
  return values.length >= 4 ? values.reduce((a, b) => a + b, 0) : null
}

function countValidMasses(masses: MassViewData['masses']): number {
  return [
    masses.h1Left, masses.h1Right, masses.h2Left, masses.h2Right,
    masses.h3Left, masses.h3Right, masses.h4Left, masses.h4Right,
  ].filter(t => t !== null).length
}

function computeMassViewScore(view: MassViewData & { massCount: number }): number {
  const anglePreference = getFamilyAnglePreference('mass', view.angleClass)
  const completenessBonus = view.massCount / 8 * 0.2
  return anglePreference * 0.4 + view.confidence * 0.25 + view.referenceQuality * 0.15 + completenessBonus
}

// ============================================================================
// ROBUST STATISTICS
// ============================================================================

/**
 * Fuse values using robust statistics when disagreement is high
 */
function fuseWithRobustStats(
  values: { value: number; weight: number }[],
  robustThreshold: number
): { fusedValue: number; disagreementScore: number; maxDeviation: number; usedRobust: boolean } {
  if (values.length === 0) {
    return { fusedValue: 0, disagreementScore: 0, maxDeviation: 0, usedRobust: false }
  }

  if (values.length === 1) {
    return { fusedValue: values[0].value, disagreementScore: 0, maxDeviation: 0, usedRobust: false }
  }

  // Compute weighted mean
  const totalWeight = values.reduce((sum, v) => sum + v.weight, 0)
  const weightedMean = values.reduce((sum, v) => sum + v.value * v.weight, 0) / totalWeight

  // Compute statistics
  const deviations = values.map(v => Math.abs(v.value - weightedMean))
  const maxDeviation = Math.max(...deviations)
  const avgDeviation = deviations.reduce((a, b) => a + b, 0) / deviations.length
  
  // Compute disagreement score (0-1, higher = more disagreement)
  // Normalize by expected range for the measurement type
  const valueRange = Math.max(...values.map(v => v.value)) - Math.min(...values.map(v => v.value))
  const disagreementScore = values.length > 1 
    ? Math.min(1, valueRange / (weightedMean * 0.3 + 5)) // 30% of mean + 5" baseline
    : 0

  // If disagreement is high, use robust fusion
  if (disagreementScore > robustThreshold && values.length >= 3) {
    // Use trimmed mean (remove outliers)
    const trimmedValues = trimOutliers(values)
    const trimmedWeight = trimmedValues.reduce((sum, v) => sum + v.weight, 0)
    const trimmedMean = trimmedValues.reduce((sum, v) => sum + v.value * v.weight, 0) / trimmedWeight
    return { fusedValue: trimmedMean, disagreementScore, maxDeviation, usedRobust: true }
  }

  return { fusedValue: weightedMean, disagreementScore, maxDeviation, usedRobust: false }
}

/**
 * Remove outliers using standard deviation threshold
 */
function trimOutliers(values: { value: number; weight: number }[]): { value: number; weight: number }[] {
  if (values.length <= 2) return values

  const mean = values.reduce((sum, v) => sum + v.value, 0) / values.length
  const variance = values.reduce((sum, v) => sum + Math.pow(v.value - mean, 2), 0) / values.length
  const stdDev = Math.sqrt(variance)

  return values.filter(v => 
    Math.abs(v.value - mean) <= OUTLIER_STD_DEV_THRESHOLD * stdDev
  )
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function createEmptyResult(family: MeasurementFamily): FamilyFusionResult {
  return {
    family,
    fusedValue: 0,
    uncertainty: Infinity,
    primaryViewIndex: -1,
    primaryViewWeight: 0,
    secondaryViewIndices: [],
    secondaryViewWeights: [],
    disagreementScore: 1,
    maxDeviation: 0,
    supportQuality: 'insufficient',
    usedRobustFusion: false,
  }
}

function createSingleViewResult(family: MeasurementFamily, view: { viewIndex: number; confidence: number }): FamilyFusionResult {
  return {
    family,
    fusedValue: 0, // Will be overwritten
    uncertainty: (1 - view.confidence) * 3, // Rough uncertainty from single view
    primaryViewIndex: view.viewIndex,
    primaryViewWeight: 1.0,
    secondaryViewIndices: [],
    secondaryViewWeights: [],
    disagreementScore: 0,
    maxDeviation: 0,
    supportQuality: 'weak',
    usedRobustFusion: false,
  }
}

function computeUncertainty(values: number[], disagreementScore: number): number {
  if (values.length === 0) return Infinity
  if (values.length === 1) return 3.0 // Default single-view uncertainty

  // Base uncertainty from standard deviation
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length
  const stdDev = Math.sqrt(variance)

  // Scale uncertainty by disagreement
  const base = Math.max(0.5, stdDev)
  const scaled = base * (1 + disagreementScore)

  return scaled
}

function computeSupportQuality(viewCount: number, disagreementScore: number): SupportQuality {
  if (viewCount === 0) return 'insufficient'
  if (viewCount === 1) return 'weak'
  
  if (viewCount >= 3 && disagreementScore < 0.2) return 'strong'
  if (viewCount >= 2 && disagreementScore < 0.4) return 'moderate'
  if (viewCount >= 2) return 'weak'
  
  return 'insufficient'
}

// ============================================================================
// MAIN FUSION INTERFACE
// ============================================================================

export interface FuseAllFamiliesInput {
  views: Array<{
    viewIndex: number
    angleClass: AngleClass
    measurements: Partial<Measurements>
    confidence: number
    referenceQuality: number
  }>
  edges: Array<{
    viewAIndex: number
    viewBIndex: number
    agreement: number
    weight: number
  }>
}

export interface FuseAllFamiliesResult {
  results: Record<MeasurementFamily, FamilyFusionResult>
  fusedMeasurements: Partial<Measurements>
  overallDisagreement: number
  highDisagreementFamilies: MeasurementFamily[]
  overallUncertainty: number
}

/**
 * Fuse all measurement families across views
 */
export function fuseAllFamilies(input: FuseAllFamiliesInput): FuseAllFamiliesResult {
  const { views, edges } = input

  // Prepare spread views
  const spreadViews: SpreadViewData[] = views
    .filter(v => v.measurements.inside_spread !== null && v.measurements.inside_spread !== undefined)
    .map(v => ({
      viewIndex: v.viewIndex,
      angleClass: v.angleClass,
      insideSpread: v.measurements.inside_spread!,
      confidence: v.confidence,
      referenceQuality: v.referenceQuality,
    }))

  // Prepare beam views
  const beamViews: BeamViewData[] = views.map(v => ({
    viewIndex: v.viewIndex,
    angleClass: v.angleClass,
    mainBeamLeft: v.measurements.main_beam_left ?? null,
    mainBeamRight: v.measurements.main_beam_right ?? null,
    confidence: v.confidence,
    referenceQuality: v.referenceQuality,
  }))

  // Prepare tine views
  const tineViews: TineViewData[] = views.map(v => ({
    viewIndex: v.viewIndex,
    angleClass: v.angleClass,
    tines: {
      g1Left: v.measurements.g1_left ?? null,
      g1Right: v.measurements.g1_right ?? null,
      g2Left: v.measurements.g2_left ?? null,
      g2Right: v.measurements.g2_right ?? null,
      g3Left: v.measurements.g3_left ?? null,
      g3Right: v.measurements.g3_right ?? null,
      g4Left: v.measurements.g4_left ?? null,
      g4Right: v.measurements.g4_right ?? null,
    },
    confidence: v.confidence,
    referenceQuality: v.referenceQuality,
  }))

  // Prepare mass views
  const massViews: MassViewData[] = views.map(v => ({
    viewIndex: v.viewIndex,
    angleClass: v.angleClass,
    masses: {
      h1Left: v.measurements.h1_left ?? null,
      h1Right: v.measurements.h1_right ?? null,
      h2Left: v.measurements.h2_left ?? null,
      h2Right: v.measurements.h2_right ?? null,
      h3Left: v.measurements.h3_left ?? null,
      h3Right: v.measurements.h3_right ?? null,
      h4Left: v.measurements.h4_left ?? null,
      h4Right: v.measurements.h4_right ?? null,
    },
    confidence: v.confidence,
    referenceQuality: v.referenceQuality,
  }))

  // Fuse each family
  const spreadResult = fuseSpread(spreadViews, edges)
  const beamResult = fuseBeam(beamViews, edges)
  const tineResult = fuseTine(tineViews, edges)
  const massResult = fuseMass(massViews, edges)

  const results: Record<MeasurementFamily, FamilyFusionResult> = {
    spread: spreadResult,
    beam: beamResult,
    tine: tineResult,
    mass: massResult,
    deduction: massResult, // deduction uses same fusion as mass for now
  }

  // Build fused measurements
  const fusedMeasurements: Partial<Measurements> = {
    inside_spread: spreadResult.supportQuality !== 'insufficient' ? spreadResult.fusedValue : null,
    // For beam/tine/mass, we need to reconstruct individual measurements from the primary view
    // but scaled by the fusion ratio
  }

  // Compute overall disagreement
  const familyDisagreements = [
    spreadResult.disagreementScore,
    beamResult.disagreementScore,
    tineResult.disagreementScore,
    massResult.disagreementScore,
  ].filter(d => d < 1) // Exclude insufficient families

  const overallDisagreement = familyDisagreements.length > 0
    ? familyDisagreements.reduce((a, b) => a + b, 0) / familyDisagreements.length
    : 1

  // Identify high disagreement families
  const HIGH_DISAGREEMENT_THRESHOLD = 0.5
  const highDisagreementFamilies = FAMILIES.filter(
    f => results[f].disagreementScore > HIGH_DISAGREEMENT_THRESHOLD
  )

  // Compute overall uncertainty
  const familyUncertainties = FAMILIES
    .map(f => results[f].uncertainty)
    .filter(u => u < Infinity)
  const overallUncertainty = familyUncertainties.length > 0
    ? familyUncertainties.reduce((a, b) => a + b, 0) / familyUncertainties.length
    : Infinity

  return {
    results,
    fusedMeasurements,
    overallDisagreement,
    highDisagreementFamilies,
    overallUncertainty,
  }
}
