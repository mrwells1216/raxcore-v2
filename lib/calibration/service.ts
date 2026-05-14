/**
 * Phase 20: Calibration Service
 * 
 * Manages calibration profiles, model version rollback, and audit trail.
 * Provides safe, bounded tuning controls for the scoring pipeline.
 */

import { createClient } from '@/lib/supabase/server'
import type {
  CalibrationProfile,
  CalibrationProfileInput,
  CalibrationChange,
  CalibrationPreviewResult,
  CalibrationMetrics,
  ModelVersionWithCalibration,
  ModelActivationEvent,
  ModelRollbackRequest,
  ModelRollbackResult,
} from '@/lib/types'
import {
  DEFAULT_CALIBRATION,
  CALIBRATION_SAFE_RANGES as SAFE_RANGES,
  getActiveCalibrationProfile,
  invalidateCalibrationCache,
  ensureCalibrationProfile,
  getCalibrationApplicationValues,
} from './utils'

// Re-export from utils for backward compatibility
export { DEFAULT_CALIBRATION, SAFE_RANGES, getActiveCalibrationProfile, ensureCalibrationProfile }

// ============================================================================
// CALIBRATION PROFILE CRUD
// ============================================================================

export async function getCalibrationProfile(id: string): Promise<CalibrationProfile | null> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('calibration_profiles')
    .select('*')
    .eq('id', id)
    .single()

  if (error) {
    console.error('Error fetching calibration profile:', error)
    return null
  }

  return data
}

export async function listCalibrationProfiles(): Promise<CalibrationProfile[]> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('calibration_profiles')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Error listing calibration profiles:', error)
    return []
  }

  return data || []
}

export async function createCalibrationProfile(
  input: CalibrationProfileInput,
  createdBy?: string
): Promise<CalibrationProfile | null> {
  const supabase = await createClient()
  
  // Validate and clamp values to safe ranges
  const validatedInput = validateCalibrationInput(input)
  
  const { data, error } = await supabase
    .from('calibration_profiles')
    .insert({
      name: input.name,
      description: input.description || null,
      model_version_id: input.model_version_id || null,
      is_active: false,
      ...validatedInput,
      created_by: createdBy || null,
    })
    .select()
    .single()

  if (error) {
    console.error('Error creating calibration profile:', error)
    return null
  }

  // Log the creation
  await logCalibrationChange({
    calibration_profile_id: data.id,
    model_version_id: input.model_version_id || null,
    change_type: 'calibration_created',
    old_values: null,
    new_values: data,
    changed_by: createdBy || null,
    reason: 'New calibration profile created',
  })

  return data
}

export async function updateCalibrationProfile(
  id: string,
  input: Partial<CalibrationProfileInput>,
  updatedBy?: string,
  reason?: string
): Promise<CalibrationProfile | null> {
  const supabase = await createClient()
  
  // Get current values for audit
  const { data: currentProfile } = await supabase
    .from('calibration_profiles')
    .select('*')
    .eq('id', id)
    .single()

  if (!currentProfile) {
    console.error('Calibration profile not found:', id)
    return null
  }

  // Validate and clamp values
  const validatedInput = validateCalibrationInput(input)
  
  const { data, error } = await supabase
    .from('calibration_profiles')
    .update({
      ...validatedInput,
      name: input.name ?? currentProfile.name,
      description: input.description ?? currentProfile.description,
    })
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('Error updating calibration profile:', error)
    return null
  }

  // Log the change
  await logCalibrationChange({
    calibration_profile_id: id,
    model_version_id: data.model_version_id,
    change_type: 'calibration_updated',
    old_values: currentProfile,
    new_values: data,
    changed_by: updatedBy || null,
    reason: reason || 'Calibration profile updated',
  })

  return data
}

export async function activateCalibrationProfile(
  id: string,
  activatedBy?: string,
  reason?: string
): Promise<boolean> {
  const supabase = await createClient()
  
  // Deactivate all other profiles
  await supabase
    .from('calibration_profiles')
    .update({ is_active: false })
    .neq('id', id)

  // Activate this profile
  const { error } = await supabase
    .from('calibration_profiles')
    .update({ is_active: true })
    .eq('id', id)

  if (error) {
    console.error('Error activating calibration profile:', error)
    return false
  }

  // Invalidate the calibration cache
  invalidateCalibrationCache()

  // Log the activation
  await logCalibrationChange({
    calibration_profile_id: id,
    model_version_id: null,
    change_type: 'calibration_activated',
    old_values: null,
    new_values: { is_active: true },
    changed_by: activatedBy || null,
    reason: reason || 'Calibration profile activated',
  })

  return true
}

export async function deleteCalibrationProfile(id: string): Promise<boolean> {
  const supabase = await createClient()
  
  // Don't delete if it's the only profile or if active
  const { data: profile } = await supabase
    .from('calibration_profiles')
    .select('is_active')
    .eq('id', id)
    .single()

  if (profile?.is_active) {
    console.error('Cannot delete active calibration profile')
    return false
  }

  const { error } = await supabase
    .from('calibration_profiles')
    .delete()
    .eq('id', id)

  if (error) {
    console.error('Error deleting calibration profile:', error)
    return false
  }

  return true
}

// ============================================================================
// MODEL VERSION MANAGEMENT & ROLLBACK
// ============================================================================

export async function getModelVersionsWithCalibration(): Promise<ModelVersionWithCalibration[]> {
  const supabase = await createClient()
  
  const { data: models, error } = await supabase
    .from('model_versions')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Error fetching model versions:', error)
    return []
  }

  // Get calibration profiles for each model
  const { data: profiles } = await supabase
    .from('calibration_profiles')
    .select('*')

  // Get activation history
  const { data: activations } = await supabase
    .from('model_activation_events')
    .select('*')
    .order('activated_at', { ascending: false })
    .limit(50)

  const profilesMap = new Map<string, CalibrationProfile[]>()
  const activeProfileMap = new Map<string, CalibrationProfile>()
  
  for (const profile of profiles || []) {
    if (profile.model_version_id) {
      const existing = profilesMap.get(profile.model_version_id) || []
      existing.push(profile)
      profilesMap.set(profile.model_version_id, existing)
      
      if (profile.is_active) {
        activeProfileMap.set(profile.model_version_id, profile)
      }
    }
  }

  const activationsMap = new Map<string, ModelActivationEvent[]>()
  for (const event of activations || []) {
    const existing = activationsMap.get(event.model_version_id) || []
    existing.push(event)
    activationsMap.set(event.model_version_id, existing)
  }

  return (models || []).map(model => ({
    ...model,
    calibration_profiles: profilesMap.get(model.id) || [],
    active_calibration_profile: activeProfileMap.get(model.id) || null,
    activation_history: activationsMap.get(model.id) || [],
  }))
}

export async function activateModelVersion(
  modelVersionId: string,
  calibrationProfileId?: string | null,
  activatedBy?: string,
  reason?: string
): Promise<boolean> {
  const supabase = await createClient()
  
  // Get current active model
  const { data: currentActive } = await supabase
    .from('model_versions')
    .select('id')
    .eq('is_active', true)
    .single()

  // Deactivate all models
  await supabase
    .from('model_versions')
    .update({ is_active: false })
    .neq('id', modelVersionId)

  // Activate the selected model
  const { error } = await supabase
    .from('model_versions')
    .update({ 
      is_active: true, 
      last_activated_at: new Date().toISOString(),
      updated_at: new Date().toISOString() 
    })
    .eq('id', modelVersionId)

  if (error) {
    console.error('Error activating model version:', error)
    return false
  }

  // Log activation event
  await supabase
    .from('model_activation_events')
    .insert({
      model_version_id: modelVersionId,
      previous_model_version_id: currentActive?.id || null,
      calibration_profile_id: calibrationProfileId || null,
      activated_by: activatedBy || null,
      reason: reason || 'Model version activated',
      is_rollback: false,
    })

  // Log to calibration changes
  await logCalibrationChange({
    calibration_profile_id: calibrationProfileId || null,
    model_version_id: modelVersionId,
    change_type: 'model_activated',
    old_values: { model_version_id: currentActive?.id || null },
    new_values: { model_version_id: modelVersionId },
    changed_by: activatedBy || null,
    reason: reason || 'Model version activated',
  })

  return true
}

export async function rollbackModelVersion(
  request: ModelRollbackRequest,
  rolledBackBy?: string
): Promise<ModelRollbackResult> {
  const supabase = await createClient()
  
  const warnings: string[] = []
  
  // Get current active model
  const { data: currentActive } = await supabase
    .from('model_versions')
    .select('id, version_name')
    .eq('is_active', true)
    .single()

  // Verify target model exists
  const { data: targetModel } = await supabase
    .from('model_versions')
    .select('id, version_name')
    .eq('id', request.target_model_version_id)
    .single()

  if (!targetModel) {
    return {
      success: false,
      previous_model_version_id: currentActive?.id || null,
      new_model_version_id: request.target_model_version_id,
      calibration_profile_id: null,
      rollback_event_id: '',
      warnings: ['Target model version not found'],
    }
  }

  // Find the calibration profile that was active with the target model (if requested)
  let calibrationProfileId: string | null = null
  if (request.include_calibration) {
    const { data: lastActivation } = await supabase
      .from('model_activation_events')
      .select('calibration_profile_id')
      .eq('model_version_id', request.target_model_version_id)
      .order('activated_at', { ascending: false })
      .limit(1)
      .single()

    if (lastActivation?.calibration_profile_id) {
      calibrationProfileId = lastActivation.calibration_profile_id
      
      // Activate the calibration profile
      await activateCalibrationProfile(calibrationProfileId!, rolledBackBy, `Restored as part of rollback to ${targetModel.version_name}`)
    } else {
      warnings.push('No calibration profile was previously active with this model version')
    }
  }

  // Deactivate current model
  await supabase
    .from('model_versions')
    .update({ is_active: false })
    .neq('id', request.target_model_version_id)

  // Activate target model
  const { error } = await supabase
    .from('model_versions')
    .update({ 
      is_active: true, 
      last_activated_at: new Date().toISOString(),
      updated_at: new Date().toISOString() 
    })
    .eq('id', request.target_model_version_id)

  if (error) {
    return {
      success: false,
      previous_model_version_id: currentActive?.id || null,
      new_model_version_id: request.target_model_version_id,
      calibration_profile_id: calibrationProfileId,
      rollback_event_id: '',
      warnings: ['Failed to activate target model version'],
    }
  }

  // Log rollback event
  const { data: rollbackEvent } = await supabase
    .from('model_activation_events')
    .insert({
      model_version_id: request.target_model_version_id,
      previous_model_version_id: currentActive?.id || null,
      calibration_profile_id: calibrationProfileId,
      activated_by: rolledBackBy || null,
      reason: request.reason,
      is_rollback: true,
    })
    .select()
    .single()

  // Log to calibration changes
  await logCalibrationChange({
    calibration_profile_id: calibrationProfileId,
    model_version_id: request.target_model_version_id,
    change_type: 'model_rollback',
    old_values: { model_version_id: currentActive?.id || null },
    new_values: { model_version_id: request.target_model_version_id },
    changed_by: rolledBackBy || null,
    reason: request.reason,
  })

  return {
    success: true,
    previous_model_version_id: currentActive?.id || null,
    new_model_version_id: request.target_model_version_id,
    calibration_profile_id: calibrationProfileId,
    rollback_event_id: rollbackEvent?.id || '',
    warnings,
  }
}

// ============================================================================
// CALIBRATION PREVIEW
// ============================================================================

export async function previewCalibrationChanges(
  proposedProfile: Partial<CalibrationProfile>,
  validationRunId?: string,
  sampleSize: number = 50
): Promise<CalibrationPreviewResult> {
  const supabase = await createClient()
  const warnings: string[] = []
  const recommendations: string[] = []

  // Get current active profile
  const currentProfile = await getActiveCalibrationProfile()
  
  // Get validation results to test against
  let testExamples: { 
    ground_truth_gross: number
    ground_truth_net: number | null
    predicted_gross: number
    predicted_net: number | null
    state: string | null
    rack_type: string | null
  }[] = []

  if (validationRunId) {
    const { data } = await supabase
      .from('validation_results')
      .select('ground_truth_gross, ground_truth_net, predicted_gross, predicted_net, state, rack_type')
      .eq('run_id', validationRunId)
      .limit(sampleSize)

    testExamples = data || []
  } else {
    // Use training examples with ground truth
    const { data } = await supabase
      .from('training_examples')
      .select(`
        ground_truth_score,
        predicted_score,
        buck_id
      `)
      .eq('verified_for_training', true)
      .not('ground_truth_score', 'is', null)
      .not('predicted_score', 'is', null)
      .limit(sampleSize)

    if (data) {
      // Get buck metadata
      const buckIds = data.map(e => e.buck_id).filter(Boolean)
      const { data: bucks } = await supabase
        .from('bucks')
        .select('id, state, rack_type')
        .in('id', buckIds)

      const bucksMap = new Map(bucks?.map(b => [b.id, b]) || [])

      testExamples = data.map(e => ({
        ground_truth_gross: e.ground_truth_score,
        ground_truth_net: null,
        predicted_gross: e.predicted_score,
        predicted_net: null,
        state: bucksMap.get(e.buck_id)?.state || null,
        rack_type: bucksMap.get(e.buck_id)?.rack_type || null,
      }))
    }
  }

  if (testExamples.length < 10) {
    warnings.push('Limited test data available - preview results may not be representative')
  }

  // Calculate metrics with current calibration (no simulation)
  const currentMetrics = calculateCalibrationMetrics(testExamples, null, null)
  // Calculate metrics with proposed calibration (simulated)
  const proposedMetrics = calculateCalibrationMetrics(testExamples, proposedProfile as CalibrationProfile, currentProfile)

  // Calculate improvements
  const maeImprovement = currentMetrics.mae_gross - proposedMetrics.mae_gross
  const maeImprovementPercent = currentMetrics.mae_gross > 0 
    ? (maeImprovement / currentMetrics.mae_gross) * 100 
    : 0

  let examplesImproved = 0
  let examplesWorsened = 0
  let examplesUnchanged = 0

  for (const example of testExamples) {
    const currentError = Math.abs(example.predicted_gross - example.ground_truth_gross)
    const proposedError = simulateCalibratedError(example, proposedProfile, currentProfile)
    
    if (proposedError < currentError - 0.5) examplesImproved++
    else if (proposedError > currentError + 0.5) examplesWorsened++
    else examplesUnchanged++
  }

  // Generate warnings for extreme values
  if (proposedProfile.learning_correction_strength !== undefined) {
    if (proposedProfile.learning_correction_strength > 1.5) {
      warnings.push('High learning correction strength may cause instability')
    }
    if (proposedProfile.learning_correction_strength < 0.5) {
      warnings.push('Low learning correction strength may ignore valuable training data')
    }
  }

  if (proposedProfile.confidence_scaling !== undefined) {
    if (proposedProfile.confidence_scaling < 0.7) {
      warnings.push('Low confidence scaling will significantly reduce reported confidence')
    }
  }

  // Generate recommendations
  if (maeImprovement > 0.5) {
    recommendations.push('Proposed calibration shows meaningful improvement - consider activating')
  }
  if (examplesWorsened > examplesImproved) {
    recommendations.push('Proposed calibration worsens more examples than it improves - review carefully')
  }
  if (Math.abs(maeImprovement) < 0.2) {
    recommendations.push('Changes have minimal impact - may not be worth the risk')
  }

  return {
    current_profile_id: currentProfile?.id || null,
    proposed_profile: proposedProfile,
    current_metrics: currentMetrics,
    proposed_metrics: proposedMetrics,
    mae_improvement_inches: maeImprovement,
    mae_improvement_percent: maeImprovementPercent,
    examples_improved: examplesImproved,
    examples_worsened: examplesWorsened,
    examples_unchanged: examplesUnchanged,
    warnings,
    recommendations,
  }
}

// ============================================================================
// AUDIT TRAIL
// ============================================================================

export async function getCalibrationAuditTrail(limit: number = 50): Promise<CalibrationChange[]> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('calibration_changes')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('Error fetching calibration audit trail:', error)
    return []
  }

  return data || []
}

export async function getModelActivationHistory(limit: number = 20): Promise<ModelActivationEvent[]> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('model_activation_events')
    .select('*')
    .order('activated_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('Error fetching model activation history:', error)
    return []
  }

  return data || []
}

// ============================================================================
// HELPERS
// ============================================================================

function validateCalibrationInput(input: Partial<CalibrationProfileInput>): Record<string, number> {
  const validated: Record<string, number> = {}
  
  for (const [key, range] of Object.entries(SAFE_RANGES)) {
    const value = input[key as keyof CalibrationProfileInput]
    if (typeof value === 'number') {
      const typedRange = range as { min: number; max: number }
      validated[key] = Math.max(typedRange.min, Math.min(typedRange.max, value))
    }
  }
  
  return validated
}

async function logCalibrationChange(change: Omit<CalibrationChange, 'id' | 'created_at'>): Promise<void> {
  const supabase = await createClient()
  
  await supabase
    .from('calibration_changes')
    .insert(change)
}

/**
 * Calculate calibration metrics for a set of examples.
 * When a profile is provided, simulates what the errors would be with that calibration.
 */
function calculateCalibrationMetrics(
  examples: { 
    ground_truth_gross: number
    predicted_gross: number
    state?: string | null
    rack_type?: string | null 
  }[],
  profile?: CalibrationProfile | null,
  currentProfile?: CalibrationProfile | null
): CalibrationMetrics {
  if (examples.length === 0) {
    return {
      mae_gross: 0,
      mae_net: null,
      median_error_gross: 0,
      median_error_net: null,
      overestimation_count: 0,
      underestimation_count: 0,
      within_5_inches: 0,
      within_10_inches: 0,
      within_5_percent: 0,
      within_10_percent: 0,
      sample_count: 0,
    }
  }

  // If no profile to simulate, just use raw errors
  // If profile provided, simulate calibrated errors
  const absErrors: number[] = []
  const signedErrors: number[] = []
  
  for (const example of examples) {
    if (profile) {
      // Simulate what the error would be with the proposed calibration
      const simulatedAbsError = simulateCalibratedError(example, profile, currentProfile)
      absErrors.push(simulatedAbsError)
      // Estimate signed error based on direction
      const baseError = example.predicted_gross - example.ground_truth_gross
      signedErrors.push(baseError >= 0 ? simulatedAbsError : -simulatedAbsError)
    } else {
      const error = example.predicted_gross - example.ground_truth_gross
      absErrors.push(Math.abs(error))
      signedErrors.push(error)
    }
  }
  
  const mae = absErrors.reduce((a, b) => a + b, 0) / absErrors.length
  
  const sortedAbsErrors = [...absErrors].sort((a, b) => a - b)
  const medianError = sortedAbsErrors[Math.floor(sortedAbsErrors.length / 2)]
  
  const overestimation = signedErrors.filter(e => e > 0.5).length
  const underestimation = signedErrors.filter(e => e < -0.5).length
  
  const within5 = absErrors.filter(e => e <= 5).length
  const within10 = absErrors.filter(e => e <= 10).length
  
  const within5Pct = examples.filter((e, i) => {
    const pctError = absErrors[i] / e.ground_truth_gross * 100
    return pctError <= 5
  }).length

  const within10Pct = examples.filter((e, i) => {
    const pctError = absErrors[i] / e.ground_truth_gross * 100
    return pctError <= 10
  }).length

  return {
    mae_gross: mae,
    mae_net: null,
    median_error_gross: medianError,
    median_error_net: null,
    overestimation_count: overestimation,
    underestimation_count: underestimation,
    within_5_inches: within5,
    within_10_inches: within10,
    within_5_percent: within5Pct,
    within_10_percent: within10Pct,
    sample_count: examples.length,
  }
}

/**
 * Simulate how a proposed calibration profile would affect prediction error.
 * 
 * This models the actual calibration pipeline behavior:
 * 1. Learning correction strength scales overall corrections
 * 2. Max correction caps limit how much the score can change
 * 3. Confidence scaling affects uncertainty estimates
 * 
 * The simulation estimates the direction and magnitude of changes based on
 * the current error and the proposed calibration weights.
 */
function simulateCalibratedError(
  example: { 
    ground_truth_gross: number
    predicted_gross: number
    state?: string | null
    rack_type?: string | null
  },
  proposedProfile: Partial<CalibrationProfile>,
  currentProfile?: CalibrationProfile | null
): number {
  const baseError = example.predicted_gross - example.ground_truth_gross
  const absBaseError = Math.abs(baseError)
  
  // Get current and proposed calibration values
  const current = getCalibrationApplicationValues(currentProfile)
  const proposed = getCalibrationApplicationValues(proposedProfile as CalibrationProfile)
  
  // Calculate relative learning strength change
  const learningStrengthRatio = proposed.learningStrength / current.learningStrength
  
  // Estimate the correction that would have been applied under current calibration
  // Based on typical correction patterns: corrections are usually 10-30% of the error
  const estimatedCurrentCorrection = baseError * 0.2 * current.learningStrength
  
  // Estimate what correction would be applied under proposed calibration
  const estimatedProposedCorrection = baseError * 0.2 * proposed.learningStrength
  
  // Apply correction caps
  const cappedCurrentCorrection = Math.max(
    -current.maxTotalCorrection,
    Math.min(current.maxTotalCorrection, estimatedCurrentCorrection)
  )
  const cappedProposedCorrection = Math.max(
    -proposed.maxTotalCorrection,
    Math.min(proposed.maxTotalCorrection, estimatedProposedCorrection)
  )
  
  // Calculate the net correction difference
  const correctionDelta = cappedProposedCorrection - cappedCurrentCorrection
  
  // The proposed prediction would be: predicted + correctionDelta
  const proposedPredicted = example.predicted_gross + correctionDelta
  const proposedError = Math.abs(proposedPredicted - example.ground_truth_gross)
  
  // Factor in measurement-specific weight changes
  // If we're over-estimating (baseError > 0), reducing weights helps
  // If we're under-estimating (baseError < 0), increasing weights helps
  const avgWeightChange = (
    (proposed.spreadWeight / current.spreadWeight) +
    (proposed.beamWeight / current.beamWeight) +
    (proposed.tineWeight / current.tineWeight)
  ) / 3
  
  // Apply a small adjustment based on weight changes
  // Higher weights = larger corrections = typically helps when under-estimating
  const weightAdjustment = (avgWeightChange - 1) * absBaseError * 0.05
  
  return Math.max(0, proposedError - weightAdjustment)
}


