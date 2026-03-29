/**
 * Phase 52: Structured Supervision Configuration
 * 
 * Configuration constants and thresholds for the supervision system.
 */

import type {
  SupervisionType,
  FailureCauseLabel,
  LearningActionType,
  PatternDefinition,
} from './types'

// ============================================================================
// SUPERVISION TYPE METADATA
// ============================================================================

export const SUPERVISION_TYPE_INFO: Record<SupervisionType, {
  label: string
  description: string
  priority: 'low' | 'medium' | 'high'
  auto_confirm: boolean
}> = {
  official_score_submitted: {
    label: 'Official Score',
    description: 'User submitted an official B&C or P&Y score',
    priority: 'high',
    auto_confirm: true,
  },
  official_measurement_breakdown_submitted: {
    label: 'Official Measurements',
    description: 'User submitted detailed official measurements',
    priority: 'high',
    auto_confirm: true,
  },
  reverse_pass_improved_result: {
    label: 'Reverse Pass Improvement',
    description: 'Precision pass found a better scoring hypothesis',
    priority: 'medium',
    auto_confirm: false,
  },
  reverse_pass_found_scale_issue: {
    label: 'Scale Reference Issue',
    description: 'Reverse pass identified a scale/reference problem',
    priority: 'high',
    auto_confirm: false,
  },
  reverse_pass_found_asymmetry_issue: {
    label: 'Asymmetry Issue',
    description: 'Reverse pass identified asymmetry handling issue',
    priority: 'medium',
    auto_confirm: false,
  },
  structural_solver_corrected_topology: {
    label: 'Topology Correction',
    description: 'Structural solver reinterpreted rack topology',
    priority: 'high',
    auto_confirm: false,
  },
  benchmark_failure_cluster: {
    label: 'Benchmark Failure',
    description: 'Repeated failures detected in benchmark evaluation',
    priority: 'high',
    auto_confirm: false,
  },
  confidence_overclaim: {
    label: 'Confidence Overclaim',
    description: 'System reported higher confidence than accuracy warranted',
    priority: 'medium',
    auto_confirm: true,
  },
  confidence_underclaim: {
    label: 'Confidence Underclaim',
    description: 'System reported lower confidence than accuracy warranted',
    priority: 'low',
    auto_confirm: true,
  },
  interval_miss: {
    label: 'Interval Miss',
    description: 'Actual error fell outside predicted error band',
    priority: 'medium',
    auto_confirm: true,
  },
  segment_regression_detected: {
    label: 'Segment Regression',
    description: 'Regression detected in a specific segment',
    priority: 'high',
    auto_confirm: false,
  },
  admin_confirmed_failure_cause: {
    label: 'Admin Confirmed',
    description: 'Admin confirmed a failure cause diagnosis',
    priority: 'high',
    auto_confirm: true,
  },
  admin_rejected_failure_cause: {
    label: 'Admin Rejected',
    description: 'Admin rejected an auto-inferred failure cause',
    priority: 'medium',
    auto_confirm: true,
  },
  hard_case_promoted_for_learning: {
    label: 'Hard Case Promoted',
    description: 'Case promoted as a learning priority',
    priority: 'high',
    auto_confirm: false,
  },
}

// ============================================================================
// FAILURE CAUSE LABEL METADATA
// ============================================================================

export const FAILURE_CAUSE_INFO: Record<FailureCauseLabel, {
  label: string
  description: string
  category: 'reference' | 'geometry' | 'view' | 'confidence' | 'calibration'
  severity: number // 0-1, higher = more severe
  mitigation_hint: string
}> = {
  scale_reference_failure: {
    label: 'Scale Reference Failure',
    description: 'Unable to establish reliable scale from ear or other references',
    category: 'reference',
    severity: 0.9,
    mitigation_hint: 'Request clearer frontal image with visible ears',
  },
  weak_front_reference: {
    label: 'Weak Frontal Reference',
    description: 'Poor frontal view quality affecting landmark detection',
    category: 'reference',
    severity: 0.7,
    mitigation_hint: 'Request a clearer frontal angle',
  },
  weak_side_reference: {
    label: 'Weak Side Reference',
    description: 'Poor side profile quality affecting beam/tine measurements',
    category: 'reference',
    severity: 0.6,
    mitigation_hint: 'Request a clearer side profile',
  },
  beam_tip_misread: {
    label: 'Beam Tip Misread',
    description: 'Main beam tip location incorrectly identified',
    category: 'geometry',
    severity: 0.8,
    mitigation_hint: 'Better side profile or additional angles',
  },
  tine_occlusion: {
    label: 'Tine Occlusion',
    description: 'Tines partially hidden by other rack structure',
    category: 'geometry',
    severity: 0.6,
    mitigation_hint: 'Request additional angle showing obscured tines',
  },
  tine_topology_confusion: {
    label: 'Tine Topology Confusion',
    description: 'Difficulty determining tine count or assignment',
    category: 'geometry',
    severity: 0.8,
    mitigation_hint: 'Multiple angles or structural solving pass',
  },
  asymmetry_perspective_confound: {
    label: 'Asymmetry Perspective Confound',
    description: 'Camera angle creating false asymmetry appearance',
    category: 'view',
    severity: 0.7,
    mitigation_hint: 'Request centered frontal view',
  },
  left_right_association_error: {
    label: 'Left/Right Association Error',
    description: 'Measurements assigned to wrong side',
    category: 'geometry',
    severity: 0.9,
    mitigation_hint: 'Clearer angle or manual verification',
  },
  weak_multi_view_agreement: {
    label: 'Weak Multi-View Agreement',
    description: 'Significant disagreement between image angles',
    category: 'view',
    severity: 0.7,
    mitigation_hint: 'Better quality images from consistent angles',
  },
  crop_or_occlusion_failure: {
    label: 'Crop/Occlusion Failure',
    description: 'Critical rack parts cropped or hidden',
    category: 'view',
    severity: 0.8,
    mitigation_hint: 'Full rack visibility in images',
  },
  lighting_quality_failure: {
    label: 'Lighting Quality Failure',
    description: 'Poor lighting affecting measurement accuracy',
    category: 'reference',
    severity: 0.5,
    mitigation_hint: 'Better lit images',
  },
  confidence_overestimate: {
    label: 'Confidence Overestimate',
    description: 'Reported confidence was too high',
    category: 'confidence',
    severity: 0.5,
    mitigation_hint: 'Calibration adjustment needed',
  },
  confidence_underestimate: {
    label: 'Confidence Underestimate',
    description: 'Reported confidence was too low',
    category: 'confidence',
    severity: 0.3,
    mitigation_hint: 'Calibration adjustment may help',
  },
  segment_calibration_miss: {
    label: 'Segment Calibration Miss',
    description: 'Segment-specific calibration was incorrect',
    category: 'calibration',
    severity: 0.6,
    mitigation_hint: 'Review segment calibration settings',
  },
  structural_solver_overcorrection: {
    label: 'Structural Solver Overcorrection',
    description: 'Structural solving made incorrect adjustment',
    category: 'geometry',
    severity: 0.7,
    mitigation_hint: 'Review structural hypothesis thresholds',
  },
}

// ============================================================================
// LEARNING ACTION TYPE METADATA
// ============================================================================

export const LEARNING_ACTION_INFO: Record<LearningActionType, {
  label: string
  description: string
  requires_approval: boolean
  auto_implementable: boolean
}> = {
  calibration_adjustment_candidate: {
    label: 'Calibration Adjustment',
    description: 'Suggested calibration parameter change',
    requires_approval: true,
    auto_implementable: false,
  },
  segment_refinement_candidate: {
    label: 'Segment Refinement',
    description: 'Suggested segment definition improvement',
    requires_approval: true,
    auto_implementable: false,
  },
  protected_segment_candidate: {
    label: 'Protected Segment',
    description: 'Suggest adding or modifying a protected segment',
    requires_approval: true,
    auto_implementable: false,
  },
  shadow_test_recommendation: {
    label: 'Shadow Test',
    description: 'Recommend shadow testing a variant',
    requires_approval: true,
    auto_implementable: false,
  },
  benchmark_pack_candidate: {
    label: 'Benchmark Pack',
    description: 'Suggest creating a benchmark pack from cases',
    requires_approval: true,
    auto_implementable: false,
  },
  data_gap_priority_candidate: {
    label: 'Data Gap Priority',
    description: 'Identified data collection priority',
    requires_approval: false,
    auto_implementable: false,
  },
  fine_tuning_label_candidate: {
    label: 'Fine-Tuning Label',
    description: 'Case ready for model fine-tuning',
    requires_approval: true,
    auto_implementable: false,
  },
  ui_guidance_candidate: {
    label: 'UI Guidance',
    description: 'Suggest user-facing guidance message',
    requires_approval: true,
    auto_implementable: true,
  },
}

// ============================================================================
// THRESHOLDS AND SETTINGS
// ============================================================================

export const SUPERVISION_SETTINGS = {
  // Minimum confidence to auto-create supervision event
  min_auto_event_confidence: 0.5,
  
  // Minimum delta to consider a change significant
  min_significant_delta_gross: 2.0, // inches
  min_significant_delta_net: 2.0,
  min_significant_delta_confidence: 5.0, // percent
  
  // Confidence thresholds for different signal types
  confidence_overclaim_threshold: 0.75, // If confidence > 75% but error > expected
  confidence_underclaim_threshold: 0.5, // If confidence < 50% but error < expected
  
  // Interval miss detection
  interval_miss_buffer: 0.5, // Allow 0.5 inch buffer before flagging
  
  // Hard case pattern thresholds
  min_pattern_examples: 5, // Minimum examples to form a pattern
  min_pattern_severity: 0.6, // Minimum average severity to create pattern
  
  // Learning action generation
  min_supervision_events_for_action: 3, // Minimum events before suggesting action
  min_confirmed_events_for_high_priority: 2, // Min confirmed events for high priority
  
  // Export readiness
  min_confirmed_labels_for_fine_tuning: 2,
  min_confidence_for_weak_label: 0.6,
  min_confidence_for_confirmed_label: 0.8,
  
  // Segment stats refresh interval
  segment_stats_refresh_hours: 24,
}

// ============================================================================
// PREDEFINED HARD CASE PATTERNS
// ============================================================================

export const PREDEFINED_PATTERNS: Array<{
  name: string
  definition: PatternDefinition
  description: string
  severity: number
  associated_labels: FailureCauseLabel[]
}> = [
  {
    name: 'low_light_trail_cam_weak_frontal',
    definition: {
      conditions: [
        { field: 'source_type', operator: 'in', value: ['trail_cam', 'trail_camera'] },
        { field: 'lighting_quality', operator: 'eq', value: 'poor' },
        { field: 'frontal_reference_quality', operator: 'lt', value: 0.5 },
      ],
      operator: 'AND',
      pattern_description: 'Low light trail cam with weak frontal reference',
    },
    description: 'Trail camera images in poor lighting with inadequate frontal view',
    severity: 0.85,
    associated_labels: ['scale_reference_failure', 'weak_front_reference', 'lighting_quality_failure'],
  },
  {
    name: 'high_asymmetry_missing_profile',
    definition: {
      conditions: [
        { field: 'asymmetry_percent', operator: 'gt', value: 0.2 },
        { field: 'has_right_profile', operator: 'eq', value: false },
      ],
      operator: 'AND',
      pattern_description: 'High asymmetry rack missing side profile',
    },
    description: 'Asymmetric racks where one side profile is missing',
    severity: 0.75,
    associated_labels: ['asymmetry_perspective_confound', 'weak_side_reference'],
  },
  {
    name: 'heavy_mass_tine_occlusion',
    definition: {
      conditions: [
        { field: 'mass_score_estimate', operator: 'gt', value: 20 },
        { field: 'tine_visibility_score', operator: 'lt', value: 0.6 },
      ],
      operator: 'AND',
      pattern_description: 'Heavy mass rack with occluded tines',
    },
    description: 'Heavy mass racks where tines are partially hidden',
    severity: 0.7,
    associated_labels: ['tine_occlusion', 'tine_topology_confusion'],
  },
  {
    name: 'mounted_frontal_poor_beam_visibility',
    definition: {
      conditions: [
        { field: 'source_type', operator: 'eq', value: 'mounted_photo' },
        { field: 'angle_type', operator: 'eq', value: 'front' },
        { field: 'beam_tip_visibility', operator: 'lt', value: 0.5 },
      ],
      operator: 'AND',
      pattern_description: 'Mounted photo with poor beam tip visibility',
    },
    description: 'Wall-mounted antlers photographed from front with poor beam visibility',
    severity: 0.65,
    associated_labels: ['beam_tip_misread', 'weak_side_reference'],
  },
  {
    name: 'multi_image_high_disagreement',
    definition: {
      conditions: [
        { field: 'image_count', operator: 'gte', value: 3 },
        { field: 'cross_view_disagreement', operator: 'gt', value: 0.3 },
      ],
      operator: 'AND',
      pattern_description: 'Multi-image set with high cross-view disagreement',
    },
    description: 'Multiple images that produce conflicting measurements',
    severity: 0.8,
    associated_labels: ['weak_multi_view_agreement', 'asymmetry_perspective_confound'],
  },
  {
    name: 'single_image_low_confidence',
    definition: {
      conditions: [
        { field: 'image_count', operator: 'eq', value: 1 },
        { field: 'confidence_percent', operator: 'lt', value: 60 },
      ],
      operator: 'AND',
      pattern_description: 'Single image with low confidence',
    },
    description: 'Single-image predictions with inherently low confidence',
    severity: 0.6,
    associated_labels: ['weak_front_reference', 'weak_side_reference'],
  },
  {
    name: 'non_typical_topology_confusion',
    definition: {
      conditions: [
        { field: 'rack_type', operator: 'eq', value: 'non-typical' },
        { field: 'abnormal_points', operator: 'gt', value: 3 },
      ],
      operator: 'AND',
      pattern_description: 'Non-typical rack with many abnormal points',
    },
    description: 'Non-typical racks with complex point structures',
    severity: 0.85,
    associated_labels: ['tine_topology_confusion', 'left_right_association_error'],
  },
]

// ============================================================================
// SEGMENT DEFINITIONS FOR SUPERVISION ANALYSIS
// ============================================================================

export const SUPERVISION_SEGMENTS = {
  state: {
    label: 'State',
    field: 'state',
    values: ['TX', 'IL', 'KS', 'IA', 'OH', 'WI', 'KY', 'MO', 'IN', 'PA', 'MI', 'NY', 'GA', 'AL', 'MS', 'SC', 'NC', 'VA', 'WV', 'TN', 'AR', 'LA', 'OK', 'NE', 'SD', 'ND', 'MN', 'MT', 'WY', 'CO', 'NM', 'AZ', 'UT', 'ID', 'WA', 'OR', 'CA', 'NV', 'FL', 'MD', 'DE', 'NJ', 'CT', 'MA', 'NH', 'VT', 'ME', 'RI'],
  },
  rack_type: {
    label: 'Rack Type',
    field: 'rack_type',
    values: ['typical', 'non-typical'],
  },
  source_type: {
    label: 'Source Type',
    field: 'source_type',
    values: ['live_deer', 'mounted_photo', 'european_mount', 'trail_cam', 'harvest_photo', 'other'],
  },
  image_count_tier: {
    label: 'Image Count',
    field: 'image_count_tier',
    values: ['single', 'dual', 'multi'],
  },
  score_bucket: {
    label: 'Score Bucket',
    field: 'score_bucket',
    values: ['<100', '100-120', '120-140', '140-160', '160-180', '180-200', '200+'],
  },
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get severity color for a failure cause label
 */
export function getFailureCauseSeverityColor(label: FailureCauseLabel): string {
  const severity = FAILURE_CAUSE_INFO[label].severity
  if (severity >= 0.8) return 'text-destructive'
  if (severity >= 0.6) return 'text-orange-600'
  if (severity >= 0.4) return 'text-yellow-600'
  return 'text-muted-foreground'
}

/**
 * Get priority color for learning actions
 */
export function getLearningActionPriorityColor(priority: string): string {
  switch (priority) {
    case 'critical': return 'text-destructive'
    case 'high': return 'text-orange-600'
    case 'medium': return 'text-yellow-600'
    case 'low': return 'text-muted-foreground'
    default: return 'text-foreground'
  }
}

/**
 * Get mitigation status color
 */
export function getMitigationStatusColor(status: string): string {
  switch (status) {
    case 'mitigated': return 'text-green-600'
    case 'in_progress': return 'text-blue-600'
    case 'unaddressed': return 'text-orange-600'
    case 'wont_fix': return 'text-muted-foreground'
    default: return 'text-foreground'
  }
}

/**
 * Determine if a delta is significant
 */
export function isSignificantDelta(
  deltaGross: number | null,
  deltaNet: number | null,
  deltaConfidence: number | null
): boolean {
  const settings = SUPERVISION_SETTINGS
  
  if (deltaGross !== null && Math.abs(deltaGross) >= settings.min_significant_delta_gross) {
    return true
  }
  if (deltaNet !== null && Math.abs(deltaNet) >= settings.min_significant_delta_net) {
    return true
  }
  if (deltaConfidence !== null && Math.abs(deltaConfidence) >= settings.min_significant_delta_confidence) {
    return true
  }
  
  return false
}

/**
 * Infer likely failure causes from supervision event metadata
 */
export function inferFailureCauses(
  supervisionType: SupervisionType,
  metadata: Record<string, unknown>
): Array<{ label: FailureCauseLabel; confidence: number }> {
  const causes: Array<{ label: FailureCauseLabel; confidence: number }> = []
  
  // Type-specific inferences
  switch (supervisionType) {
    case 'reverse_pass_found_scale_issue':
      causes.push({ label: 'scale_reference_failure', confidence: 0.85 })
      break
      
    case 'reverse_pass_found_asymmetry_issue':
      causes.push({ label: 'asymmetry_perspective_confound', confidence: 0.75 })
      break
      
    case 'structural_solver_corrected_topology':
      causes.push({ label: 'tine_topology_confusion', confidence: 0.7 })
      if (metadata.topology_changes?.includes?.('beam')) {
        causes.push({ label: 'beam_tip_misread', confidence: 0.65 })
      }
      break
      
    case 'confidence_overclaim':
      causes.push({ label: 'confidence_overestimate', confidence: 0.9 })
      break
      
    case 'confidence_underclaim':
      causes.push({ label: 'confidence_underestimate', confidence: 0.9 })
      break
      
    case 'interval_miss':
      causes.push({ label: 'segment_calibration_miss', confidence: 0.6 })
      break
  }
  
  // Metadata-based inferences
  if (metadata.cross_view_disagreement_score && (metadata.cross_view_disagreement_score as number) > 0.3) {
    causes.push({ label: 'weak_multi_view_agreement', confidence: 0.7 })
  }
  
  if (metadata.lighting_quality === 'poor') {
    causes.push({ label: 'lighting_quality_failure', confidence: 0.6 })
  }
  
  if (metadata.ear_reference_quality && (metadata.ear_reference_quality as number) < 0.5) {
    causes.push({ label: 'scale_reference_failure', confidence: 0.65 })
  }
  
  return causes
}
