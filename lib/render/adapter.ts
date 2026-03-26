/**
 * 3D Render Adapter — Phase 12B: Parametric Antler Generator
 *
 * Converts AntlerGeometry measurements into Three.js-ready geometry parameters.
 * Modular pipeline: normalize → beam curves → tine positions → mesh params.
 * Future adapters (external AI mesh, taxidermy mount) can replace this module
 * without touching the viewer component.
 *
 * Renderer type registry — extend here to add future adapters.
 */

import * as THREE from 'three'
import type { AntlerGeometry, RenderSettings } from '@/lib/types'

export type RendererType = 'parametric_3d' | 'canvas_2d' | 'external_mesh'

export const RENDERER_LABELS: Record<RendererType, string> = {
  parametric_3d: 'Parametric 3D',
  canvas_2d: 'Visualization',
  external_mesh: 'AI Mesh',
}

// ─── Scale constant ──────────────────────────────────────────────────────────
// 1 inch → 0.08 Three.js units gives a ~15-25 unit tall rack at typical sizes.
const IN = 0.08

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BeamCurve {
  /** CatmullRom control points in 3D space */
  points: THREE.Vector3[]
  /**
   * Tube radii at each control point index.
   * Interpolated along the tube by the viewer.
   */
  radii: number[]
}

export interface TineSpec {
  name: string
  /** t value [0..1] along the parent beam CatmullRom curve */
  beamT: number
  /** Length in Three.js units */
  length: number
  /** Tine branch direction in local beam tangent space (unit vector) */
  localDir: THREE.Vector3
}

export interface BurrSpec {
  center: THREE.Vector3
  radius: number
}

export interface AntlerMeshParams {
  rendererType: RendererType
  leftBeam: BeamCurve
  rightBeam: BeamCurve
  leftTines: TineSpec[]
  rightTines: TineSpec[]
  leftBurr: BurrSpec
  rightBurr: BurrSpec
  /** Half-skull offset on X axis (so beams start at ±offset) */
  skullHalfWidth: number
}

// ─── Step 1: Normalize ───────────────────────────────────────────────────────

/**
 * Fill in missing/zero measurements with anatomically reasonable defaults
 * so the renderer never has to deal with 0-length geometry.
 */
export function normalizeGeometry(g: AntlerGeometry): Required<AntlerGeometry> {
  const safe = (v: number | null | undefined, fallback: number) =>
    v && v > 0 ? v : fallback

  return {
    insideSpread: safe(g.insideSpread, 16),
    mainBeamLeft: safe(g.mainBeamLeft, 22),
    mainBeamRight: safe(g.mainBeamRight, 22),
    g1Left: safe(g.g1Left, 4),
    g1Right: safe(g.g1Right, 4),
    g2Left: safe(g.g2Left, 9),
    g2Right: safe(g.g2Right, 9),
    g3Left: safe(g.g3Left, 8),
    g3Right: safe(g.g3Right, 8),
    g4Left: safe(g.g4Left, 5),
    g4Right: safe(g.g4Right, 5),
    g5Left: g.g5Left && g.g5Left > 0 ? g.g5Left : null,
    g5Right: g.g5Right && g.g5Right > 0 ? g.g5Right : null,
    h1Left: safe(g.h1Left, 4.5),
    h1Right: safe(g.h1Right, 4.5),
    h2Left: safe(g.h2Left, 4.2),
    h2Right: safe(g.h2Right, 4.2),
    h3Left: safe(g.h3Left, 3.9),
    h3Right: safe(g.h3Right, 3.9),
    h4Left: safe(g.h4Left, 3.6),
    h4Right: safe(g.h4Right, 3.6),
    abnormalPoints: g.abnormalPoints ?? 0,
    rackType: g.rackType,
    mainFramePoints: g.mainFramePoints ?? 10,
  }
}

// ─── Step 2: Beam curves ─────────────────────────────────────────────────────

/**
 * Generate a CatmullRom beam curve.
 *
 * Deer main beams sweep out and forward from the burr, curve up and slightly
 * back, then sweep inward toward the tip (like a backwards C when viewed from
 * the front).  We parameterize this with 7 control points so the shape is
 * recognisably antler-shaped across a wide range of measurements.
 */
function buildBeamCurve(
  beamLength: number,
  circumferences: [number, number, number, number],
  halfSpread: number,
  isLeft: boolean
): BeamCurve {
  const sx = isLeft ? -1 : 1          // side sign
  const bl = beamLength * IN          // beam length in 3D units
  const hs = halfSpread * IN          // half-spread in 3D units

  // Control points — tuned to look natural across 18–30" beams
  const pts: THREE.Vector3[] = [
    new THREE.Vector3(sx * 0.6,   0,        0),       // 0 — burr (base)
    new THREE.Vector3(sx * 1.0,   bl * 0.1, 0.1),     // 1 — just off burr, slight forward kick
    new THREE.Vector3(sx * hs * 0.55, bl * 0.25, 0.25),// 2 — sweeping out and forward
    new THREE.Vector3(sx * hs * 0.85, bl * 0.48, 0.15),// 3 — peak outward reach
    new THREE.Vector3(sx * hs * 0.80, bl * 0.68, -0.05),// 4 — turning back
    new THREE.Vector3(sx * hs * 0.55, bl * 0.85, -0.18),// 5 — heading inward
    new THREE.Vector3(sx * hs * 0.25, bl * 1.00, -0.08),// 6 — tip
  ]

  // Circumference → radius: circumference = 2πr → r = c/(2π)
  // Use H1–H4 mapped to 4 spread points along the beam, taper to tip
  const c = circumferences
  const radii = [
    (c[0] / (2 * Math.PI)) * IN * 1.4, // 0 — burr (slightly wider)
    (c[0] / (2 * Math.PI)) * IN * 1.1, // 1
    (c[1] / (2 * Math.PI)) * IN,       // 2
    (c[1] / (2 * Math.PI)) * IN * 0.9, // 3
    (c[2] / (2 * Math.PI)) * IN * 0.8, // 4
    (c[3] / (2 * Math.PI)) * IN * 0.65,// 5
    (c[3] / (2 * Math.PI)) * IN * 0.25,// 6 — tip
  ]

  return { points: pts, radii }
}

// ─── Step 3: Tine attachment points ──────────────────────────────────────────

const TINE_T_POSITIONS = [0.14, 0.32, 0.52, 0.70, 0.86] as const

/**
 * Build tine specs. Each tine gets:
 * - a t-value along the beam CatmullRom curve
 * - a length in 3D units
 * - a local branch direction (outward + slightly forward + upward)
 */
function buildTineSpecs(
  tines: { name: string; length: number | null }[],
  isLeft: boolean
): TineSpec[] {
  const sx = isLeft ? -1 : 1
  const result: TineSpec[] = []

  tines.forEach((t, i) => {
    const len = t.length && t.length > 0 ? t.length : null
    if (!len) return

    // G1 (brow tine): angles sharply forward/upward
    // G2–G4: progressively more vertical, slightly outward
    // G5: nearly vertical
    const fwdBias = i === 0 ? 0.7 : 0.2 - i * 0.04
    const upBias = 0.5 + i * 0.08
    const outBias = sx * (0.35 - i * 0.04)

    const dir = new THREE.Vector3(outBias, upBias, fwdBias).normalize()

    result.push({
      name: t.name,
      beamT: TINE_T_POSITIONS[i] ?? 0.5,
      length: len * IN,
      localDir: dir,
    })
  })

  return result
}

// ─── Step 4: Assemble params ─────────────────────────────────────────────────

/**
 * Full pipeline: AntlerGeometry → AntlerMeshParams
 */
export function geometryToMeshParams(geometry: AntlerGeometry): AntlerMeshParams {
  const g = normalizeGeometry(geometry)
  const halfSpread = g.insideSpread / 2

  const leftBeam = buildBeamCurve(
    g.mainBeamLeft,
    [g.h1Left, g.h2Left, g.h3Left, g.h4Left],
    halfSpread,
    true
  )
  const rightBeam = buildBeamCurve(
    g.mainBeamRight,
    [g.h1Right, g.h2Right, g.h3Right, g.h4Right],
    halfSpread,
    false
  )

  const leftTines = buildTineSpecs(
    [
      { name: 'G1', length: g.g1Left },
      { name: 'G2', length: g.g2Left },
      { name: 'G3', length: g.g3Left },
      { name: 'G4', length: g.g4Left },
      { name: 'G5', length: g.g5Left },
    ],
    true
  )
  const rightTines = buildTineSpecs(
    [
      { name: 'G1', length: g.g1Right },
      { name: 'G2', length: g.g2Right },
      { name: 'G3', length: g.g3Right },
      { name: 'G4', length: g.g4Right },
      { name: 'G5', length: g.g5Right },
    ],
    false
  )

  const burrRadius = Math.max(g.h1Left, g.h1Right) / (2 * Math.PI) * IN * 1.6

  return {
    rendererType: 'parametric_3d',
    leftBeam,
    rightBeam,
    leftTines,
    rightTines,
    leftBurr: { center: leftBeam.points[0].clone(), radius: burrRadius },
    rightBurr: { center: rightBeam.points[0].clone(), radius: burrRadius },
    skullHalfWidth: 0.6,
  }
}

// ─── Camera helpers (unchanged API) ─────────────────────────────────────────

export function getCameraPosition(
  view: 'front' | 'left' | 'right' | 'top' | 'isometric',
  distance = 5
): [number, number, number] {
  switch (view) {
    case 'front':      return [0,  1.2, distance]
    case 'left':       return [-distance, 1.2, 0]
    case 'right':      return [distance,  1.2, 0]
    case 'top':        return [0,  distance, 0.01]
    case 'isometric':  return [distance * 0.7, distance * 0.55, distance * 0.7]
    default:           return [0,  1.2, distance]
  }
}

// ─── Color helpers ───────────────────────────────────────────────────────────

export function getColorScheme(settings: RenderSettings): {
  background: string
  antler: string
  highlight: string
} {
  return {
    background: settings.backgroundColor,
    antler: settings.antlerColor,
    highlight: settings.highlightColor,
  }
}

// ─── Tube geometry builder ───────────────────────────────────────────────────

/**
 * Build a tapered tube along a CatmullRom curve.
 * Returns a THREE.TubeGeometry approximation by building a single tube with
 * the average radius. For visual taper we use a custom BufferGeometry approach
 * that the viewer will call per-segment.
 */
export function buildBeamTubeGeometry(
  curve: BeamCurve,
  tubularSegments = 40,
  radialSegments = 8
): THREE.TubeGeometry {
  const catmull = new THREE.CatmullRomCurve3(curve.points)
  // Average radius across the beam for a single TubeGeometry pass
  const avgRadius = curve.radii.reduce((s, r) => s + r, 0) / curve.radii.length
  return new THREE.TubeGeometry(catmull, tubularSegments, avgRadius, radialSegments, false)
}

/**
 * Build a straight taper-tipped cone-tube for a tine.
 * We use ConeGeometry oriented along the tine direction.
 */
export function buildTineGeometry(length: number, baseRadius: number): THREE.ConeGeometry {
  return new THREE.ConeGeometry(baseRadius, length, 7, 1, false)
}

/**
 * Sample a point + tangent on a CatmullRom beam at t ∈ [0,1].
 */
export function sampleBeamAt(
  curve: BeamCurve,
  t: number
): { position: THREE.Vector3; tangent: THREE.Vector3 } {
  const catmull = new THREE.CatmullRomCurve3(curve.points)
  return {
    position: catmull.getPoint(t),
    tangent: catmull.getTangent(t).normalize(),
  }
}
