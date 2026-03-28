/**
 * Phase 26: Benchmark Pack Module
 * 
 * Exports benchmark pack management, execution, guardrail evaluation,
 * and promotion decision functionality.
 */

export {
  // Pack CRUD
  createBenchmarkPack,
  getBenchmarkPack,
  listBenchmarkPacks,
  updateBenchmarkPack,
  archiveBenchmarkPack,
  deleteBenchmarkPack,
  
  // Pack Examples
  getBenchmarkPackExamples,
  addExamplesToBenchmarkPack,
  removeExamplesFromBenchmarkPack,
  
  // Benchmark Runs
  createBenchmarkRun,
  getBenchmarkRun,
  listBenchmarkRuns,
  
  // Guardrail Evaluation
  evaluateGuardrails,
  
  // Promotion Decisions
  createPromotionDecision,
  getPromotionDecision,
  listPromotionDecisions,
  
  // Promotion Readiness
  getPromotionReadiness,
} from './service'

export type {
  BenchmarkPack,
  BenchmarkPackInput,
  BenchmarkRun,
  BenchmarkRunInput,
  BenchmarkRunWithDetails,
  PromotionDecision,
  PromotionDecisionInput,
  RegressionGuardrailConfig,
  GuardrailEvaluationResult,
  PromotionReadinessSummary,
} from './service'
