/**
 * Phase 51: Topology Extractor
 * Extracts rack topology interpretation from landmarks and measurements
 */

import type { AngleType, Measurements, LandmarksDetected } from '@/lib/types'
import type { AllLandmarkId, LandmarkPoint45 } from '@/lib/vision/landmarks/types'
import type {
  TopologyInterpretation,
  BeamPathPoint,
  TineSequenceItem,
  SpreadAnchorInterpretation,
  MassProgressionItem,
  AsymmetryInterpretation,
  AsymmetryCause,
} from './types'
import { ANATOMICAL_BOUNDS } from './config'

// ============================================================================
// MAIN EXTRACTION FUNCTION
// ============================================================================

export interface TopologyExtractionInput {
  measurements: Measurements
  perImageLandmarks: {
    imageIndex: number
    angleType: AngleType
    landmarks: LandmarksDetected
    landmarkConfidence: number
    referenceQuality: number
    phase45Landmarks?: Partial<Record<AllLandmarkId, LandmarkPoint45>>
  }[]
  crossViewData?: {
    dominantViewPerFamily: Record<string, number>
  } | null
}

export function extractTopologyInterpretation(
  input: TopologyExtractionInput
): TopologyInterpretation {
  const { measurements, perImageLandmarks, crossViewData } = input

  // Extract beam paths
  const { beamPathLeft, beamPathRight, beamContinuityScore } = extractBeamPaths(perImageLandmarks)

  // Extract tine sequences
  const { 
    tineSequenceLeft, 
    tineSequenceRight, 
    tineOrderingConfidence,
    missingTinesLeft,
    missingTinesRight,
  } = extractTineSequences(measurements, perImageLandmarks)

  // Extract spread anchor interpretation
  const spreadAnchor = extractSpreadAnchor(measurements, perImageLandmarks, crossViewData)

  // Extract mass progression
  const { massProgressionLeft, massProgressionRight } = extractMassProgression(measurements)

  // Extract asymmetry interpretation
  const asymmetry = extractAsymmetryInterpretation(measurements, perImageLandmarks)

  return {
    beamPathLeft,
    beamPathRight,
    beamContinuityScore,
    tineSequenceLeft,
    tineSequenceRight,
    tineOrderingConfidence,
    missingTinesLeft,
    missingTinesRight,
    spreadAnchor,
    massProgressionLeft,
    massProgressionRight,
    asymmetry,
  }
}

// ============================================================================
// BEAM PATH EXTRACTION
// ============================================================================

function extractBeamPaths(
  perImageLandmarks: TopologyExtractionInput['perImageLandmarks']
): {
  beamPathLeft: BeamPathPoint[]
  beamPathRight: BeamPathPoint[]
  beamContinuityScore: number
} {
  const beamPathLeft: BeamPathPoint[] = []
  const beamPathRight: BeamPathPoint[] = []

  // Look for beam-related landmarks across all images
  for (const img of perImageLandmarks) {
    const p45 = img.phase45Landmarks
    if (!p45) continue

    // Left beam path points
    const leftBurr = p45['left_burr_or_antler_base']
    const leftTip = p45['left_main_beam_tip']
    
    if (leftBurr?.visible) {
      beamPathLeft.push({
        landmarkId: 'left_burr_or_antler_base',
        position: { x: leftBurr.x, y: leftBurr.y },
        confidence: leftBurr.confidence,
        sourceImageIndex: img.imageIndex,
      })
    }
    if (leftTip?.visible) {
      beamPathLeft.push({
        landmarkId: 'left_main_beam_tip',
        position: { x: leftTip.x, y: leftTip.y },
        confidence: leftTip.confidence,
        sourceImageIndex: img.imageIndex,
      })
    }

    // Right beam path points
    const rightBurr = p45['right_burr_or_antler_base']
    const rightTip = p45['right_main_beam_tip']
    
    if (rightBurr?.visible) {
      beamPathRight.push({
        landmarkId: 'right_burr_or_antler_base',
        position: { x: rightBurr.x, y: rightBurr.y },
        confidence: rightBurr.confidence,
        sourceImageIndex: img.imageIndex,
      })
    }
    if (rightTip?.visible) {
      beamPathRight.push({
        landmarkId: 'right_main_beam_tip',
        position: { x: rightTip.x, y: rightTip.y },
        confidence: rightTip.confidence,
        sourceImageIndex: img.imageIndex,
      })
    }
  }

  // Calculate continuity score based on landmark availability and confidence
  const leftHasBurr = beamPathLeft.some(p => p.landmarkId === 'left_burr_or_antler_base')
  const leftHasTip = beamPathLeft.some(p => p.landmarkId === 'left_main_beam_tip')
  const rightHasBurr = beamPathRight.some(p => p.landmarkId === 'right_burr_or_antler_base')
  const rightHasTip = beamPathRight.some(p => p.landmarkId === 'right_main_beam_tip')

  let continuityScore = 0
  if (leftHasBurr && leftHasTip) continuityScore += 0.25
  if (rightHasBurr && rightHasTip) continuityScore += 0.25
  
  // Add confidence-weighted bonus
  const avgConfidence = [...beamPathLeft, ...beamPathRight]
    .map(p => p.confidence)
    .reduce((sum, c) => sum + c, 0) / Math.max(1, beamPathLeft.length + beamPathRight.length)
  
  continuityScore += avgConfidence * 0.5

  return {
    beamPathLeft,
    beamPathRight,
    beamContinuityScore: Math.min(1, continuityScore),
  }
}

// ============================================================================
// TINE SEQUENCE EXTRACTION
// ============================================================================

function extractTineSequences(
  measurements: Measurements,
  perImageLandmarks: TopologyExtractionInput['perImageLandmarks']
): {
  tineSequenceLeft: TineSequenceItem[]
  tineSequenceRight: TineSequenceItem[]
  tineOrderingConfidence: number
  missingTinesLeft: string[]
  missingTinesRight: string[]
} {
  const tineIds = ['g1', 'g2', 'g3', 'g4', 'g5'] as const
  const tineSequenceLeft: TineSequenceItem[] = []
  const tineSequenceRight: TineSequenceItem[] = []
  const missingTinesLeft: string[] = []
  const missingTinesRight: string[] = []

  // Expected positions along beam (0 = base, 1 = tip)
  const expectedPositions: Record<string, number> = {
    g1: 0.15, // Brow tine, closest to base
    g2: 0.35, // G2 bay tine
    g3: 0.55, // G3
    g4: 0.75, // G4
    g5: 0.90, // G5, near tip
  }

  for (const tineId of tineIds) {
    const leftKey = `${tineId}_left` as keyof Measurements
    const rightKey = `${tineId}_right` as keyof Measurements
    
    const leftValue = measurements[leftKey]
    const rightValue = measurements[rightKey]

    // Left tine
    const leftItem: TineSequenceItem = {
      tineId,
      basePosition: null,
      tipPosition: null,
      confidence: 0.5,
      isVisible: typeof leftValue === 'number' && leftValue > 0,
      isOccluded: false,
      expectedPosition: expectedPositions[tineId],
      sourceImageIndices: [],
    }

    if (!leftItem.isVisible || leftValue === 0) {
      missingTinesLeft.push(tineId)
      leftItem.isOccluded = true // Assume occluded if missing
    } else {
      // Find landmarks for this tine from images
      for (const img of perImageLandmarks) {
        const p45 = img.phase45Landmarks
        if (!p45) continue
        
        const baseLandmark = p45[`left_${tineId}_base` as AllLandmarkId]
        const tipLandmark = p45[`left_${tineId}_tip` as AllLandmarkId]
        
        if (baseLandmark?.visible) {
          leftItem.basePosition = { x: baseLandmark.x, y: baseLandmark.y }
          leftItem.confidence = Math.max(leftItem.confidence, baseLandmark.confidence)
          leftItem.sourceImageIndices.push(img.imageIndex)
        }
        if (tipLandmark?.visible) {
          leftItem.tipPosition = { x: tipLandmark.x, y: tipLandmark.y }
          leftItem.confidence = Math.max(leftItem.confidence, tipLandmark.confidence)
          if (!leftItem.sourceImageIndices.includes(img.imageIndex)) {
            leftItem.sourceImageIndices.push(img.imageIndex)
          }
        }
      }
    }
    tineSequenceLeft.push(leftItem)

    // Right tine (similar logic)
    const rightItem: TineSequenceItem = {
      tineId,
      basePosition: null,
      tipPosition: null,
      confidence: 0.5,
      isVisible: typeof rightValue === 'number' && rightValue > 0,
      isOccluded: false,
      expectedPosition: expectedPositions[tineId],
      sourceImageIndices: [],
    }

    if (!rightItem.isVisible || rightValue === 0) {
      missingTinesRight.push(tineId)
      rightItem.isOccluded = true
    } else {
      for (const img of perImageLandmarks) {
        const p45 = img.phase45Landmarks
        if (!p45) continue
        
        const baseLandmark = p45[`right_${tineId}_base` as AllLandmarkId]
        const tipLandmark = p45[`right_${tineId}_tip` as AllLandmarkId]
        
        if (baseLandmark?.visible) {
          rightItem.basePosition = { x: baseLandmark.x, y: baseLandmark.y }
          rightItem.confidence = Math.max(rightItem.confidence, baseLandmark.confidence)
          rightItem.sourceImageIndices.push(img.imageIndex)
        }
        if (tipLandmark?.visible) {
          rightItem.tipPosition = { x: tipLandmark.x, y: tipLandmark.y }
          rightItem.confidence = Math.max(rightItem.confidence, tipLandmark.confidence)
          if (!rightItem.sourceImageIndices.includes(img.imageIndex)) {
            rightItem.sourceImageIndices.push(img.imageIndex)
          }
        }
      }
    }
    tineSequenceRight.push(rightItem)
  }

  // Calculate ordering confidence
  const visibleLeft = tineSequenceLeft.filter(t => t.isVisible)
  const visibleRight = tineSequenceRight.filter(t => t.isVisible)
  const avgConfidence = [...visibleLeft, ...visibleRight]
    .map(t => t.confidence)
    .reduce((sum, c) => sum + c, 0) / Math.max(1, visibleLeft.length + visibleRight.length)

  // Check if tine progression matches expected G1 > G2 > G3 pattern
  let progressionScore = 0
  if (visibleLeft.length >= 2) {
    const g1Left = measurements.g1_left
    const g2Left = measurements.g2_left
    if (g1Left !== null && g2Left !== null && g1Left >= g2Left) {
      progressionScore += 0.25
    }
  }
  if (visibleRight.length >= 2) {
    const g1Right = measurements.g1_right
    const g2Right = measurements.g2_right
    if (g1Right !== null && g2Right !== null && g1Right >= g2Right) {
      progressionScore += 0.25
    }
  }

  const tineOrderingConfidence = Math.min(1, avgConfidence * 0.5 + progressionScore)

  return {
    tineSequenceLeft,
    tineSequenceRight,
    tineOrderingConfidence,
    missingTinesLeft,
    missingTinesRight,
  }
}

// ============================================================================
// SPREAD ANCHOR EXTRACTION
// ============================================================================

function extractSpreadAnchor(
  measurements: Measurements,
  perImageLandmarks: TopologyExtractionInput['perImageLandmarks'],
  crossViewData: TopologyExtractionInput['crossViewData']
): SpreadAnchorInterpretation {
  // Find best frontal view for spread anchor
  const frontalViews = perImageLandmarks.filter(
    img => img.angleType === 'front' || img.angleType === 'front_left' || img.angleType === 'front_right'
  )

  const bestFrontal = frontalViews.sort((a, b) => b.referenceQuality - a.referenceQuality)[0]
  
  if (!bestFrontal?.phase45Landmarks) {
    return {
      leftAnchorLandmark: null,
      rightAnchorLandmark: null,
      leftPosition: null,
      rightPosition: null,
      anchorType: 'uncertain',
      confidence: 0.3,
      sourceImageIndex: -1,
    }
  }

  const p45 = bestFrontal.phase45Landmarks
  const leftAnchor = p45['inside_spread_anchor_left']
  const rightAnchor = p45['inside_spread_anchor_right']

  // Determine anchor type based on available landmarks
  let anchorType: SpreadAnchorInterpretation['anchorType'] = 'uncertain'
  
  if (leftAnchor?.visible && rightAnchor?.visible) {
    // Check if anchors are near burr (typical) or beam inner edge
    const leftBurr = p45['left_burr_or_antler_base']
    const rightBurr = p45['right_burr_or_antler_base']
    
    if (leftBurr && rightBurr) {
      const leftNearBurr = Math.abs(leftAnchor.x - leftBurr.x) < 0.05 && Math.abs(leftAnchor.y - leftBurr.y) < 0.05
      const rightNearBurr = Math.abs(rightAnchor.x - rightBurr.x) < 0.05 && Math.abs(rightAnchor.y - rightBurr.y) < 0.05
      
      if (leftNearBurr && rightNearBurr) {
        anchorType = 'burr_to_burr'
      } else {
        anchorType = 'beam_inner'
      }
    } else {
      anchorType = 'inferred'
    }
  }

  const confidence = leftAnchor?.visible && rightAnchor?.visible
    ? (leftAnchor.confidence + rightAnchor.confidence) / 2
    : 0.4

  return {
    leftAnchorLandmark: leftAnchor?.visible ? 'inside_spread_anchor_left' : null,
    rightAnchorLandmark: rightAnchor?.visible ? 'inside_spread_anchor_right' : null,
    leftPosition: leftAnchor?.visible ? { x: leftAnchor.x, y: leftAnchor.y } : null,
    rightPosition: rightAnchor?.visible ? { x: rightAnchor.x, y: rightAnchor.y } : null,
    anchorType,
    confidence,
    sourceImageIndex: bestFrontal.imageIndex,
  }
}

// ============================================================================
// MASS PROGRESSION EXTRACTION
// ============================================================================

function extractMassProgression(measurements: Measurements): {
  massProgressionLeft: MassProgressionItem[]
  massProgressionRight: MassProgressionItem[]
} {
  const circumferences = ['h1', 'h2', 'h3', 'h4'] as const
  const massProgressionLeft: MassProgressionItem[] = []
  const massProgressionRight: MassProgressionItem[] = []

  // Expected: H1 (at burr) is largest, decreasing toward tip
  for (let i = 0; i < circumferences.length; i++) {
    const id = circumferences[i]
    const leftKey = `${id}_left` as keyof Measurements
    const rightKey = `${id}_right` as keyof Measurements
    
    const leftValue = measurements[leftKey] as number | null
    const rightValue = measurements[rightKey] as number | null

    // Check if progression is as expected
    const expectedProgression: MassProgressionItem['expectedProgression'] = 
      i === 0 ? 'stable' : 'decreasing'

    // Calculate plausibility based on expected progression
    let leftPlausibility = 0.5
    let rightPlausibility = 0.5

    if (i > 0) {
      const prevLeftKey = `${circumferences[i - 1]}_left` as keyof Measurements
      const prevRightKey = `${circumferences[i - 1]}_right` as keyof Measurements
      const prevLeft = measurements[prevLeftKey] as number | null
      const prevRight = measurements[prevRightKey] as number | null

      if (prevLeft !== null && leftValue !== null) {
        leftPlausibility = leftValue <= prevLeft ? 0.8 : 0.3
      }
      if (prevRight !== null && rightValue !== null) {
        rightPlausibility = rightValue <= prevRight ? 0.8 : 0.3
      }
    }

    massProgressionLeft.push({
      circumferenceId: id,
      value: leftValue,
      expectedProgression,
      plausibilityScore: leftPlausibility,
    })

    massProgressionRight.push({
      circumferenceId: id,
      value: rightValue,
      expectedProgression,
      plausibilityScore: rightPlausibility,
    })
  }

  return { massProgressionLeft, massProgressionRight }
}

// ============================================================================
// ASYMMETRY INTERPRETATION EXTRACTION
// ============================================================================

function extractAsymmetryInterpretation(
  measurements: Measurements,
  perImageLandmarks: TopologyExtractionInput['perImageLandmarks']
): AsymmetryInterpretation {
  // Calculate per-family asymmetry
  const beamAsym = calculateAsymmetry(
    measurements.main_beam_left,
    measurements.main_beam_right
  )
  
  const tineValues = ['g1', 'g2', 'g3', 'g4', 'g5'] as const
  let totalTineLeft = 0
  let totalTineRight = 0
  let tineCount = 0
  
  for (const t of tineValues) {
    const left = measurements[`${t}_left` as keyof Measurements] as number | null
    const right = measurements[`${t}_right` as keyof Measurements] as number | null
    if (left !== null && right !== null) {
      totalTineLeft += left
      totalTineRight += right
      tineCount++
    }
  }
  const tineAsym = tineCount > 0 ? calculateAsymmetry(totalTineLeft, totalTineRight) : 0

  const massValues = ['h1', 'h2', 'h3', 'h4'] as const
  let totalMassLeft = 0
  let totalMassRight = 0
  let massCount = 0
  
  for (const h of massValues) {
    const left = measurements[`${h}_left` as keyof Measurements] as number | null
    const right = measurements[`${h}_right` as keyof Measurements] as number | null
    if (left !== null && right !== null) {
      totalMassLeft += left
      totalMassRight += right
      massCount++
    }
  }
  const massAsym = massCount > 0 ? calculateAsymmetry(totalMassLeft, totalMassRight) : 0

  // Overall asymmetry
  const overallAsym = (beamAsym + tineAsym + massAsym) / 3

  // Analyze view support for asymmetry
  let viewsSupporting = 0
  let viewsContradicting = 0

  // Check if left/right visibility differs significantly across views
  const leftVisibleViews = perImageLandmarks.filter(
    img => img.angleType === 'left' || img.angleType === 'front_left'
  )
  const rightVisibleViews = perImageLandmarks.filter(
    img => img.angleType === 'right' || img.angleType === 'front_right'
  )

  const visibilityImbalance = Math.abs(leftVisibleViews.length - rightVisibleViews.length)
  
  // Determine likely cause
  let cause: AsymmetryCause = 'unknown'
  let causeConfidence = 0.5

  if (visibilityImbalance >= 2) {
    cause = 'missing_visibility'
    causeConfidence = 0.7
    viewsContradicting = Math.max(leftVisibleViews.length, rightVisibleViews.length)
  } else if (overallAsym > ANATOMICAL_BOUNDS.maxSideAsymmetry) {
    // Very high asymmetry with good visibility - likely real or perspective
    const hasFrontalView = perImageLandmarks.some(img => img.angleType === 'front')
    if (hasFrontalView) {
      cause = 'real_asymmetry'
      causeConfidence = 0.6
      viewsSupporting = perImageLandmarks.length
    } else {
      cause = 'perspective_induced'
      causeConfidence = 0.5
    }
  } else if (overallAsym > 0.05) {
    // Moderate asymmetry
    cause = 'mixed'
    causeConfidence = 0.4
  } else {
    // Low asymmetry
    cause = 'unknown'
    causeConfidence = 0.3
  }

  // Determine if deduction should apply
  const shouldApplyDeduction = cause === 'real_asymmetry' && overallAsym > 0.08
  const suggestedDeductionAdjustment = shouldApplyDeduction 
    ? Math.min(4, overallAsym * 20) // Max 4" deduction adjustment
    : 0

  return {
    overallAsymmetryPercent: overallAsym,
    beamAsymmetryPercent: beamAsym,
    tineAsymmetryPercent: tineAsym,
    massAsymmetryPercent: massAsym,
    cause,
    causeConfidence,
    viewsSupporting,
    viewsContradicting,
    shouldApplyDeduction,
    suggestedDeductionAdjustment,
  }
}

function calculateAsymmetry(left: number | null, right: number | null): number {
  if (left === null || right === null || left === 0 || right === 0) return 0
  const max = Math.max(left, right)
  const min = Math.min(left, right)
  return (max - min) / max
}
