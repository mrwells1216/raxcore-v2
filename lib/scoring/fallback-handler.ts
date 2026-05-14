/**
 * Phase 24: Fallback Handler
 * Safe fallback logic when vision path fails
 */

import type {
  Measurements,
  LandmarksDetected,
  AngleType
} from '@/lib/types'
import type { ScoringOutput } from '@/lib/scoring/ai-service'
import type { VisionRuntimeError, RuntimeMetadata } from './vision-runtime'
import type { ImageValidationResult } from './image-validation'
import { ANATOMICAL_REFERENCES } from '@/lib/constants'

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
  | 'heuristic_full'      // Full heuristic scoring with learning
  | 'heuristic_degraded'  // Heuristic with reduced confidence
  | 'safe_minimum'        // Minimal safe response
  | 'error_response'      // Return error, don't fake results

export interface FallbackMetadata {
  /** Whether fallback was used */
  usedFallback: boolean
  /** Reason for fallback (null if vision succeeded) */
  fallbackReason: FallbackReason | null
  /** Strategy used for fallback */
  fallbackStrategy: FallbackStrategy | null
  /** Vision errors encountered */
  visionErrors: VisionRuntimeError[]
  /** Image validation result */
  imageValidation: ImageValidationResult | null
  /** Runtime metadata from vision attempts */
  runtimeMetadata: RuntimeMetadata | null
  /** Confidence penalty applied due to fallback */
  confidencePenalty: number
  /** Error band widening factor */
  errorBandWidening: number
  /** Human-readable summary */
  summary: string
  /** Admin/debug details */
  adminDetails: string[]
  /** Timestamp of fallback decision */
  timestamp: string
}

export interface FallbackDecision {
  shouldFallback: boolean
  reason: FallbackReason | null
  strategy: FallbackStrategy
  confidencePenalty: number
  errorBandWidening: number
  userMessage: string
  adminMessage: string
}

/**
 * Map vision runtime error to fallback reason
 */
export function mapRuntimeErrorToFallbackReason(error: VisionRuntimeError): FallbackReason {
  switch (error.type) {
    case 'timeout':
      return 'vision_timeout'
    case 'provider_error':
      return 'vision_provider_error'
    case 'rate_limit':
      return 'vision_rate_limit'
    case 'quota_exceeded':
      return 'vision_quota_exceeded'
    case 'model_unavailable':
      return 'vision_model_unavailable'
    case 'malformed_response':
    case 'incomplete_response':
      return 'vision_malformed_response'
    case 'validation_error':
      return 'vision_validation_failed'
    case 'content_policy':
      return 'vision_content_blocked'
    default:
      return 'unknown_error'
  }
}

/**
 * Determine fallback strategy based on reason and context
 */
export function determineFallbackStrategy(
  reason: FallbackReason,
  hasValidImages: boolean,
  imageValidationResult: ImageValidationResult | null
): FallbackStrategy {
  // No valid images at all - can't do anything meaningful
  if (!hasValidImages || (imageValidationResult && imageValidationResult.validImageCount === 0)) {
    return 'error_response'
  }

  // Content blocked - don't try to work around it
  if (reason === 'vision_content_blocked') {
    return 'error_response'
  }

  // Quota/billing issues - provide degraded response but make it clear
  if (reason === 'vision_quota_exceeded') {
    return 'heuristic_degraded'
  }

  // Transient issues - full heuristic is reasonable
  if (
    reason === 'vision_timeout' ||
    reason === 'vision_provider_error' ||
    reason === 'vision_rate_limit' ||
    reason === 'vision_model_unavailable'
  ) {
    return 'heuristic_full'
  }

  // Response quality issues - degraded heuristic
  if (
    reason === 'vision_malformed_response' ||
    reason === 'vision_validation_failed'
  ) {
    return 'heuristic_degraded'
  }

  // Image validation issues
  if (reason === 'image_validation_failed' || reason === 'no_valid_images' || reason === 'all_images_inaccessible') {
    return imageValidationResult && imageValidationResult.validImageCount > 0 
      ? 'heuristic_degraded' 
      : 'error_response'
  }

  // Unknown - be conservative
  return 'heuristic_degraded'
}

/**
 * Get confidence penalty for a fallback reason
 */
function getConfidencePenalty(reason: FallbackReason, strategy: FallbackStrategy): number {
  // Base penalty by strategy
  const strategyPenalty: Record<FallbackStrategy, number> = {
    heuristic_full: 15,
    heuristic_degraded: 25,
    safe_minimum: 40,
    error_response: 0, // N/A
  }

  // Additional penalty by reason
  const reasonPenalty: Record<FallbackReason, number> = {
    vision_timeout: 5,
    vision_provider_error: 5,
    vision_rate_limit: 3,
    vision_quota_exceeded: 8,
    vision_model_unavailable: 5,
    vision_malformed_response: 10,
    vision_validation_failed: 12,
    vision_content_blocked: 0,
    image_validation_failed: 8,
    no_valid_images: 0,
    all_images_inaccessible: 10,
    unknown_error: 15,
  }

  return strategyPenalty[strategy] + reasonPenalty[reason]
}

/**
 * Get error band widening factor for a fallback reason
 */
function getErrorBandWidening(reason: FallbackReason, strategy: FallbackStrategy): number {
  // Base widening by strategy
  const strategyWidening: Record<FallbackStrategy, number> = {
    heuristic_full: 1.3,
    heuristic_degraded: 1.5,
    safe_minimum: 2.0,
    error_response: 1.0,
  }

  // Additional widening by reason
  const reasonWidening: Record<FallbackReason, number> = {
    vision_timeout: 0.1,
    vision_provider_error: 0.1,
    vision_rate_limit: 0.05,
    vision_quota_exceeded: 0.15,
    vision_model_unavailable: 0.1,
    vision_malformed_response: 0.2,
    vision_validation_failed: 0.25,
    vision_content_blocked: 0,
    image_validation_failed: 0.15,
    no_valid_images: 0,
    all_images_inaccessible: 0.2,
    unknown_error: 0.25,
  }

  return strategyWidening[strategy] + reasonWidening[reason]
}

/**
 * Get user-friendly message for fallback
 */
function getUserMessage(reason: FallbackReason, strategy: FallbackStrategy): string {
  if (strategy === 'error_response') {
    switch (reason) {
      case 'vision_content_blocked':
        return 'Images could not be processed due to content guidelines.'
      case 'no_valid_images':
        return 'No valid images were provided for scoring.'
      case 'all_images_inaccessible':
        return 'None of the provided images could be accessed.'
      default:
        return 'Scoring could not be completed. Please try again.'
    }
  }

  if (strategy === 'heuristic_degraded') {
    return 'Using simplified analysis. Results have wider error margins.'
  }

  if (strategy === 'heuristic_full') {
    return 'Using alternative analysis method. Vision analysis temporarily unavailable.'
  }

  return 'Using fallback scoring method.'
}

/**
 * Get admin message with details
 */
function getAdminMessage(
  reason: FallbackReason, 
  strategy: FallbackStrategy,
  visionErrors: VisionRuntimeError[],
  runtimeMetadata: RuntimeMetadata | null
): string {
  const parts: string[] = [
    `Fallback: ${strategy}`,
    `Reason: ${reason}`,
  ]

  if (runtimeMetadata) {
    parts.push(`Attempts: ${runtimeMetadata.totalAttempts}`)
    parts.push(`Time: ${runtimeMetadata.totalTimeMs}ms`)
    if (runtimeMetadata.timedOut) {
      parts.push('TIMEOUT')
    }
  }

  if (visionErrors.length > 0) {
    parts.push(`Errors: ${visionErrors.map(e => e.type).join(', ')}`)
  }

  return parts.join(' | ')
}

/**
 * Make a fallback decision based on available context
 */
export function makeFallbackDecision(
  visionError: VisionRuntimeError | null,
  runtimeMetadata: RuntimeMetadata | null,
  imageValidation: ImageValidationResult | null
): FallbackDecision {
  // If no error, no fallback needed
  if (!visionError) {
    return {
      shouldFallback: false,
      reason: null,
      strategy: 'heuristic_full',
      confidencePenalty: 0,
      errorBandWidening: 1.0,
      userMessage: '',
      adminMessage: '',
    }
  }

  // Determine reason
  const reason = mapRuntimeErrorToFallbackReason(visionError)
  
  // Check if we have valid images
  const hasValidImages = !imageValidation || imageValidation.validImageCount > 0

  // Determine strategy
  const strategy = determineFallbackStrategy(reason, hasValidImages, imageValidation)

  // Get penalties
  const confidencePenalty = getConfidencePenalty(reason, strategy)
  const errorBandWidening = getErrorBandWidening(reason, strategy)

  // Get messages
  const userMessage = getUserMessage(reason, strategy)
  const adminMessage = getAdminMessage(reason, strategy, runtimeMetadata?.errorsEncountered || [], runtimeMetadata)

  return {
    shouldFallback: true,
    reason,
    strategy,
    confidencePenalty,
    errorBandWidening,
    userMessage,
    adminMessage,
  }
}

/**
 * Create fallback metadata for storage
 */
export function createFallbackMetadata(
  decision: FallbackDecision,
  visionErrors: VisionRuntimeError[],
  imageValidation: ImageValidationResult | null,
  runtimeMetadata: RuntimeMetadata | null
): FallbackMetadata {
  const adminDetails: string[] = []

  if (runtimeMetadata) {
    adminDetails.push(`Total vision attempts: ${runtimeMetadata.totalAttempts}`)
    adminDetails.push(`Total processing time: ${runtimeMetadata.totalTimeMs}ms`)
    if (runtimeMetadata.wasRetried) {
      adminDetails.push(`Retry delays: ${runtimeMetadata.retryDelaysMs.join(', ')}ms`)
    }
    if (runtimeMetadata.timedOut) {
      adminDetails.push('Operation timed out')
    }
  }

  if (imageValidation) {
    adminDetails.push(`Images validated: ${imageValidation.validImageCount}/${imageValidation.totalImageCount}`)
    if (imageValidation.issues.length > 0) {
      adminDetails.push(`Image issues: ${imageValidation.issues.length}`)
      const errorIssues = imageValidation.issues.filter(i => i.severity === 'error')
      if (errorIssues.length > 0) {
        adminDetails.push(`Image errors: ${errorIssues.map(i => i.issueType).join(', ')}`)
      }
    }
  }

  for (const err of visionErrors) {
    adminDetails.push(`Vision error: ${err.type} - ${err.message}`)
  }

  return {
    usedFallback: decision.shouldFallback,
    fallbackReason: decision.reason,
    fallbackStrategy: decision.strategy,
    visionErrors,
    imageValidation,
    runtimeMetadata,
    confidencePenalty: decision.confidencePenalty,
    errorBandWidening: decision.errorBandWidening,
    summary: decision.userMessage,
    adminDetails,
    timestamp: new Date().toISOString(),
  }
}

/**
 * Generate safe heuristic measurements for fallback
 * These are conservative estimates based on input context
 */
export function generateFallbackMeasurements(
  state: string,
  rackType: 'typical' | 'non-typical',
  mainFramePoints?: number,
  sourceType?: string
): Measurements {
  // Use very conservative/average measurements
  const isTypical = rackType === 'typical'
  const framePts = mainFramePoints || (isTypical ? 10 : 11)
  
  // Conservative base values (lower than average)
  const baseSpread = 17.5
  const baseBeam = 23.0
  const baseG1 = 4.2
  const baseG2 = 9.0
  const baseG3 = 7.5
  const baseG4 = 5.5
  const baseH = 4.2

  // Minor adjustments for mounted sources (more reliable)
  const mountBonus = (sourceType === 'mounted_photo' || sourceType === 'european_mount') ? 0.5 : 0

  return {
    inside_spread: Number((baseSpread + mountBonus).toFixed(1)),
    main_beam_left: Number((baseBeam + mountBonus).toFixed(1)),
    main_beam_right: Number((baseBeam + mountBonus).toFixed(1)),
    g1_left: Number(baseG1.toFixed(1)),
    g1_right: Number(baseG1.toFixed(1)),
    g2_left: Number(baseG2.toFixed(1)),
    g2_right: Number(baseG2.toFixed(1)),
    g3_left: Number(baseG3.toFixed(1)),
    g3_right: Number(baseG3.toFixed(1)),
    g4_left: Number(baseG4.toFixed(1)),
    g4_right: Number(baseG4.toFixed(1)),
    g5_left: framePts >= 12 ? 2.5 : null,
    g5_right: framePts >= 12 ? 2.5 : null,
    h1_left: Number(baseH.toFixed(1)),
    h1_right: Number(baseH.toFixed(1)),
    h2_left: Number((baseH - 0.2).toFixed(1)),
    h2_right: Number((baseH - 0.2).toFixed(1)),
    h3_left: Number((baseH - 0.4).toFixed(1)),
    h3_right: Number((baseH - 0.4).toFixed(1)),
    h4_left: Number((baseH - 0.6).toFixed(1)),
    h4_right: Number((baseH - 0.6).toFixed(1)),
    abnormal_points: isTypical ? 0 : 8.0,
    deductions: 3.5,
  }
}

/**
 * Generate safe landmarks for fallback
 */
export function generateFallbackLandmarks(
  earsFullyVisible?: boolean,
  fallbackReason?: FallbackReason
): LandmarksDetected {
  return {
    ears_visible: earsFullyVisible ?? false,
    eyes_visible: false,
    antlers_visible: true,
    ear_base_to_tip: ANATOMICAL_REFERENCES.EAR_BASE_TO_TIP,
    eye_to_eye: ANATOMICAL_REFERENCES.EYE_TO_EYE,
    ear_tip_to_tip: ANATOMICAL_REFERENCES.EAR_TIP_TO_TIP_ALERT,
    quality_notes: [
      `Fallback scoring: ${fallbackReason || 'vision unavailable'}`,
      'Landmarks estimated using reference values',
      'Manual verification recommended',
    ],
  }
}

/**
 * Build a complete fallback error response
 */
export interface FallbackErrorResponse {
  success: false
  error: string
  userMessage: string
  fallbackMetadata: FallbackMetadata
}

export function buildFallbackErrorResponse(
  decision: FallbackDecision,
  visionErrors: VisionRuntimeError[],
  imageValidation: ImageValidationResult | null,
  runtimeMetadata: RuntimeMetadata | null
): FallbackErrorResponse {
  return {
    success: false,
    error: decision.adminMessage,
    userMessage: decision.userMessage,
    fallbackMetadata: createFallbackMetadata(decision, visionErrors, imageValidation, runtimeMetadata),
  }
}

/**
 * Apply fallback penalties to a scoring output
 */
export function applyFallbackPenalties(
  output: ScoringOutput,
  metadata: FallbackMetadata
): ScoringOutput {
  // Apply confidence penalty
  const adjustedConfidence = Math.max(15, output.confidencePercent - metadata.confidencePenalty)
  
  // Widen error bands
  const midpoint = output.predictedGross
  const currentRange = output.errorBandHigh - output.errorBandLow
  const newRange = currentRange * metadata.errorBandWidening
  const newLow = midpoint - (newRange / 2)
  const newHigh = midpoint + (newRange / 2)

  // Add fallback note to explanations
  const updatedExplanations = [...output.confidenceExplanation]
  if (metadata.usedFallback && metadata.summary) {
    updatedExplanations.unshift(`[Fallback] ${metadata.summary}`)
  }

  return {
    ...output,
    confidencePercent: adjustedConfidence,
    errorBandLow: Number(newLow.toFixed(1)),
    errorBandHigh: Number(newHigh.toFixed(1)),
    confidenceExplanation: updatedExplanations,
    confidenceReliability: adjustedConfidence >= 60 ? 'medium' : 'low',
  }
}
