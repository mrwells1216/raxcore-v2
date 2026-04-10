/**
 * Measurement Overlay Mapping
 * 
 * Maps raw landmarks + measurements + provenance into drawable overlay features.
 * Handles partial/missing landmark data gracefully.
 */

import type { LandmarkPoint, DetailedLandmarks } from '@/lib/types'
import type { MeasuredField } from '@/lib/rules-engine/types'
import type { MeasurementDisplayConfidence } from './measurement-display-confidence'
import { getMeasurementDisplayConfidence, getMeasurementConfidenceHex } from './measurement-display-confidence'

export type OverlayFeatureKind = 'point' | 'segment' | 'polyline' | 'label'

export interface OverlayFeature {
  key: string
  label: string
  confidence: MeasurementDisplayConfidence
  color: string
  points: Array<{ x: number; y: number }>
  kind: OverlayFeatureKind
  measurementValue?: number | null
}

interface BuildOverlayFeaturesParams {
  landmarks?: DetailedLandmarks | null
  measurements?: Record<string, any> | null
  provenance?: Record<string, MeasuredField> | null
  imageWidth?: number
  imageHeight?: number
}

/**
 * Build drawable overlay features from available landmark and measurement data.
 * 
 * Degrades gracefully if landmarks are missing or incomplete.
 * Uses measurement provenance to assign confidence colors.
 */
export function buildOverlayFeatures({
  landmarks,
  measurements,
  provenance,
  imageWidth = 1000,
  imageHeight = 1000,
}: BuildOverlayFeaturesParams): OverlayFeature[] {
  const features: OverlayFeature[] = []

  if (!landmarks) {
    return features
  }

  // Helper to scale normalized coordinates to pixel coordinates
  const scale = (point: LandmarkPoint | undefined): { x: number; y: number } | null => {
    if (!point) return null
    return {
      x: point.x * imageWidth,
      y: point.y * imageHeight,
    }
  }

  // Helper to get field confidence from provenance
  const getFieldConfidence = (fieldKey: string): MeasurementDisplayConfidence => {
    const field = provenance?.[fieldKey]
    return getMeasurementDisplayConfidence(field)
  }

  // Helper to get color from confidence
  const getColor = (fieldKey: string): string => {
    const confidence = getFieldConfidence(fieldKey)
    return getMeasurementConfidenceHex(confidence)
  }

  // ============================================================================
  // EYE REFERENCE MARKERS
  // ============================================================================
  if (landmarks.eye_center_left && landmarks.eye_center_right) {
    const eyeLeft = scale(landmarks.eye_center_left)
    const eyeRight = scale(landmarks.eye_center_right)

    if (eyeLeft && eyeRight) {
      // Eye-to-eye reference line
      features.push({
        key: 'eye_reference',
        label: 'Eye Reference',
        confidence: 'high',
        color: '#10b981', // Always high confidence (reference structure)
        points: [eyeLeft, eyeRight],
        kind: 'segment',
      })

      // Eye markers
      features.push({
        key: 'eye_left',
        label: 'L Eye',
        confidence: 'high',
        color: '#10b981',
        points: [eyeLeft],
        kind: 'point',
      })
      features.push({
        key: 'eye_right',
        label: 'R Eye',
        confidence: 'high',
        color: '#10b981',
        points: [eyeRight],
        kind: 'point',
      })
    }
  }

  // ============================================================================
  // MAIN BEAMS
  // ============================================================================
  // Left beam
  if (landmarks.beam_start_left && landmarks.beam_tip_left) {
    const beamStart = scale(landmarks.beam_start_left)
    const beamTip = scale(landmarks.beam_tip_left)

    if (beamStart && beamTip) {
      const confidence = getFieldConfidence('mainBeamLeft')
      features.push({
        key: 'beam_left',
        label: 'L Beam',
        confidence,
        color: getColor('mainBeamLeft'),
        points: [beamStart, beamTip],
        kind: 'segment',
        measurementValue: measurements?.main_beam_left,
      })
    }
  }

  // Right beam
  if (landmarks.beam_start_right && landmarks.beam_tip_right) {
    const beamStart = scale(landmarks.beam_start_right)
    const beamTip = scale(landmarks.beam_tip_right)

    if (beamStart && beamTip) {
      const confidence = getFieldConfidence('mainBeamRight')
      features.push({
        key: 'beam_right',
        label: 'R Beam',
        confidence,
        color: getColor('mainBeamRight'),
        points: [beamStart, beamTip],
        kind: 'segment',
        measurementValue: measurements?.main_beam_right,
      })
    }
  }

  // ============================================================================
  // G-POINTS (TINES)
  // ============================================================================
  const gPointsLeft: Array<{ index: number; base: string; tip: string; label: string }> = [
    { index: 1, base: 'g1_base_left', tip: 'g1_tip_left', label: 'G1-L' },
    { index: 2, base: 'g2_base_left', tip: 'g2_tip_left', label: 'G2-L' },
    { index: 3, base: 'g3_base_left', tip: 'g3_tip_left', label: 'G3-L' },
    { index: 4, base: 'g4_base_left', tip: 'g4_tip_left', label: 'G4-L' },
    { index: 5, base: 'g5_base_left', tip: 'g5_tip_left', label: 'G5-L' },
  ]

  const gPointsRight: Array<{ index: number; base: string; tip: string; label: string }> = [
    { index: 1, base: 'g1_base_right', tip: 'g1_tip_right', label: 'G1-R' },
    { index: 2, base: 'g2_base_right', tip: 'g2_tip_right', label: 'G2-R' },
    { index: 3, base: 'g3_base_right', tip: 'g3_tip_right', label: 'G3-R' },
    { index: 4, base: 'g4_base_right', tip: 'g4_tip_right', label: 'G4-R' },
    { index: 5, base: 'g5_base_right', tip: 'g5_tip_right', label: 'G5-R' },
  ]

  // Map G-points left
  for (const gPoint of gPointsLeft) {
    const base = scale((landmarks as any)[gPoint.base])
    const tip = scale((landmarks as any)[gPoint.tip])

    if (base && tip) {
      const fieldKey = `g${gPoint.index}_left`
      const confidence = getFieldConfidence(fieldKey)
      features.push({
        key: `tine_${gPoint.index}_left`,
        label: gPoint.label,
        confidence,
        color: getColor(fieldKey),
        points: [base, tip],
        kind: 'segment',
        measurementValue: measurements?.[fieldKey],
      })
    }
  }

  // Map G-points right
  for (const gPoint of gPointsRight) {
    const base = scale((landmarks as any)[gPoint.base])
    const tip = scale((landmarks as any)[gPoint.tip])

    if (base && tip) {
      const fieldKey = `g${gPoint.index}_right`
      const confidence = getFieldConfidence(fieldKey)
      features.push({
        key: `tine_${gPoint.index}_right`,
        label: gPoint.label,
        confidence,
        color: getColor(fieldKey),
        points: [base, tip],
        kind: 'segment',
        measurementValue: measurements?.[fieldKey],
      })
    }
  }

  // ============================================================================
  // INSIDE SPREAD
  // ============================================================================
  // If we have beam tips or burrs, connect them for spread visualization
  if (landmarks.beam_tip_left && landmarks.beam_tip_right) {
    const spreadLeft = scale(landmarks.beam_tip_left)
    const spreadRight = scale(landmarks.beam_tip_right)

    if (spreadLeft && spreadRight) {
      const confidence = getFieldConfidence('insideSpread')
      features.push({
        key: 'inside_spread',
        label: 'Spread',
        confidence,
        color: getColor('insideSpread'),
        points: [spreadLeft, spreadRight],
        kind: 'segment',
        measurementValue: measurements?.inside_spread,
      })
    }
  }

  return features
}

/**
 * Extract strongest and weakest features for summary display
 */
export function summarizeFeatureConfidence(features: OverlayFeature[]): {
  strongest: string[]
  weakest: string[]
} {
  const high = features.filter(f => f.confidence === 'high' && f.kind === 'segment')
  const low = features.filter(f => f.confidence === 'low' && f.kind === 'segment')

  return {
    strongest: high.slice(0, 3).map(f => f.label),
    weakest: low.slice(0, 3).map(f => f.label),
  }
}
