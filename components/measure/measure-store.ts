'use client'

import { create } from 'zustand'

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
}

export const FIELD_DEFS: FieldDef[] = [
  { id: 'beam-left',  label: 'Main Beam Left',  shortLabel: 'Beam L', side: 'left',  type: 'beam',          color: '#4a90d9', pairedWith: 'beam-right' },
  { id: 'beam-right', label: 'Main Beam Right', shortLabel: 'Beam R', side: 'right', type: 'beam',          color: '#5aa3ec', pairedWith: 'beam-left' },
  { id: 'g1-left',    label: 'G1 Left',         shortLabel: 'G1 L',   side: 'left',  type: 'tine',          color: '#4fc36e', pairedWith: 'g1-right' },
  { id: 'g1-right',   label: 'G1 Right',        shortLabel: 'G1 R',   side: 'right', type: 'tine',          color: '#5dd17d', pairedWith: 'g1-left' },
  { id: 'g2-left',    label: 'G2 Left',         shortLabel: 'G2 L',   side: 'left',  type: 'tine',          color: '#7bc950', pairedWith: 'g2-right' },
  { id: 'g2-right',   label: 'G2 Right',        shortLabel: 'G2 R',   side: 'right', type: 'tine',          color: '#8dd660', pairedWith: 'g2-left' },
  { id: 'g3-left',    label: 'G3 Left',         shortLabel: 'G3 L',   side: 'left',  type: 'tine',          color: '#e0a030', pairedWith: 'g3-right' },
  { id: 'g3-right',   label: 'G3 Right',        shortLabel: 'G3 R',   side: 'right', type: 'tine',          color: '#ecb040', pairedWith: 'g3-left' },
  { id: 'g4-left',    label: 'G4 Left',         shortLabel: 'G4 L',   side: 'left',  type: 'tine',          color: '#d08820', pairedWith: 'g4-right' },
  { id: 'g4-right',   label: 'G4 Right',        shortLabel: 'G4 R',   side: 'right', type: 'tine',          color: '#dc9830', pairedWith: 'g4-left' },
  { id: 'h1-left',    label: 'H1 Left',         shortLabel: 'H1 L',   side: 'left',  type: 'circumference', color: '#d94a4a', pairedWith: 'h1-right' },
  { id: 'h1-right',   label: 'H1 Right',        shortLabel: 'H1 R',   side: 'right', type: 'circumference', color: '#e85c5c', pairedWith: 'h1-left' },
  { id: 'h2-left',    label: 'H2 Left',         shortLabel: 'H2 L',   side: 'left',  type: 'circumference', color: '#c43a3a', pairedWith: 'h2-right' },
  { id: 'h2-right',   label: 'H2 Right',        shortLabel: 'H2 R',   side: 'right', type: 'circumference', color: '#d44a4a', pairedWith: 'h2-left' },
  { id: 'h3-left',    label: 'H3 Left',         shortLabel: 'H3 L',   side: 'left',  type: 'circumference', color: '#b42c2c', pairedWith: 'h3-right' },
  { id: 'h3-right',   label: 'H3 Right',        shortLabel: 'H3 R',   side: 'right', type: 'circumference', color: '#c43c3c', pairedWith: 'h3-left' },
  { id: 'h4-left',    label: 'H4 Left',         shortLabel: 'H4 L',   side: 'left',  type: 'circumference', color: '#a41e1e', pairedWith: 'h4-right' },
  { id: 'h4-right',   label: 'H4 Right',        shortLabel: 'H4 R',   side: 'right', type: 'circumference', color: '#b42e2e', pairedWith: 'h4-left' },
  { id: 'spread',     label: 'Inside Spread',   shortLabel: 'Spread', side: 'n/a',   type: 'spread',        color: '#40c8c8' },
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
}

export interface Measurement3D {
  fieldId: FieldId
  points: Point3D[]
  finalized: boolean
  confidence: 'high' | 'medium' | 'low'
  inchLength: number
}

// ─── Calibration ─────────────────────────────────────────────────────────────

export interface CalibrationState {
  linePoints: Point2D[]
  realInches: number
  pixelsPerInch: number
  finalized: boolean
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

  // ── 3D (Phase 2) ──────────────────────────────────────────────────────────
  glbUrl: string | null
  setGlbUrl: (url: string | null) => void

  renderMode: RenderMode
  setRenderMode: (m: RenderMode) => void

  /** Whether the zone-color overlay is drawn on top of the solid mesh */
  showZones: boolean
  setShowZones: (v: boolean) => void

  /** Opacity of the zone overlay (0–1) */
  zoneOpacity: number
  setZoneOpacity: (v: number) => void

  /** Whether an edge-based wireframe is overlaid on the solid mesh */
  showWireframe: boolean
  setShowWireframe: (v: boolean) => void

  /** Two points defining the cross-section plane for circumference slicing */
  crossSectionPoints: Point3D[]
  setCrossSectionPoint: (index: 0 | 1, p: Point3D) => void
  clearCrossSection: () => void

  measurements3D: Record<FieldId, Measurement3D>
  addPoint3D: (fieldId: FieldId, point: Point3D) => void
  undoPoint3D: (fieldId: FieldId) => void
  finalizeField3D: (fieldId: FieldId) => void
  clearField3D: (fieldId: FieldId) => void

  // ── Photogrammetry (Phase 3) ───────────────────────────────────────────────
  captures: PhotogrammetryCapture[]
  setCaptureImage: (angleIndex: number, dataUrl: string) => void
  polycamJobId: string | null
  setPolycamJobId: (id: string | null) => void
  polycamStatus: 'idle' | 'uploading' | 'processing' | 'complete' | 'error'
  setPolycamStatus: (s: MeasureStore['polycamStatus']) => void

  // ── Reset ─────────────────────────────────────────────────────────────────
  resetSession: () => void
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function polylinePixelLength(points: Point2D[]): number {
  let total = 0
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x
    const dy = points[i].y - points[i - 1].y
    total += Math.sqrt(dx * dx + dy * dy)
  }
  return total
}

function polyline3DLength(points: Point3D[]): number {
  let total = 0
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x
    const dy = points[i].y - points[i - 1].y
    const dz = points[i].z - points[i - 1].z
    total += Math.sqrt(dx * dx + dy * dy + dz * dz)
  }
  return total
}

function emptyMeasurement2D(fieldId: FieldId): Measurement2D {
  return { fieldId, points: [], finalized: false, confidence: 'medium', pixelLength: 0, inchLength: 0 }
}

function emptyMeasurement3D(fieldId: FieldId): Measurement3D {
  return { fieldId, points: [], finalized: false, confidence: 'medium', inchLength: 0 }
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
  return { linePoints: [], realInches: 12, pixelsPerInch: 1, finalized: false }
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
  setPhotoDataUrl: (url) => set({ photoDataUrl: url }),

  calibration: defaultCalibration(),
  setCalibrationPoint: (p) => set((s) => {
    const pts = s.calibration.linePoints
    const next = pts.length < 2 ? [...pts, p] : [p]
    return { calibration: { ...s.calibration, linePoints: next } }
  }),
  setCalibrationInches: (inches) => set((s) => ({
    calibration: { ...s.calibration, realInches: inches },
  })),
  finalizeCalibration: () => set((s) => {
    const pts = s.calibration.linePoints
    if (pts.length < 2) return {}
    const dx = pts[1].x - pts[0].x
    const dy = pts[1].y - pts[0].y
    const px = Math.sqrt(dx * dx + dy * dy)
    const ppi = px / (s.calibration.realInches || 12)
    return {
      calibration: { ...s.calibration, pixelsPerInch: ppi, finalized: true },
      mode: 'view' as MeasureMode,
    }
  }),
  resetCalibration: () => set({ calibration: defaultCalibration() }),

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
    const pixelLength = polylinePixelLength(points)
    const ppi = s.calibration.pixelsPerInch
    const inchLength = ppi > 0 ? pixelLength / ppi : 0
    return {
      measurements2D: {
        ...s.measurements2D,
        [fieldId]: { ...m, points, pixelLength, inchLength, confidence: s.calibration.finalized ? 'high' : 'medium' },
      },
    }
  }),
  undoPoint2D: (fieldId) => set((s) => {
    const m = s.measurements2D[fieldId]
    if (m.points.length === 0) return {}
    const points = m.points.slice(0, -1)
    const pixelLength = polylinePixelLength(points)
    const ppi = s.calibration.pixelsPerInch
    return {
      measurements2D: {
        ...s.measurements2D,
        [fieldId]: { ...m, points, pixelLength, inchLength: ppi > 0 ? pixelLength / ppi : 0 },
      },
    }
  }),
  removePoint2D: (fieldId, index) => set((s) => {
    const m = s.measurements2D[fieldId]
    const points = m.points.filter((_, i) => i !== index)
    const pixelLength = polylinePixelLength(points)
    const ppi = s.calibration.pixelsPerInch
    return {
      measurements2D: {
        ...s.measurements2D,
        [fieldId]: { ...m, points, pixelLength, inchLength: ppi > 0 ? pixelLength / ppi : 0 },
      },
    }
  }),
  movePoint2D: (fieldId, index, point) => set((s) => {
    const m = s.measurements2D[fieldId]
    const points = m.points.map((p, i) => (i === index ? point : p))
    const pixelLength = polylinePixelLength(points)
    const ppi = s.calibration.pixelsPerInch
    return {
      measurements2D: {
        ...s.measurements2D,
        [fieldId]: { ...m, points, pixelLength, inchLength: ppi > 0 ? pixelLength / ppi : 0 },
      },
    }
  }),
  finalizeField2D: (fieldId) => set((s) => ({
    measurements2D: { ...s.measurements2D, [fieldId]: { ...s.measurements2D[fieldId], finalized: true } },
    activeField: null,
    mode: 'view' as MeasureMode,
  })),
  clearField2D: (fieldId) => set((s) => ({
    measurements2D: { ...s.measurements2D, [fieldId]: emptyMeasurement2D(fieldId) },
  })),

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
  addPoint3D: (fieldId, point) => set((s) => {
    const m = s.measurements3D[fieldId]
    if (m.finalized) return {}
    const points = [...m.points, point]
    const inchLength = polyline3DLength(points)
    return {
      measurements3D: { ...s.measurements3D, [fieldId]: { ...m, points, inchLength } },
    }
  }),
  undoPoint3D: (fieldId) => set((s) => {
    const m = s.measurements3D[fieldId]
    if (m.points.length === 0) return {}
    const points = m.points.slice(0, -1)
    return {
      measurements3D: { ...s.measurements3D, [fieldId]: { ...m, points, inchLength: polyline3DLength(points) } },
    }
  }),
  finalizeField3D: (fieldId) => set((s) => ({
    measurements3D: { ...s.measurements3D, [fieldId]: { ...s.measurements3D[fieldId], finalized: true } },
    activeField: null,
    mode: 'view' as MeasureMode,
  })),
  clearField3D: (fieldId) => set((s) => ({
    measurements3D: { ...s.measurements3D, [fieldId]: emptyMeasurement3D(fieldId) },
  })),

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
    activeField: null,
    mode: 'view',
    phase: 'photo',
    stageScale: 1,
    stagePos: { x: 0, y: 0 },
    showZones: false,
    zoneOpacity: 0.45,
    showWireframe: false,
    crossSectionPoints: [],
  }),
}))
