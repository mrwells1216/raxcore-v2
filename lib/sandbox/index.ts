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
  processShadowBatch, // Job pipeline entry point
  executeShadowScoring,
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
  runEvaluation, // Job pipeline entry point with progress callback
} from './evaluation-runner'
export type { CreateEvaluationRunParams } from './evaluation-runner'

// Promotion Gates
export {
  getPromotionGateCriteria,
  upsertGateCriteria,
  createVariantComparison,
  generateComparison, // Job pipeline entry point
  evaluatePromotionGates,
  getVariantComparison,
  listVariantComparisons,
  getGateEvaluation,
  getVariantPromotionHistory,
} from './promotion-gates'
export type { CreateComparisonParams } from './promotion-gates'
