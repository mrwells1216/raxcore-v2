/**
 * Phase 28: Training Influence Weighting + Safe Learning Boundaries
 * 
 * Public exports for the influence weighting module
 */

export {
  // Configuration
  getActiveInfluenceConfig,
  clearInfluenceConfigCache,
  
  // Influence computation
  computeInfluenceWeight,
  computeAllInfluenceWeights,
  
  // Similarity computation
  computeSimilarity,
  type SimilarityInput,
  type ExampleMetadata,
  
  // Aggregation
  aggregateCorrections,
  type WeightedExample,
  type AggregationResult,
  
  // Drift detection
  analyzeDrift,
  logDriftDetection,
  
  // Logging
  logLearningCorrection,
  logCorrectionContributions,
  
  // Admin queries
  getRecentCorrections,
  getCorrectionContributions,
} from './service'
