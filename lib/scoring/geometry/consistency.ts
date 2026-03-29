/**
 * Phase 45: Measurement-Family Refinement
 * 
 * Uses geometry analysis to influence measurement families independently:
 * spread, beam, tine, mass, deductions.
 * 
 * Weak references reduce trust in that family.
 * Geometry-supported refinement may adjust values with tracked reasoning.
 */

import type { Measurements } from '@/lib/types'
import type {
  GeometryRefinementResult,
  ReferenceFusionResult,
  MeasurementFamily,
  MeasurementFamilyAdjustment,
} from '@/lib/vision/landmarks/types'

// ============================================================================
// TYPES
// ============================================================================

export interface MeasurementFamilyRefinementInput {
  measurements: Measurements
  geometryResult: GeometryRefinementResult
  referenceFusion: ReferenceFusionResult
}

export interface MeasurementFamilyRefinementOutput {
  /** Refined measurements with adjustments applied */
  refinedMeasurements: Measurements
  
  /** Per-family refinement details */
  familyRefinements: MeasurementFamilyAdjustment[]
  
  /** Per-family trust scores (0-1) */
  familyTrust: Record<MeasurementFamily, number>
  
  /** Overall refinement confidence */
  refinementConfidence: number
  
  /** Summary notes */
  notes: string[]
}

// ============================================================================
// MAIN REFINEMENT FUNCTION
// ============================================================================

/**
 * Apply measurement-family level refinement based on geometry and reference quality.
 * This is conservative - adjustments are small and bounded.
 */
export function refineMeasurementFamilies(
  input: MeasurementFamilyRefinementInput
): MeasurementFamilyRefinementOutput {
  const { measurements, geometryResult, referenceFusion } = input
  
  const refinedMeasurements = { ...measurements }
  const familyRefinements: MeasurementFamilyAdjustment[] = []
  const notes: string[] = []
  
  // Calculate trust per family based on reference quality and geometry
  const familyTrust: Record<MeasurementFamily, number> = {
    spread: calculateFamilyTrust('spread', referenceFusion, geometryResult),
    beam: calculateFamilyTrust('beam', referenceFusion, geometryResult),
    tine: calculateFamilyTrust('tine', referenceFusion, geometryResult),
    mass: calculateFamilyTrust('mass', referenceFusion, geometryResult),
    asymmetry: calculateFamilyTrust('asymmetry', referenceFusion, geometryResult),
    deduction: calculateFamilyTrust('deduction', referenceFusion, geometryResult),
  }
  
  // ========== SPREAD REFINEMENT ==========
  if (measurements.inside_spread !== null) {
    const spreadRefinement = refineSpread(
      measurements.inside_spread,
      familyTrust.spread,
      geometryResult,
      referenceFusion
    )
    
    if (spreadRefinement.adjustment !== 0) {
      refinedMeasurements.inside_spread = spreadRefinement.refined
      familyRefinements.push({
        family: 'spread',
        original_estimate: measurements.inside_spread,
        refined_estimate: spreadRefinement.refined,
        adjustment_amount: spreadRefinement.adjustment,
        adjustment_reason: spreadRefinement.reason,
        trust_reduction: 1 - familyTrust.spread,
        refinement_applied: true,
      })
      notes.push(spreadRefinement.note)
    }
  }
  
  // ========== BEAM REFINEMENT ==========
  const beamRefinement = refineBeams(
    measurements.main_beam_left,
    measurements.main_beam_right,
    familyTrust.beam,
    geometryResult
  )
  
  if (beamRefinement.leftAdjustment !== 0 || beamRefinement.rightAdjustment !== 0) {
    refinedMeasurements.main_beam_left = beamRefinement.refinedLeft
    refinedMeasurements.main_beam_right = beamRefinement.refinedRight
    familyRefinements.push({
      family: 'beam',
      original_estimate: (measurements.main_beam_left ?? 0) + (measurements.main_beam_right ?? 0),
      refined_estimate: beamRefinement.refinedLeft + beamRefinement.refinedRight,
      adjustment_amount: beamRefinement.leftAdjustment + beamRefinement.rightAdjustment,
      adjustment_reason: beamRefinement.reason,
      trust_reduction: 1 - familyTrust.beam,
      refinement_applied: true,
    })
    if (beamRefinement.note) notes.push(beamRefinement.note)
  }
  
  // ========== TINE REFINEMENT ==========
  // Tines are rarely refined automatically - only flagged for review
  // But we record trust information
  familyRefinements.push({
    family: 'tine',
    original_estimate: null,
    refined_estimate: null,
    adjustment_amount: 0,
    adjustment_reason: 'Tines not auto-refined (complex geometry)',
    trust_reduction: 1 - familyTrust.tine,
    refinement_applied: false,
  })
  
  // ========== MASS REFINEMENT ==========
  // Mass is also rarely refined - circumference is hard to estimate
  familyRefinements.push({
    family: 'mass',
    original_estimate: null,
    refined_estimate: null,
    adjustment_amount: 0,
    adjustment_reason: 'Mass not auto-refined (circumference estimation)',
    trust_reduction: 1 - familyTrust.mass,
    refinement_applied: false,
  })
  
  // ========== DEDUCTION REFINEMENT ==========
  if (measurements.deductions !== null && !geometryResult.asymmetry_analysis.should_apply_asymmetry_deduction) {
    // Reduce deductions if asymmetry is perspective-induced
    const adjustment = geometryResult.asymmetry_analysis.suggested_deduction_adjustment
    if (adjustment !== 0) {
      const refined = Math.max(0, measurements.deductions + adjustment)
      familyRefinements.push({
        family: 'deduction',
        original_estimate: measurements.deductions,
        refined_estimate: refined,
        adjustment_amount: adjustment,
        adjustment_reason: geometryResult.asymmetry_analysis.recommendation,
        trust_reduction: 1 - familyTrust.deduction,
        refinement_applied: true,
      })
      refinedMeasurements.deductions = Number(refined.toFixed(1))
      notes.push(`Deduction adjusted: ${geometryResult.asymmetry_analysis.recommendation}`)
    }
  }
  
  // Overall refinement confidence
  const avgTrust = Object.values(familyTrust).reduce((a, b) => a + b, 0) / Object.keys(familyTrust).length
  const refinementConfidence = avgTrust * geometryResult.geometry_consistency_score
  
  return {
    refinedMeasurements,
    familyRefinements,
    familyTrust,
    refinementConfidence,
    notes,
  }
}

// ============================================================================
// PER-FAMILY TRUST CALCULATION
// ============================================================================

function calculateFamilyTrust(
  family: MeasurementFamily,
  refFusion: ReferenceFusionResult,
  geometry: GeometryRefinementResult
): number {
  let trust = 0.5 // baseline
  
  // Reference quality contribution
  let refConf = 0.5
  switch (family) {
    case 'spread': refConf = refFusion.spread_primary.confidence; break
    case 'beam': refConf = refFusion.beam_primary.confidence; break
    case 'tine': refConf = refFusion.tine_primary.confidence; break
    case 'mass': refConf = refFusion.mass_primary.confidence; break
    case 'asymmetry': refConf = (refFusion.spread_primary.confidence + refFusion.beam_primary.confidence) / 2; break
    case 'deduction': refConf = refFusion.overall_reference_quality; break
  }
  trust = refConf * 0.6
  
  // Geometry consistency contribution
  trust += geometry.geometry_consistency_score * 0.3
  
  // Penalty from geometry flags
  const penalty = geometry.family_trust_penalties[family] ?? 0
  trust -= penalty
  
  // Bonus for multi-reference agreement
  if (refFusion.reference_disagreement_score < 0.1) {
    trust += 0.05
  }
  
  return Math.max(0.1, Math.min(1, trust))
}

// ============================================================================
// SPREAD REFINEMENT
// ============================================================================

interface SpreadRefinementResult {
  refined: number
  adjustment: number
  reason: string
  note: string
}

function refineSpread(
  original: number,
  trust: number,
  geometry: GeometryRefinementResult,
  refFusion: ReferenceFusionResult
): SpreadRefinementResult {
  let adjustment = 0
  let reason = ''
  let note = ''
  
  // Only refine if trust is low AND geometry flags suggest it
  if (trust < 0.5) {
    const spreadFlags = geometry.geometry_flags.filter(
      f => f.field === 'inside_spread' && f.severity === 'critical'
    )
    
    if (spreadFlags.length > 0) {
      // Apply bounded correction towards anatomical center
      const typicalSpread = 18.5 // typical mature buck
      const deviation = original - typicalSpread
      
      // Pull towards typical, but conservatively
      const correctionStrength = 0.15 * (1 - trust) // max 15% correction when trust is 0
      adjustment = -deviation * correctionStrength
      
      // Cap adjustment
      adjustment = Math.max(-2, Math.min(2, adjustment))
      
      reason = 'Low reference trust + geometry flags'
      note = `Spread adjusted ${adjustment > 0 ? '+' : ''}${adjustment.toFixed(1)}" due to weak reference`
    }
  }
  
  return {
    refined: Number((original + adjustment).toFixed(1)),
    adjustment,
    reason,
    note,
  }
}

// ============================================================================
// BEAM REFINEMENT
// ============================================================================

interface BeamRefinementResult {
  refinedLeft: number
  refinedRight: number
  leftAdjustment: number
  rightAdjustment: number
  reason: string
  note: string
}

function refineBeams(
  left: number | null,
  right: number | null,
  trust: number,
  geometry: GeometryRefinementResult
): BeamRefinementResult {
  const l = left ?? 0
  const r = right ?? 0
  
  let leftAdj = 0
  let rightAdj = 0
  let reason = ''
  let note = ''
  
  // Only refine if there are critical beam flags
  const beamFlags = geometry.geometry_flags.filter(
    f => f.field === 'main_beam' && f.severity === 'critical'
  )
  
  if (beamFlags.length > 0 && trust < 0.6) {
    // Apply bounded correction towards anatomical center
    const typicalBeam = 24.0 // typical mature buck
    
    const lDeviation = l - typicalBeam
    const rDeviation = r - typicalBeam
    
    const correctionStrength = 0.1 * (1 - trust)
    leftAdj = -lDeviation * correctionStrength
    rightAdj = -rDeviation * correctionStrength
    
    // Cap adjustments
    leftAdj = Math.max(-1.5, Math.min(1.5, leftAdj))
    rightAdj = Math.max(-1.5, Math.min(1.5, rightAdj))
    
    reason = 'Critical geometry flags on beams'
    note = `Beams adjusted due to geometry concerns`
  }
  
  return {
    refinedLeft: Number((l + leftAdj).toFixed(1)),
    refinedRight: Number((r + rightAdj).toFixed(1)),
    leftAdjustment: leftAdj,
    rightAdjustment: rightAdj,
    reason,
    note,
  }
}

// ============================================================================
// EXPORT HELPERS
// ============================================================================

/**
 * Convert family trust to display-friendly format
 */
export function familyTrustToDisplay(trust: Record<MeasurementFamily, number>): Record<string, string> {
  const tierize = (t: number): string => {
    if (t >= 0.8) return 'excellent'
    if (t >= 0.6) return 'good'
    if (t >= 0.4) return 'fair'
    return 'poor'
  }
  
  return {
    spread: `${Math.round(trust.spread * 100)}% (${tierize(trust.spread)})`,
    beam: `${Math.round(trust.beam * 100)}% (${tierize(trust.beam)})`,
    tine: `${Math.round(trust.tine * 100)}% (${tierize(trust.tine)})`,
    mass: `${Math.round(trust.mass * 100)}% (${tierize(trust.mass)})`,
    deduction: `${Math.round(trust.deduction * 100)}% (${tierize(trust.deduction)})`,
  }
}
