// Database types for RutAI/XRacks

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
