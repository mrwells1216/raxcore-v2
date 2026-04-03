/**
 * Phase 49: Multi-View Fusion System
 * 
 * Main entry point for the multi-image fusion scoring engine.
 */

// Types
export * from './types'

// Pair matching
export { matchViewPair, scoreAllPairs, getFamilyAnglePreference } from './pair-matcher'

// View graph
export { buildViewGraph, getGraphSummary, getFamilySupport } from './view-graph'

// Family fusion
export { fuseAllFamilies, type FuseAllFamiliesInput, type FuseAllFamiliesResult } from './family-fusion'

// Solver
export { 
  solveMultiView, 
  getMVSolution, 
  determineFallback,
  type MVSolverInput,
  type MVSolverResult,
} from './solver'
