/**
 * Phase 24: Vision Runtime Hardening
 * Timeout, retry, and error handling wrapper for vision calls
 */

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

export interface VisionRuntimeError {
  type: VisionRuntimeErrorType
  message: string
  retryable: boolean
  retryAfterMs?: number
  originalError?: unknown
  attempt?: number
  totalAttempts?: number
}

export interface RuntimeConfig {
  /** Total timeout for the entire operation including retries (default: 60s) */
  totalTimeoutMs: number
  /** Timeout for a single vision call (default: 30s) */
  singleCallTimeoutMs: number
  /** Maximum retry attempts for transient failures (default: 2) */
  maxRetries: number
  /** Base delay between retries in ms (default: 1000) */
  retryDelayBaseMs: number
  /** Maximum delay between retries in ms (default: 5000) */
  retryDelayMaxMs: number
  /** Whether to use exponential backoff (default: true) */
  exponentialBackoff: boolean
}

export const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  totalTimeoutMs: 60000,
  singleCallTimeoutMs: 30000,
  maxRetries: 2,
  retryDelayBaseMs: 1000,
  retryDelayMaxMs: 5000,
  exponentialBackoff: true,
}

export interface RuntimeMetadata {
  totalAttempts: number
  successfulAttempt: number | null
  totalTimeMs: number
  retryDelaysMs: number[]
  errorsEncountered: VisionRuntimeError[]
  finalError: VisionRuntimeError | null
  timedOut: boolean
  wasRetried: boolean
}

export interface VisionCallResult<T> {
  success: boolean
  result?: T
  error?: VisionRuntimeError
  metadata: RuntimeMetadata
}

/**
 * Classify an error into a VisionRuntimeErrorType
 */
export function classifyError(error: unknown): VisionRuntimeError {
  const message = error instanceof Error ? error.message : String(error)
  const lowerMessage = message.toLowerCase()

  // Timeout errors
  if (lowerMessage.includes('timeout') || lowerMessage.includes('timed out') || lowerMessage.includes('aborted')) {
    return {
      type: 'timeout',
      message: 'Vision call timed out',
      retryable: true,
      originalError: error,
    }
  }

  // Rate limit errors
  if (lowerMessage.includes('rate limit') || lowerMessage.includes('429') || lowerMessage.includes('too many requests')) {
    const retryAfterMatch = lowerMessage.match(/retry.?after:?\s*(\d+)/i)
    const retryAfterMs = retryAfterMatch ? parseInt(retryAfterMatch[1], 10) * 1000 : 5000
    return {
      type: 'rate_limit',
      message: 'Rate limit exceeded',
      retryable: true,
      retryAfterMs,
      originalError: error,
    }
  }

  // Quota errors
  if (lowerMessage.includes('quota') || lowerMessage.includes('billing') || lowerMessage.includes('exceeded')) {
    return {
      type: 'quota_exceeded',
      message: 'API quota or billing limit exceeded',
      retryable: false,
      originalError: error,
    }
  }

  // Model unavailable
  if (lowerMessage.includes('model') && (lowerMessage.includes('unavailable') || lowerMessage.includes('not found'))) {
    return {
      type: 'model_unavailable',
      message: 'Vision model is unavailable',
      retryable: true,
      retryAfterMs: 10000,
      originalError: error,
    }
  }

  // Content policy
  if (lowerMessage.includes('content policy') || lowerMessage.includes('safety') || lowerMessage.includes('blocked')) {
    return {
      type: 'content_policy',
      message: 'Content blocked by safety policy',
      retryable: false,
      originalError: error,
    }
  }

  // Network errors
  if (lowerMessage.includes('network') || lowerMessage.includes('econnreset') || 
      lowerMessage.includes('econnrefused') || lowerMessage.includes('fetch failed')) {
    return {
      type: 'network_error',
      message: 'Network error during vision call',
      retryable: true,
      originalError: error,
    }
  }

  // Provider errors (500s)
  if (lowerMessage.includes('500') || lowerMessage.includes('502') || 
      lowerMessage.includes('503') || lowerMessage.includes('504') ||
      lowerMessage.includes('internal server error') || lowerMessage.includes('service unavailable')) {
    return {
      type: 'provider_error',
      message: 'Vision provider error',
      retryable: true,
      originalError: error,
    }
  }

  // Malformed response
  if (lowerMessage.includes('json') || lowerMessage.includes('parse') || lowerMessage.includes('unexpected token')) {
    return {
      type: 'malformed_response',
      message: 'Malformed response from vision model',
      retryable: true,
      originalError: error,
    }
  }

  // Validation error
  if (lowerMessage.includes('validation') || lowerMessage.includes('invalid') || lowerMessage.includes('schema')) {
    return {
      type: 'validation_error',
      message: 'Response failed validation',
      retryable: true,
      originalError: error,
    }
  }

  // Unknown error
  return {
    type: 'unknown',
    message: message || 'Unknown vision error',
    retryable: false,
    originalError: error,
  }
}

/**
 * Calculate retry delay with optional exponential backoff
 */
function calculateRetryDelay(attempt: number, config: RuntimeConfig): number {
  if (config.exponentialBackoff) {
    const delay = config.retryDelayBaseMs * Math.pow(2, attempt)
    return Math.min(delay, config.retryDelayMaxMs)
  }
  return config.retryDelayBaseMs
}

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Create a timeout promise
 */
function createTimeoutPromise<T>(ms: number, message: string): Promise<T> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(message)), ms)
  })
}

/**
 * Execute a vision call with timeout, retry, and error handling
 */
export async function executeWithRuntime<T>(
  visionCall: () => Promise<T>,
  config: Partial<RuntimeConfig> = {}
): Promise<VisionCallResult<T>> {
  const finalConfig: RuntimeConfig = { ...DEFAULT_RUNTIME_CONFIG, ...config }
  
  const startTime = Date.now()
  const metadata: RuntimeMetadata = {
    totalAttempts: 0,
    successfulAttempt: null,
    totalTimeMs: 0,
    retryDelaysMs: [],
    errorsEncountered: [],
    finalError: null,
    timedOut: false,
    wasRetried: false,
  }

  let lastError: VisionRuntimeError | null = null

  for (let attempt = 0; attempt <= finalConfig.maxRetries; attempt++) {
    const elapsedMs = Date.now() - startTime
    
    // Check total timeout
    if (elapsedMs >= finalConfig.totalTimeoutMs) {
      metadata.timedOut = true
      metadata.finalError = {
        type: 'timeout',
        message: 'Total operation timeout exceeded',
        retryable: false,
        attempt,
        totalAttempts: attempt,
      }
      break
    }

    metadata.totalAttempts = attempt + 1
    
    if (attempt > 0) {
      metadata.wasRetried = true
    }

    try {
      // Calculate remaining time for this attempt
      const remainingTimeMs = finalConfig.totalTimeoutMs - elapsedMs
      const callTimeoutMs = Math.min(finalConfig.singleCallTimeoutMs, remainingTimeMs)

      // Execute with timeout
      const result = await Promise.race([
        visionCall(),
        createTimeoutPromise<T>(callTimeoutMs, `Vision call timed out after ${callTimeoutMs}ms`),
      ])

      // Success!
      metadata.successfulAttempt = attempt + 1
      metadata.totalTimeMs = Date.now() - startTime

      return {
        success: true,
        result,
        metadata,
      }
    } catch (error) {
      const runtimeError = classifyError(error)
      runtimeError.attempt = attempt + 1
      runtimeError.totalAttempts = finalConfig.maxRetries + 1
      
      metadata.errorsEncountered.push(runtimeError)
      lastError = runtimeError

      // Check if we should retry
      const shouldRetry = 
        runtimeError.retryable && 
        attempt < finalConfig.maxRetries &&
        (Date.now() - startTime) < finalConfig.totalTimeoutMs

      if (!shouldRetry) {
        metadata.finalError = runtimeError
        break
      }

      // Calculate and apply retry delay
      const retryDelay = runtimeError.retryAfterMs || calculateRetryDelay(attempt, finalConfig)
      metadata.retryDelaysMs.push(retryDelay)
      
      // Make sure we don't exceed total timeout
      const maxWait = Math.min(retryDelay, finalConfig.totalTimeoutMs - (Date.now() - startTime))
      if (maxWait > 0) {
        await sleep(maxWait)
      }
    }
  }

  metadata.totalTimeMs = Date.now() - startTime
  
  return {
    success: false,
    error: metadata.finalError || lastError || {
      type: 'unknown',
      message: 'Vision call failed',
      retryable: false,
    },
    metadata,
  }
}

/**
 * Validate vision model output for completeness and sanity
 */
export interface VisionOutputValidation {
  valid: boolean
  issues: string[]
  sanitizedOutput?: unknown
  severity: 'none' | 'minor' | 'major' | 'critical'
}

export function validateVisionOutput(output: unknown): VisionOutputValidation {
  const issues: string[] = []

  if (!output || typeof output !== 'object') {
    return {
      valid: false,
      issues: ['Output is null or not an object'],
      severity: 'critical',
    }
  }

  const obj = output as Record<string, unknown>

  // Check for required fields
  if (!obj.measurements || typeof obj.measurements !== 'object') {
    issues.push('Missing or invalid measurements object')
  }

  if (!obj.landmarks || typeof obj.landmarks !== 'object') {
    issues.push('Missing or invalid landmarks object')
  }

  if (typeof obj.gross_score !== 'number') {
    issues.push('Missing or invalid gross_score')
  }

  if (typeof obj.confidence_percent !== 'number') {
    issues.push('Missing or invalid confidence_percent')
  }

  // Check for nonsensical values
  if (typeof obj.gross_score === 'number') {
    if (obj.gross_score < 50 || obj.gross_score > 350) {
      issues.push(`Gross score out of reasonable range: ${obj.gross_score}`)
    }
    if (isNaN(obj.gross_score) || !isFinite(obj.gross_score)) {
      issues.push('Gross score is NaN or Infinity')
    }
  }

  if (typeof obj.confidence_percent === 'number') {
    if (obj.confidence_percent < 0 || obj.confidence_percent > 100) {
      issues.push(`Confidence out of range: ${obj.confidence_percent}`)
    }
    if (isNaN(obj.confidence_percent) || !isFinite(obj.confidence_percent)) {
      issues.push('Confidence is NaN or Infinity')
    }
  }

  // Check measurements for nonsense
  if (obj.measurements && typeof obj.measurements === 'object') {
    const measurements = obj.measurements as Record<string, unknown>
    
    // Check key measurements
    const measurementChecks: [string, number, number][] = [
      ['inside_spread', 8, 40],
      ['main_beam_left', 10, 40],
      ['main_beam_right', 10, 40],
      ['g1_left', 0, 15],
      ['g1_right', 0, 15],
      ['g2_left', 0, 20],
      ['g2_right', 0, 20],
    ]

    for (const [field, min, max] of measurementChecks) {
      const value = measurements[field]
      if (typeof value === 'number') {
        if (value < min || value > max) {
          issues.push(`${field} out of range: ${value} (expected ${min}-${max})`)
        }
        if (isNaN(value) || !isFinite(value)) {
          issues.push(`${field} is NaN or Infinity`)
        }
      }
    }

    // Check for extreme asymmetry (potential error)
    const leftBeam = measurements.main_beam_left
    const rightBeam = measurements.main_beam_right
    if (typeof leftBeam === 'number' && typeof rightBeam === 'number') {
      const beamDiff = Math.abs(leftBeam - rightBeam)
      if (beamDiff > 8) {
        issues.push(`Extreme beam asymmetry: ${beamDiff.toFixed(1)}" difference`)
      }
    }
  }

  // Determine severity
  let severity: VisionOutputValidation['severity'] = 'none'
  if (issues.length > 0) {
    const hasCritical = issues.some(i => 
      i.includes('Missing') || i.includes('NaN') || i.includes('Infinity')
    )
    const hasMajor = issues.some(i => 
      i.includes('out of range') && !i.includes('asymmetry')
    )
    
    if (hasCritical) severity = 'critical'
    else if (hasMajor) severity = 'major'
    else severity = 'minor'
  }

  return {
    valid: severity !== 'critical',
    issues,
    severity,
    sanitizedOutput: severity !== 'critical' ? output : undefined,
  }
}

/**
 * Create a user-safe error message from a runtime error
 */
export function getUserSafeErrorMessage(error: VisionRuntimeError): string {
  switch (error.type) {
    case 'timeout':
      return 'The image analysis is taking longer than expected. Please try again.'
    case 'rate_limit':
      return 'The system is currently busy. Please wait a moment and try again.'
    case 'provider_error':
      return 'The image analysis service is temporarily unavailable. Please try again shortly.'
    case 'network_error':
      return 'A network error occurred. Please check your connection and try again.'
    case 'malformed_response':
    case 'incomplete_response':
      return 'The image analysis returned an unexpected result. Please try again.'
    case 'validation_error':
      return 'The image could not be analyzed properly. Please try different images.'
    case 'quota_exceeded':
      return 'The service has reached its usage limit. Please try again later.'
    case 'model_unavailable':
      return 'The image analysis service is currently unavailable. Please try again later.'
    case 'content_policy':
      return 'The images could not be processed. Please ensure images meet content guidelines.'
    default:
      return 'An unexpected error occurred during image analysis. Please try again.'
  }
}

/**
 * Create an admin/debug error message with full details
 */
export function getAdminErrorMessage(error: VisionRuntimeError, metadata?: RuntimeMetadata): string {
  const parts: string[] = [
    `Type: ${error.type}`,
    `Message: ${error.message}`,
    `Retryable: ${error.retryable}`,
  ]

  if (error.attempt !== undefined) {
    parts.push(`Attempt: ${error.attempt}/${error.totalAttempts}`)
  }

  if (error.retryAfterMs !== undefined) {
    parts.push(`Retry after: ${error.retryAfterMs}ms`)
  }

  if (metadata) {
    parts.push(`Total attempts: ${metadata.totalAttempts}`)
    parts.push(`Total time: ${metadata.totalTimeMs}ms`)
    if (metadata.wasRetried) {
      parts.push(`Retry delays: ${metadata.retryDelaysMs.join(', ')}ms`)
    }
    if (metadata.timedOut) {
      parts.push('TIMED OUT')
    }
  }

  if (error.originalError instanceof Error) {
    parts.push(`Original: ${error.originalError.message}`)
  }

  return parts.join(' | ')
}
