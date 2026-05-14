/**
 * Phase 49: Multi-View Uncertainty Integration
 * 
 * Integrates multi-view fusion results with the Phase 47 confidence interval system.
 * When multiple views agree, uncertainty narrows; when they conflict, it widens.
 */

import type { 
  ConfidenceIntervalInput, 
  SegmentConfidenceIntervalResult,
  MeasurementFamily 
} from './segment-confidence-interval'
import { computeSegmentConfidenceInterval } from './segment-confidence-interval'
import type { MultiViewResult, FamilyFusionDetail } from './multi-view-engine'
import type { CrossViewConflictResult } from './cross-view-conflict'
import type { Measurements } from '@/lib/types'

// ============================================================================
// TYPES
// ============================================================================

export interface MultiViewUncertaintyInput extends Omit<ConfidenceIntervalInput, 'conflictAnalysis'> {
  /** Multi-view fusion result */
  multiViewResult: MultiViewResult
}

export interface MultiViewUncertaintyResult extends SegmentConfidenceIntervalResult {
  /** Multi-view specific adjustments */
  multiViewAdjustments: {
    /** Uncertainty reduction from multi-view agreement */
    uncertaintyReduction: number
    /** Confidence boost from cross-view consistency */
    confidenceBoost: number
    /** Views that contributed to the estimate */
    contributingViews: number
    /** Graph quality impact */
    graphQualityImpact: 'positive' | 'neutral' | 'negative'
  }
  /** Per-family multi-view impact */
  familyMultiViewImpact: Record<MeasurementFamily, {
    viewCount: number
    agreementScore: number
    uncertaintyReduction: number
    strategyUsed: string
  }>
  /** Whether multi-view improved the estimate */
  multiViewImprovedEstimate: boolean
}

// ============================================================================
// CONSTANTS
// ============================================================================

const MULTI_VIEW_ADJUSTMENTS = {
  /** Minimum graph connectivity for positive uncertainty adjustment */
  minGraphConnectivityForBonus: 0.4,
  /** Maximum uncertainty reduction from perfect multi-view agreement */
  maxUncertaintyReduction: 0.35,
  /** Maximum confidence boost from perfect multi-view */
  maxConfidenceBoost: 0.15,
  /** Penalty for fallback usage */
  fallbackPenalty: 0.10,
  /** Per-family agreement thresholds */
  agreementThresholds: {
    high: 0.85, // Significant uncertainty reduction
    moderate: 0.70, // Moderate reduction
    low: 0.50, // Minimal reduction
  },
} as const

// ============================================================================
// MAIN FUNCTION
// ============================================================================

/**
 * Compute confidence intervals with multi-view adjustments
 */
export async function computeMultiViewUncertainty(
  input: MultiViewUncertaintyInput
): Promise<MultiViewUncertaintyResult> {
  const { multiViewResult, ...baseInput } = input

  // Build conflict analysis input from multi-view result
  const conflictAnalysisInput = buildConflictAnalysisFromMultiView(multiViewResult)

  // Compute base confidence interval with conflict analysis
  const baseResult = await computeSegmentConfidenceInterval({
    ...baseInput,
    conflictAnalysis: conflictAnalysisInput,
  })

  // Compute multi-view specific adjustments
  const multiViewAdjustments = computeMultiViewAdjustments(multiViewResult, baseResult)

  // Compute per-family multi-view impact
  const familyMultiViewImpact = computeFamilyMultiViewImpact(
    multiViewResult.solution.familyFusionDetails
  )

  // Apply multi-view adjustments to error bands
  const adjustedGrossBand = adjustErrorBand(
    baseResult.grossScoreExpectedErrorBand,
    multiViewAdjustments.uncertaintyReduction,
    multiViewResult.solution.fallbackUsed
  )

  const adjustedNetBand = adjustErrorBand(
    baseResult.netScoreExpectedErrorBand,
    multiViewAdjustments.uncertaintyReduction,
    multiViewResult.solution.fallbackUsed
  )

  // Adjust confidence
  const adjustedConfidence = Math.min(
    0.95,
    baseResult.calibratedConfidencePercent + (multiViewAdjustments.confidenceBoost * 100)
  )

  // Determine if multi-view improved the estimate
  const multiViewImprovedEstimate = 
    multiViewAdjustments.uncertaintyReduction > 0.05 &&
    !multiViewResult.solution.fallbackUsed &&
    multiViewResult.viewGraph.graphConnectivityScore >= MULTI_VIEW_ADJUSTMENTS.minGraphConnectivityForBonus

  // Update detailed explanation
  const extendedExplanation = [
    ...baseResult.detailedExplanation,
    '',
    '--- Multi-View Fusion Analysis ---',
    `Graph connectivity: ${(multiViewResult.viewGraph.graphConnectivityScore * 100).toFixed(0)}% (${multiViewResult.viewGraph.graphQualityTier})`,
    `Method used: ${multiViewResult.solution.method}`,
    `Contributing views: ${multiViewResult.solution.chosenPrimaryViews.length + multiViewResult.solution.secondarySupportingViews.length}`,
    `Cross-view agreement: ${(multiViewResult.solution.crossViewAgreementScore * 100).toFixed(0)}%`,
    `Uncertainty reduction: ${(multiViewAdjustments.uncertaintyReduction * 100).toFixed(0)}%`,
  ]

  if (multiViewResult.solution.fallbackUsed) {
    extendedExplanation.push(`Fallback used: ${multiViewResult.solution.fallbackReason}`)
  }

  if (multiViewResult.solution.rejectedViews.length > 0) {
    extendedExplanation.push(
      `Rejected views: ${multiViewResult.solution.rejectedViews.map(v => `${v.index} (${v.reason})`).join(', ')}`
    )
  }

  return {
    ...baseResult,
    grossScoreExpectedErrorBand: adjustedGrossBand,
    netScoreExpectedErrorBand: adjustedNetBand,
    calibratedConfidencePercent: adjustedConfidence,
    detailedExplanation: extendedExplanation,
    multiViewAdjustments,
    familyMultiViewImpact,
    multiViewImprovedEstimate,
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function buildConflictAnalysisFromMultiView(
  multiViewResult: MultiViewResult
): ConfidenceIntervalInput['conflictAnalysis'] {
  const conflict = multiViewResult.conflictAnalysis
  if (!conflict) {
    return {
      disagreementScore: 0,
      numberOfAgreeingViews: multiViewResult.solution.chosenPrimaryViews.length,
      trustConcentration: 1.0,
      hasOutliers: multiViewResult.solution.rejectedViews.length > 0,
      highDisagreementFamilies: [],
      reverseEngineeringRecommended: false,
    }
  }

  // Calculate trust concentration (are high-trust views aligned?)
  const trustScores = conflict.viewTrustScores
  const nonOutlierTrusts = trustScores.filter(v => !v.isOutlier).map(v => v.overallTrust)
  const avgTrust = nonOutlierTrusts.length > 0
    ? nonOutlierTrusts.reduce((a, b) => a + b, 0) / nonOutlierTrusts.length
    : 0.5
  const trustVariance = nonOutlierTrusts.length > 0
    ? nonOutlierTrusts.reduce((sum, t) => sum + Math.pow(t - avgTrust, 2), 0) / nonOutlierTrusts.length
    : 0
  const trustConcentration = 1 - Math.sqrt(trustVariance)

  return {
    disagreementScore: 1 - multiViewResult.solution.crossViewAgreementScore,
    numberOfAgreeingViews: multiViewResult.solution.chosenPrimaryViews.length + 
      multiViewResult.solution.secondarySupportingViews.length,
    trustConcentration,
    hasOutliers: multiViewResult.solution.rejectedViews.length > 0,
    highDisagreementFamilies: conflict.conflictSummary.highDisagreementFamilies,
    reverseEngineeringRecommended: conflict.conflictSummary.reverseEngineeringRecommended,
  }
}

function computeMultiViewAdjustments(
  multiViewResult: MultiViewResult,
  baseResult: SegmentConfidenceIntervalResult
): MultiViewUncertaintyResult['multiViewAdjustments'] {
  const solution = multiViewResult.solution
  const graph = multiViewResult.viewGraph

  // Start with base uncertainty reduction from agreement
  let uncertaintyReduction = solution.uncertaintyReduction

  // Adjust based on graph quality
  if (graph.graphConnectivityScore >= MULTI_VIEW_ADJUSTMENTS.minGraphConnectivityForBonus) {
    uncertaintyReduction *= (0.8 + graph.graphConnectivityScore * 0.2)
  } else {
    uncertaintyReduction *= 0.5 // Weak graph reduces benefit
  }

  // Apply fallback penalty
  if (solution.fallbackUsed) {
    uncertaintyReduction = Math.max(0, uncertaintyReduction - MULTI_VIEW_ADJUSTMENTS.fallbackPenalty)
  }

  // Cap uncertainty reduction
  uncertaintyReduction = Math.min(MULTI_VIEW_ADJUSTMENTS.maxUncertaintyReduction, uncertaintyReduction)

  // Calculate confidence boost
  let confidenceBoost = 0
  if (!solution.fallbackUsed && graph.graphConnectivityScore >= MULTI_VIEW_ADJUSTMENTS.minGraphConnectivityForBonus) {
    confidenceBoost = solution.crossViewAgreementScore * MULTI_VIEW_ADJUSTMENTS.maxConfidenceBoost
    confidenceBoost *= graph.graphConnectivityScore
  }

  // Determine graph quality impact
  let graphQualityImpact: 'positive' | 'neutral' | 'negative' = 'neutral'
  if (graph.graphConnectivityScore >= 0.7 && solution.crossViewAgreementScore >= 0.8) {
    graphQualityImpact = 'positive'
  } else if (graph.graphConnectivityScore < 0.3 || solution.crossViewAgreementScore < 0.4) {
    graphQualityImpact = 'negative'
  }

  return {
    uncertaintyReduction,
    confidenceBoost,
    contributingViews: solution.chosenPrimaryViews.length + solution.secondarySupportingViews.length,
    graphQualityImpact,
  }
}

function computeFamilyMultiViewImpact(
  familyDetails: FamilyFusionDetail[]
): MultiViewUncertaintyResult['familyMultiViewImpact'] {
  const impact: MultiViewUncertaintyResult['familyMultiViewImpact'] = {
    spread: { viewCount: 0, agreementScore: 0, uncertaintyReduction: 0, strategyUsed: 'none' },
    beam: { viewCount: 0, agreementScore: 0, uncertaintyReduction: 0, strategyUsed: 'none' },
    tine: { viewCount: 0, agreementScore: 0, uncertaintyReduction: 0, strategyUsed: 'none' },
    mass: { viewCount: 0, agreementScore: 0, uncertaintyReduction: 0, strategyUsed: 'none' },
    deduction: { viewCount: 0, agreementScore: 0, uncertaintyReduction: 0, strategyUsed: 'none' },
  }

  for (const detail of familyDetails) {
    const viewCount = detail.primaryViews.length + detail.secondaryViews.length
    
    // Calculate uncertainty reduction based on agreement and view count
    let uncertaintyReduction = 0
    if (detail.agreementScore >= MULTI_VIEW_ADJUSTMENTS.agreementThresholds.high && viewCount >= 2) {
      uncertaintyReduction = 0.30
    } else if (detail.agreementScore >= MULTI_VIEW_ADJUSTMENTS.agreementThresholds.moderate && viewCount >= 2) {
      uncertaintyReduction = 0.20
    } else if (detail.agreementScore >= MULTI_VIEW_ADJUSTMENTS.agreementThresholds.low && viewCount >= 2) {
      uncertaintyReduction = 0.10
    }

    impact[detail.family] = {
      viewCount,
      agreementScore: detail.agreementScore,
      uncertaintyReduction,
      strategyUsed: detail.strategy,
    }
  }

  return impact
}

function adjustErrorBand(
  originalBand: SegmentConfidenceIntervalResult['grossScoreExpectedErrorBand'],
  uncertaintyReduction: number,
  fallbackUsed: boolean
): SegmentConfidenceIntervalResult['grossScoreExpectedErrorBand'] {
  const reductionFactor = 1 - uncertaintyReduction
  
  // If fallback was used, actually increase uncertainty slightly
  const adjustmentFactor = fallbackUsed ? 1.05 : reductionFactor

  const newWidth = originalBand.width * adjustmentFactor
  const halfWidth = newWidth / 2

  return {
    low: originalBand.expectedValue - halfWidth,
    high: originalBand.expectedValue + halfWidth,
    expectedValue: originalBand.expectedValue,
    width: newWidth,
  }
}

// ============================================================================
// COMPARISON UTILITIES
// ============================================================================

/**
 * Compare single-view vs multi-view uncertainty
 */
export function compareUncertaintyReduction(
  singleViewResult: SegmentConfidenceIntervalResult,
  multiViewResult: MultiViewUncertaintyResult
): {
  grossUncertaintyReduction: number
  netUncertaintyReduction: number
  confidenceImprovement: number
  worthwhile: boolean
  summary: string
} {
  const grossReduction = 
    (singleViewResult.grossScoreExpectedErrorBand.width - multiViewResult.grossScoreExpectedErrorBand.width) /
    singleViewResult.grossScoreExpectedErrorBand.width

  const netReduction = 
    (singleViewResult.netScoreExpectedErrorBand.width - multiViewResult.netScoreExpectedErrorBand.width) /
    singleViewResult.netScoreExpectedErrorBand.width

  const confidenceImprovement = 
    multiViewResult.calibratedConfidencePercent - singleViewResult.calibratedConfidencePercent

  const worthwhile = grossReduction > 0.10 || confidenceImprovement > 5

  let summary: string
  if (worthwhile) {
    summary = `Multi-view scoring reduced uncertainty by ${(grossReduction * 100).toFixed(0)}% and improved confidence by ${confidenceImprovement.toFixed(0)}pp`
  } else if (grossReduction > 0) {
    summary = `Multi-view scoring provided modest improvement (${(grossReduction * 100).toFixed(0)}% uncertainty reduction)`
  } else if (grossReduction < 0) {
    summary = `Multi-view scoring increased uncertainty due to view disagreement`
  } else {
    summary = `Multi-view scoring had minimal impact on uncertainty`
  }

  return {
    grossUncertaintyReduction: grossReduction,
    netUncertaintyReduction: netReduction,
    confidenceImprovement,
    worthwhile,
    summary,
  }
}

