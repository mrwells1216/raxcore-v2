/**
 * Phase 27: Dataset Health + Training Example Quality Controls
 * 
 * Export all health scoring, duplicate detection, and outlier detection functionality.
 */

export {
  // Health score computation
  computeHealthScore,
  type ExampleData,
  
  // Duplicate detection
  detectDuplicates,
  type DuplicateCandidate,
  
  // Outlier detection
  detectOutliers,
  type OutlierInput,
  
  // Database operations
  getTrainingExamplesWithHealth,
  getDatasetHealthSummary,
  getDatasetHealthTotals,
  updateExampleHealth,
  markExampleAsDuplicate,
  markExampleAsOutlier,
  createHealthReviewDecision,
  getReviewDecisions,
  createOutlierRecord,
  getOutlierRecords,
  createDuplicateCluster,
  getDuplicateClusters,
  createHealthComputationRun,
  updateHealthComputationRun,
  runFullHealthComputation,
} from './service'
