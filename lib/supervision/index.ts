/**
 * Phase 52: Structured Supervision Module
 * 
 * Re-exports all supervision functionality for convenient importing.
 */

// Types
export * from './types'

// Config
export * from './config'

// Core service
export {
  // Event creation
  createSupervisionEvent,
  createReversePassSupervisionEvent,
  createStructuralSolvingSupervisionEvent,
  createConfidenceLearningSignal,
  
  // Event queries
  getSupervisionEvent,
  listSupervisionEvents,
  getPredictionSupervisionEvents,
  
  // Labels and feedback
  updateSupervisionLabel,
  addSupervisionFeedback,
  
  // Dashboard
  getSupervisionDashboardStats,
  getSupervisionTrends,
  getCaseSupervisionTrail,
  
  // Export
  markSupervisionExportReady,
} from './service'

// Hard-case patterns
export {
  // Pattern CRUD
  createHardCasePattern,
  getHardCasePattern,
  getHardCasePatternByName,
  listHardCasePatterns,
  updateHardCasePattern,
  
  // Pattern examples
  addPatternExample,
  getPatternExamples,
  removePatternExample,
  
  // Pattern matching
  matchPredictionToPatterns,
  
  // Pattern discovery
  discoverNewPatterns,
  promotePatternCandidate,
  
  // Pattern stats
  getPatternImpactSummary,
  trackVariantImpact,
  
  // Initialization
  initializePredefinedPatterns,
} from './hard-case-patterns'

// Learning actions
export {
  // Action CRUD
  createLearningAction,
  getLearningAction,
  listLearningActions,
  getPendingLearningActions,
  
  // Action generation
  generateLearningActionsFromEvents,
  generateLearningActionsFromPattern,
  generateUIGuidanceAction,
  runLearningActionGeneration,
  
  // Action review
  reviewLearningAction,
  markActionImplemented,
  archiveLearningAction,
  
  // Preview
  getActionImplementationPreview,
} from './learning-actions'
