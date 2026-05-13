export type DetectionSubjectType =
  | 'deer'
  | 'mounted_deer'
  | 'shed_antlers'
  | 'non_deer'
  | 'unknown'

export type RackView =
  | 'front'
  | 'left'
  | 'right'
  | 'front_left'
  | 'front_right'
  | 'rear'
  | 'unknown'

export type DetectionQuality =
  | 'usable'
  | 'borderline'
  | 'reject'

export type LandmarkConfidenceBand = 'high' | 'medium' | 'low'

export interface Point2D {
  x: number
  y: number
}

export interface BoundingBox {
  x: number
  y: number
  width: number
  height: number
}

export interface RackLandmark {
  key: string
  label: string
  point: Point2D | null
  confidence: number
  band: LandmarkConfidenceBand
  visible: boolean
  inferred: boolean
  sourceImageIndex: number
}

export interface DetectionIssue {
  code:
    | 'non_deer_subject'
    | 'no_antlers_visible'
    | 'rack_too_small'
    | 'too_blurry'
    | 'too_dark'
    | 'too_far'
    | 'heavy_occlusion'
    | 'bad_angle'
    | 'mounted_bias'
    | 'unknown_subject'
  message: string
  severity: 'info' | 'warning' | 'error'
}

export interface DetectionImageAnalysis {
  imageIndex: number
  subjectType: DetectionSubjectType
  subjectConfidence: number
  antlerPresenceConfidence: number
  rackVisibilityConfidence: number
  usableFrameScore: number
  view: RackView
  mounted: boolean
  occlusionScore: number
  blurScore: number
  lightingScore: number
  rackBox: BoundingBox | null
  leftRackBox: BoundingBox | null
  rightRackBox: BoundingBox | null
  landmarks: RackLandmark[]
  issues: DetectionIssue[]
  accepted: boolean
}

export interface MeasurementGraphNode {
  id: string
  type:
    | 'burr_left'
    | 'burr_right'
    | 'beam_tip_left'
    | 'beam_tip_right'
    | 'spread_anchor_left'
    | 'spread_anchor_right'
    | 'tine_base'
    | 'tine_tip'
    | 'beam_curve'
  side: 'left' | 'right' | 'center'
  point: Point2D | null
  confidence: number
  visible: boolean
  inferred: boolean
  sourceImageIndex: number | null
}

export interface MeasurementGraphEdge {
  id: string
  type:
    | 'beam_path'
    | 'tine_segment'
    | 'spread_line'
    | 'circumference_interval'
  from: string
  to: string
  side: 'left' | 'right' | 'center'
  confidence: number
  sourceImageIndex: number | null
}

export interface AntlerMeasurementGraph {
  nodes: MeasurementGraphNode[]
  edges: MeasurementGraphEdge[]
  sourceImagesUsed: number[]
  graphConfidence: number
  notes: string[]
}

export interface MultiImageDetectionResult {
  accepted: boolean
  overallSubjectType: DetectionSubjectType
  overallConfidence: number
  images: DetectionImageAnalysis[]
  bestImageByPurpose: {
    fullRack: number | null
    leftAntler: number | null
    rightAntler: number | null
    spread: number | null
  }
  graph: AntlerMeasurementGraph | null
  rejectionReasons: DetectionIssue[]
}
