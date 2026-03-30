/**
 * Phase 51: Structural Hypothesis Configuration
 * Settings, thresholds, and controls for structural solving
 */

import type { StructuralSolvingSettings, MeasurementFamily } from './types'

// ============================================================================
// DEFAULT SETTINGS
// ============================================================================

export const DEFAULT_STRUCTURAL_SETTINGS: StructuralSolvingSettings = {
  maxCandidates: 12,
  maxEvaluationDepth: 3,
  maxRuntimeMs: 30000,
  candidatePruningThreshold: 0.3,
  requireDisagreementTrigger: true,
  minDisagreementForStructural: 0.15,
  adminOnlyMode: false,
}

// ============================================================================
// SCORING WEIGHTS
// ============================================================================

export const STRUCTURAL_SCORING_WEIGHTS = {
  geometryConsistency: 0.20,
  crossViewConsistency: 0.25,
  landmarkAgreement: 0.15,
  familyPlausibility: 0.15,
  asymmetryPlausibility: 0.10,
  structuralSimplicity: 0.05,
  baselineDeviationPenalty: 0.05,
  uncertaintyReductionBenefit: 0.05,
} as const

// ============================================================================
// TRIGGER THRESHOLDS
// ============================================================================

export const STRUCTURAL_TRIGGER_THRESHOLDS = {
  /** Min cross-view disagreement to trigger structural solving */
  minDisagreementForTrigger: 0.15,
  
  /** Min high-disagreement families to trigger */
  minHighDisagreementFamilies: 1,
  
  /** Min landmark confidence variance to suggest structural issues */
  landmarkConfidenceVarianceThreshold: 0.25,
  
  /** Min asymmetry percent to investigate structural cause */
  asymmetryInvestigationThreshold: 0.12,
  
  /** Max deviation from baseline to consider candidate viable */
  maxViableDeviationPercent: 0.15,
} as const

// ============================================================================
// CANDIDATE GENERATION LIMITS
// ============================================================================

export const CANDIDATE_GENERATION_LIMITS = {
  maxSpreadAnchorShiftCandidates: 2,
  maxBeamTipReassignmentCandidates: 2,
  maxTineTopologyVariants: 3,
  maxAsymmetryRebalanceCandidates: 2,
  maxOcclusionRecoveryCandidates: 2,
  maxLeftRightAssociationCandidates: 1,
  maxComboCandidates: 2,
} as const

// ============================================================================
// ANATOMICAL PLAUSIBILITY BOUNDS
// ============================================================================

export const ANATOMICAL_BOUNDS = {
  /** Typical range for inside spread in inches */
  spreadRange: { min: 8, max: 32 },
  
  /** Typical range for main beam length in inches */
  beamRange: { min: 12, max: 32 },
  
  /** Max asymmetry between sides (as ratio) */
  maxSideAsymmetry: 0.35,
  
  /** Expected tine progression: G1 usually longest, then decreasing */
  tineProgressionExpected: 'g1_longest_then_decreasing',
  
  /** Max reasonable mass circumference in inches */
  maxMassCircumference: 8,
  
  /** Min reasonable mass circumference in inches */
  minMassCircumference: 1,
} as const

// ============================================================================
// VIEW PREFERENCE BY MEASUREMENT FAMILY
// ============================================================================

export const PREFERRED_ANGLES_BY_FAMILY: Record<MeasurementFamily, string[]> = {
  spread: ['front', 'front_left', 'front_right'],
  beam: ['left', 'right', 'front_left', 'front_right'],
  tine: ['left', 'right', 'front_left', 'front_right'],
  mass: ['left', 'right'],
  asymmetry: ['front', 'back'],
  deduction: ['front', 'left', 'right'],
}

// ============================================================================
// SIMPLICITY PENALTIES
// ============================================================================

export const SIMPLICITY_PENALTIES = {
  /** Penalty per landmark override */
  perLandmarkOverride: 0.02,
  
  /** Penalty for tine reordering */
  tineReordering: 0.05,
  
  /** Penalty for left/right swap */
  leftRightSwap: 0.08,
  
  /** Penalty for asymmetry rebalancing */
  asymmetryRebalance: 0.03,
  
  /** Penalty for combo candidates */
  comboCandidate: 0.04,
} as const

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function normalizeScore(value: number): number {
  return clamp(value, 0, 1)
}

export function shouldTriggerStructuralSolving(input: {
  crossViewDisagreement: number
  highDisagreementFamilies: MeasurementFamily[]
  asymmetryPercent: number
  landmarkConfidenceVariance: number
  settings: StructuralSolvingSettings
}): { shouldTrigger: boolean; reasons: string[] } {
  const reasons: string[] = []
  
  if (!input.settings.requireDisagreementTrigger) {
    return { shouldTrigger: true, reasons: ['Manual trigger or always-on mode'] }
  }
  
  if (input.crossViewDisagreement >= input.settings.minDisagreementForStructural) {
    reasons.push(`Cross-view disagreement ${(input.crossViewDisagreement * 100).toFixed(0)}% exceeds threshold`)
  }
  
  if (input.highDisagreementFamilies.length >= STRUCTURAL_TRIGGER_THRESHOLDS.minHighDisagreementFamilies) {
    reasons.push(`${input.highDisagreementFamilies.length} measurement families with high disagreement`)
  }
  
  if (input.landmarkConfidenceVariance >= STRUCTURAL_TRIGGER_THRESHOLDS.landmarkConfidenceVarianceThreshold) {
    reasons.push(`High landmark confidence variance (${(input.landmarkConfidenceVariance * 100).toFixed(0)}%)`)
  }
  
  if (input.asymmetryPercent >= STRUCTURAL_TRIGGER_THRESHOLDS.asymmetryInvestigationThreshold) {
    reasons.push(`High asymmetry (${(input.asymmetryPercent * 100).toFixed(0)}%) warrants structural investigation`)
  }
  
  return {
    shouldTrigger: reasons.length > 0,
    reasons,
  }
}
