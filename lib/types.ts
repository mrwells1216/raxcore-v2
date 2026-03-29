// Database types for RAXcore

export type RackType = 'typical' | 'non-typical'
export type HarvestMethod = 'bow' | 'rifle' | 'muzzleloader' | 'crossbow' | 'other'
export type SourceType = 'live_deer' | 'mounted_photo' | 'european_mount' | 'trail_cam' | 'harvest_photo' | 'other'
export type AngleType = 'front' | 'left' | 'right' | 'back' | 'other'
export type CaptureMethod = 'camera' | 'upload'
export type CaptureDevice = 'iphone' | 'android' | 'digital_camera' | 'photo_of_photo' | 'vintage_photo' | 'unknown'
export type BuckStatus = 'pending' | 'processing' | 'completed' | 'failed'
export type ScoreSource = 'official_scorer' | 'self_measured' | 'user_reported' | 'estimated'

export interface Buck {
  id: string
  user_id: string | null
  state: string
  rack_type: RackType
  harvest_method: HarvestMethod | null
  source_type: SourceType | null
  capture_device: CaptureDevice | null
  ears_fully_visible: boolean | null
  harvest_year: number | null
  main_frame_points: number | null
  notes: string | null
  status: BuckStatus
  created_at: string
  updated_at: string
}

export interface BuckImage {
  id: string
  buck_id: string
  storage_path: string
  public_url: string | null
  angle_type: AngleType | null
  capture_method: CaptureMethod | null
  file_type: string | null
  file_size_bytes: number | null
  width: number | null
  height: number | null
  quality_score: number | null
  landmarks_detected: LandmarksDetected | null
  created_at: string
}

export interface LandmarksDetected {
  ears_visible: boolean
  eyes_visible: boolean
  antlers_visible: boolean
  ear_base_to_tip?: number
  eye_to_eye?: number
  ear_tip_to_tip?: number
  quality_notes?: string[]
}

// Enhanced landmark representation (Phase 8)
export interface LandmarkPoint {
  x: number // normalized 0-1 position in image
  y: number // normalized 0-1 position in image
  confidence: number // 0-1 confidence score
  source_image_index?: number // which image this came from
}

export interface DetailedLandmarks {
  // Ear landmarks
  ear_base_left?: LandmarkPoint
  ear_base_right?: LandmarkPoint
  ear_tip_left?: LandmarkPoint
  ear_tip_right?: LandmarkPoint
  
  // Eye landmarks
  eye_center_left?: LandmarkPoint
  eye_center_right?: LandmarkPoint
  
  // Antler landmarks
  burr_left?: LandmarkPoint
  burr_right?: LandmarkPoint
  beam_start_left?: LandmarkPoint
  beam_start_right?: LandmarkPoint
  beam_mid_left?: LandmarkPoint
  beam_mid_right?: LandmarkPoint
  beam_tip_left?: LandmarkPoint
  beam_tip_right?: LandmarkPoint
  
  // Tine landmarks (G1-G5)
  g1_base_left?: LandmarkPoint
  g1_tip_left?: LandmarkPoint
  g1_base_right?: LandmarkPoint
  g1_tip_right?: LandmarkPoint
  g2_base_left?: LandmarkPoint
  g2_tip_left?: LandmarkPoint
  g2_base_right?: LandmarkPoint
  g2_tip_right?: LandmarkPoint
  g3_base_left?: LandmarkPoint
  g3_tip_left?: LandmarkPoint
  g3_base_right?: LandmarkPoint
  g3_tip_right?: LandmarkPoint
  g4_base_left?: LandmarkPoint
  g4_tip_left?: LandmarkPoint
  g4_base_right?: LandmarkPoint
  g4_tip_right?: LandmarkPoint
  g5_base_left?: LandmarkPoint
  g5_tip_left?: LandmarkPoint
  g5_base_right?: LandmarkPoint
  g5_tip_right?: LandmarkPoint
  
  // Computed distances
  estimated_ear_base_to_tip?: number
  estimated_eye_to_eye?: number
  estimated_ear_tip_to_tip?: number
  
  // Overall landmark quality
  overall_quality: 'poor' | 'fair' | 'good' | 'excellent'
  detected_landmark_count: number
  total_possible_landmarks: number
}

// Multi-image fusion result
export interface FusionResult {
  fused_measurements: Measurements
  measurement_sources: {
    [key: string]: {
      value: number
      confidence: number
      source_angle: AngleType
      source_image_index: number
    }[]
  }
  conflicts_resolved: number
  fusion_confidence: number
  angle_coverage: {
    front: boolean
    left: boolean
    right: boolean
    back: boolean
  }
  preferred_angles: {
    beams: AngleType[]
    tines: AngleType[]
    spread: AngleType[]
    symmetry: AngleType[]
  }
}

export interface Measurements {
  inside_spread: number | null
  main_beam_left: number | null
  main_beam_right: number | null
  g1_left: number | null
  g1_right: number | null
  g2_left: number | null
  g2_right: number | null
  g3_left: number | null
  g3_right: number | null
  g4_left: number | null
  g4_right: number | null
  g5_left: number | null
  g5_right: number | null
  h1_left: number | null
  h1_right: number | null
  h2_left: number | null
  h2_right: number | null
  h3_left: number | null
  h3_right: number | null
  h4_left: number | null
  h4_right: number | null
  abnormal_points: number | null
  deductions: number | null
}

export interface Prediction {
  id: string
  buck_id: string
  model_version_id: string | null
  predicted_gross: number | null
  predicted_net: number | null
  confidence_percent: number | null
  error_band_low: number | null
  error_band_high: number | null
  measurements: Measurements | null
  landmarks: LandmarksDetected | null
  state_calibration: StateCalibration | null
  processing_time_ms: number | null
  images_used: number | null
  angle_diversity_score: number | null
  created_at: string
  // Phase 10: Extended learning data (stored for model version tracking)
  extended_learning_summary?: ExtendedLearningSummary | null
  scoring_method?: 'vision' | 'heuristic' | 'vision_with_fallback' | null
  vision_model_used?: string | null
  vision_confidence?: number | null
}

export interface StateCalibration {
  state: string
  prior_adjustment: number
  giant_buck_likelihood: 'low' | 'medium' | 'high' | 'very_high'
  notes: string
}

export interface GroundTruthScore {
  id: string
  buck_id: string
  official_gross: number | null
  official_net: number | null
  score_source: ScoreSource | null
  scorer_name: string | null
  scoring_organization: string | null
  is_typical: boolean | null
  harvest_year: number | null
  verified: boolean
  verified_by: string | null
  verified_at: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface TrainingExample {
  id: string
  prediction_id: string
  ground_truth_id: string
  gross_error: number | null
  net_error: number | null
  abs_gross_error: number | null
  abs_net_error: number | null
  verified_for_training: boolean
  verified_by: string | null
  verified_at: string | null
  quality_flags: QualityFlags | null
  target_model_version: string | null
  notes: string | null
  created_at: string
}

export interface QualityFlags {
  multi_angle: boolean
  high_resolution: boolean
  clear_landmarks: boolean
  official_score: boolean
  consistent_measurements: boolean
}

export interface ModelVersion {
  id: string
  version_name: string
  description: string | null
  is_active: boolean
  training_data_count: number
  avg_gross_error: number | null
  avg_net_error: number | null
  created_at: string
  updated_at: string
}

export interface Profile {
  id: string
  display_name: string | null
  is_admin: boolean
  created_at: string
  updated_at: string
}

// Form types
export interface ScoringFormData {
  state: string
  rack_type: RackType
  harvest_method?: HarvestMethod
  source_type?: SourceType
  capture_device?: CaptureDevice
  ears_fully_visible?: boolean
  harvest_year?: number
  main_frame_points?: number
  notes?: string
}

export interface GroundTruthFormData {
  official_gross: number | null
  official_net: number | null
  score_source: ScoreSource
  scorer_name?: string
  scoring_organization?: string
  harvest_year?: number
  notes?: string
}

// Ground truth data for training
export interface GroundTruthData {
  officialScore?: number
  mainBeamLeft?: number
  mainBeamRight?: number
  insideSpread?: number
  pointsLeft?: number
  pointsRight?: number
  g1Left?: number
  g1Right?: number
  g2Left?: number
  g2Right?: number
  g3Left?: number
  g3Right?: number
  g4Left?: number
  g4Right?: number
  h1Left?: number
  h1Right?: number
  h2Left?: number
  h2Right?: number
  h3Left?: number
  h3Right?: number
  h4Left?: number
  h4Right?: number
  scoringMethod?: string
  scorerNotes?: string
}

// Phase 10: Extended learning summary for admin views
export interface MeasurementCorrectionInfo {
  field: string
  originalValue: number
  correction: number
  correctedValue: number
  confidence: number
  sampleCount: number
}

export interface VerifiedExampleInfluenceInfo {
  exampleId: string
  buckId: string
  similarity: number
  matchingFeatures: string[]
  errorContribution: number
  groundTruthScore: number
  predictedScore: number
}

export interface ExtendedLearningSummary {
  verifiedExamplesConsidered: number
  highlySimilarExamplesUsed: number
  strongestMatchingFeatures: string[]
  weakestMatchingFeatures: string[]
  correctionDirection: 'increase' | 'decrease' | 'mixed' | 'none'
  grossAdjustmentApplied: number
  netAdjustmentApplied: number
  confidenceAdjustmentApplied: number
  correctionStrength: 'none' | 'low' | 'medium' | 'high'
  measurementCorrections: MeasurementCorrectionInfo[]
  correctionCapped: boolean
  cappingReason: string | null
  exampleConsistency: number
  influentialExamples: VerifiedExampleInfluenceInfo[]
  notes: string[]
  matchQuality: 'none' | 'weak' | 'moderate' | 'strong'
}

// Simplified scoring result for API
export interface ScoringResult {
  buck: Buck & { property_id?: string | null }
  images: BuckImage[]
  prediction: Prediction
  confidence_explanation: string[]
  scaling_references_used: string[]
  disclaimer: string
  // Vision scoring metadata
  scoringMethod?: 'vision' | 'heuristic' | 'vision_with_fallback'
  visionModelUsed?: string | null
  visionConfidence?: number | null
  learningSummary?: {
    similarExamplesUsed: number
    strongestMatchingFeatures: string[]
    correctionIncrease: number
    correctionDecrease: number
    confidenceImpact: number
    matchQuality: 'none' | 'weak' | 'moderate' | 'strong'
    notes: string[]
  }
  // Phase 10: Extended learning data (for admin)
  extendedLearningSummary?: ExtendedLearningSummary
}

// Legacy API response types (for backward compatibility)
export interface LegacyScoringResult {
  buck: Buck
  images: BuckImage[]
  prediction: Prediction
  confidence_explanation: string[]
  scaling_references_used: string[]
  disclaimer: string
}

// Scoring submission for API
export interface ScoringSubmission {
  sessionId: string
  images: string[]
  metadata?: {
    nickname?: string
    location?: string
    harvestDate?: string
    notes?: string
  }
}

// ========================================
// MAPPING TYPES (Phase 6)
// ========================================

export type PropertyType = 'private' | 'lease' | 'public' | 'unknown'

export type LocationType = 
  | 'sighting' 
  | 'trailcam' 
  | 'harvest' 
  | 'shed' 
  | 'scoring_source'
  | 'stand' 
  | 'blind' 
  | 'scrape' 
  | 'rub' 
  | 'food_plot'
  | 'bedding' 
  | 'travel_corridor' 
  | 'unknown'

export interface Property {
  id: string
  name: string
  owner_label: string | null
  state: string | null
  county: string | null
  property_type: PropertyType
  acreage: number | null
  notes: string | null
  boundary_geojson: GeoJSON.Geometry | null
  created_at: string
  updated_at: string
}

export interface MapPin {
  id: string
  property_id: string | null
  buck_id: string | null
  label: string | null
  location_type: LocationType
  latitude: number | null
  longitude: number | null
  is_approximate: boolean
  confidence_radius_meters: number | null
  pin_date: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface PropertyFormData {
  name: string
  owner_label?: string
  state?: string
  county?: string
  property_type: PropertyType
  acreage?: number
  notes?: string
}

export interface MapPinFormData {
  property_id?: string
  buck_id?: string
  label?: string
  location_type: LocationType
  latitude?: number
  longitude?: number
  is_approximate: boolean
  confidence_radius_meters?: number
  pin_date?: string
  notes?: string
}

// Extended buck with mapping relations
export interface BuckWithMapping extends Buck {
  property_id: string | null
  primary_pin_id: string | null
  property?: Property | null
  pins?: MapPin[]
}

// ========================================
// 3D RENDERER TYPES (Phase 7/8)
// ========================================

export type RenderStatus = 'pending' | 'processing' | 'completed' | 'failed'
export type RenderQuality = 'draft' | 'standard' | 'high'
export type RenderView = 'front' | 'left' | 'right' | 'top' | 'isometric'

export interface RenderSettings {
  quality: RenderQuality
  showMeasurements: boolean
  showLabels: boolean
  backgroundColor: string
  antlerColor: string
  highlightColor: string
  wireframe: boolean
  autoRotate: boolean
}

// Phase 16: Enhanced render configuration
export type MountMode = 'antlers_only' | 'european_mount'
export type RealismLevel = 'basic' | 'standard' | 'enhanced'

export interface RenderConfig {
  mountMode: MountMode
  realismLevel: RealismLevel
  asymmetrySensitivity: number // 0-1, how much to emphasize L/R differences
  beamSweepBias: number // -1 to 1, backward to forward sweep
  tineForwardTilt: number // 0-1, how much tines tilt forward
  showSkullPlate: boolean
}

export interface RenderJob {
  id: string
  buck_id: string
  status: RenderStatus
  settings: RenderSettings
  progress_percent: number
  error_message: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
}

export interface RenderOutput {
  id: string
  render_job_id: string
  view_type: RenderView
  image_url: string | null
  thumbnail_url: string | null
  created_at: string
}

export interface AntlerGeometry {
  insideSpread: number
  mainBeamLeft: number
  mainBeamRight: number
  g1Left: number
  g1Right: number
  g2Left: number
  g2Right: number
  g3Left: number
  g3Right: number
  g4Left: number
  g4Right: number
  g5Left: number | null
  g5Right: number | null
  h1Left: number
  h1Right: number
  h2Left: number
  h2Right: number
  h3Left: number
  h3Right: number
  h4Left: number
  h4Right: number
  abnormalPoints: number
  rackType: RackType
  mainFramePoints: number
}

export interface RenderBundle {
  job: RenderJob
  outputs: RenderOutput[]
  geometry: AntlerGeometry | null
}

// ========================================
// VALIDATION HARNESS TYPES (Phase 13)
// ========================================

export type ValidationRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface ValidationRun {
  id: string
  run_name: string
  model_version_id: string | null
  status: ValidationRunStatus
  total_examples: number
  processed_examples: number
  started_at: string | null
  completed_at: string | null
  // Aggregate metrics
  mean_absolute_error_gross: number | null
  mean_absolute_error_net: number | null
  median_absolute_error_gross: number | null
  median_absolute_error_net: number | null
  rmse_gross: number | null
  rmse_net: number | null
  within_5_percent: number | null
  within_10_percent: number | null
  within_15_percent: number | null
  // Metadata
  config: ValidationRunConfig | null
  error_message: string | null
  created_at: string
  updated_at: string
}

export interface ValidationRunConfig {
  include_unverified: boolean
  min_confidence: number | null
  states_filter: string[] | null
  rack_types_filter: RackType[] | null
  score_range_min: number | null
  score_range_max: number | null
  sample_size: number | null
  notes: string | null
}

export interface ValidationResult {
  id: string
  run_id: string
  training_example_id: string
  buck_id: string
  // Ground truth
  ground_truth_gross: number
  ground_truth_net: number | null
  // Prediction (re-scored during validation)
  predicted_gross: number
  predicted_net: number | null
  confidence_percent: number | null
  // Errors
  error_gross: number
  error_net: number | null
  abs_error_gross: number
  abs_error_net: number | null
  percent_error_gross: number
  percent_error_net: number | null
  // Metadata
  state: string | null
  rack_type: RackType | null
  scoring_method: string | null
  processing_time_ms: number | null
  created_at: string
}

export interface ValidationSummary {
  run: ValidationRun
  results: ValidationResult[]
  // Breakdown by category
  by_state: ValidationBreakdown[]
  by_rack_type: ValidationBreakdown[]
  by_score_bucket: ValidationBreakdown[]
  by_confidence_bucket: ValidationBreakdown[]
  // Outliers
  worst_predictions: ValidationResult[]
  best_predictions: ValidationResult[]
}

export interface ValidationBreakdown {
  category: string
  count: number
  mae_gross: number
  mae_net: number | null
  median_error_gross: number
  within_5_percent: number
  within_10_percent: number
}

// ========================================
// ACCURACY DASHBOARD TYPES (Phase 14)
// ========================================

export interface AccuracyMetrics {
  // Overall metrics
  total_predictions: number
  total_with_ground_truth: number
  coverage_percent: number
  
  // Error metrics
  mae_gross: number | null
  mae_net: number | null
  median_error_gross: number | null
  median_error_net: number | null
  rmse_gross: number | null
  rmse_net: number | null
  
  // Distribution
  within_5_inches: number
  within_10_inches: number
  within_15_inches: number
  within_5_percent: number
  within_10_percent: number
  
  // Trend data
  error_trend_7d: TrendPoint[]
  error_trend_30d: TrendPoint[]
  
  // Model version performance
  current_model_version: string | null
  model_accuracy_history: ModelAccuracyPoint[]
}

export interface TrendPoint {
  date: string
  mae: number
  count: number
}

export interface ModelAccuracyPoint {
  version_name: string
  created_at: string
  mae_gross: number | null
  sample_count: number
}

export interface AccuracyBreakdown {
  dimension: string // 'state' | 'rack_type' | 'score_bucket' | 'confidence_bucket'
  breakdown: {
    label: string
    count: number
    mae_gross: number | null
    mae_net: number | null
    within_10_percent: number
  }[]
}

export interface ErrorDistribution {
  bucket_label: string // e.g., "-20 to -15", "-15 to -10", etc.
  bucket_min: number
  bucket_max: number
  count: number
  percent: number
}

// ========================================
// INTAKE QUALITY TYPES (Phase 15)
// ========================================

export type IntakeQualityTier = 'excellent' | 'good' | 'fair' | 'poor'

export interface IntakeQualitySummary {
  tier: IntakeQualityTier
  overallScore: number
  strongestFactors: string[]
  weakestFactors: string[]
  confidenceAdjustment: number
  errorBandWidening: number
  recommendations: {
    type: 'add_angle' | 'retake' | 'improve_quality'
    priority: 'high' | 'medium' | 'low'
    angle?: AngleType
    message: string
    reason: string
  }[]
  summary: string
}

// Extended prediction with intake quality
export interface PredictionWithIntakeQuality extends Prediction {
  intake_quality?: IntakeQualitySummary | null
}

// ========================================
// PLACEMENT PREVIEW TYPES (Phase 18)
// ========================================

export type PlacementPreviewMode = 'studio' | 'wall' | 'room_image'

export type WallTone = 'white' | 'cream' | 'gray' | 'beige' | 'wood_light' | 'wood_dark' | 'brick' | 'stone'

export interface PlacementConfig {
  /** Preview mode: studio (neutral), wall backdrop, or room image */
  previewMode: PlacementPreviewMode
  /** Wall tone/texture (used for 'wall' mode) */
  wallTone: WallTone
  /** Horizontal position offset (-1 to 1, left to right) */
  horizontalOffset: number
  /** Vertical position offset (-1 to 1, bottom to top) */
  verticalOffset: number
  /** Scale multiplier (0.5 to 2.0) */
  scale: number
  /** Uploaded room image URL (for 'room_image' mode) */
  roomImageUrl: string | null
  /** Shadow intensity (0 to 1) */
  shadowIntensity: number
  /** Show mount bracket/hardware hint */
  showMountHint: boolean
}

export interface PlacementPreset {
  id: string
  name: string
  wallTone: WallTone
  description: string
}

// ========================================
// BULK VALIDATION & MODEL COMPARISON (Phase 19)
// ========================================

export type BulkRunType = 'single_model' | 'model_comparison'

export interface BulkValidationFilters {
  states?: string[]
  rackTypes?: RackType[]
  sourceTypes?: SourceType[]
  captureDevices?: CaptureDevice[]
  minImageCount?: number
  maxImageCount?: number
  scoreRangeMin?: number
  scoreRangeMax?: number
  verifiedOnly?: boolean
  dateRangeStart?: string
  dateRangeEnd?: string
  sampleSize?: number
  // Health-based filters (Phase 27)
  minHealthScore?: number
  healthTiers?: ('excellent' | 'good' | 'fair' | 'poor')[]
  excludeDuplicates?: boolean
  excludeOutliers?: boolean
  trainingEligibleOnly?: boolean
  validationEligibleOnly?: boolean
}

export interface BulkValidationRun {
  id: string
  run_name: string
  run_type: BulkRunType
  status: ValidationRunStatus
  // Model versions being compared
  primary_model_version_id: string | null
  comparison_model_version_ids: string[]
  // Calibration profile snapshot for reproducibility
  primary_calibration_profile_id: string | null
  comparison_calibration_profile_ids: string[]
  // Filters used
  filters: BulkValidationFilters | null
  filter_snapshot: string | null // JSON snapshot of filter state at run time
  // Snapshotted example IDs for reproducibility (source of truth for execution)
  example_ids: string[] | null
  // Progress
  total_examples: number
  processed_examples: number
  started_at: string | null
  completed_at: string | null
  // Aggregate metrics
  summary_metrics: BulkRunSummaryMetrics | null
  error_message: string | null
  created_at: string
  updated_at: string
}

export interface BulkRunSummaryMetrics {
  primary_model: ModelRunMetrics
  comparison_models: ModelRunMetrics[]
  improvement_vs_comparison: ImprovementMetrics[] | null
}

export interface ModelRunMetrics {
  model_version_id: string | null
  model_version_name: string | null
  example_count: number
  // Error metrics
  avg_gross_error: number
  avg_net_error: number | null
  median_gross_error: number
  median_net_error: number | null
  rmse_gross: number
  rmse_net: number | null
  // Distribution
  overestimation_count: number
  underestimation_count: number
  exact_count: number
  within_5_inches: number
  within_10_inches: number
  within_5_percent: number
  within_10_percent: number
  // Processing
  avg_processing_time_ms: number | null
  avg_confidence_percent: number | null
}

export interface ImprovementMetrics {
  comparison_model_version_id: string
  comparison_model_version_name: string | null
  mae_improvement_inches: number
  mae_improvement_percent: number
  examples_improved: number
  examples_worsened: number
  examples_unchanged: number
}

export interface BulkValidationResult {
  id: string
  bulk_run_id: string
  training_example_id: string
  buck_id: string
  // Ground truth
  ground_truth_gross: number
  ground_truth_net: number | null
  // Results by model version
  model_results: ModelPredictionResult[]
  // Metadata
  state: string | null
  rack_type: RackType | null
  source_type: SourceType | null
  image_count: number | null
  created_at: string
}

export interface ModelPredictionResult {
  model_version_id: string | null
  model_version_name: string | null
  // Raw vision output
  raw_vision_gross: number | null
  raw_vision_net: number | null
  // Normalized output
  normalized_gross: number | null
  normalized_net: number | null
  // Corrected/final output
  final_gross: number
  final_net: number | null
  // Errors
  error_gross: number
  error_net: number | null
  abs_error_gross: number
  abs_error_net: number | null
  percent_error_gross: number
  percent_error_net: number | null
  // Metadata
  confidence_percent: number | null
  scoring_method: string | null
  processing_time_ms: number | null
}

export interface ModelComparisonDetail {
  training_example_id: string
  buck_id: string
  ground_truth_gross: number
  ground_truth_net: number | null
  results: {
    model_version_id: string | null
    model_version_name: string | null
    final_gross: number
    final_net: number | null
    error_gross: number
    error_net: number | null
    improved_vs_primary: boolean | null
    error_diff_vs_primary: number | null
  }[]
  best_model_version_id: string | null
  worst_model_version_id: string | null
}

export interface BulkRunExportData {
  run: BulkValidationRun
  summary_metrics: BulkRunSummaryMetrics
  results: BulkValidationResult[]
  comparison_details: ModelComparisonDetail[]
}

// ========================================
// CALIBRATION & MODEL ROLLBACK (Phase 20)
// ========================================

export interface CalibrationProfile {
  id: string
  name: string
  description: string | null
  is_active: boolean
  model_version_id: string | null
  // Correction weights (0.0 to 2.0, 1.0 = default)
  spread_correction_weight: number
  beam_correction_weight: number
  tine_correction_weight: number
  mass_correction_weight: number
  deduction_correction_weight: number
  // Confidence and learning
  confidence_scaling: number // 0.5 to 1.5
  learning_correction_strength: number // 0.0 to 2.0
  // Caps
  max_total_correction: number // max absolute correction in inches
  max_spread_correction: number
  max_beam_correction: number
  max_tine_correction: number
  max_mass_correction: number
  // Metadata
  created_at: string
  updated_at: string
  created_by: string | null
}

export interface CalibrationProfileInput {
  name: string
  description?: string
  model_version_id?: string | null
  spread_correction_weight?: number
  beam_correction_weight?: number
  tine_correction_weight?: number
  mass_correction_weight?: number
  deduction_correction_weight?: number
  confidence_scaling?: number
  learning_correction_strength?: number
  max_total_correction?: number
  max_spread_correction?: number
  max_beam_correction?: number
  max_tine_correction?: number
  max_mass_correction?: number
}

export interface CalibrationChange {
  id: string
  calibration_profile_id: string | null
  model_version_id: string | null
  change_type: 'calibration_created' | 'calibration_updated' | 'calibration_activated' | 'calibration_deactivated' | 'model_activated' | 'model_rollback'
  old_values: Record<string, unknown> | null
  new_values: Record<string, unknown> | null
  changed_by: string | null
  reason: string | null
  created_at: string
}

export interface CalibrationPreviewRequest {
  proposed_profile: Partial<CalibrationProfile>
  validation_run_id?: string
  sample_size?: number
  include_breakdown?: boolean
}

export interface CalibrationPreviewResult {
  // Current vs proposed comparison
  current_profile_id: string | null
  proposed_profile: Partial<CalibrationProfile>
  // Metrics comparison
  current_metrics: CalibrationMetrics
  proposed_metrics: CalibrationMetrics
  // Improvement summary
  mae_improvement_inches: number
  mae_improvement_percent: number
  examples_improved: number
  examples_worsened: number
  examples_unchanged: number
  // Breakdown by category if requested
  breakdown_by_state?: CalibrationBreakdownItem[]
  breakdown_by_rack_type?: CalibrationBreakdownItem[]
  breakdown_by_score_range?: CalibrationBreakdownItem[]
  // Warnings/recommendations
  warnings: string[]
  recommendations: string[]
}

export interface CalibrationMetrics {
  mae_gross: number
  mae_net: number | null
  median_error_gross: number
  median_error_net: number | null
  overestimation_count: number
  underestimation_count: number
  within_5_inches: number
  within_10_inches: number
  within_5_percent: number
  within_10_percent: number
  sample_count: number
}

export interface CalibrationBreakdownItem {
  category: string
  current_mae: number
  proposed_mae: number
  improvement_inches: number
  improvement_percent: number
  sample_count: number
}

export interface ModelVersionWithCalibration extends ModelVersion {
  active_calibration_profile?: CalibrationProfile | null
  calibration_profiles?: CalibrationProfile[]
  last_activated_at?: string | null
  activation_history?: ModelActivationEvent[]
}

export interface ModelActivationEvent {
  id: string
  model_version_id: string
  previous_model_version_id: string | null
  calibration_profile_id: string | null
  activated_at: string
  activated_by: string | null
  reason: string | null
  is_rollback: boolean
}

export interface ModelRollbackRequest {
  target_model_version_id: string
  reason: string
  include_calibration?: boolean // Whether to also restore the calibration profile
}

export interface ModelRollbackResult {
  success: boolean
  previous_model_version_id: string | null
  new_model_version_id: string
  calibration_profile_id: string | null
  rollback_event_id: string
  warnings: string[]
}

// Calibration defaults
export const DEFAULT_CALIBRATION_VALUES = {
  spread_correction_weight: 1.0,
  beam_correction_weight: 1.0,
  tine_correction_weight: 1.0,
  mass_correction_weight: 1.0,
  deduction_correction_weight: 1.0,
  confidence_scaling: 1.0,
  learning_correction_strength: 1.0,
  max_total_correction: 8.0,
  max_spread_correction: 3.0,
  max_beam_correction: 4.0,
  max_tine_correction: 2.0,
  max_mass_correction: 1.0,
} as const

// Safe ranges for calibration values
export const CALIBRATION_SAFE_RANGES = {
  spread_correction_weight: { min: 0.0, max: 2.0 },
  beam_correction_weight: { min: 0.0, max: 2.0 },
  tine_correction_weight: { min: 0.0, max: 2.0 },
  mass_correction_weight: { min: 0.0, max: 2.0 },
  deduction_correction_weight: { min: 0.0, max: 2.0 },
  confidence_scaling: { min: 0.5, max: 1.5 },
  learning_correction_strength: { min: 0.0, max: 2.0 },
  max_total_correction: { min: 1.0, max: 15.0 },
  max_spread_correction: { min: 0.5, max: 6.0 },
  max_beam_correction: { min: 0.5, max: 8.0 },
  max_tine_correction: { min: 0.5, max: 4.0 },
  max_mass_correction: { min: 0.2, max: 2.0 },
} as const

// ========================================
// MEASUREMENT-LEVEL CORRECTION TYPES (Phase 21)
// ========================================

export type MeasurementCategory = 'spread' | 'beam' | 'tine' | 'mass' | 'deduction'

export interface CategoryCorrectionSummary {
  category: MeasurementCategory
  originalTotal: number
  correctedTotal: number
  correctionAmount: number
  correctionPercent: number
  confidence: number
  sampleCount: number
  direction: 'increase' | 'decrease' | 'none'
  capped: boolean
  cappingReason: string | null
}

export interface FieldCorrectionDetail {
  field: string
  category: MeasurementCategory
  originalValue: number
  correction: number
  correctedValue: number
  confidence: number
  sampleCount: number
}

export interface MeasurementCorrectionSummary {
  totalFieldsCorrected: number
  totalCategoriesCorrected: number
  strongestCorrection: {
    category: MeasurementCategory
    amount: number
    direction: 'increase' | 'decrease'
  } | null
  weakestCategory: MeasurementCategory | null
  overallCorrectionDirection: 'increase' | 'decrease' | 'mixed' | 'none'
  grossCorrectionApplied: number
  netCorrectionApplied: number
  confidenceWeightedAvg: number
  verifiedExamplesUsed: number
  highlySimilarExamplesUsed: number
  correctionStrength: 'none' | 'low' | 'medium' | 'high'
  notes: string[]
  categoryCorrections?: CategoryCorrectionSummary[]
  fieldCorrections?: FieldCorrectionDetail[]
}

export interface MeasurementLevelMetrics {
  // Per-category MAE before and after correction
  spreadMaeBefore: number | null
  spreadMaeAfter: number | null
  beamMaeBefore: number | null
  beamMaeAfter: number | null
  tineMaeBefore: number | null
  tineMaeAfter: number | null
  massMaeBefore: number | null
  massMaeAfter: number | null
  // Improvement metrics
  spreadImprovement: number | null
  beamImprovement: number | null
  tineImprovement: number | null
  massImprovement: number | null
  // Which categories are improving
  categoriesImproved: MeasurementCategory[]
  categoriesWorsened: MeasurementCategory[]
  categoriesUnchanged: MeasurementCategory[]
}

export interface MeasurementErrorSnapshot {
  spread?: number
  beam?: number
  tine?: number
  mass?: number
  deduction?: number
}

export interface ValidationResultWithMeasurements extends ValidationResult {
  measurement_errors_before?: MeasurementErrorSnapshot | null
  measurement_errors_after?: MeasurementErrorSnapshot | null
  category_corrections_applied?: Record<MeasurementCategory, number> | null
}

export interface AccuracyMetricsWithMeasurements extends AccuracyMetrics {
  measurement_level?: MeasurementLevelMetrics | null
}

export interface ExtendedLearningSummaryWithMeasurements extends ExtendedLearningSummary {
  measurementCorrectionSummary?: MeasurementCorrectionSummary | null
}

// ========================================
// PHASE 23: SMART SECOND-PASS SCORING
// ========================================

export type SelfCheckIssueSeverity = 'low' | 'medium' | 'high' | 'critical'
export type SelfCheckIssueType = 
  | 'spread_ear_mismatch'
  | 'beam_angle_inconsistency'
  | 'tine_pattern_inconsistent'
  | 'mass_out_of_range'
  | 'extreme_asymmetry'
  | 'image_disagreement'
  | 'confidence_stability_mismatch'
  | 'anatomical_ratio_violation'
  | 'normalization_heavy'
  | 'landmark_consistency_poor'
  | 'measurement_correction_large'
  | 'score_range_implausible'
  | 'component_variance_high'

export interface SelfCheckIssue {
  type: SelfCheckIssueType
  severity: SelfCheckIssueSeverity
  description: string
  affectedMeasurements: string[]
  suggestedAction: 'verify' | 'adjust_weights' | 'use_alternative_scaling' | 'reduce_confidence' | 'trigger_second_pass'
  metadata?: Record<string, unknown>
}

export interface SelfCheckSummary {
  issues: SelfCheckIssue[]
  overallStability: 'stable' | 'uncertain' | 'unstable'
  stabilityScore: number
  triggerSecondPass: boolean
  secondPassReasons: string[]
  componentVariance: {
    spread: number
    beams: number
    tines: number
    mass: number
  }
  confidenceAdjustment: number
  summary: string
}

export type FinalSelectionMethod = 
  | 'first_pass' 
  | 'second_pass' 
  | 'blend_weighted' 
  | 'blend_conservative'

export interface FinalResultSelection {
  method: FinalSelectionMethod
  reason: string
  confidence: number
  firstPassWeight: number
  secondPassWeight: number
  blendingApplied: boolean
}

export interface PassComparisonMetrics {
  grossDifference: number
  netDifference: number
  confidenceDifference: number
  stabilityImprovement: number
  measurementChanges: {
    field: string
    firstPass: number
    secondPass: number
    change: number
    changePercent: number
  }[]
}

export interface TwoPassScoringMetadata {
  secondPassRan: boolean
  selfCheck: SelfCheckSummary
  firstPassGross: number
  firstPassNet: number
  firstPassConfidence: number
  secondPassGross: number | null
  secondPassNet: number | null
  secondPassConfidence: number | null
  passComparison: PassComparisonMetrics | null
  selection: FinalResultSelection
  adjustmentsSummary: string
  secondPassReasons: string[]
  processingTimeMs: number
}

export interface SecondPassAdjustmentsSummary {
  angleWeightChanges: Record<string, number>
  scalingEmphasis: 'ears' | 'eyes' | 'combined' | 'size_priors'
  scalingStrength: number
  tightenedConstraints: boolean
  constraintStrength: number
  adjustmentReasons: string[]
}

// Extended prediction with two-pass metadata
export interface PredictionWithTwoPass extends Prediction {
  two_pass_metadata?: TwoPassScoringMetadata | null
}

// Extended validation result with second-pass error tracking
export interface ValidationResultWithSecondPass extends ValidationResult {
  first_pass_error_gross?: number | null
  first_pass_error_net?: number | null
  second_pass_error_gross?: number | null
  second_pass_error_net?: number | null
  final_selection_method?: FinalSelectionMethod | null
  second_pass_ran?: boolean
  second_pass_improved?: boolean | null
  improvement_amount?: number | null
}

// Accuracy metrics with second-pass breakdown
export interface AccuracyMetricsWithSecondPass extends AccuracyMetrics {
  second_pass_metrics?: SecondPassAccuracyMetrics | null
}

export interface SecondPassAccuracyMetrics {
  // How often second pass runs
  total_predictions_with_two_pass: number
  second_pass_trigger_rate: number
  
  // Error comparison
  first_pass_only_mae: number | null
  with_second_pass_mae: number | null
  mae_improvement: number | null
  
  // Selection method breakdown
  selection_method_counts: Record<FinalSelectionMethod, number>
  
  // Issue type frequency
  issue_type_frequency: Record<SelfCheckIssueType, number>
  
  // Stability distribution
  stable_count: number
  uncertain_count: number
  unstable_count: number
  
  // Which scenarios benefit most
  best_improvement_scenarios: {
    scenario: string
    improvement: number
    sampleCount: number
  }[]
}

// ========================================
// PHASE 24: VISION/RUNTIME HARDENING
// ========================================

export type VisionRuntimeErrorType =
  | 'timeout'
  | 'rate_limit'
  | 'provider_error'
  | 'network_error'
  | 'malformed_response'
  | 'incomplete_response'
  | 'validation_error'
  | 'quota_exceeded'
  | 'model_unavailable'
  | 'content_policy'
  | 'unknown'

export type FallbackReason =
  | 'vision_timeout'
  | 'vision_provider_error'
  | 'vision_rate_limit'
  | 'vision_quota_exceeded'
  | 'vision_model_unavailable'
  | 'vision_malformed_response'
  | 'vision_validation_failed'
  | 'vision_content_blocked'
  | 'image_validation_failed'
  | 'no_valid_images'
  | 'all_images_inaccessible'
  | 'unknown_error'

export type FallbackStrategy =
  | 'heuristic_full'
  | 'heuristic_degraded'
  | 'safe_minimum'
  | 'error_response'

export type ImageValidationIssueType =
  | 'missing_url'
  | 'invalid_url_format'
  | 'url_inaccessible'
  | 'unsupported_file_type'
  | 'zero_byte_file'
  | 'file_too_large'
  | 'duplicate_image'
  | 'data_url_malformed'
  | 'signed_url_expired'
  | 'private_url'
  | 'timeout_checking'

export interface RuntimeErrorInfo {
  type: VisionRuntimeErrorType
  message: string
  retryable: boolean
  attempt?: number
  totalAttempts?: number
}

export interface RuntimeMetadataInfo {
  totalAttempts: number
  successfulAttempt: number | null
  totalTimeMs: number
  retryDelaysMs: number[]
  timedOut: boolean
  wasRetried: boolean
}

export interface ImageValidationIssueInfo {
  imageIndex: number
  issueType: ImageValidationIssueType
  severity: 'error' | 'warning' | 'info'
  message: string
  recoverable: boolean
}

export interface FallbackMetadataInfo {
  usedFallback: boolean
  fallbackReason: FallbackReason | null
  fallbackStrategy: FallbackStrategy | null
  visionErrorTypes: VisionRuntimeErrorType[]
  imageValidationIssues: ImageValidationIssueInfo[]
  validImageCount: number
  totalImageCount: number
  confidencePenalty: number
  errorBandWidening: number
  summary: string
  timestamp: string
}

export interface RuntimeHealthMetrics {
  // Overall health
  totalPredictions: number
  visionSuccessRate: number
  fallbackRate: number
  
  // Error breakdown
  errorTypeCounts: Record<VisionRuntimeErrorType, number>
  fallbackReasonCounts: Record<FallbackReason, number>
  
  // Timing
  avgVisionTimeMs: number | null
  p95VisionTimeMs: number | null
  timeoutRate: number
  
  // Image validation
  avgValidImagesPerRequest: number
  imageValidationFailRate: number
  commonImageIssues: { type: ImageValidationIssueType; count: number }[]
  
  // Retry stats
  retryRate: number
  avgRetriesPerFailure: number
  
  // By time period
  healthTrend7d: {
    date: string
    successRate: number
    fallbackRate: number
    avgTimeMs: number
  }[]
}

// Extended prediction with runtime metadata
export interface PredictionWithRuntime extends Prediction {
  fallback_metadata?: FallbackMetadataInfo | null
  runtime_metadata?: RuntimeMetadataInfo | null
  image_validation_summary?: {
    validCount: number
    totalCount: number
    issues: ImageValidationIssueInfo[]
  } | null
}

// Extended scoring output with runtime info
export interface ScoringOutputWithRuntime {
  // Standard scoring output fields
  predictedGross: number
  predictedNet: number
  confidencePercent: number
  errorBandLow: number
  errorBandHigh: number
  measurements: Measurements
  landmarks: LandmarksDetected
  stateCalibration: StateCalibration
  processingTimeMs: number
  imagesUsed: number
  angleDiversityScore: number
  confidenceExplanation: string[]
  scalingReferencesUsed: string[]
  visionModelUsed: string | null
  scoringMethod: 'vision' | 'heuristic' | 'vision_with_fallback'
  visionConfidence: number | null
  
  // Phase 24 runtime metadata
  fallbackMetadata?: FallbackMetadataInfo | null
  runtimeMetadata?: RuntimeMetadataInfo | null
  imageValidationSummary?: {
    valid: boolean
    validCount: number
    totalCount: number
    warningsOnly: boolean
    issues: ImageValidationIssueInfo[]
  } | null
}

// ========================================
// PHASE 25: CONFIDENCE CALIBRATION + TRUST SCORING
// ========================================

export type ConfidenceTier = 'very_high' | 'high' | 'medium' | 'low' | 'very_low'
export type TrustTier = 'excellent' | 'good' | 'fair' | 'limited' | 'uncertain'

export interface CalibratedConfidenceInfo {
  rawConfidence: number
  calibratedConfidence: number
  tier: ConfidenceTier
  tierLabel: string
  expectedMae: number
  expectedErrorBandLow: number
  expectedErrorBandHigh: number
  calibrationSource: 'historical_data' | 'scenario_specific' | 'default_mapping'
  scenarioUsed: string | null
}

export interface TrustScoreInfo {
  overallScore: number
  tier: TrustTier
  tierLabel: string
  componentScores: Record<string, number>
  positiveFactors: string[]
  negativeFactors: string[]
  primaryConcerns: string[]
  summary: string
  recommendations: string[]
}

export interface ConfidenceTrustMetadata {
  // Calibrated confidence
  rawConfidence: number
  calibratedConfidence: number
  confidenceTier: ConfidenceTier
  expectedMae: number
  
  // Trust score
  trustScore: number
  trustTier: TrustTier
  
  // Combined explanation
  confidenceExplanation: string[]
  trustExplanation: string[]
  
  // Top factors
  topPositiveFactors: string[]
  topNegativeFactors: string[]
  recommendations: string[]
}

// Extended prediction with confidence/trust metadata
export interface PredictionWithConfidenceTrust extends Prediction {
  calibrated_confidence?: number | null
  confidence_tier?: ConfidenceTier | null
  raw_confidence?: number | null
  trust_score?: number | null
  trust_tier?: TrustTier | null
  expected_mae?: number | null
  confidence_trust_metadata?: ConfidenceTrustMetadata | null
}

// Confidence calibration metrics for admin
export interface ConfidenceCalibrationMetrics {
  // Overall calibration quality
  totalPredictionsAnalyzed: number
  
  // Calibration accuracy
  calibrationSlope: number | null // Should be close to 1.0
  calibrationIntercept: number | null // Should be close to 0
  calibrationR2: number | null // Higher is better
  
  // Tier accuracy
  tierAccuracy: {
    tier: ConfidenceTier
    predictedMae: number
    actualMae: number
    sampleCount: number
    accuracy: number // How close predicted was to actual
  }[]
  
  // Overconfidence/underconfidence
  overconfidentPercent: number // High confidence but high error
  underconfidentPercent: number // Low confidence but low error
  
  // Confidence-error correlation
  confidenceErrorCorrelation: number | null
  
  // Trust score effectiveness
  trustScoreCorrelation: number | null
  highTrustAvgError: number | null
  lowTrustAvgError: number | null
}

export interface ConfidenceCalibrationPoint {
  confidenceBucket: string
  avgRawConfidence: number
  avgCalibratedConfidence: number
  actualMae: number
  sampleCount: number
  within5InchesPercent: number
  within10InchesPercent: number
}

// ========================================
// BENCHMARK PACKS & PROMOTION (Phase 26)
// ========================================

export interface BenchmarkPack {
  id: string
  name: string
  description: string | null
  tags: string[]
  is_archived: boolean
  example_count: number
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface BenchmarkPackInput {
  name: string
  description?: string
  tags?: string[]
  example_ids: string[]
}

export interface BenchmarkPackExample {
  id: string
  benchmark_pack_id: string
  training_example_id: string
  ground_truth_gross: number | null
  ground_truth_net: number | null
  state: string | null
  rack_type: string | null
  source_type: string | null
  added_at: string
}

export interface BenchmarkRun {
  id: string
  benchmark_pack_id: string
  bulk_validation_run_id: string
  run_purpose: 'release_candidate' | 'regression_test' | 'ad_hoc' | null
  run_notes: string | null
  active_model_version_id: string | null
  candidate_model_version_id: string | null
  active_calibration_profile_id: string | null
  candidate_calibration_profile_id: string | null
  guardrail_config: RegressionGuardrailConfig | null
  guardrail_results: GuardrailEvaluationResult | null
  all_guardrails_passed: boolean | null
  created_at: string
}

export interface BenchmarkRunWithDetails extends BenchmarkRun {
  pack_name: string
  pack_example_count: number
  bulk_run_status: string
  total_examples: number
  processed_examples: number
  active_model_name: string | null
  candidate_model_name: string | null
  active_calibration_name: string | null
  candidate_calibration_name: string | null
}

export interface BenchmarkRunInput {
  benchmark_pack_id: string
  run_purpose?: 'release_candidate' | 'regression_test' | 'ad_hoc'
  run_notes?: string
  active_model_version_id?: string
  candidate_model_version_id?: string
  active_calibration_profile_id?: string
  candidate_calibration_profile_id?: string
  guardrail_config?: RegressionGuardrailConfig
}

// Guardrails configuration
export interface RegressionGuardrailConfig {
  // Absolute error thresholds
  max_avg_gross_error_inches: number
  max_avg_net_error_inches: number | null
  
  // Regression vs active model thresholds
  max_regression_vs_active_inches: number
  max_regression_vs_active_percent: number
  
  // Accuracy thresholds
  min_within_5_inches_percent: number
  min_within_10_inches_percent: number
  
  // Confidence calibration drift
  max_overconfidence_drift_percent: number
  
  // Subgroup regression limits
  max_subgroup_regression_inches: number
  subgroups_to_check: ('state' | 'rack_type' | 'source_type')[]
}

export const DEFAULT_GUARDRAIL_CONFIG: RegressionGuardrailConfig = {
  max_avg_gross_error_inches: 8.0,
  max_avg_net_error_inches: 6.0,
  max_regression_vs_active_inches: 1.0,
  max_regression_vs_active_percent: 10.0,
  min_within_5_inches_percent: 40.0,
  min_within_10_inches_percent: 70.0,
  max_overconfidence_drift_percent: 5.0,
  max_subgroup_regression_inches: 2.0,
  subgroups_to_check: ['state', 'rack_type', 'source_type']
}

// Individual guardrail result
export interface GuardrailCheckResult {
  name: string
  description: string
  passed: boolean
  threshold: number
  actual: number
  unit: string
  severity: 'critical' | 'warning' | 'info'
}

// Full guardrail evaluation
export interface GuardrailEvaluationResult {
  overall_passed: boolean
  critical_failures: number
  warning_failures: number
  checks: GuardrailCheckResult[]
  subgroup_results: {
    subgroup_type: string
    subgroup_value: string
    passed: boolean
    active_mae: number
    candidate_mae: number
    regression_inches: number
  }[]
  summary: string
}

// Promotion decisions
export type PromotionDecisionType = 'promote' | 'reject' | 'defer'

export interface PromotionDecision {
  id: string
  benchmark_run_id: string | null
  decision: PromotionDecisionType
  decision_reason: string | null
  decision_notes: string | null
  candidate_model_version_id: string | null
  candidate_calibration_profile_id: string | null
  active_model_version_id: string | null
  active_calibration_profile_id: string | null
  metrics_snapshot: PromotionMetricsSnapshot | null
  guardrail_results: GuardrailEvaluationResult | null
  decided_by: string | null
  decided_at: string
  created_at: string
}

export interface PromotionDecisionWithDetails extends PromotionDecision {
  candidate_model_name: string | null
  active_model_name: string | null
  candidate_calibration_name: string | null
  active_calibration_name: string | null
  benchmark_pack_id: string | null
  benchmark_pack_name: string | null
}

export interface PromotionDecisionInput {
  benchmark_run_id?: string
  decision: PromotionDecisionType
  decision_reason: string
  decision_notes?: string
  candidate_model_version_id?: string
  candidate_calibration_profile_id?: string
  active_model_version_id?: string
  active_calibration_profile_id?: string
  metrics_snapshot?: PromotionMetricsSnapshot
  guardrail_results?: GuardrailEvaluationResult
  decided_by?: string
}

// Metrics snapshot for promotion decisions
export interface PromotionMetricsSnapshot {
  active_model: {
    model_version_id: string
    model_name: string
    avg_gross_error: number
    avg_net_error: number | null
    within_5_inches_percent: number
    within_10_inches_percent: number
    sample_count: number
  }
  candidate_model: {
    model_version_id: string
    model_name: string
    avg_gross_error: number
    avg_net_error: number | null
    within_5_inches_percent: number
    within_10_inches_percent: number
    sample_count: number
  }
  comparison: {
    gross_error_improvement_inches: number
    gross_error_improvement_percent: number
    net_error_improvement_inches: number | null
    net_error_improvement_percent: number | null
    examples_improved: number
    examples_regressed: number
    examples_unchanged: number
  }
  confidence_metrics?: {
    active_overconfident_percent: number
    candidate_overconfident_percent: number
    overconfidence_drift: number
  }
}

// Promotion readiness summary for UI
export interface PromotionReadinessSummary {
  benchmark_pack: BenchmarkPack
  benchmark_run: BenchmarkRunWithDetails | null
  active_model: {
    id: string
    name: string
    metrics: ModelBenchmarkMetrics
  } | null
  candidate_model: {
    id: string
    name: string
    metrics: ModelBenchmarkMetrics
  }
  comparison: ModelComparisonSummary | null
  guardrail_evaluation: GuardrailEvaluationResult | null
  recommendation: 'ready_to_promote' | 'needs_review' | 'not_recommended' | 'insufficient_data'
  recommendation_reasons: string[]
}

export interface ModelBenchmarkMetrics {
  avg_gross_error: number
  avg_net_error: number | null
  median_gross_error: number
  median_net_error: number | null
  within_5_inches_count: number
  within_5_inches_percent: number
  within_10_inches_count: number
  within_10_inches_percent: number
  overestimation_count: number
  underestimation_count: number
  sample_count: number
  by_state?: Record<string, { avg_error: number; count: number }>
  by_rack_type?: Record<string, { avg_error: number; count: number }>
  by_source_type?: Record<string, { avg_error: number; count: number }>
}

export interface ModelComparisonSummary {
  gross_error_diff_inches: number
  gross_error_diff_percent: number
  net_error_diff_inches: number | null
  net_error_diff_percent: number | null
  accuracy_5_inch_diff: number
  accuracy_10_inch_diff: number
  examples_improved: number
  examples_regressed: number
  examples_unchanged: number
  improvement_rate: number // % of examples that improved
  regression_rate: number // % of examples that regressed
}

// ========================================
// DATASET HEALTH + QUALITY CONTROLS (Phase 27)
// ========================================

export type HealthTier = 'excellent' | 'good' | 'fair' | 'poor' | 'excluded' | 'unknown'
export type ScoreSourceStrength = 'official' | 'verified' | 'self_reported' | 'estimated' | 'unknown'
export type OutlierType = 'score_outlier' | 'error_outlier' | 'measurement_outlier' | 'metadata_outlier' | 'correction_instability'
export type OutlierSeverity = 'mild' | 'moderate' | 'severe'
export type DuplicateClusterType = 'exact' | 'near' | 'suspected'
export type HealthReviewDecision = 'approve_training' | 'validation_only' | 'exclude' | 'mark_duplicate' | 'needs_more_info' | 'defer'

// Health factors breakdown for explainability
export interface HealthFactors {
  // Score-related factors (0-100 scale each)
  score_source_quality: number // official=100, verified=80, self=50, estimated=20
  verification_status: number // verified=100, unverified=50
  
  // Image quality factors
  image_count_factor: number // 4+=100, 3=85, 2=70, 1=50
  angle_diversity_factor: number // based on angle_diversity_score
  image_quality_factor: number // from intake_quality
  
  // Metadata completeness factors
  metadata_completeness: number // % of key fields filled
  
  // Consistency factors
  measurement_consistency: number // from quality_flags
  error_stability: number // low variance in corrections over time
  
  // Trust signals
  trust_score_factor: number // from trust score if available
  confidence_factor: number // from prediction confidence
  
  // Negative signals (reduce health)
  outlier_penalty: number // 0 if not outlier, -10 to -50 if outlier
  duplicate_penalty: number // 0 if not duplicate, -20 to -40 if duplicate
  suspect_metadata_penalty: number // 0 or -20
  
  // Computed totals
  raw_score: number // sum before normalization
  normalized_score: number // 0-100 final health score
  
  // Explanation
  top_strengths: string[]
  top_weaknesses: string[]
}

// Extended TrainingExample with health fields
export interface TrainingExampleWithHealth extends TrainingExample {
  // Health scoring
  health_score: number | null
  health_tier: HealthTier
  health_computed_at: string | null
  health_factors: HealthFactors | null
  
  // Usability flags
  usable_for_training: boolean | null
  usable_for_validation: boolean | null
  is_low_quality: boolean
  is_duplicate: boolean
  is_near_duplicate: boolean
  duplicate_of_id: string | null
  has_suspect_metadata: boolean
  is_outlier: boolean
  needs_review: boolean
  review_reason: string | null
  
  // Score source strength
  score_source_strength: ScoreSourceStrength
}

// Health review decision record
export interface HealthReviewDecisionRecord {
  id: string
  training_example_id: string
  decision: HealthReviewDecision
  previous_usable_for_training: boolean | null
  previous_usable_for_validation: boolean | null
  decision_reason: string | null
  decision_notes: string | null
  decided_by: string | null
  decided_at: string
  created_at: string
}

// Input for submitting a health review decision
export interface HealthReviewDecisionInput {
  training_example_id: string
  decision: HealthReviewDecision
  decision_reason: string
  decision_notes?: string
  decided_by?: string
}

// Duplicate cluster
export interface DuplicateCluster {
  id: string
  cluster_type: DuplicateClusterType
  cluster_reason: string | null
  primary_example_id: string | null
  example_count: number
  is_resolved: boolean
  resolved_by: string | null
  resolved_at: string | null
  resolution_notes: string | null
  created_at: string
  updated_at: string
}

// Duplicate cluster member
export interface DuplicateClusterMember {
  id: string
  cluster_id: string
  training_example_id: string
  similarity_score: number | null
  similarity_factors: {
    same_buck: boolean
    image_similarity?: number
    measurement_similarity?: number
    metadata_similarity?: number
  } | null
  is_primary: boolean
  added_at: string
}

// Duplicate cluster with members
export interface DuplicateClusterWithMembers extends DuplicateCluster {
  members: (DuplicateClusterMember & {
    example?: TrainingExampleWithHealth
    buck?: Buck
    prediction?: Prediction
    ground_truth?: GroundTruthScore
  })[]
}

// Outlier record
export interface OutlierRecord {
  id: string
  training_example_id: string
  outlier_type: OutlierType
  severity: OutlierSeverity
  outlier_reason: string
  statistical_details: {
    z_score?: number
    percentile?: number
    expected_range?: [number, number]
    actual_value?: number
    comparison_group_size?: number
  } | null
  is_resolved: boolean
  resolution_action: string | null
  resolved_by: string | null
  resolved_at: string | null
  detected_at: string
  created_at: string
}

// Health computation run
export interface HealthComputationRun {
  id: string
  run_type: 'full' | 'incremental' | 'single'
  examples_processed: number
  duplicates_detected: number
  outliers_detected: number
  examples_flagged_for_review: number
  computation_time_ms: number | null
  run_config: {
    include_duplicate_detection?: boolean
    include_outlier_detection?: boolean
    duplicate_threshold?: number
    outlier_z_threshold?: number
  } | null
  run_stats: {
    by_health_tier?: Record<HealthTier, number>
    avg_health_score?: number
    median_health_score?: number
  } | null
  started_at: string
  completed_at: string | null
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  error_message: string | null
  created_at: string
}

// Dataset health summary (from view)
export interface DatasetHealthSummary {
  health_tier: HealthTier
  example_count: number
  avg_health_score: number | null
  training_eligible: number
  validation_eligible: number
  low_quality_count: number
  duplicate_count: number
  outlier_count: number
  needs_review_count: number
}

// Health summary totals
export interface DatasetHealthTotals {
  total_examples: number
  healthy_examples: number // excellent + good
  fair_examples: number
  unhealthy_examples: number // poor + excluded
  training_eligible: number
  validation_eligible: number
  needs_review: number
  duplicates: number
  outliers: number
  uncomputed: number // health_score is null
  avg_health_score: number | null
}

// Health by breakdown (source type, image count, etc.)
export interface DatasetHealthBreakdown {
  category: string
  example_count: number
  avg_health_score: number | null
  excellent_count: number
  good_count: number
  fair_count: number
  poor_count: number
  training_eligible: number
}

// Filters for querying training examples with health
export interface HealthFilterOptions {
  health_tier?: HealthTier | HealthTier[]
  min_health_score?: number
  max_health_score?: number
  usable_for_training?: boolean
  usable_for_validation?: boolean
  is_low_quality?: boolean
  is_duplicate?: boolean
  is_outlier?: boolean
  needs_review?: boolean
  score_source_strength?: ScoreSourceStrength | ScoreSourceStrength[]
  verified_only?: boolean
  exclude_duplicates?: boolean
  exclude_outliers?: boolean
}

// Config for health computation
export interface HealthComputationConfig {
  // Duplicate detection settings
  enable_duplicate_detection: boolean
  duplicate_same_buck_check: boolean
  duplicate_measurement_similarity_threshold: number // 0-1
  
  // Outlier detection settings
  enable_outlier_detection: boolean
  outlier_z_score_threshold: number // typically 2.5 or 3
  outlier_error_percentile_threshold: number // e.g., 95
  
  // Health score weights
  weights: {
    score_source: number
    verification: number
    image_count: number
    angle_diversity: number
    image_quality: number
    metadata_completeness: number
    measurement_consistency: number
    trust_score: number
    confidence: number
  }
  
  // Tier thresholds
  tier_thresholds: {
    excellent: number // e.g., 85
    good: number // e.g., 70
    fair: number // e.g., 50
    poor: number // e.g., 30
    // below poor = excluded
  }
}

// Default health computation config
export const DEFAULT_HEALTH_CONFIG: HealthComputationConfig = {
  enable_duplicate_detection: true,
  duplicate_same_buck_check: true,
  duplicate_measurement_similarity_threshold: 0.95,
  
  enable_outlier_detection: true,
  outlier_z_score_threshold: 2.5,
  outlier_error_percentile_threshold: 95,
  
  weights: {
    score_source: 20,
    verification: 15,
    image_count: 12,
    angle_diversity: 10,
    image_quality: 10,
    metadata_completeness: 8,
    measurement_consistency: 10,
    trust_score: 8,
    confidence: 7,
  },
  
  tier_thresholds: {
    excellent: 85,
    good: 70,
    fair: 50,
    poor: 30,
  }
}

// ========================================
// INFLUENCE WEIGHTING + SAFE LEARNING (Phase 28)
// ========================================

// Influence factors breakdown for explainability
export interface InfluenceFactors {
  // Quality-based factors (0-1 scale)
  health_score_factor: number
  verification_strength_factor: number
  image_quality_factor: number
  metadata_completeness_factor: number
  error_stability_factor: number // Low variance in corrections over time
  
  // Computed values
  base_influence: number // Before similarity bonus
  similarity_bonus: number // Added based on match to current buck
  final_influence: number // After all factors
  
  // Explanations
  top_boosters: string[]
  top_reducers: string[]
}

// Similarity factors for matching
export interface SimilarityFactors {
  state_match: boolean
  state_region_match: boolean
  rack_type_match: boolean
  frame_size_similarity: number // 0-1
  source_type_match: boolean
  capture_device_match: boolean
  image_count_similarity: number // 0-1
  ears_visibility_match: boolean
  harvest_method_match: boolean
  angle_diversity_similarity: number // 0-1
  confidence_tier_match: boolean
  
  // Computed
  total_similarity: number // 0-1
  matching_features: string[]
  missing_features: string[]
}

// Training example with influence weight
export interface TrainingExampleWithInfluence extends TrainingExampleWithHealth {
  influence_weight: number
  influence_factors: InfluenceFactors | null
  influence_computed_at: string | null
  training_eligibility_reason: string | null
}

// Learning correction log entry
export interface LearningCorrectionLog {
  id: string
  buck_id: string | null
  prediction_id: string | null
  gross_correction: number
  net_correction: number | null
  confidence_boost: number | null
  aggregation_method: 'weighted_mean' | 'trimmed_mean' | 'median' | 'robust_mean'
  pre_cap_gross_correction: number | null
  cap_applied: boolean
  cap_reason: string | null
  contributing_examples_count: number
  highly_similar_count: number | null
  total_influence_weight: number | null
  avg_similarity: number | null
  max_similarity: number | null
  min_similarity: number | null
  correction_direction: 'increase' | 'decrease' | 'mixed' | 'none'
  measurement_corrections: Record<string, number> | null
  influential_examples: InfluentialExampleDetail[] | null
  scenario_context: ScenarioContext | null
  created_at: string
}

// Detailed contribution from one example
export interface InfluentialExampleDetail {
  example_id: string
  buck_id: string
  similarity_score: number
  influence_weight: number
  effective_weight: number
  error_contribution: number
  weighted_contribution: number
  matching_features: string[]
  ground_truth_score: number
  predicted_score: number
  state: string | null
  rack_type: string | null
}

// Scenario context for a correction
export interface ScenarioContext {
  state: string
  rack_type: string
  source_type: string | null
  capture_device: string | null
  image_count: number
  angle_diversity: number
  base_vision_confidence: number
}

// Correction contribution tracking
export interface CorrectionContribution {
  id: string
  correction_log_id: string
  training_example_id: string
  similarity_score: number
  influence_weight: number
  effective_weight: number
  error_contribution: number
  weighted_contribution: number
  similarity_factors: SimilarityFactors | null
  created_at: string
}

// Drift detection types
export type DriftType = 
  | 'directional_bias'
  | 'magnitude_drift'
  | 'measurement_drift'
  | 'scenario_drift'
  | 'confidence_divergence'

export type DriftSeverity = 'low' | 'medium' | 'high' | 'critical'

export type DriftAction = 
  | 'none'
  | 'reduced_learning_strength'
  | 'increased_evidence_threshold'
  | 'flagged_for_review'
  | 'temporarily_disabled'

// Drift detection log entry
export interface DriftDetectionLog {
  id: string
  drift_type: DriftType
  severity: DriftSeverity
  detection_window_hours: number
  samples_analyzed: number
  drift_metrics: DriftMetrics
  action_taken: DriftAction | null
  action_details: Record<string, unknown> | null
  is_resolved: boolean
  resolved_by: string | null
  resolved_at: string | null
  resolution_notes: string | null
  detected_at: string
  created_at: string
}

// Drift metrics (varies by drift type)
export interface DriftMetrics {
  // For directional_bias
  positive_corrections?: number
  negative_corrections?: number
  bias_ratio?: number
  
  // For magnitude_drift
  avg_correction_magnitude?: number
  magnitude_trend?: number // positive = increasing
  
  // For measurement_drift
  affected_measurement?: string
  measurement_bias?: number
  
  // For scenario_drift
  scenario?: string
  scenario_bias?: number
  
  // For confidence_divergence
  correlation_with_confidence?: number
  expected_direction_match_rate?: number
}

// Influence configuration
export interface InfluenceConfig {
  id: string
  config_name: string
  is_active: boolean
  weight_factors: InfluenceWeightFactors
  safety_caps: SafetyCaps
  drift_protection: DriftProtectionSettings
  eligibility_rules: EligibilityRules
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface InfluenceWeightFactors {
  health_score: number
  verification_strength: number
  image_quality: number
  metadata_completeness: number
  error_stability: number
  similarity_bonus: number
}

export interface SafetyCaps {
  max_per_example_influence: number
  max_total_correction_inches: number
  max_per_measurement_correction_percent: number
  min_examples_for_correction: number
  min_total_influence_weight: number
}

export interface DriftProtectionSettings {
  enabled: boolean
  directional_bias_threshold: number
  magnitude_drift_threshold: number
  detection_window_hours: number
  min_samples_for_detection: number
  auto_reduce_strength_on_drift: boolean
  strength_reduction_factor: number
}

export interface EligibilityRules {
  require_usable_for_training: boolean
  min_health_score: number
  exclude_outliers: boolean
  exclude_duplicates: boolean
  low_quality_weight_multiplier: number
}

// Default influence configuration
export const DEFAULT_INFLUENCE_CONFIG: Omit<InfluenceConfig, 'id' | 'created_at' | 'updated_at'> = {
  config_name: 'default',
  is_active: true,
  created_by: null,
  weight_factors: {
    health_score: 0.25,
    verification_strength: 0.20,
    image_quality: 0.15,
    metadata_completeness: 0.10,
    error_stability: 0.15,
    similarity_bonus: 0.15,
  },
  safety_caps: {
    max_per_example_influence: 0.25,
    max_total_correction_inches: 8.0,
    max_per_measurement_correction_percent: 0.15,
    min_examples_for_correction: 3,
    min_total_influence_weight: 0.5,
  },
  drift_protection: {
    enabled: true,
    directional_bias_threshold: 3.0,
    magnitude_drift_threshold: 1.5,
    detection_window_hours: 168,
    min_samples_for_detection: 50,
    auto_reduce_strength_on_drift: true,
    strength_reduction_factor: 0.5,
  },
  eligibility_rules: {
    require_usable_for_training: true,
    min_health_score: 30,
    exclude_outliers: true,
    exclude_duplicates: true,
    low_quality_weight_multiplier: 0.3,
  },
}

// Weighted learning correction result (enhanced from Phase 10)
export interface WeightedLearningCorrectionResult {
  // Score adjustments
  grossCorrection: number
  netCorrection: number
  confidenceBoost: number
  
  // Per-measurement corrections
  measurementCorrections: Map<string, number>
  
  // Aggregation details
  aggregationMethod: 'weighted_mean' | 'trimmed_mean' | 'median' | 'robust_mean'
  preCap: {
    grossCorrection: number
    wasCapped: boolean
    capReason: string | null
  }
  
  // Influence breakdown
  totalInfluenceWeight: number
  contributingExamples: InfluentialExampleDetail[]
  
  // Safety flags
  driftWarning: DriftWarning | null
  
  // Summary for UI/API
  summary: WeightedLearningSummary
}

export interface DriftWarning {
  type: DriftType
  severity: DriftSeverity
  message: string
  strengthReduced: boolean
  reductionFactor: number
}

export interface WeightedLearningSummary {
  verifiedExamplesConsidered: number
  eligibleExamplesUsed: number
  highlySimilarExamplesUsed: number
  totalInfluenceWeight: number
  avgSimilarity: number
  avgInfluenceWeight: number
  strongestMatchingFeatures: string[]
  weakestMatchingFeatures: string[]
  correctionDirection: 'increase' | 'decrease' | 'mixed' | 'none'
  grossAdjustmentApplied: number
  netAdjustmentApplied: number
  confidenceAdjustmentApplied: number
  correctionStrength: 'none' | 'low' | 'medium' | 'high'
  measurementCorrections: MeasurementCorrectionInfo[]
  correctionCapped: boolean
  cappingReason: string | null
  exampleConsistency: number
  aggregationMethod: string
  driftWarning: DriftWarning | null
  influentialExamples: InfluentialExampleDetail[]
  notes: string[]
  matchQuality: 'none' | 'weak' | 'moderate' | 'strong'
}

// Drift analysis result
export interface DriftAnalysisResult {
  hasActiveDrift: boolean
  driftAlerts: DriftDetectionLog[]
  currentBias: {
    direction: 'positive' | 'negative' | 'balanced'
    ratio: number
    magnitude: number
  }
  recommendedAction: DriftAction
  strengthMultiplier: number // 1.0 = normal, <1.0 = reduced
}

// Influence computation input
export interface InfluenceComputationInput {
  training_example_id: string
  health_score: number | null
  health_tier: HealthTier
  verified_for_training: boolean
  score_source: ScoreSource | string | null
  images_used: number | null
  angle_diversity_score: number | null
  intake_quality: Record<string, unknown> | null
  quality_flags: QualityFlags | null
  is_outlier: boolean
  is_duplicate: boolean
  usable_for_training: boolean | null
  state: string | null
  rack_type: string | null
}

// Influence computation result
export interface InfluenceComputationResult {
  influence_weight: number
  influence_factors: InfluenceFactors
  eligibility_reason: string | null
}

// ========================================
// USAGE TRACKING + COST CONTROLS (Phase 30)
// ========================================

export type UsageRecordStatus = 'pending' | 'processing' | 'success' | 'error' | 'rate_limited'

export interface UsageRecord {
  id: string
  request_id: string
  session_id: string | null
  buck_id: string | null
  prediction_id: string | null
  endpoint: string
  method: string
  client_ip: string | null
  client_fingerprint: string | null
  user_agent: string | null
  images_submitted: number
  images_processed: number
  vision_calls: number
  retry_count: number
  used_fallback: boolean
  request_start_at: string
  request_end_at: string | null
  processing_time_ms: number | null
  vision_time_ms: number | null
  status: UsageRecordStatus
  error_type: string | null
  error_message: string | null
  estimated_cost_mc: number
  model_version_id: string | null
  vision_model: string | null
  created_at: string
}

export interface UsageRecordInput {
  request_id: string
  session_id?: string
  buck_id?: string
  endpoint: string
  method?: string
  client_ip?: string
  client_fingerprint?: string
  user_agent?: string
  images_submitted?: number
}

export interface UsageRecordUpdate {
  prediction_id?: string
  images_processed?: number
  vision_calls?: number
  retry_count?: number
  used_fallback?: boolean
  request_end_at?: string
  processing_time_ms?: number
  vision_time_ms?: number
  status?: UsageRecordStatus
  error_type?: string
  error_message?: string
  estimated_cost_mc?: number
  model_version_id?: string
  vision_model?: string
}

// Rate limit configuration
export interface RateLimitConfig {
  id: string
  config_name: string
  is_active: boolean
  requests_per_minute: number
  images_per_minute: number
  requests_per_hour: number
  images_per_hour: number
  requests_per_day: number
  images_per_day: number
  monthly_request_soft_limit: number | null
  monthly_image_soft_limit: number | null
  monthly_cost_soft_limit_cents: number | null
  max_images_per_request: number
  max_retries_per_request: number
  request_timeout_ms: number
  burst_window_seconds: number
  max_burst_requests: number
  duplicate_check_window_seconds: number
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface RateLimitState {
  id: string
  client_key: string
  window_type: 'minute' | 'hour' | 'day' | 'month' | 'burst'
  window_start: string
  window_end: string
  request_count: number
  image_count: number
  estimated_cost_mc: number
  last_request_at: string
  created_at: string
  updated_at: string
}

export interface RateLimitCheckResult {
  allowed: boolean
  reason: string | null
  limit_type: string | null
  current_count: number | null
  max_count: number | null
  retry_after_seconds: number | null
  warnings: string[]
}

// Cost tracking
export interface CostEstimate {
  id: string
  provider: string
  model: string
  cost_per_image_mc: number
  cost_per_request_mc: number
  cost_per_1k_tokens_input_mc: number
  cost_per_1k_tokens_output_mc: number
  effective_from: string
  effective_to: string | null
  is_active: boolean
  notes: string | null
  created_at: string
  updated_at: string
}

export interface CostCalculation {
  images: number
  vision_calls: number
  cost_per_image_mc: number
  cost_per_request_mc: number
  total_image_cost_mc: number
  total_request_cost_mc: number
  total_cost_mc: number
  total_cost_cents: number
  total_cost_dollars: number
}

// Production configuration
export interface ProductionConfig {
  id: string
  config_name: string
  is_active: boolean
  max_images_per_request: number
  min_images_per_request: number
  max_retries: number
  retry_delay_base_ms: number
  retry_delay_max_ms: number
  total_timeout_ms: number
  single_call_timeout_ms: number
  max_learning_correction_inches: number
  max_measurement_correction_percent: number
  min_confidence_percent: number
  max_confidence_percent: number
  min_error_band_inches: number
  max_error_band_inches: number
  fallback_enabled: boolean
  fallback_confidence_penalty: number
  fallback_error_band_widening: number
  vision_scoring_enabled: boolean
  learning_correction_enabled: boolean
  two_pass_scoring_enabled: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

// Default production config values
export const DEFAULT_PRODUCTION_CONFIG: Omit<ProductionConfig, 'id' | 'created_at' | 'updated_at'> = {
  config_name: 'default',
  is_active: true,
  max_images_per_request: 6,
  min_images_per_request: 1,
  max_retries: 2,
  retry_delay_base_ms: 1000,
  retry_delay_max_ms: 5000,
  total_timeout_ms: 60000,
  single_call_timeout_ms: 30000,
  max_learning_correction_inches: 8.0,
  max_measurement_correction_percent: 0.15,
  min_confidence_percent: 15,
  max_confidence_percent: 95,
  min_error_band_inches: 3.0,
  max_error_band_inches: 25.0,
  fallback_enabled: true,
  fallback_confidence_penalty: 15.0,
  fallback_error_band_widening: 1.3,
  vision_scoring_enabled: true,
  learning_correction_enabled: true,
  two_pass_scoring_enabled: true,
  created_by: null,
}

// Release readiness types
export type ReleaseReadinessCategory = 'accuracy' | 'runtime' | 'calibration' | 'data_quality' | 'cost'
export type ReleaseReadinessSeverity = 'info' | 'warning' | 'blocker'
export type ReleaseReadinessStatus = 'ready' | 'warnings' | 'issues' | 'blocked'

export interface ReleaseReadinessCheck {
  id: string
  model_version_id: string | null
  calibration_profile_id: string | null
  benchmark_run_id: string | null
  check_name: string
  check_category: ReleaseReadinessCategory
  check_passed: boolean
  check_value: number | null
  check_threshold: number | null
  check_details: Record<string, unknown> | null
  severity: ReleaseReadinessSeverity
  checked_at: string
  checked_by: string | null
  created_at: string
}

export interface ReleaseReadinessCheckInput {
  model_version_id?: string
  calibration_profile_id?: string
  benchmark_run_id?: string
  check_name: string
  check_category: ReleaseReadinessCategory
  check_passed: boolean
  check_value?: number
  check_threshold?: number
  check_details?: Record<string, unknown>
  severity?: ReleaseReadinessSeverity
  checked_by?: string
}

export interface ReleaseReadinessSummaryView {
  model_version_id: string | null
  model_name: string | null
  calibration_profile_id: string | null
  calibration_name: string | null
  benchmark_run_id: string | null
  total_checks: number
  passed_checks: number
  failed_checks: number
  blocker_count: number
  warning_count: number
  accuracy_failures: number
  runtime_failures: number
  calibration_failures: number
  data_quality_failures: number
  cost_failures: number
  status: ReleaseReadinessStatus
  last_checked_at: string
}

export interface ReleaseReadinessReport {
  model_version_id: string | null
  model_name: string | null
  calibration_profile_id: string | null
  calibration_name: string | null
  status: ReleaseReadinessStatus
  summary: {
    total_checks: number
    passed_checks: number
    failed_checks: number
    blocker_count: number
    warning_count: number
  }
  checks_by_category: Record<ReleaseReadinessCategory, ReleaseReadinessCheck[]>
  blockers: ReleaseReadinessCheck[]
  warnings: ReleaseReadinessCheck[]
  recommendations: string[]
  is_safe_to_promote: boolean
  last_checked_at: string | null
}

// Usage summary types
export interface DailyUsageSummary {
  date: string
  total_requests: number
  total_images_submitted: number
  total_images_processed: number
  total_vision_calls: number
  total_retries: number
  fallback_count: number
  success_count: number
  error_count: number
  timeout_count: number
  rate_limit_count: number
  avg_processing_ms: number | null
  p95_processing_ms: number | null
  total_cost_mc: number
  unique_clients: number
}

export interface HourlyUsageSummary {
  hour: string
  request_count: number
  image_count: number
  vision_calls: number
  fallback_count: number
  cost_mc: number
  avg_processing_ms: number | null
  unique_clients: number
}

export interface MonthlyUsageSummary {
  month: string
  total_requests: number
  total_images: number
  total_vision_calls: number
  total_cost_mc: number
  total_cost_cents: number
  total_cost_dollars: number
  unique_clients: number
}

export interface UsageReportSummary {
  period: 'day' | 'week' | 'month'
  start_date: string
  end_date: string
  totals: {
    requests: number
    images_submitted: number
    images_processed: number
    vision_calls: number
    retries: number
    fallbacks: number
    errors: number
    cost_mc: number
    cost_dollars: number
  }
  rates: {
    success_rate: number
    fallback_rate: number
    timeout_rate: number
    retry_rate: number
    avg_images_per_request: number
  }
  timing: {
    avg_processing_ms: number | null
    p95_processing_ms: number | null
    avg_vision_ms: number | null
  }
  unique_clients: number
  top_error_types: { type: string; count: number }[]
}

// ========================================
// PHASE 41: SEGMENTED CALIBRATION TYPES
// ========================================

export type CalibrationMeasurementType = 'spread' | 'beam' | 'tine' | 'mass' | 'deduction'
export type SegmentType = 'global' | 'source_type' | 'image_quality' | 'region' | 'state' | 'compound'

export interface CalibrationSegment {
  id: string
  name: string
  description: string | null
  parent_id: string | null
  level: number
  segment_type: string
  conditions: Record<string, unknown>
  sample_size: number
  stability_score: number
  activation_weight: number
  enabled: boolean
  created_at: string
  updated_at: string
}

export interface CalibrationValue {
  id: string
  segment_id: string
  measurement_type: CalibrationMeasurementType
  multiplier: number
  bias: number
  confidence_adjustment: number
  created_at: string
  updated_at: string
}

export interface SegmentMetric {
  id: string
  segment_id: string
  evaluated_at: string
  sample_count: number
  avg_gross_error: number | null
  avg_abs_gross_error: number | null
  avg_net_error: number | null
  avg_abs_net_error: number | null
  confidence_calib_error: number | null
  regression_flagged: boolean
  notes: string | null
  created_at: string
}

export interface PredictionSegmentLog {
  id: string
  prediction_id: string | null
  buck_id: string | null
  trace_id: string | null
  segment_ids: string[]
  blend_weights: number[]
  calibration_deltas: {
    per_field: Record<string, number>
    gross_confidence_adj: number
    segment_trace: Array<{
      id: string
      name: string
      level: number
      weight: number
      gated: boolean
      gate_reason: string | null
      direct_match: boolean
    }>
  }
  created_at: string
}

// ========================================
// PHASE 42: LANDMARK STRENGTHENING & GEOMETRY CONSISTENCY
// ========================================

export type LandmarkQualityTier = 'excellent' | 'good' | 'fair' | 'poor' | 'missing'
export type ReferenceSourceType = 'strong_ear' | 'partial_ear' | 'strong_eye' | 'combined_ear_eye' | 'weak_fallback' | 'none'
export type GeometryConsistencyTier = 'excellent' | 'good' | 'fair' | 'poor' | 'implausible'
export type AsymmetryCause = 'real_asymmetry' | 'poor_angle' | 'weak_reference' | 'unknown'

export interface EnhancedLandmarkData {
  // Quality scores per landmark type
  ear_base_quality: LandmarkQualityTier
  ear_tip_quality: LandmarkQualityTier
  eye_quality: LandmarkQualityTier
  skull_symmetry_quality: LandmarkQualityTier
  beam_tip_visibility: LandmarkQualityTier
  brow_tine_visibility: LandmarkQualityTier
  inside_spread_visibility: LandmarkQualityTier
  
  // Confidence scores (0-1)
  ear_base_confidence: number
  ear_tip_confidence: number
  eye_confidence: number
  beam_tip_confidence: number
  
  // Overall landmark quality
  overall_quality: LandmarkQualityTier
  overall_confidence: number
  
  // Source image indices
  best_frontal_image: number | null
  best_side_images: number[]
}

export interface ReferenceRankingData {
  primary_source: ReferenceSourceType
  primary_confidence: number
  fallback_source: ReferenceSourceType | null
  fallback_confidence: number | null
  overall_reliability: number
  is_sufficient: boolean
  
  // Per-measurement family reference assignment
  spread_reference: ReferenceSourceType
  beam_reference: ReferenceSourceType
  tine_reference: ReferenceSourceType
  mass_reference: ReferenceSourceType
  
  // Warnings
  warnings: string[]
}

export interface GeometryConsistencyData {
  consistency_score: number
  tier: GeometryConsistencyTier
  confidence_adjustment: number
  
  // Flag counts by severity
  critical_flags: number
  warning_flags: number
  info_flags: number
  
  // Per-measurement trust penalties
  measurement_trust_penalties: Record<string, number>
  
  // Asymmetry analysis
  asymmetry_likely_real: boolean
  asymmetry_cause: AsymmetryCause
  asymmetry_divergence: number
  
  // Summary
  summary: string
  flags: Array<{
    id: string
    category: string
    severity: 'info' | 'warning' | 'critical'
    field: string | null
    message: string
  }>
}

export interface Phase42Metadata {
  enhanced_landmarks: EnhancedLandmarkData | null
  reference_ranking: ReferenceRankingData | null
  geometry_consistency: GeometryConsistencyData | null
  
  // Processing info
  phase42_version: string
  processed_at: string
}

// ========================================
// PHASE 43: RETRAINING READINESS & EXPORT PACKS
// ========================================

export type VerificationSource = 'official_scorer' | 'user_reported' | 'taxidermist' | 'contest' | 'estimated'
export type VerificationConfidence = 'high' | 'medium' | 'low'
export type ReadinessTier = 'ready' | 'nearly_ready' | 'needs_work' | 'insufficient'
export type GapSeverity = 'none' | 'low' | 'medium' | 'high' | 'critical'
export type CandidateModelStatus = 'pending' | 'evaluated' | 'promoted' | 'rejected' | 'archived'
export type SplitAssignment = 'train' | 'validation' | 'test'

export interface TrainingExample {
  id: string
  buck_id: string | null
  prediction_id: string | null
  // Ground truth
  ground_truth_gross: number
  ground_truth_net: number | null
  ground_truth_spread: number | null
  ground_truth_beam_left: number | null
  ground_truth_beam_right: number | null
  ground_truth_mass: number | null
  ground_truth_tine_lengths: Record<string, number> | null
  ground_truth_deductions: number | null
  // Predictions
  predicted_gross: number | null
  predicted_net: number | null
  predicted_spread: number | null
  predicted_beam_left: number | null
  predicted_beam_right: number | null
  predicted_mass: number | null
  predicted_confidence: number | null
  // Context
  state: string | null
  rack_type: 'typical' | 'non-typical' | 'unknown' | null
  source_type: string | null
  capture_device: string | null
  image_count: number
  angle_types: string[]
  ears_fully_visible: boolean | null
  main_frame_points: number | null
  // Quality
  verification_source: VerificationSource | null
  verification_confidence: VerificationConfidence | null
  health_score: number | null
  health_tier: string | null
  // Images
  image_urls: string[]
  // Timestamps
  verified_at: string | null
  created_at: string
  updated_at: string
}

export interface SplitConfig {
  train_ratio: number
  validation_ratio: number
  test_ratio: number
  split_seed: number
  stratify_by: string[]
  prevent_near_duplicate_leakage: boolean
}

export interface ExportPackFilters {
  states?: string[]
  rack_types?: ('typical' | 'non-typical')[]
  source_types?: string[]
  score_range?: { min: number; max: number }
  health_tiers?: string[]
  verification_sources?: VerificationSource[]
  min_image_count?: number
  require_images?: boolean
  exclude_ids?: string[]
}

export interface ExportPack {
  id: string
  name: string
  description: string | null
  filters: ExportPackFilters
  split_config: SplitConfig
  export_formats: string[]
  include_image_urls: boolean
  include_segment_context: boolean
  include_health_metadata: boolean
  targets_data_gap: string | null
  gap_priority: number
  is_archived: boolean
  example_count: number
  last_computed_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface ExportPackExample {
  id: string
  export_pack_id: string
  training_example_id: string
  split_assignment: SplitAssignment
  ground_truth_gross: number | null
  ground_truth_net: number | null
  health_score: number | null
  health_tier: string | null
  state: string | null
  rack_type: string | null
  source_type: string | null
  segment_ids: string[]
  added_at: string
}

export interface ExportRun {
  id: string
  export_pack_id: string
  format: 'json' | 'csv' | 'both'
  example_count: number
  train_count: number
  validation_count: number
  test_count: number
  export_file_path: string | null
  export_file_size_bytes: number | null
  export_config: Record<string, unknown> | null
  run_notes: string | null
  exported_by: string | null
  exported_at: string
}

export interface CandidateModel {
  id: string
  name: string
  version: string
  description: string | null
  export_pack_id: string | null
  training_approach: string | null
  training_notes: string | null
  status: CandidateModelStatus
  metrics_summary: Record<string, number> | null
  comparison_to_production: {
    production_mae: number
    candidate_mae: number
    delta: number
    is_improvement: boolean
  } | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface OfflineEvaluation {
  id: string
  candidate_model_id: string
  export_pack_id: string
  evaluation_split: 'validation' | 'test' | 'full'
  example_count: number
  // Metrics
  mae_gross: number | null
  mae_net: number | null
  rmse_gross: number | null
  rmse_net: number | null
  mean_error_gross: number | null
  mean_error_net: number | null
  correlation_gross: number | null
  correlation_net: number | null
  // Error bands
  within_5_inches_pct: number | null
  within_10_inches_pct: number | null
  within_15_inches_pct: number | null
  // Breakdowns
  metrics_by_state: Record<string, { mae: number; count: number }> | null
  metrics_by_rack_type: Record<string, { mae: number; count: number }> | null
  metrics_by_source_type: Record<string, { mae: number; count: number }> | null
  metrics_by_score_band: Record<string, { mae: number; count: number }> | null
  // Comparison
  production_mae_gross: number | null
  delta_mae_gross: number | null
  is_improvement: boolean | null
  // Meta
  notes: string | null
  evaluated_by: string | null
  evaluated_at: string
}

export interface DataGap {
  category: 'state' | 'rack_type' | 'source_type' | 'score_band'
  value: string
  current_count: number
  target_count: number
  severity: GapSeverity
  priority: number
  recommendation: string
}

export interface RetrainingReadiness {
  id: string
  computed_at: string
  total_examples: number
  high_quality_examples: number
  examples_with_images: number
  coverage_by_state: Record<string, number>
  typical_count: number
  non_typical_count: number
  coverage_by_source: Record<string, number>
  coverage_by_score_band: Record<string, number>
  data_gaps: DataGap[]
  gap_severity: GapSeverity
  recommendations: string[]
  readiness_score: number
  readiness_tier: ReadinessTier
  notes: string | null
}
