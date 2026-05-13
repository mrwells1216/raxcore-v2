/**
 * Phase 51: Structural Rack Hypothesis Solving
 * 
 * This module provides landmark-level and topology-level reverse engineering
 * for rack structure interpretation. It goes beyond simple measurement perturbation
 * to support:
 * 
 * 1. Landmark-level alternative interpretations
 * 2. Rack topology hypothesis generation
 * 3. Cross-view structural re-solving
 * 4. Candidate rack structure ranking
 * 5. Stronger "why this structure won" explainability
 */

// Types
export * from './types'

// Configuration
export { 
  DEFAULT_STRUCTURAL_SETTINGS,
  STRUCTURAL_SCORING_WEIGHTS,
  STRUCTURAL_TRIGGER_THRESHOLDS,
  CANDIDATE_GENERATION_LIMITS,
  ANATOMICAL_BOUNDS,
  shouldTriggerStructuralSolving,
} from './config'

// Topology extraction
export { 
  extractTopologyInterpretation,
  type TopologyExtractionInput,
} from './topology-extractor'

// Hypothesis generation
export { 
  generateStructuralHypotheses,
  type GeneratedCandidate,
  type CandidateGenerationInput,
} from './hypothesis-generator'

// Scoring and ranking
export { 
  evaluateStructuralCandidate,
  rankCandidates,
  selectWinningCandidate,
  type CandidateEvaluation,
  type ScoringInput,
} from './structural-scorer'

// Service (server-only)
// Note: Import directly from './service' in server contexts
