'use client'

import { create } from 'zustand'
import {
  polylineLength2D,
  polylineLength3D,
  pixelsToInches,
  unitsToInches,
  isFiniteNumber,
} from '@/lib/advanced-scoring/geometry'
import {
  parsePointCloudText,
  pointCloudCoverageWarning,
  createPointCloudIndex,
  findNearestPointCloudAnchorIndexed,
  estimatePointDensityAroundIndexed,
  type PointCloudIndex,
} from '@/lib/advanced-scoring/point-cloud'
import type { PointCloudPoint, MeasurementMethod, AdvancedMeasurement, MeasurementField, CalibrationSource } from '@/lib/advanced-scoring/types'
import type {
  ReconstructionAsset,
  ReconstructionJob,
  ReconstructionJobStatus,
  ReconstructionProvider,
} from '@/lib/reconstruction/types'

// ─── Field definitions ────────────────────────────────────────────────────────

export type FieldId =
  | 'beam-left' | 'beam-right'
  | 'g1-left'   | 'g1-right'
  | 'g2-left'   | 'g2-right'
  | 'g3-left'   | 'g3-right'
  | 'g4-left'   | 'g4-right'
  | 'h1-left'   | 'h1-right'
  | 'h2-left'   | 'h2-right'
  | 'h3-left'   | 'h3-right'
  | 'h4-left'   | 'h4-right'
  | 'spread'

export interface FieldDef {
  id: FieldId
  label: string
  shortLabel: string
  side: 'left' | 'right' | 'n/a'
  type: 'beam' | 'tine' | 'circumference' | 'spread'
  color: string
  pairedWith?: FieldId
  measurementField: MeasurementField
}

export const FIELD_DEFS: FieldDef[] = [
  { id: 'beam-left',  label: 'Main Beam Left',  shortLabel: 'Beam L', side: 'left',  type: 'beam',          color: '#4a90d9', pairedWith: 'beam-right', measurementField: 'main_beam_left'  },
  { id: 'beam-right', label: 'Main Beam Right', shortLabel: 'Beam R', side: 'right', type: 'beam',          color: '#5aa3ec', pairedWith: 'beam-left',  measurementField: 'main_beam_right' },
  { id: 'g1-left',    label: 'G1 Left',         shortLabel: 'G1 L',   side: 'left',  type: 'tine',          color: '#4fc36e', pairedWith: 'g1-right',   measurementField: 'g1_left'  },
  { id: 'g1-right',   label: 'G1 Right',        shortLabel: 'G1 R',   side: 'right', type: 'tine',          color: '#5dd17d', pairedWith: 'g1-left',    measurementField: 'g1_right' },
  { id: 'g2-left',    label: 'G2 Left',         shortLabel: 'G2 L',   side: 'left',  type: 'tine',          color: '#7bc950', pairedWith: 'g2-right',   measurementField: 'g2_left'  },
  { id: 'g2-right',   label: 'G2 Right',        shortLabel: 'G2 R',   side: 'right', type: 'tine',          color: '#8dd660', pairedWith: 'g2-left',    measurementField: 'g2_right' },
  { id: 'g3-left',    label: 'G3 Left',         shortLabel: 'G3 L',   side: 'left',  type: 'tine',          color: '#e0a030', pairedWith: 'g3-right',   measurementField: 'g3_left'  },
  { id: 'g3-right',   label: 'G3 Right',        shortLabel: 'G3 R',   side: 'right', type: 'tine',          color: '#ecb040', pairedWith: 'g3-left',    measurementField: 'g3_right' },
  { id: 'g4-left',    label: 'G4 Left',         shortLabel: 'G4 L',   side: 'left',  type: 'tine',          color: '#d08820', pairedWith: 'g4-right',   measurementField: 'g4_left'  },
  { id: 'g4-right',   label: 'G4 Right',        shortLabel: 'G4 R',   side: 'right', type: 'tine',          color: '#dc9830', pairedWith: 'g4-left',    measurementField: 'g4_right' },
  { id: 'h1-left',    label: 'H1 Left',         shortLabel: 'H1 L',   side: 'left',  type: 'circumference', color: '#d94a4a', pairedWith: 'h1-right',   measurementField: 'h1_left'  },
  { id: 'h1-right',   label: 'H1 Right',        shortLabel: 'H1 R',   side: 'right', type: 'circumference', color: '#e85c5c', pairedWith: 'h1-left',    measurementField: 'h1_right' },
  { id: 'h2-left',    label: 'H2 Left',         shortLabel: 'H2 L',   side: 'left',  type: 'circumference', color: '#c43a3a', pairedWith: 'h2-right',   measurementField: 'h2_left'  },
  { id: 'h2-right',   label: 'H2 Right',        shortLabel: 'H2 R',   side: 'right', type: 'circumference', color: '#d44a4a', pairedWith: 'h2-left',    measurementField: 'h2_right' },
  { id: 'h3-left',    label: 'H3 Left',         shortLabel: 'H3 L',   side: 'left',  type: 'circumference', color: '#b42c2c', pairedWith: 'h3-right',   measurementField: 'h3_left'  },
  { id: 'h3-right',   label: 'H3 Right',        shortLabel: 'H3 R',   side: 'right', type: 'circumference', color: '#c43c3c', pairedWith: 'h3-left',    measurementField: 'h3_right' },
  { id: 'h4-left',    label: 'H4 Left',         shortLabel: 'H4 L',   side: 'left',  type: 'circumference', color: '#a41e1e', pairedWith: 'h4-right',   measurementField: 'h4_left'  },
  { id: 'h4-right',   label: 'H4 Right',        shortLabel: 'H4 R',   side: 'right', type: 'circumference', color: '#b42e2e', pairedWith: 'h4-left',    measurementField: 'h4_right' },
  { id: 'spread',     label: 'Inside Spread',   shortLabel: 'Spread', side: 'n/a',   type: 'spread',        color: '#40c8c8',                            measurementField: 'inside_spread'   },
]

export function getFieldDef(id: FieldId): FieldDef {
  return FIELD_DEFS.find(f => f.id === id)!
}

// ─── Point types ─────────────────────────────────────────────────────────────

export interface Point2D { x: number; y: number }
export interface Point3D { x: number; y: number; z: number }

// ─── Measurement entries ──────────────────────────────────────────────────────

export interface Measurement2D {
  fieldId: FieldId
  points: Point2D[]
  finalized: boolean
  confidence: 'high' | 'medium' | 'low'
  pixelLength: number
  inchLength: number
  /** Warnings accumulated for this measurement (e.g. "Add more points"). */
  warnings: string[]
  /** Method that produced this measurement. */
  method: MeasurementMethod
  /** Where the calibration came from. */
  calibrationSource: CalibrationSource | null
}

export interface Measurement3D {
  fieldId: FieldId
  points: Point3D[]
  finalized: boolean
  confidence: 'high' | 'medium' | 'low'
  inchLength: number
  warnings: string[]
  method: MeasurementMethod
  /** Whether every point was snapped to the point cloud. */
  snappedToPointCloud: boolean
  /** Average point cloud density around measurement points. */
  avgPointDensity: number | null
}

// ─── Calibration ─────────────────────────────────────────────────────────────

export interface CalibrationState {
  linePoints: Point2D[]
  realInches: number
  pixelsPerInch: number
  finalized: boolean
  /** Physical reference = known object measured; estimated = guessed. */
  source: CalibrationSource
}

// ─── Filters / Render ─────────────────────────────────────────────────────────

export type PhotoFilter = 'none' | 'brighten' | 'contrast' | 'sharpen' | 'thermal'
export type RenderMode = 'solid' | 'wireframe' | 'xray' | 'thermal' | 'zones'

// ─── Phase ───────────────────────────────────────────────────────────────────

export type MeasurePhase = 'photo' | '3d' | 'photogrammetry' | 'score'
export type MeasureMode = 'view' | 'calibrate' | 'measure'

// ─── Photogrammetry ──────────────────────────────────────────────────────────

export interface PhotogrammetryCapture {
  angle: string
  imageDataUrl: string | null
  captured: boolean
}

export const CAPTURE_ANGLES = [
  'Front',       'Front-Left',   'Left',        'Rear-Left',
  'Rear',        'Rear-Right',   'Right',       'Front-Right',
  'Top-Down',    'Top-Left',     'Top-Right',   'Low-Angle',
]

// ─── Point cloud state ────────────────────────────────────────────────────────

export interface PointCloudState {
  points: PointCloudPoint[]
  index: PointCloudIndex | null
  loaded: boolean
  filename: string | null
  /** Max snap distance in model units. */
  snapDistance: number
  /** Visual point size for THREE.Points rendering. */
  pointSize: number
  visible: boolean
}

const UNCALIBRATED_2D_WARNING = 'Physical 2D calibration required before inch value is official'
const UNCALIBRATED_3D_WARNING = 'Physical 3D calibration required before inch value is official'
const MESH_FALLBACK_WARNING = 'Mesh fallback measurement - point cloud anchor unavailable'

// ─── Store interface ──────────────────────────────────────────────────────────

export interface MeasureStore {
  phase: MeasurePhase
  setPhase: (p: MeasurePhase) => void

  mode: MeasureMode
  setMode: (m: MeasureMode) => void

  activeField: FieldId | null
  setActiveField: (id: FieldId | null) => void

  // ── Photo (Phase 1) ────────────────────────────────────────────────────────
  photoDataUrl: string | null
  setPhotoDataUrl: (url: string) => void

  calibration: CalibrationState
  setCalibrationPoint: (p: Point2D) => void
  setCalibrationInches: (inches: number) => void
  setCalibrationSource: (source: CalibrationSource) => void
  finalizeCalibration: () => void
  resetCalibration: () => void

  photoFilter: PhotoFilter
  setPhotoFilter: (f: PhotoFilter) => void

  stageScale: number
  stagePos: Point2D
  setStageViewport: (scale: number, pos: Point2D) => void

  measurements2D: Record<FieldId, Measurement2D>
  addPoint2D: (fieldId: FieldId, point: Point2D) => void
  undoPoint2D: (fieldId: FieldId) => void
  removePoint2D: (fieldId: FieldId, index: number) => void
  movePoint2D: (fieldId: FieldId, index: number, point: Point2D) => void
  finalizeField2D: (fieldId: FieldId) => void
  clearField2D: (fieldId: FieldId) => void
  setMeasurementWarning2D: (fieldId: FieldId, warning: string | null) => void

  // ── 3D (Phase 2) ──────────────────────────────────────────────────────────
  glbUrl: string | null
  setGlbUrl: (url: string | null) => void

  renderMode: RenderMode
  setRenderMode: (m: RenderMode) => void

  showZones: boolean
  setShowZones: (v: boolean) => void

  zoneOpacity: number
  setZoneOpacity: (v: number) => void

  showWireframe: boolean
  setShowWireframe: (v: boolean) => void

  crossSectionPoints: Point3D[]
  setCrossSectionPoint: (index: 0 | 1, p: Point3D) => void
  clearCrossSection: () => void

  measurements3D: Record<FieldId, Measurement3D>
  /**
   * Add a 3D point. If a point cloud is loaded, automatically snap to the
   * nearest anchor and record snapping metadata + density warning.
   */
  addPoint3D: (fieldId: FieldId, point: Point3D) => void
  undoPoint3D: (fieldId: FieldId) => void
  finalizeField3D: (fieldId: FieldId) => void
  clearField3D: (fieldId: FieldId) => void
  setMeasurementWarning3D: (fieldId: FieldId, warning: string | null) => void

  // ── Point cloud ──────────────────────────────────────────────────────────
  pointCloud: PointCloudState
  loadPointCloudText: (text: string, filename: string) => void
  clearPointCloud: () => void
  setPointCloudSnapDistance: (d: number) => void
  setPointCloudPointSize: (s: number) => void
  setPointCloudVisible: (v: boolean) => void

  // ── Calibration 3D ────────────────────────────────────────────────────────
  calibration3D: {
    unitsPerInch: number
    source: CalibrationSource
    finalized: boolean
  }
  setCalibration3D: (unitsPerInch: number, source: CalibrationSource) => void

  // ── Photogrammetry (Phase 3) ───────────────────────────────────────────────
  captures: PhotogrammetryCapture[]
  setCaptureImage: (angleIndex: number, dataUrl: string) => void
  polycamJobId: string | null
  setPolycamJobId: (id: string | null) => void
  polycamStatus: 'idle' | 'uploading' | 'processing' | 'complete' | 'error'
  setPolycamStatus: (s: MeasureStore['polycamStatus']) => void

  // New reconstruction state is provider-neutral. The older polycam fields
  // remain only as compatibility aliases for any legacy callers.
  reconstructionJob: ReconstructionJob | null
  reconstructionProvider: ReconstructionProvider
  reconstructionStatus: ReconstructionJobStatus
  reconstructionProgress: number
  reconstructionMessage: string | null
  reconstructionAssets: ReconstructionAsset[]
  reconstructionError: string | null
  setReconstructionJob: (job: ReconstructionJob | null) => void
  setReconstructionStatus: (status: ReconstructionJobStatus, progress?: number, message?: string | null) => void
  setReconstructionAssets: (assets: ReconstructionAsset[]) => void
  setReconstructionError: (error: string | null) => void
  resetReconstruction: () => void
  attachReconstructionAsset: (asset: ReconstructionAsset) => void

  // ── Derived session values (computed on demand, not in render) ─────────────
  /** Returns all AdvancedMeasurement objects computed from current state. */
  getAdvancedMeasurements: () => AdvancedMeasurement[]

  // ── Reset ─────────────────────────────────────────────────────────────────
  resetSession: () => void
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function emptyMeasurement2D(fieldId: FieldId): Measurement2D {
  return {
    fieldId, points: [], finalized: false, confidence: 'medium',
    pixelLength: 0, inchLength: 0, warnings: [],
    method: 'photo_polyline', calibrationSource: null,
  }
}

function emptyMeasurement3D(fieldId: FieldId): Measurement3D {
  return {
    fieldId, points: [], finalized: false, confidence: 'medium',
    inchLength: 0, warnings: [], method: 'three_d_mesh_fallback',
    snappedToPointCloud: false, avgPointDensity: null,
  }
}

function buildEmpty2D(): Record<FieldId, Measurement2D> {
  return Object.fromEntries(FIELD_DEFS.map(f => [f.id, emptyMeasurement2D(f.id)])) as Record<FieldId, Measurement2D>
}

function buildEmpty3D(): Record<FieldId, Measurement3D> {
  return Object.fromEntries(FIELD_DEFS.map(f => [f.id, emptyMeasurement3D(f.id)])) as Record<FieldId, Measurement3D>
}

function buildCaptures(): PhotogrammetryCapture[] {
  return CAPTURE_ANGLES.map(angle => ({ angle, imageDataUrl: null, captured: false }))
}

function defaultCalibration(): CalibrationState {
  return { linePoints: [], realInches: 12, pixelsPerInch: 1, finalized: false, source: 'estimated' }
}

function defaultPointCloud(): PointCloudState {
  return { points: [], index: null, loaded: false, filename: null, snapDistance: 0.01, pointSize: 0.003, visible: true }
}

function defaultCalibration3D() {
  return { unitsPerInch: 1, source: 'estimated' as CalibrationSource, finalized: false }
}

function defaultReconstructionState(): Pick<
  MeasureStore,
  | 'reconstructionJob'
  | 'reconstructionProvider'
  | 'reconstructionStatus'
  | 'reconstructionProgress'
  | 'reconstructionMessage'
  | 'reconstructionAssets'
  | 'reconstructionError'
> {
  return {
    reconstructionJob: null,
    reconstructionProvider: 'manual',
    reconstructionStatus: 'idle',
    reconstructionProgress: 0,
    reconstructionMessage: null,
    reconstructionAssets: [],
    reconstructionError: null,
  }
}

/** Recompute confidence tier from calibration and warning state. */
function computeConf2D(
  calibrated: boolean,
  calibSource: CalibrationSource | null,
  warnings: string[],
): Measurement2D['confidence'] {
  if (!calibrated || calibSource !== 'physical_reference') return 'medium'
  if (warnings.length > 0) return 'medium'
  return 'high'
}

function mergeWarning(warnings: string[], warning: string): string[] {
  return warnings.includes(warning) ? warnings : [...warnings, warning]
}

function withoutWarning(warnings: string[], warning: string): string[] {
  return warnings.filter((item) => item !== warning)
}

function calibrationAware2DLength(pixelLength: number, calibration: CalibrationState): {
  inchLength: number
  calibrationSource: CalibrationSource | null
} {
  if (!calibration.finalized) return { inchLength: 0, calibrationSource: null }
  return {
    inchLength: pixelsToInches(pixelLength, calibration.pixelsPerInch) ?? 0,
    calibrationSource: calibration.source,
  }
}

function calibrationAware3DLength(unitLength: number, calibration3D: MeasureStore['calibration3D']): number {
  if (!calibration3D.finalized) return 0
  return unitsToInches(unitLength, calibration3D.unitsPerInch) ?? 0
}

// ─── Store creation ───────────────────────────────────────────────────────────

export const useMeasureStore = create<MeasureStore>()((set, get) => ({
  phase: 'photo',
  setPhase: (p) => set({ phase: p }),

  mode: 'view',
  setMode: (m) => set({ mode: m }),

  activeField: null,
  setActiveField: (id) => set({ activeField: id, mode: id ? 'measure' : 'view' }),

  // ── Photo ──────────────────────────────────────────────────────────────────
  photoDataUrl: null,
  setPhotoDataUrl: (url) => set({
    photoDataUrl: url,
    calibration: defaultCalibration(),
    measurements2D: buildEmpty2D(),
    stageScale: 1,
    stagePos: { x: 0, y: 0 },
  }),

  calibration: defaultCalibration(),

  setCalibrationPoint: (p) => set((s) => {
    const pts = s.calibration.linePoints
    const next = pts.length < 2 ? [...pts, p] : [p]
    return { calibration: { ...s.calibration, linePoints: next } }
  }),

  setCalibrationInches: (inches) => set((s) => ({
    calibration: { ...s.calibration, realInches: inches },
  })),

  setCalibrationSource: (source) => set((s) => ({
    calibration: { ...s.calibration, source },
  })),

  finalizeCalibration: () => set((s) => {
    const pts = s.calibration.linePoints
    if (pts.length < 2) return {}
    const dx = pts[1].x - pts[0].x
    const dy = pts[1].y - pts[0].y
    const px = Math.sqrt(dx * dx + dy * dy)
    const realIn = s.calibration.realInches
    if (!isFiniteNumber(realIn) || realIn <= 0 || px <= 0) return {}
    const ppi = px / realIn

    const src: CalibrationSource = 'physical_reference'

    // Recompute inch lengths for any existing 2D measurements
    const measurements2D = { ...s.measurements2D }
    for (const fd of FIELD_DEFS) {
      const m = measurements2D[fd.id]
      const pl = polylineLength2D(m.points)
      const il = pixelsToInches(pl, ppi) ?? 0
      const warnings = withoutWarning(m.warnings, UNCALIBRATED_2D_WARNING)
      measurements2D[fd.id] = {
        ...m,
        pixelLength: pl,
        inchLength: il,
        warnings,
        calibrationSource: src,
        confidence: computeConf2D(true, src, warnings),
      }
    }

    return {
      calibration: { ...s.calibration, pixelsPerInch: ppi, finalized: true, source: src },
      measurements2D,
      mode: 'view' as MeasureMode,
    }
  }),

  resetCalibration: () => set((s) => {
    const measurements2D = { ...s.measurements2D }
    for (const fd of FIELD_DEFS) {
      const m = measurements2D[fd.id]
      const warnings = m.points.length >= 2
        ? mergeWarning(m.warnings, UNCALIBRATED_2D_WARNING)
        : withoutWarning(m.warnings, UNCALIBRATED_2D_WARNING)
      measurements2D[fd.id] = {
        ...m,
        inchLength: 0,
        warnings,
        calibrationSource: null,
        confidence: computeConf2D(false, null, warnings),
      }
    }
    return { calibration: defaultCalibration(), measurements2D }
  }),

  photoFilter: 'none',
  setPhotoFilter: (f) => set({ photoFilter: f }),

  stageScale: 1,
  stagePos: { x: 0, y: 0 },
  setStageViewport: (scale, pos) => set({ stageScale: scale, stagePos: pos }),

  measurements2D: buildEmpty2D(),

  addPoint2D: (fieldId, point) => set((s) => {
    const m = s.measurements2D[fieldId]
    if (m.finalized) return {}
    const points = [...m.points, point]
    const pixelLength = polylineLength2D(points)
    const { inchLength, calibrationSource: src } = calibrationAware2DLength(pixelLength, s.calibration)
    const warnings = s.calibration.finalized
      ? withoutWarning(m.warnings, UNCALIBRATED_2D_WARNING)
      : points.length >= 2
        ? mergeWarning(m.warnings, UNCALIBRATED_2D_WARNING)
        : m.warnings
    return {
      measurements2D: {
        ...s.measurements2D,
        [fieldId]: {
          ...m, points, pixelLength, inchLength,
          warnings,
          calibrationSource: src,
          confidence: computeConf2D(s.calibration.finalized, src, warnings),
        },
      },
    }
  }),

  undoPoint2D: (fieldId) => set((s) => {
    const m = s.measurements2D[fieldId]
    if (m.points.length === 0) return {}
    const points = m.points.slice(0, -1)
    const pixelLength = polylineLength2D(points)
    const { inchLength, calibrationSource: src } = calibrationAware2DLength(pixelLength, s.calibration)
    const warnings = s.calibration.finalized || points.length < 2
      ? withoutWarning(m.warnings, UNCALIBRATED_2D_WARNING)
      : mergeWarning(m.warnings, UNCALIBRATED_2D_WARNING)
    return {
      measurements2D: {
        ...s.measurements2D,
        [fieldId]: {
          ...m,
          points,
          pixelLength,
          inchLength,
          warnings,
          calibrationSource: src,
          confidence: computeConf2D(s.calibration.finalized, src, warnings),
        },
      },
    }
  }),

  removePoint2D: (fieldId, index) => set((s) => {
    const m = s.measurements2D[fieldId]
    const points = m.points.filter((_, i) => i !== index)
    const pixelLength = polylineLength2D(points)
    const { inchLength, calibrationSource: src } = calibrationAware2DLength(pixelLength, s.calibration)
    const warnings = s.calibration.finalized || points.length < 2
      ? withoutWarning(m.warnings, UNCALIBRATED_2D_WARNING)
      : mergeWarning(m.warnings, UNCALIBRATED_2D_WARNING)
    return {
      measurements2D: {
        ...s.measurements2D,
        [fieldId]: {
          ...m,
          points,
          pixelLength,
          inchLength,
          warnings,
          calibrationSource: src,
          confidence: computeConf2D(s.calibration.finalized, src, warnings),
        },
      },
    }
  }),

  movePoint2D: (fieldId, index, point) => set((s) => {
    const m = s.measurements2D[fieldId]
    const points = m.points.map((p, i) => (i === index ? point : p))
    const pixelLength = polylineLength2D(points)
    const { inchLength, calibrationSource: src } = calibrationAware2DLength(pixelLength, s.calibration)
    const warnings = s.calibration.finalized
      ? withoutWarning(m.warnings, UNCALIBRATED_2D_WARNING)
      : points.length >= 2
        ? mergeWarning(m.warnings, UNCALIBRATED_2D_WARNING)
        : m.warnings
    return {
      measurements2D: {
        ...s.measurements2D,
        [fieldId]: {
          ...m,
          points,
          pixelLength,
          inchLength,
          warnings,
          calibrationSource: src,
          confidence: computeConf2D(s.calibration.finalized, src, warnings),
        },
      },
    }
  }),

  finalizeField2D: (fieldId) => set((s) => ({
    measurements2D: {
      ...s.measurements2D,
      [fieldId]: { ...s.measurements2D[fieldId], finalized: true },
    },
    activeField: null,
    mode: 'view' as MeasureMode,
  })),

  clearField2D: (fieldId) => set((s) => ({
    measurements2D: { ...s.measurements2D, [fieldId]: emptyMeasurement2D(fieldId) },
  })),

  setMeasurementWarning2D: (fieldId, warning) => set((s) => {
    const m = s.measurements2D[fieldId]
    const warnings = warning
      ? m.warnings.includes(warning) ? m.warnings : [...m.warnings, warning]
      : m.warnings.filter((item) => item === UNCALIBRATED_2D_WARNING)
    if (warnings.length === m.warnings.length && warnings.every((item, index) => item === m.warnings[index])) {
      return {}
    }
    return {
      measurements2D: {
        ...s.measurements2D,
        [fieldId]: { ...m, warnings },
      },
    }
  }),

  // ── 3D ────────────────────────────────────────────────────────────────────
  glbUrl: null,
  setGlbUrl: (url) => set({ glbUrl: url }),

  renderMode: 'solid',
  setRenderMode: (m) => set({ renderMode: m }),

  showZones: false,
  setShowZones: (v) => set({ showZones: v }),

  zoneOpacity: 0.45,
  setZoneOpacity: (v) => set({ zoneOpacity: v }),

  showWireframe: false,
  setShowWireframe: (v) => set({ showWireframe: v }),

  crossSectionPoints: [],
  setCrossSectionPoint: (index, p) => set((s) => {
    const next = [...s.crossSectionPoints] as Point3D[]
    next[index] = p
    return { crossSectionPoints: next }
  }),
  clearCrossSection: () => set({ crossSectionPoints: [] }),

  measurements3D: buildEmpty3D(),

  addPoint3D: (fieldId, rawPoint) => set((s) => {
    const m = s.measurements3D[fieldId]
    if (m.finalized) return {}

    const cloudPoints = s.pointCloud.points
    const cloudIndex = s.pointCloud.index
    const snapDist = s.pointCloud.snapDistance
    let point = rawPoint
    let snappedToPointCloud = false
    let density: number | null = null
    const warnings = [...m.warnings]

    if (cloudPoints.length > 0) {
      const anchor = findNearestPointCloudAnchorIndexed(rawPoint, cloudIndex, snapDist)
      if (anchor) {
        point = { x: anchor.x, y: anchor.y, z: anchor.z }
        snappedToPointCloud = true
        density = estimatePointDensityAroundIndexed(point, cloudIndex, snapDist * 3)
        const densityWarning = pointCloudCoverageWarning(density)
        if (densityWarning && !warnings.includes(densityWarning)) {
          warnings.push(densityWarning)
        }
      }
    }

    const points = [...m.points, point]
    const rawLength = polylineLength3D(points)
    const inchLength = calibrationAware3DLength(rawLength, s.calibration3D)

    // Method: if point cloud exists and snapped, use point_cloud; else mesh_fallback
    const method: MeasurementMethod =
      cloudPoints.length > 0 && snappedToPointCloud
        ? 'three_d_point_cloud'
        : 'three_d_mesh_fallback'

    if (method === 'three_d_mesh_fallback') {
      if (!warnings.includes(MESH_FALLBACK_WARNING)) warnings.push(MESH_FALLBACK_WARNING)
    }
    if (!s.calibration3D.finalized && points.length >= 2) {
      if (!warnings.includes(UNCALIBRATED_3D_WARNING)) warnings.push(UNCALIBRATED_3D_WARNING)
    } else if (s.calibration3D.finalized) {
      const calibrationWarningIndex = warnings.indexOf(UNCALIBRATED_3D_WARNING)
      if (calibrationWarningIndex >= 0) warnings.splice(calibrationWarningIndex, 1)
    }

    // Confidence
    const conf: Measurement3D['confidence'] =
      method === 'three_d_point_cloud' && s.calibration3D.finalized && s.calibration3D.source === 'physical_reference'
        ? 'high'
        : method === 'three_d_point_cloud'
          ? 'medium'
          : 'low'

    // Average density across all points
    let avgDensity = density
    if (m.avgPointDensity !== null && density !== null) {
      avgDensity = (m.avgPointDensity * m.points.length + density) / points.length
    }

    return {
      measurements3D: {
        ...s.measurements3D,
        [fieldId]: {
          ...m, points, inchLength, warnings, method,
          confidence: conf,
          snappedToPointCloud: points.length === 1 ? snappedToPointCloud : m.snappedToPointCloud && snappedToPointCloud,
          avgPointDensity: avgDensity,
        },
      },
    }
  }),

  undoPoint3D: (fieldId) => set((s) => {
    const m = s.measurements3D[fieldId]
    if (m.points.length === 0) return {}
    const points = m.points.slice(0, -1)
    const unitLength = polylineLength3D(points)
    const inchLength = calibrationAware3DLength(unitLength, s.calibration3D)
    const warnings = points.length >= 2 && !s.calibration3D.finalized
      ? mergeWarning(m.warnings, UNCALIBRATED_3D_WARNING)
      : withoutWarning(m.warnings, UNCALIBRATED_3D_WARNING)
    return {
      measurements3D: {
        ...s.measurements3D,
        [fieldId]: { ...m, points, inchLength, warnings },
      },
    }
  }),

  finalizeField3D: (fieldId) => set((s) => ({
    measurements3D: {
      ...s.measurements3D,
      [fieldId]: { ...s.measurements3D[fieldId], finalized: true },
    },
    activeField: null,
    mode: 'view' as MeasureMode,
  })),

  clearField3D: (fieldId) => set((s) => ({
    measurements3D: { ...s.measurements3D, [fieldId]: emptyMeasurement3D(fieldId) },
  })),

  setMeasurementWarning3D: (fieldId, warning) => set((s) => {
    const m = s.measurements3D[fieldId]
    const warnings = warning
      ? m.warnings.includes(warning) ? m.warnings : [...m.warnings, warning]
      : m.warnings.filter((item) => item === UNCALIBRATED_3D_WARNING || item === MESH_FALLBACK_WARNING)
    if (warnings.length === m.warnings.length && warnings.every((item, index) => item === m.warnings[index])) {
      return {}
    }
    return {
      measurements3D: {
        ...s.measurements3D,
        [fieldId]: { ...m, warnings },
      },
    }
  }),

  // ── Point cloud ───────────────────────────────────────────────────────────
  pointCloud: defaultPointCloud(),

  loadPointCloudText: (text, filename) => set(() => {
    const points = parsePointCloudText(text)
    const snapDistance = defaultPointCloud().snapDistance
    return {
      pointCloud: {
        ...defaultPointCloud(),
        points,
        index: points.length > 0 ? createPointCloudIndex(points, snapDistance) : null,
        loaded: points.length > 0,
        filename,
      },
    }
  }),

  clearPointCloud: () => set({ pointCloud: defaultPointCloud() }),

  setPointCloudSnapDistance: (d) => set((s) => {
    const snapDistance = isFiniteNumber(d) && d > 0 ? d : s.pointCloud.snapDistance
    return {
      pointCloud: {
        ...s.pointCloud,
        snapDistance,
        index: s.pointCloud.points.length > 0
          ? createPointCloudIndex(s.pointCloud.points, snapDistance)
          : null,
      },
    }
  }),

  setPointCloudPointSize: (size) => set((s) => ({
    pointCloud: { ...s.pointCloud, pointSize: size },
  })),

  setPointCloudVisible: (v) => set((s) => ({
    pointCloud: { ...s.pointCloud, visible: v },
  })),

  // ── Calibration 3D ────────────────────────────────────────────────────────
  calibration3D: defaultCalibration3D(),

  setCalibration3D: (unitsPerInch, source) => set((s) => {
    if (!isFiniteNumber(unitsPerInch) || unitsPerInch <= 0) {
      return { calibration3D: defaultCalibration3D() }
    }

    const calibration3D = { unitsPerInch, source, finalized: true }
    const measurements3D = { ...s.measurements3D }

    for (const fd of FIELD_DEFS) {
      const m = measurements3D[fd.id]
      const inchLength = calibrationAware3DLength(polylineLength3D(m.points), calibration3D)
      const warnings = withoutWarning(m.warnings, UNCALIBRATED_3D_WARNING)
      measurements3D[fd.id] = {
        ...m,
        inchLength,
        warnings,
        confidence:
          m.method === 'three_d_point_cloud' && source === 'physical_reference'
            ? 'high'
            : m.method === 'three_d_point_cloud'
              ? 'medium'
              : 'low',
      }
    }

    return { calibration3D, measurements3D }
  }),

  // ── Photogrammetry ────────────────────────────────────────────────────────
  captures: buildCaptures(),
  setCaptureImage: (angleIndex, dataUrl) => set((s) => {
    const next = s.captures.map((c, i) =>
      i === angleIndex ? { ...c, imageDataUrl: dataUrl, captured: true } : c
    )
    return { captures: next }
  }),
  polycamJobId: null,
  setPolycamJobId: (id) => set({ polycamJobId: id }),
  polycamStatus: 'idle',
  setPolycamStatus: (st) => set({ polycamStatus: st }),

  ...defaultReconstructionState(),
  setReconstructionJob: (job) => set({
    reconstructionJob: job,
    reconstructionProvider: job?.provider ?? 'manual',
    reconstructionStatus: job?.status ?? 'idle',
    reconstructionProgress: job?.progress ?? 0,
    reconstructionMessage: job?.message ?? null,
    reconstructionAssets: job?.assets ?? [],
    reconstructionError: job?.error ?? null,
    polycamJobId: job?.externalJobId ?? null,
    polycamStatus:
      job?.status === 'completed'
        ? 'complete'
        : job?.status === 'failed' || job?.status === 'cancelled'
          ? 'error'
          : job?.status === 'queued' || job?.status === 'uploading' || job?.status === 'processing'
            ? 'processing'
            : 'idle',
  }),
  setReconstructionStatus: (status, progress, message) => set((s) => {
    const safeProgress = typeof progress === 'number' && Number.isFinite(progress)
      ? Math.max(0, Math.min(100, progress))
      : s.reconstructionProgress
    return {
      reconstructionStatus: status,
      reconstructionProgress: safeProgress,
      reconstructionMessage: message === undefined ? s.reconstructionMessage : message,
      reconstructionJob: s.reconstructionJob
        ? {
            ...s.reconstructionJob,
            status,
            progress: safeProgress,
            message: message === undefined ? s.reconstructionJob.message : message,
            updatedAt: new Date().toISOString(),
          }
        : null,
      polycamStatus:
        status === 'completed'
          ? 'complete'
          : status === 'failed' || status === 'cancelled'
            ? 'error'
            : status === 'queued' || status === 'uploading' || status === 'processing'
              ? 'processing'
              : 'idle',
    }
  }),
  setReconstructionAssets: (assets) => set((s) => ({
    reconstructionAssets: assets,
    reconstructionJob: s.reconstructionJob
      ? { ...s.reconstructionJob, assets, updatedAt: new Date().toISOString() }
      : s.reconstructionJob,
  })),
  setReconstructionError: (error) => set((s) => ({
    reconstructionError: error,
    reconstructionJob: s.reconstructionJob
      ? { ...s.reconstructionJob, error, updatedAt: new Date().toISOString() }
      : s.reconstructionJob,
  })),
  resetReconstruction: () => set({
    ...defaultReconstructionState(),
    polycamJobId: null,
    polycamStatus: 'idle',
  }),
  attachReconstructionAsset: (asset) => set((s) => {
    const assets = s.reconstructionAssets.some((existing) =>
      existing.id === asset.id || existing.url === asset.url
    )
      ? s.reconstructionAssets.map((existing) =>
          existing.id === asset.id || existing.url === asset.url ? { ...existing, ...asset } : existing
        )
      : [...s.reconstructionAssets, asset]

    return {
      reconstructionAssets: assets,
      reconstructionJob: s.reconstructionJob
        ? { ...s.reconstructionJob, assets, updatedAt: new Date().toISOString() }
        : s.reconstructionJob,
    }
  }),

  // ── Derived measurements ──────────────────────────────────────────────────
  getAdvancedMeasurements: () => {
    const s = get()
    const result: AdvancedMeasurement[] = []

    for (const fd of FIELD_DEFS) {
      const m2 = s.measurements2D[fd.id]
      const m3 = s.measurements3D[fd.id]

      if (m2.points.length >= 2) {
        result.push({
          id: `photo-${fd.id}`,
          field: fd.measurementField,
          method: 'photo_polyline',
          photoId: 'primary',
          points2D: m2.points,
          lengthInches: m2.inchLength > 0 ? m2.inchLength : null,
          confidence: m2.confidence === 'high' ? 0.9 : m2.confidence === 'medium' ? 0.65 : 0.35,
          warnings: m2.warnings,
          provenance: {
            origin: 'human',
            visibility: m2.finalized ? 'corrected' : 'visible',
            source: 'photo_polyline',
            calibrationSource: m2.calibrationSource,
          },
        })
      }

      if (m3.points.length >= 2) {
        result.push({
          id: `3d-${fd.id}`,
          field: fd.measurementField,
          method: m3.method,
          points3D: m3.points,
          lengthInches: m3.inchLength > 0 ? m3.inchLength : null,
          confidence: m3.confidence === 'high' ? 0.9 : m3.confidence === 'medium' ? 0.65 : 0.35,
          warnings: m3.warnings,
          provenance: {
            origin: 'human',
            visibility: m3.method === 'three_d_mesh_fallback'
              ? 'inferred'
              : m3.finalized
                ? 'corrected'
                : 'visible',
            source: m3.method,
            snappedToPointCloud: m3.snappedToPointCloud,
            pointCloudDensity: m3.avgPointDensity,
            calibrationSource: s.calibration3D.finalized ? s.calibration3D.source : null,
          },
        })
      }
    }

    return result
  },

  // ── Reset ─────────────────────────────────────────────────────────────────
  resetSession: () => set({
    photoDataUrl: null,
    calibration: defaultCalibration(),
    measurements2D: buildEmpty2D(),
    measurements3D: buildEmpty3D(),
    glbUrl: null,
    captures: buildCaptures(),
    polycamJobId: null,
    polycamStatus: 'idle',
    ...defaultReconstructionState(),
    activeField: null,
    mode: 'view',
    phase: 'photo',
    stageScale: 1,
    stagePos: { x: 0, y: 0 },
    showZones: false,
    zoneOpacity: 0.45,
    showWireframe: false,
    crossSectionPoints: [],
    pointCloud: defaultPointCloud(),
    calibration3D: defaultCalibration3D(),
  }),
}))
