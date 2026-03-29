/**
 * Phase 48: Scoring Variant Sandbox
 * 
 * Central exports for the offline candidate model sandbox,
 * shadow scoring, and promotion gate system.
 */

// Variant Registry
export {
  createScoringVariant,
  getScoringVariant,
  getScoringVariantByTag,
  getProductionVariant,
  listScoringVariants,
  listCandidateVariants,
  updateScoringVariant,
  archiveScoringVariant,
  markAsCandidate,
  removeCandidate,
  promoteVariant,
  rollbackVariant,
  createVariantFromModel,
  createVariantFromCalibration,
  createPipelineVariant,
  ensureProductionVariant,
} from './variant-registry'

// Shadow Scoring
export {
  getActiveShadowConfigs,
  getShadowConfigForVariant,
  upsertShadowConfig,
  disableShadowScoring,
  shouldRunShadowScoring,
  runShadowScoring,
  maybeShadowScore,
  getShadowPredictionsForProduction,
  getShadowPredictionsForVariant,
  getShadowStats,
} from './shadow-scoring'

// Evaluation Runner
export {
  createEvaluationRun,
  getEvaluationRun,
  listEvaluationRuns,
  updateEvaluationRunStatus,
  updateEvaluationRunProgress,
  executeEvaluationRun,
  getEvaluationResults,
  getWorstPredictions,
} from './evaluation-runner'
export type { CreateEvaluationRunParams } from './evaluation-runner'

// Promotion Gates
export {
  getPromotionGateCriteria,
  upsertGateCriteria,
  createVariantComparison,
  evaluatePromotionGates,
  getVariantComparison,
  listVariantComparisons,
  getGateEvaluation,
  getVariantPromotionHistory,
} from './promotion-gates'
export type { CreateComparisonParams } from './promotion-gates'
