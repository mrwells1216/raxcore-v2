/**
 * Phase 25: Calibrated Confidence Module
 * 
 * Calibrates raw confidence scores using real validation outcomes.
 * Maps internal confidence to a calibrated value that correlates with actual accuracy.
 */

import { createClient } from '@/lib/supabase/server'
import type { 
  SourceType, 
  CaptureDevice,
  FallbackReason 
} from '@/lib/types'

// ============================================================================
// TYPES
// ============================================================================

export type ConfidenceTier = 'very_high' | 'high' | 'medium' | 'low' | 'very_low'

export interface CalibrationBucket {
  rawConfidenceMin: number
  rawConfidenceMax: number
  sampleCount: number
  observedMae: number
  observedMedianError: number
  within5InchesPercent: number
  within10InchesPercent: number
  calibratedConfidence: number
  calibratedTier: ConfidenceTier
}

export interface ScenarioCalibration {
  scenario: string
  buckets: CalibrationBucket[]
  sampleCount: number
  overallMae: number
  confidenceMultiplier: number // Applied to raw confidence
}

export interface CalibratedConfidenceResult {
  rawConfidence: number
  calibratedConfidence: number
  tier: ConfidenceTier
  tierLabel: string
  expectedErrorBand: {
    low: number
    high: number
    expectedMae: number
  }
  calibrationSource: 'historical_data' | 'scenario_specific' | 'default_mapping'
  scenarioUsed: string | null
  sampleCount: number
  explanation: string[]
}

export interface ConfidenceCalibrationMetadata {
  rawConfidence: number
  calibratedConfidence: number
  tier: ConfidenceTier
  expectedMae: number
  expectedErrorBandLow: number
  expectedErrorBandHigh: number
  calibrationSource: string
  scenarioUsed: string | null
}

// ============================================================================
// CONFIDENCE TIER DEFINITIONS
// ============================================================================

const CONFIDENCE_TIERS: Record<ConfidenceTier, { min: number; max: number; label: string; description: string }> = {
  very_high: { 
    min: 85, 
    max: 100, 
    label: 'Very High',
    description: 'Exceptional conditions with multiple clear angles and validated accuracy'
  },
  high: { 
    min: 70, 
    max: 84, 
    label: 'High',
    description: 'Strong conditions with good landmark visibility and consistent measurements'
  },
  medium: { 
    min: 50, 
    max: 69, 
    label: 'Medium',
    description: 'Typical conditions with some limitations in image quality or angles'
  },
  low: { 
    min: 30, 
    max: 49, 
    label: 'Low',
    description: 'Challenging conditions with limited landmarks or image quality'
  },
  very_low: { 
    min: 0, 
    max: 29, 
    label: 'Very Low',
    description: 'Difficult conditions requiring significant estimation'
  },
}

// ============================================================================
// DEFAULT CALIBRATION MAPPING
// ============================================================================

// Default calibration based on typical observed patterns
// This is used when insufficient validation data exists
const DEFAULT_CALIBRATION_MAP: { raw: [number, number]; calibrated: number; expectedMae: number }[] = [
  { raw: [90, 100], calibrated: 88, expectedMae: 4.5 },
  { raw: [80, 89], calibrated: 78, expectedMae: 6.0 },
  { raw: [70, 79], calibrated: 68, expectedMae: 8.0 },
  { raw: [60, 69], calibrated: 55, expectedMae: 10.0 },
  { raw: [50, 59], calibrated: 45, expectedMae: 12.5 },
  { raw: [40, 49], calibrated: 35, expectedMae: 15.0 },
  { raw: [30, 39], calibrated: 25, expectedMae: 18.0 },
  { raw: [20, 29], calibrated: 18, expectedMae: 22.0 },
  { raw: [0, 19], calibrated: 12, expectedMae: 28.0 },
]

// Scenario-specific confidence adjustments
const SCENARIO_ADJUSTMENTS: Record<string, number> = {
  // Source type adjustments
  'source:mounted_photo': 1.08,
  'source:european_mount': 1.05,
  'source:harvest_photo': 1.0,
  'source:live_deer': 0.92,
  'source:trail_cam': 0.85,
  
  // Image count adjustments
  'images:single': 0.88,
  'images:two': 0.95,
  'images:multi': 1.05,
  
  // Fallback adjustments
  'fallback:none': 1.0,
  'fallback:used': 0.75,
  
  // Angle diversity adjustments
  'angles:poor': 0.85,
  'angles:fair': 0.95,
  'angles:good': 1.02,
  'angles:excellent': 1.08,
}

// ============================================================================
// CALIBRATION CACHE
// ============================================================================

interface CalibrationCache {
  buckets: CalibrationBucket[]
  scenarioCalibrations: Map<string, ScenarioCalibration>
  lastUpdated: number
  isValid: boolean
}

let calibrationCache: CalibrationCache = {
  buckets: [],
  scenarioCalibrations: new Map(),
  lastUpdated: 0,
  isValid: false,
}

const CACHE_TTL_MS = 30 * 60 * 1000 // 30 minutes

// ============================================================================
// CORE CALIBRATION FUNCTIONS
// ============================================================================

/**
 * Load calibration data from validation history
 */
async function loadCalibrationData(): Promise<void> {
  const now = Date.now()
  
  // Check cache validity
  if (calibrationCache.isValid && (now - calibrationCache.lastUpdated) < CACHE_TTL_MS) {
    return
  }

  try {
    const supabase = await createClient()

    // Get validation results with confidence data
    const { data: results } = await supabase
      .from('validation_results')
      .select(`
        confidence_percent,
        abs_error_gross,
        percent_error_gross,
        state,
        rack_type,
        scoring_method
      `)
      .not('confidence_percent', 'is', null)
      .not('abs_error_gross', 'is', null)
      .order('created_at', { ascending: false })
      .limit(2000)

    if (!results || results.length < 50) {
      // Insufficient data - use defaults
      calibrationCache = {
        buckets: generateDefaultBuckets(),
        scenarioCalibrations: new Map(),
        lastUpdated: now,
        isValid: true,
      }
      return
    }

    // Build calibration buckets from data
    const buckets = buildCalibrationBuckets(results)
    
    // Build scenario-specific calibrations
    const scenarioCalibrations = buildScenarioCalibrations(results)

    calibrationCache = {
      buckets,
      scenarioCalibrations,
      lastUpdated: now,
      isValid: true,
    }
  } catch (error) {
    console.error('Error loading calibration data:', error)
    // Fall back to defaults
    calibrationCache = {
      buckets: generateDefaultBuckets(),
      scenarioCalibrations: new Map(),
      lastUpdated: now,
      isValid: true,
    }
  }
}

/**
 * Generate default calibration buckets when insufficient data exists
 */
function generateDefaultBuckets(): CalibrationBucket[] {
  return DEFAULT_CALIBRATION_MAP.map(entry => ({
    rawConfidenceMin: entry.raw[0],
    rawConfidenceMax: entry.raw[1],
    sampleCount: 0,
    observedMae: entry.expectedMae,
    observedMedianError: entry.expectedMae * 0.85,
    within5InchesPercent: estimateWithinThreshold(entry.expectedMae, 5),
    within10InchesPercent: estimateWithinThreshold(entry.expectedMae, 10),
    calibratedConfidence: entry.calibrated,
    calibratedTier: getTierFromConfidence(entry.calibrated),
  }))
}

/**
 * Build calibration buckets from validation data
 */
function buildCalibrationBuckets(results: {
  confidence_percent: number | null
  abs_error_gross: number | null
}[]): CalibrationBucket[] {
  const bucketRanges = [
    [90, 100], [80, 89], [70, 79], [60, 69], [50, 59],
    [40, 49], [30, 39], [20, 29], [0, 19]
  ]

  return bucketRanges.map(([min, max]) => {
    const bucketResults = results.filter(r => 
      r.confidence_percent !== null &&
      r.confidence_percent >= min &&
      r.confidence_percent <= max &&
      r.abs_error_gross !== null
    )

    if (bucketResults.length < 10) {
      // Insufficient data for this bucket - use default
      const defaultEntry = DEFAULT_CALIBRATION_MAP.find(e => e.raw[0] === min)
      return {
        rawConfidenceMin: min,
        rawConfidenceMax: max,
        sampleCount: bucketResults.length,
        observedMae: defaultEntry?.expectedMae || 15,
        observedMedianError: (defaultEntry?.expectedMae || 15) * 0.85,
        within5InchesPercent: estimateWithinThreshold(defaultEntry?.expectedMae || 15, 5),
        within10InchesPercent: estimateWithinThreshold(defaultEntry?.expectedMae || 15, 10),
        calibratedConfidence: defaultEntry?.calibrated || 50,
        calibratedTier: getTierFromConfidence(defaultEntry?.calibrated || 50),
      }
    }

    const errors = bucketResults.map(r => r.abs_error_gross!)
    const mae = errors.reduce((a, b) => a + b, 0) / errors.length
    const sortedErrors = [...errors].sort((a, b) => a - b)
    const medianError = sortedErrors[Math.floor(sortedErrors.length / 2)]
    const within5 = (errors.filter(e => e <= 5).length / errors.length) * 100
    const within10 = (errors.filter(e => e <= 10).length / errors.length) * 100

    // Calibrate confidence based on observed accuracy
    // Higher accuracy = higher calibrated confidence
    const calibratedConfidence = calculateCalibratedConfidence(mae, within10)

    return {
      rawConfidenceMin: min,
      rawConfidenceMax: max,
      sampleCount: bucketResults.length,
      observedMae: mae,
      observedMedianError: medianError,
      within5InchesPercent: within5,
      within10InchesPercent: within10,
      calibratedConfidence,
      calibratedTier: getTierFromConfidence(calibratedConfidence),
    }
  })
}

/**
 * Build scenario-specific calibrations
 */
function buildScenarioCalibrations(results: {
  confidence_percent: number | null
  abs_error_gross: number | null
  scoring_method: string | null
}[]): Map<string, ScenarioCalibration> {
  const scenarios = new Map<string, ScenarioCalibration>()

  // Scoring method scenarios
  const visionResults = results.filter(r => r.scoring_method === 'vision')
  const fallbackResults = results.filter(r => r.scoring_method !== 'vision' && r.scoring_method !== null)

  if (visionResults.length >= 30) {
    const visionBuckets = buildCalibrationBuckets(visionResults)
    const visionMae = visionResults
      .filter(r => r.abs_error_gross !== null)
      .reduce((sum, r) => sum + r.abs_error_gross!, 0) / visionResults.length

    scenarios.set('vision', {
      scenario: 'vision',
      buckets: visionBuckets,
      sampleCount: visionResults.length,
      overallMae: visionMae,
      confidenceMultiplier: 1.0,
    })
  }

  if (fallbackResults.length >= 20) {
    const fallbackBuckets = buildCalibrationBuckets(fallbackResults)
    const fallbackMae = fallbackResults
      .filter(r => r.abs_error_gross !== null)
      .reduce((sum, r) => sum + r.abs_error_gross!, 0) / fallbackResults.length

    scenarios.set('fallback', {
      scenario: 'fallback',
      buckets: fallbackBuckets,
      sampleCount: fallbackResults.length,
      overallMae: fallbackMae,
      confidenceMultiplier: 0.85,
    })
  }

  return scenarios
}

/**
 * Calculate calibrated confidence from observed MAE and within-10-inches rate
 */
function calculateCalibratedConfidence(mae: number, within10Percent: number): number {
  // Primary factor: within 10 inches rate (higher is better)
  // Secondary factor: MAE (lower is better)
  
  // Within 10" contribution (0-60 points)
  const within10Score = within10Percent * 0.6
  
  // MAE contribution (0-40 points, inversely related)
  // MAE of 5" or less = 40 points, MAE of 25"+ = 0 points
  const maeScore = Math.max(0, Math.min(40, 40 - (mae - 5) * 2))
  
  return Math.max(10, Math.min(95, within10Score + maeScore))
}

/**
 * Estimate percentage within threshold based on MAE
 * Using rough approximation assuming normal-ish distribution
 */
function estimateWithinThreshold(mae: number, threshold: number): number {
  // Rough approximation: if MAE is threshold, about 50% are within
  const ratio = threshold / mae
  if (ratio >= 2) return 95
  if (ratio >= 1.5) return 85
  if (ratio >= 1) return 65
  if (ratio >= 0.7) return 45
  if (ratio >= 0.5) return 30
  return 15
}

/**
 * Get confidence tier from confidence value
 */
function getTierFromConfidence(confidence: number): ConfidenceTier {
  for (const [tier, config] of Object.entries(CONFIDENCE_TIERS)) {
    if (confidence >= config.min && confidence <= config.max) {
      return tier as ConfidenceTier
    }
  }
  return 'medium'
}

// ============================================================================
// PUBLIC API
// ============================================================================

export interface CalibrationInput {
  rawConfidence: number
  scoringMethod: 'vision' | 'heuristic' | 'vision_with_fallback'
  sourceType?: SourceType | string | null
  imageCount: number
  angleDiversity: number
  usedFallback: boolean
  fallbackReason?: FallbackReason | null
}

/**
 * Calibrate confidence using validation data
 */
export async function calibrateConfidence(input: CalibrationInput): Promise<CalibratedConfidenceResult> {
  await loadCalibrationData()

  const explanations: string[] = []
  let calibrationSource: CalibratedConfidenceResult['calibrationSource'] = 'default_mapping'
  let scenarioUsed: string | null = null
  let sampleCount = 0

  // Start with raw confidence
  let adjustedConfidence = input.rawConfidence

  // Apply scenario adjustments
  const scenarioMultiplier = calculateScenarioMultiplier(input)
  adjustedConfidence = adjustedConfidence * scenarioMultiplier

  // Find appropriate calibration bucket
  let bucket: CalibrationBucket | undefined

  // Try scenario-specific calibration first
  if (input.usedFallback && calibrationCache.scenarioCalibrations.has('fallback')) {
    const fallbackCal = calibrationCache.scenarioCalibrations.get('fallback')!
    bucket = fallbackCal.buckets.find(b => 
      adjustedConfidence >= b.rawConfidenceMin && adjustedConfidence <= b.rawConfidenceMax
    )
    if (bucket) {
      calibrationSource = 'scenario_specific'
      scenarioUsed = 'fallback'
      sampleCount = fallbackCal.sampleCount
      explanations.push('Calibrated using fallback scenario data.')
    }
  } else if (input.scoringMethod === 'vision' && calibrationCache.scenarioCalibrations.has('vision')) {
    const visionCal = calibrationCache.scenarioCalibrations.get('vision')!
    bucket = visionCal.buckets.find(b => 
      adjustedConfidence >= b.rawConfidenceMin && adjustedConfidence <= b.rawConfidenceMax
    )
    if (bucket) {
      calibrationSource = 'scenario_specific'
      scenarioUsed = 'vision'
      sampleCount = visionCal.sampleCount
      explanations.push('Calibrated using vision scoring data.')
    }
  }

  // Fall back to general calibration
  if (!bucket) {
    bucket = calibrationCache.buckets.find(b =>
      adjustedConfidence >= b.rawConfidenceMin && adjustedConfidence <= b.rawConfidenceMax
    )
    if (bucket && bucket.sampleCount > 0) {
      calibrationSource = 'historical_data'
      sampleCount = bucket.sampleCount
      explanations.push('Calibrated using historical validation data.')
    }
  }

  // Fall back to default mapping if still no bucket
  if (!bucket) {
    const defaultEntry = DEFAULT_CALIBRATION_MAP.find(e =>
      adjustedConfidence >= e.raw[0] && adjustedConfidence <= e.raw[1]
    )
    bucket = {
      rawConfidenceMin: defaultEntry?.raw[0] || 0,
      rawConfidenceMax: defaultEntry?.raw[1] || 100,
      sampleCount: 0,
      observedMae: defaultEntry?.expectedMae || 15,
      observedMedianError: (defaultEntry?.expectedMae || 15) * 0.85,
      within5InchesPercent: estimateWithinThreshold(defaultEntry?.expectedMae || 15, 5),
      within10InchesPercent: estimateWithinThreshold(defaultEntry?.expectedMae || 15, 10),
      calibratedConfidence: defaultEntry?.calibrated || 50,
      calibratedTier: getTierFromConfidence(defaultEntry?.calibrated || 50),
    }
    calibrationSource = 'default_mapping'
    explanations.push('Calibrated using default mapping (limited validation data).')
  }

  // Interpolate calibrated confidence within bucket
  const bucketRange = bucket.rawConfidenceMax - bucket.rawConfidenceMin
  const positionInBucket = bucketRange > 0 
    ? (adjustedConfidence - bucket.rawConfidenceMin) / bucketRange 
    : 0.5
  
  // Slight adjustment based on position in bucket (higher raw = slightly higher calibrated)
  const calibratedConfidence = Math.round(
    bucket.calibratedConfidence + (positionInBucket - 0.5) * 5
  )

  // Determine tier
  const tier = getTierFromConfidence(calibratedConfidence)
  const tierConfig = CONFIDENCE_TIERS[tier]

  // Calculate expected error band
  const expectedMae = bucket.observedMae
  const errorBandMultiplier = getErrorBandMultiplier(tier)
  const expectedErrorBand = {
    low: expectedMae * 0.5,
    high: expectedMae * errorBandMultiplier,
    expectedMae,
  }

  // Add tier explanation
  explanations.push(`${tierConfig.label} confidence: ${tierConfig.description}`)

  // Add scenario-specific notes
  if (input.usedFallback) {
    explanations.push('Confidence adjusted for fallback scoring path.')
  }
  if (input.imageCount === 1) {
    explanations.push('Single image limits measurement cross-validation.')
  }
  if (input.angleDiversity < 0.4) {
    explanations.push('Limited angle coverage reduces structural confidence.')
  }

  return {
    rawConfidence: input.rawConfidence,
    calibratedConfidence: Math.max(5, Math.min(95, calibratedConfidence)),
    tier,
    tierLabel: tierConfig.label,
    expectedErrorBand,
    calibrationSource,
    scenarioUsed,
    sampleCount,
    explanation: explanations,
  }
}

/**
 * Calculate scenario multiplier based on input characteristics
 */
function calculateScenarioMultiplier(input: CalibrationInput): number {
  let multiplier = 1.0

  // Source type adjustment
  if (input.sourceType) {
    const sourceKey = `source:${input.sourceType}`
    if (sourceKey in SCENARIO_ADJUSTMENTS) {
      multiplier *= SCENARIO_ADJUSTMENTS[sourceKey]
    }
  }

  // Image count adjustment
  if (input.imageCount === 1) {
    multiplier *= SCENARIO_ADJUSTMENTS['images:single']
  } else if (input.imageCount === 2) {
    multiplier *= SCENARIO_ADJUSTMENTS['images:two']
  } else if (input.imageCount >= 3) {
    multiplier *= SCENARIO_ADJUSTMENTS['images:multi']
  }

  // Angle diversity adjustment
  if (input.angleDiversity < 0.3) {
    multiplier *= SCENARIO_ADJUSTMENTS['angles:poor']
  } else if (input.angleDiversity < 0.5) {
    multiplier *= SCENARIO_ADJUSTMENTS['angles:fair']
  } else if (input.angleDiversity < 0.75) {
    multiplier *= SCENARIO_ADJUSTMENTS['angles:good']
  } else {
    multiplier *= SCENARIO_ADJUSTMENTS['angles:excellent']
  }

  // Fallback adjustment
  if (input.usedFallback) {
    multiplier *= SCENARIO_ADJUSTMENTS['fallback:used']
  }

  return multiplier
}

/**
 * Get error band multiplier based on tier
 */
function getErrorBandMultiplier(tier: ConfidenceTier): number {
  switch (tier) {
    case 'very_high': return 1.5
    case 'high': return 1.8
    case 'medium': return 2.2
    case 'low': return 2.8
    case 'very_low': return 3.5
  }
}

/**
 * Get calibration metadata for storage
 */
export function getCalibrationMetadata(result: CalibratedConfidenceResult): ConfidenceCalibrationMetadata {
  return {
    rawConfidence: result.rawConfidence,
    calibratedConfidence: result.calibratedConfidence,
    tier: result.tier,
    expectedMae: result.expectedErrorBand.expectedMae,
    expectedErrorBandLow: result.expectedErrorBand.low,
    expectedErrorBandHigh: result.expectedErrorBand.high,
    calibrationSource: result.calibrationSource,
    scenarioUsed: result.scenarioUsed,
  }
}

/**
 * Get confidence tier information
 */
export function getConfidenceTierInfo(tier: ConfidenceTier) {
  return CONFIDENCE_TIERS[tier]
}

/**
 * Get all confidence tiers for UI display
 */
export function getAllConfidenceTiers() {
  return Object.entries(CONFIDENCE_TIERS).map(([tier, config]) => ({
    tier: tier as ConfidenceTier,
    ...config,
  }))
}
