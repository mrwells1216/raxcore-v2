/**
 * 3D Render Adapter — Phase 16: Stronger Parametric 3D Realism
 *
 * Converts AntlerGeometry measurements into Three.js-ready geometry parameters.
 * Modular pipeline: normalize → beam curves → tine positions → mesh params.
 *
 * Phase 16 Enhancements:
 * - Better beam realism with natural sweep, curvature, flare, and taper
 * - Improved tine placement with anatomical spacing, angles, and transitions
 * - Mass-driven thickness using H1-H4 circumferences
 * - Support for rack asymmetry when left/right scores differ
 * - European mount base option
 * - Enhanced material parameters
 */

import * as THREE from 'three'
import type { AntlerGeometry, RenderSettings } from '@/lib/types'

export type RendererType = 'parametric_3d' | 'canvas_2d' | 'external_mesh'
export type MountMode = 'antlers_only' | 'european_mount'
export type RealismLevel = 'basic' | 'standard' | 'enhanced'

export const RENDERER_LABELS: Record<RendererType, string> = {
  parametric_3d: 'Parametric 3D',
  canvas_2d: 'Visualization',
  external_mesh: 'AI Mesh',
}

// ─── Scale constant ──────────────────────────────────────────────────────────
// 1 inch → 0.08 Three.js units gives a ~15-25 unit tall rack at typical sizes.
const IN = 0.08

// ─── Enhanced Render Config ──────────────────────────────────────────────────

export interface RenderConfig {
  mountMode: MountMode
  realismLevel: RealismLevel
  asymmetrySensitivity: number // 0-1, how much to emphasize L/R differences
  beamSweepBias: number // -1 to 1, backward to forward sweep
  tineForwardTilt: number // 0-1, how much tines tilt forward
  showSkullPlate: boolean
}

export const DEFAULT_RENDER_CONFIG: RenderConfig = {
  mountMode: 'antlers_only',
  realismLevel: 'standard',
  asymmetrySensitivity: 0.7,
  beamSweepBias: 0.15, // slight forward sweep
  tineForwardTilt: 0.4,
  showSkullPlate: false,
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BeamCurve {
  /** CatmullRom control points in 3D space */
  points: THREE.Vector3[]
  /**
   * Tube radii at each control point index.
   * Interpolated along the tube by the viewer.
   */
  radii: number[]
  /** Side identifier for asymmetry handling */
  side: 'left' | 'right'
}

export interface TineSpec {
  name: string
  /** t value [0..1] along the parent beam CatmullRom curve */
  beamT: number
  /** Length in Three.js units */
  length: number
  /** Base radius at attachment point */
  baseRadius: number
  /** Tine branch direction in local beam tangent space (unit vector) */
  localDir: THREE.Vector3
  /** Forward tilt angle in radians */
  forwardTilt: number
  /** Outward tilt angle in radians */
  outwardTilt: number
  /** Taper factor (0-1, how quickly it tapers to tip) */
  taperFactor: number
}

export interface BurrSpec {
  center: THREE.Vector3
  radius: number
  /** Height of the burr bulge */
  height: number
  /** Texture variation seed for procedural details */
  textureSeed: number
}

export interface SkullPlateSpec {
  center: THREE.Vector3
  width: number
  depth: number
  height: number
  burrDistance: number
}

export interface AntlerMeshParams {
  rendererType: RendererType
  leftBeam: BeamCurve
  rightBeam: BeamCurve
  leftTines: TineSpec[]
  rightTines: TineSpec[]
  leftBurr: BurrSpec
  rightBurr: BurrSpec
  skullPlate: SkullPlateSpec | null
  /** Half-skull offset on X axis (so beams start at ±offset) */
  skullHalfWidth: number
  /** Asymmetry factor (0-1) based on L/R differences */
  asymmetryFactor: number
  /** Render configuration */
  config: RenderConfig
  /** Material hints */
  materialHints: MaterialHints
}

export interface MaterialHints {
  baseColor: string
  tipColor: string
  burrColor: string
  roughnessBase: number
  roughnessTip: number
  colorVariation: number
}

// ─── Step 1: Normalize with Asymmetry Detection ─────────────────────────────

interface NormalizedGeometry extends Required<Omit<AntlerGeometry, 'g5Left' | 'g5Right'>> {
  g5Left: number | null
  g5Right: number | null
  asymmetryScore: number
  beamAsymmetry: number
  tineAsymmetry: number
  massAsymmetry: number
}

/**
 * Fill in missing/zero measurements with anatomically reasonable defaults
 * and compute asymmetry metrics for realistic rendering.
 */
export function normalizeGeometry(g: AntlerGeometry): NormalizedGeometry {
  const safe = (v: number | null | undefined, fallback: number) =>
    v && v > 0 ? v : fallback

  const normalized = {
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

  // Compute asymmetry metrics
  const beamAsymmetry = Math.abs(normalized.mainBeamLeft - normalized.mainBeamRight) / 
    Math.max(normalized.mainBeamLeft, normalized.mainBeamRight)
  
  const tineAsymmetry = computeTineAsymmetry(normalized)
  const massAsymmetry = computeMassAsymmetry(normalized)
  
  const asymmetryScore = (beamAsymmetry + tineAsymmetry + massAsymmetry) / 3

  return {
    ...normalized,
    asymmetryScore,
    beamAsymmetry,
    tineAsymmetry,
    massAsymmetry,
  }
}

function computeTineAsymmetry(g: {
  g1Left: number; g1Right: number;
  g2Left: number; g2Right: number;
  g3Left: number; g3Right: number;
  g4Left: number; g4Right: number;
}): number {
  const diffs = [
    Math.abs(g.g1Left - g.g1Right) / Math.max(g.g1Left, g.g1Right, 1),
    Math.abs(g.g2Left - g.g2Right) / Math.max(g.g2Left, g.g2Right, 1),
    Math.abs(g.g3Left - g.g3Right) / Math.max(g.g3Left, g.g3Right, 1),
    Math.abs(g.g4Left - g.g4Right) / Math.max(g.g4Left, g.g4Right, 1),
  ]
  return diffs.reduce((a, b) => a + b, 0) / diffs.length
}

function computeMassAsymmetry(g: {
  h1Left: number; h1Right: number;
  h2Left: number; h2Right: number;
  h3Left: number; h3Right: number;
  h4Left: number; h4Right: number;
}): number {
  const diffs = [
    Math.abs(g.h1Left - g.h1Right) / Math.max(g.h1Left, g.h1Right, 1),
    Math.abs(g.h2Left - g.h2Right) / Math.max(g.h2Left, g.h2Right, 1),
    Math.abs(g.h3Left - g.h3Right) / Math.max(g.h3Left, g.h3Right, 1),
    Math.abs(g.h4Left - g.h4Right) / Math.max(g.h4Left, g.h4Right, 1),
  ]
  return diffs.reduce((a, b) => a + b, 0) / diffs.length
}

// ─── Step 2: Enhanced Beam Curves ────────────────────────────────────────────

/**
 * Generate a realistic CatmullRom beam curve with:
 * - Natural sweep with variable curvature
 * - Forward/backward tilt options
 * - Outward flare at peak spread
 * - Realistic tip taper
 * - Mild asymmetry support
 */
function buildBeamCurve(
  beamLength: number,
  circumferences: [number, number, number, number],
  halfSpread: number,
  isLeft: boolean,
  config: RenderConfig,
  asymmetryOffset: number = 0 // -1 to 1, applied for L/R differences
): BeamCurve {
  const sx = isLeft ? -1 : 1
  const bl = beamLength * IN
  const hs = halfSpread * IN

  // Asymmetry adjustments
  const asymFactor = 1 + asymmetryOffset * config.asymmetrySensitivity * 0.15
  const sweepVariation = asymmetryOffset * 0.08 * config.asymmetrySensitivity

  // Base sweep parameters - tuned for anatomical realism
  const sweepBias = config.beamSweepBias + sweepVariation
  const forwardSweep = 0.12 + sweepBias * 0.15 // Z displacement
  const verticalRise = 0.95 + Math.abs(sweepBias) * 0.05 // Y scale factor

  // Control points for natural beam shape
  // 9 control points for smoother curves
  const pts: THREE.Vector3[] = [
    // Burr - base attachment point
    new THREE.Vector3(
      sx * 0.55,
      0,
      0
    ),
    // Just off burr - initial outward/forward kick
    new THREE.Vector3(
      sx * 0.85,
      bl * 0.06 * verticalRise,
      forwardSweep * 0.3
    ),
    // Early beam - sweeping outward
    new THREE.Vector3(
      sx * hs * 0.45 * asymFactor,
      bl * 0.15 * verticalRise,
      forwardSweep * 0.6
    ),
    // Mid-lower beam - continuing outward arc
    new THREE.Vector3(
      sx * hs * 0.72 * asymFactor,
      bl * 0.30 * verticalRise,
      forwardSweep * 0.85
    ),
    // Peak outward reach - maximum spread point
    new THREE.Vector3(
      sx * hs * 0.92 * asymFactor,
      bl * 0.48 * verticalRise,
      forwardSweep * 0.7
    ),
    // Upper-mid beam - beginning inward curve
    new THREE.Vector3(
      sx * hs * 0.88 * asymFactor,
      bl * 0.65 * verticalRise,
      forwardSweep * 0.35
    ),
    // Upper beam - curving inward and slightly back
    new THREE.Vector3(
      sx * hs * 0.68 * asymFactor,
      bl * 0.80 * verticalRise,
      -forwardSweep * 0.15
    ),
    // Near tip - strong inward curve
    new THREE.Vector3(
      sx * hs * 0.42 * asymFactor,
      bl * 0.92 * verticalRise,
      -forwardSweep * 0.35
    ),
    // Tip - final point
    new THREE.Vector3(
      sx * hs * 0.22 * asymFactor,
      bl * 1.0 * verticalRise,
      -forwardSweep * 0.25
    ),
  ]

  // Mass-driven radii using H1-H4 circumferences
  // Circumference → radius: r = c/(2π)
  const c = circumferences
  const baseRadiusFactor = config.realismLevel === 'enhanced' ? 1.0 : 0.9

  // 9 radii corresponding to 9 control points
  // Smooth interpolation between H measurements
  const radii = [
    (c[0] / (2 * Math.PI)) * IN * 1.5 * baseRadiusFactor,  // Burr - widest
    (c[0] / (2 * Math.PI)) * IN * 1.25 * baseRadiusFactor, // Just off burr
    ((c[0] + c[1]) / 2 / (2 * Math.PI)) * IN * 1.1 * baseRadiusFactor, // Early beam (H1-H2 blend)
    (c[1] / (2 * Math.PI)) * IN * baseRadiusFactor, // Mid-lower (H2)
    ((c[1] + c[2]) / 2 / (2 * Math.PI)) * IN * 0.95 * baseRadiusFactor, // Peak (H2-H3 blend)
    (c[2] / (2 * Math.PI)) * IN * 0.85 * baseRadiusFactor, // Upper-mid (H3)
    ((c[2] + c[3]) / 2 / (2 * Math.PI)) * IN * 0.72 * baseRadiusFactor, // Upper (H3-H4 blend)
    (c[3] / (2 * Math.PI)) * IN * 0.45 * baseRadiusFactor, // Near tip (H4)
    (c[3] / (2 * Math.PI)) * IN * 0.18 * baseRadiusFactor, // Tip - narrowest
  ]

  return { points: pts, radii, side: isLeft ? 'left' : 'right' }
}

// ─── Step 3: Enhanced Tine Placement ─────────────────────────────────────────

// Anatomically-tuned t-positions along the beam for each tine
const TINE_T_POSITIONS: Record<string, number> = {
  G1: 0.12, // Brow tine - early on beam
  G2: 0.30, // Second point
  G3: 0.48, // Third point - often longest
  G4: 0.66, // Fourth point
  G5: 0.82, // Fifth point (if present)
}

// Base angles for each tine (radians from vertical)
const TINE_BASE_ANGLES: Record<string, { forward: number; outward: number }> = {
  G1: { forward: 0.85, outward: 0.25 }, // Brow - sharp forward angle
  G2: { forward: 0.35, outward: 0.18 }, // More upward
  G3: { forward: 0.22, outward: 0.15 }, // Nearly vertical
  G4: { forward: 0.18, outward: 0.12 }, // Slightly back-swept
  G5: { forward: 0.12, outward: 0.10 }, // Nearly vertical
}

/**
 * Build enhanced tine specs with:
 * - Anatomically believable spacing and angles
 * - Forward and outward tilt parameters
 * - Proper taper from base to tip
 * - Per-side asymmetry support
 */
function buildTineSpecs(
  tines: { name: string; length: number | null }[],
  circumferences: [number, number, number, number],
  isLeft: boolean,
  config: RenderConfig
): TineSpec[] {
  const sx = isLeft ? -1 : 1
  const result: TineSpec[] = []

  tines.forEach((t, i) => {
    const len = t.length && t.length > 0 ? t.length : null
    if (!len) return

    const tineName = t.name as keyof typeof TINE_BASE_ANGLES
    const angles = TINE_BASE_ANGLES[tineName] || { forward: 0.2, outward: 0.15 }
    const tPos = TINE_T_POSITIONS[tineName] || (0.15 + i * 0.18)

    // Apply config-based forward tilt adjustment
    const adjustedForward = angles.forward * (0.7 + config.tineForwardTilt * 0.6)
    const adjustedOutward = angles.outward

    // Build direction vector with natural variation
    // G1 (brow): angles sharply forward and slightly outward
    // G2-G4: progressively more vertical with slight outward cant
    const upComponent = Math.cos(adjustedForward)
    const fwdComponent = Math.sin(adjustedForward)
    const outComponent = sx * Math.sin(adjustedOutward)

    const dir = new THREE.Vector3(
      outComponent,
      upComponent,
      fwdComponent
    ).normalize()

    // Base radius derived from beam thickness at attachment point
    // Interpolate between H measurements based on t position
    const hIndex = Math.min(3, Math.floor(tPos * 4))
    const hBlend = (tPos * 4) - hIndex
    const h1 = circumferences[hIndex] || 4
    const h2 = circumferences[Math.min(3, hIndex + 1)] || 4
    const localCircum = h1 * (1 - hBlend) + h2 * hBlend
    
    // Tine base is typically 40-60% of beam thickness at that point
    const beamRadius = localCircum / (2 * Math.PI) * IN
    const baseRadius = beamRadius * (0.55 - i * 0.03) // Smaller for higher tines

    // Taper factor - brow tines taper more gradually
    const taperFactor = i === 0 ? 0.6 : 0.75 + i * 0.03

    result.push({
      name: t.name,
      beamT: tPos,
      length: len * IN,
      baseRadius,
      localDir: dir,
      forwardTilt: adjustedForward,
      outwardTilt: adjustedOutward,
      taperFactor,
    })
  })

  return result
}

// ─── Step 4: European Mount Base ─────────────────────────────────────────────

function buildSkullPlate(
  leftBurrCenter: THREE.Vector3,
  rightBurrCenter: THREE.Vector3,
  burrRadius: number
): SkullPlateSpec {
  const center = new THREE.Vector3(
    (leftBurrCenter.x + rightBurrCenter.x) / 2,
    Math.min(leftBurrCenter.y, rightBurrCenter.y) - burrRadius * 0.5,
    (leftBurrCenter.z + rightBurrCenter.z) / 2
  )
  
  const burrDistance = leftBurrCenter.distanceTo(rightBurrCenter)
  
  return {
    center,
    width: burrDistance * 1.3,
    depth: burrRadius * 2.5,
    height: burrRadius * 0.8,
    burrDistance,
  }
}

// ─── Step 5: Material Hints ──────────────────────────────────────────────────

function computeMaterialHints(
  config: RenderConfig,
  asymmetryScore: number
): MaterialHints {
  // Base antler coloring with subtle variation
  const baseColors = {
    basic: { base: '#8B7355', tip: '#6B5344', burr: '#7A6348' },
    standard: { base: '#A08060', tip: '#705540', burr: '#8B7050' },
    enhanced: { base: '#B8956A', tip: '#7A6045', burr: '#9A7A55' },
  }

  const colors = baseColors[config.realismLevel]

  return {
    baseColor: colors.base,
    tipColor: colors.tip,
    burrColor: colors.burr,
    roughnessBase: 0.72 + (config.realismLevel === 'enhanced' ? 0.05 : 0),
    roughnessTip: 0.55,
    colorVariation: 0.08 + asymmetryScore * 0.04,
  }
}

// ─── Step 6: Assemble Enhanced Params ────────────────────────────────────────

/**
 * Full pipeline: AntlerGeometry → AntlerMeshParams
 * with all Phase 16 enhancements
 */
export function geometryToMeshParams(
  geometry: AntlerGeometry,
  config: RenderConfig = DEFAULT_RENDER_CONFIG
): AntlerMeshParams {
  const g = normalizeGeometry(geometry)
  const halfSpread = g.insideSpread / 2

  // Compute asymmetry offsets for each side
  const beamLengthDiff = (g.mainBeamLeft - g.mainBeamRight) / Math.max(g.mainBeamLeft, g.mainBeamRight)

  const leftBeam = buildBeamCurve(
    g.mainBeamLeft,
    [g.h1Left, g.h2Left, g.h3Left, g.h4Left],
    halfSpread,
    true,
    config,
    beamLengthDiff * 0.5 // Apply half the asymmetry offset
  )

  const rightBeam = buildBeamCurve(
    g.mainBeamRight,
    [g.h1Right, g.h2Right, g.h3Right, g.h4Right],
    halfSpread,
    false,
    config,
    -beamLengthDiff * 0.5 // Opposite asymmetry offset
  )

  const leftTines = buildTineSpecs(
    [
      { name: 'G1', length: g.g1Left },
      { name: 'G2', length: g.g2Left },
      { name: 'G3', length: g.g3Left },
      { name: 'G4', length: g.g4Left },
      { name: 'G5', length: g.g5Left },
    ],
    [g.h1Left, g.h2Left, g.h3Left, g.h4Left],
    true,
    config
  )

  const rightTines = buildTineSpecs(
    [
      { name: 'G1', length: g.g1Right },
      { name: 'G2', length: g.g2Right },
      { name: 'G3', length: g.g3Right },
      { name: 'G4', length: g.g4Right },
      { name: 'G5', length: g.g5Right },
    ],
    [g.h1Right, g.h2Right, g.h3Right, g.h4Right],
    false,
    config
  )

  // Burr specs with enhanced detail
  const burrRadiusLeft = (g.h1Left / (2 * Math.PI)) * IN * 1.8
  const burrRadiusRight = (g.h1Right / (2 * Math.PI)) * IN * 1.8

  const leftBurr: BurrSpec = {
    center: leftBeam.points[0].clone(),
    radius: burrRadiusLeft,
    height: burrRadiusLeft * 0.6,
    textureSeed: 12345,
  }

  const rightBurr: BurrSpec = {
    center: rightBeam.points[0].clone(),
    radius: burrRadiusRight,
    height: burrRadiusRight * 0.6,
    textureSeed: 67890,
  }

  // Optional skull plate for European mount
  const skullPlate = config.mountMode === 'european_mount'
    ? buildSkullPlate(leftBurr.center, rightBurr.center, Math.max(burrRadiusLeft, burrRadiusRight))
    : null

  const materialHints = computeMaterialHints(config, g.asymmetryScore)

  return {
    rendererType: 'parametric_3d',
    leftBeam,
    rightBeam,
    leftTines,
    rightTines,
    leftBurr,
    rightBurr,
    skullPlate,
    skullHalfWidth: 0.55,
    asymmetryFactor: g.asymmetryScore,
    config,
    materialHints,
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

// ─── Enhanced Tube Geometry Builder ──────────────────────────────────────────

/**
 * Build a tapered tube along a CatmullRom curve with variable radii.
 * Creates proper BufferGeometry with smooth radius interpolation.
 */
export function buildBeamTubeGeometry(
  curve: BeamCurve,
  tubularSegments = 48,
  radialSegments = 12
): THREE.BufferGeometry {
  const catmull = new THREE.CatmullRomCurve3(curve.points)
  const path = catmull
  const frames = path.computeFrenetFrames(tubularSegments, false)

  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []

  // Generate vertices with tapered radii
  for (let i = 0; i <= tubularSegments; i++) {
    const t = i / tubularSegments
    const point = path.getPoint(t)
    
    // Interpolate radius at this t position
    const radiusIndex = t * (curve.radii.length - 1)
    const radiusFloor = Math.floor(radiusIndex)
    const radiusCeil = Math.min(curve.radii.length - 1, radiusFloor + 1)
    const radiusBlend = radiusIndex - radiusFloor
    const radius = curve.radii[radiusFloor] * (1 - radiusBlend) + curve.radii[radiusCeil] * radiusBlend

    const N = frames.normals[i]
    const B = frames.binormals[i]

    for (let j = 0; j <= radialSegments; j++) {
      const v = (j / radialSegments) * Math.PI * 2
      const sin = Math.sin(v)
      const cos = Math.cos(v)

      // Position
      const x = point.x + radius * (cos * N.x + sin * B.x)
      const y = point.y + radius * (cos * N.y + sin * B.y)
      const z = point.z + radius * (cos * N.z + sin * B.z)
      positions.push(x, y, z)

      // Normal
      const normal = new THREE.Vector3(cos * N.x + sin * B.x, cos * N.y + sin * B.y, cos * N.z + sin * B.z).normalize()
      normals.push(normal.x, normal.y, normal.z)

      // UV
      uvs.push(j / radialSegments, t)
    }
  }

  // Generate indices
  for (let i = 0; i < tubularSegments; i++) {
    for (let j = 0; j < radialSegments; j++) {
      const a = i * (radialSegments + 1) + j
      const b = (i + 1) * (radialSegments + 1) + j
      const c = (i + 1) * (radialSegments + 1) + (j + 1)
      const d = i * (radialSegments + 1) + (j + 1)

      indices.push(a, b, d)
      indices.push(b, c, d)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)

  return geometry
}

/**
 * Build an enhanced tine geometry with proper base and taper.
 * Uses a tapered cylinder/cone hybrid for natural look.
 */
export function buildTineGeometry(
  spec: TineSpec
): THREE.BufferGeometry {
  const { length, baseRadius, taperFactor } = spec
  
  // Create a tapered cylinder using LatheGeometry for smoother results
  const segments = 8
  const heightSegments = 6
  
  const points: THREE.Vector2[] = []
  
  // Profile curve: wider at base, tapers to point
  for (let i = 0; i <= heightSegments; i++) {
    const t = i / heightSegments
    // Exponential taper for natural look
    const radius = baseRadius * Math.pow(1 - t, taperFactor)
    const y = t * length
    points.push(new THREE.Vector2(Math.max(radius, 0.001), y))
  }
  
  return new THREE.LatheGeometry(points, segments)
}

/**
 * Build a burr (pedicle base) geometry with textured appearance.
 */
export function buildBurrGeometry(
  spec: BurrSpec
): THREE.BufferGeometry {
  // Create a flattened sphere with slight irregularity
  const geometry = new THREE.SphereGeometry(spec.radius, 16, 12)
  
  // Scale to make it slightly flattened (oblate)
  const positions = geometry.attributes.position
  for (let i = 0; i < positions.count; i++) {
    const y = positions.getY(i)
    // Compress vertically
    positions.setY(i, y * 0.7)
  }
  geometry.attributes.position.needsUpdate = true
  geometry.computeVertexNormals()
  
  return geometry
}

/**
 * Build European mount skull plate geometry.
 */
export function buildSkullPlateGeometry(
  spec: SkullPlateSpec
): THREE.BufferGeometry {
  // Simple rounded box for skull plate
  const geometry = new THREE.BoxGeometry(
    spec.width,
    spec.height,
    spec.depth,
    4, 2, 4
  )
  
  // Round the edges by pushing vertices toward a sphere
  const positions = geometry.attributes.position
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i)
    const y = positions.getY(i)
    const z = positions.getZ(i)
    
    // Apply subtle rounding
    const len = Math.sqrt(x * x + z * z)
    if (len > spec.width * 0.4) {
      const factor = 0.92
      positions.setX(i, x * factor)
      positions.setZ(i, z * factor)
    }
  }
  geometry.attributes.position.needsUpdate = true
  geometry.computeVertexNormals()
  
  return geometry
}

/**
 * Sample a point + tangent on a CatmullRom beam at t ∈ [0,1].
 * Enhanced to also return radius at that point.
 */
export function sampleBeamAt(
  curve: BeamCurve,
  t: number
): { position: THREE.Vector3; tangent: THREE.Vector3; radius: number } {
  const catmull = new THREE.CatmullRomCurve3(curve.points)
  
  // Interpolate radius at t
  const radiusIndex = t * (curve.radii.length - 1)
  const radiusFloor = Math.floor(radiusIndex)
  const radiusCeil = Math.min(curve.radii.length - 1, radiusFloor + 1)
  const radiusBlend = radiusIndex - radiusFloor
  const radius = curve.radii[radiusFloor] * (1 - radiusBlend) + curve.radii[radiusCeil] * radiusBlend

  return {
    position: catmull.getPoint(t),
    tangent: catmull.getTangent(t).normalize(),
    radius,
  }
}

// ─── Backward Compatibility ──────────────────────────────────────────────────

/**
 * Ensure older render records without config still work.
 * Merges saved config with defaults.
 */
export function ensureRenderConfig(
  savedConfig?: Partial<RenderConfig> | null
): RenderConfig {
  return {
    ...DEFAULT_RENDER_CONFIG,
    ...(savedConfig || {}),
  }
}
