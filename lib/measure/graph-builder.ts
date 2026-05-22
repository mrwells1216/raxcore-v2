/**
 * Converts Zustand measure-store state into a canonical MeasurementGraph
 * that can be fed directly to scoreFromGraph().
 *
 * All measurements come from 2D photo polylines scaled by the calibration
 * factor.  3D measurements (when present and finalized) take precedence for
 * any field they cover.
 */

import type {
  MeasurementGraph,
  Beam,
  Tine,
  TineLabel,
  Spread,
  CircumferencePoint,
} from '@/lib/types'
import type {
  Measurement2D,
  Measurement3D,
  CalibrationState,
  FieldId,
} from '@/components/measure/measure-store'
import { circumferenceFromPoints } from '@/lib/advanced-scoring/geometry'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function confidenceToNumber(c: 'high' | 'medium' | 'low'): number {
  return c === 'high' ? 0.9 : c === 'medium' ? 0.6 : 0.3
}

/** Prefer a finalized 3D measurement when it has points; fall back to 2D inch length. */
function resolveLength(
  m2d: Measurement2D,
  m3d: Measurement3D | undefined,
): number {
  if (m3d && m3d.finalized && m3d.inchLength > 0) return m3d.inchLength
  return m2d.inchLength
}

function resolveConf(
  m2d: Measurement2D,
  m3d: Measurement3D | undefined,
): number {
  if (m3d && m3d.finalized && m3d.inchLength > 0) return confidenceToNumber(m3d.confidence)
  return confidenceToNumber(m2d.confidence)
}

/** Build a Vec2 array from 2D points (already in inches via calibration). */
function toVec2Array(m2d: Measurement2D, ppi: number) {
  if (ppi <= 0) return []
  return m2d.points.map(p => ({ x: p.x / ppi, y: p.y / ppi }))
}

function buildBeam(
  id: string,
  m2d: Measurement2D,
  m3d: Measurement3D | undefined,
  ppi: number,
): Beam {
  const length = resolveLength(m2d, m3d)
  return {
    id,
    points: toVec2Array(m2d, ppi),
    length,
    confidence: resolveConf(m2d, m3d),
    source: 'fused',
    provenance: {
      origin: 'human',
      visibility: m2d.finalized ? 'corrected' : 'inferred',
    },
  }
}

// ─── Main builder ────────────────────────────────────────────────────────────

export interface BuildGraphInput {
  measurements2D: Record<FieldId, Measurement2D>
  measurements3D: Record<FieldId, Measurement3D>
  calibration: CalibrationState
}

export function buildMeasurementGraph(input: BuildGraphInput): MeasurementGraph {
  const { measurements2D: m2, measurements3D: m3, calibration } = input
  const ppi = calibration.pixelsPerInch > 0 ? calibration.pixelsPerInch : 1

  // ── Beams ─────────────────────────────────────────────────────────────────
  const leftBeam = buildBeam('beam-left',  m2['beam-left'],  m3['beam-left'],  ppi)
  const rightBeam = buildBeam('beam-right', m2['beam-right'], m3['beam-right'], ppi)

  // ── Tines ─────────────────────────────────────────────────────────────────
  const tineFields: Array<{ fieldId: FieldId; label: TineLabel; side: 'left' | 'right'; parentBeamId: string }> = [
    { fieldId: 'g1-left',  label: 'G1', side: 'left',  parentBeamId: 'beam-left'  },
    { fieldId: 'g1-right', label: 'G1', side: 'right', parentBeamId: 'beam-right' },
    { fieldId: 'g2-left',  label: 'G2', side: 'left',  parentBeamId: 'beam-left'  },
    { fieldId: 'g2-right', label: 'G2', side: 'right', parentBeamId: 'beam-right' },
    { fieldId: 'g3-left',  label: 'G3', side: 'left',  parentBeamId: 'beam-left'  },
    { fieldId: 'g3-right', label: 'G3', side: 'right', parentBeamId: 'beam-right' },
    { fieldId: 'g4-left',  label: 'G4', side: 'left',  parentBeamId: 'beam-left'  },
    { fieldId: 'g4-right', label: 'G4', side: 'right', parentBeamId: 'beam-right' },
  ]

  const tines: Tine[] = tineFields.map(({ fieldId, label, side, parentBeamId }) => {
    const md2 = m2[fieldId]
    const md3 = m3[fieldId]
    const length = resolveLength(md2, md3)
    const pts = md2.points
    // Use first & last point as base/tip approximations
    const base = pts.length > 0 ? { x: pts[0].x / ppi, y: pts[0].y / ppi } : { x: 0, y: 0 }
    const tip  = pts.length > 1 ? { x: pts[pts.length - 1].x / ppi, y: pts[pts.length - 1].y / ppi } : base
    return {
      id: fieldId,
      side,
      parentBeamId,
      basePoint: base,
      tipPoint: tip,
      length,
      label,
      confidence: resolveConf(md2, md3),
      provenance: { origin: 'human', visibility: md2.finalized ? 'corrected' : 'inferred' },
    }
  })

  // ── Spread ────────────────────────────────────────────────────────────────
  const spreadM2 = m2['spread']
  const spreadM3 = m3['spread']
  const spreadLength = resolveLength(spreadM2, spreadM3)
  const sPts = spreadM2.points
  const spreadLeft  = sPts.length > 0 ? { x: sPts[0].x / ppi, y: sPts[0].y / ppi } : { x: 0, y: 0 }
  const spreadRight = sPts.length > 1 ? { x: sPts[sPts.length - 1].x / ppi, y: sPts[sPts.length - 1].y / ppi } : spreadLeft
  const spread: Spread = {
    leftPoint: spreadLeft,
    rightPoint: spreadRight,
    distance: spreadLength,
    confidence: resolveConf(spreadM2, spreadM3),
    provenance: { origin: 'human', visibility: spreadM2.finalized ? 'corrected' : 'inferred' },
  }

  // ── Circumferences ────────────────────────────────────────────────────────
  const circumFields: Array<{ fieldId: FieldId; label: CircumferencePoint['label']; side: 'left' | 'right' }> = [
    { fieldId: 'h1-left',  label: 'H1', side: 'left'  },
    { fieldId: 'h1-right', label: 'H1', side: 'right' },
    { fieldId: 'h2-left',  label: 'H2', side: 'left'  },
    { fieldId: 'h2-right', label: 'H2', side: 'right' },
    { fieldId: 'h3-left',  label: 'H3', side: 'left'  },
    { fieldId: 'h3-right', label: 'H3', side: 'right' },
    { fieldId: 'h4-left',  label: 'H4', side: 'left'  },
    { fieldId: 'h4-right', label: 'H4', side: 'right' },
  ]

  const circumferences: CircumferencePoint[] = circumFields.map(({ fieldId, label, side }) => {
    const cd2 = m2[fieldId]
    const cd3 = m3[fieldId]
    // Prefer finalized 3D; otherwise use Taubin on the 2D pixel points and
    // fall back to the chord-sum inch length only if the fit is degenerate.
    const use3D = !!(cd3 && cd3.finalized && cd3.inchLength > 0)
    let length = resolveLength(cd2, cd3)
    if (!use3D && cd2.points.length >= 3 && ppi > 0) {
      const fit = circumferenceFromPoints(cd2.points)
      if (fit) length = fit.circumference / ppi
    }
    const cPts = cd2.points
    const pos = cPts.length > 0 ? { x: cPts[0].x / ppi, y: cPts[0].y / ppi } : { x: 0, y: 0 }
    return {
      id: fieldId,
      side,
      label,
      position: pos,
      circumference: length,
      confidence: resolveConf(cd2, cd3),
      provenance: { origin: 'human', visibility: cd2.finalized ? 'corrected' : 'inferred' },
    }
  })

  return {
    beams: { left: leftBeam, right: rightBeam },
    tines,
    spread,
    circumferences,
  }
}
