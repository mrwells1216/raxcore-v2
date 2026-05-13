import type {
  AntlerMeasurementGraph,
  DetectionImageAnalysis,
  MeasurementGraphEdge,
  MeasurementGraphNode,
  MultiImageDetectionResult,
} from './types'
import {
  avg,
  chooseBestLandmark,
  computeImageCompositeScore,
  isAcceptedSubject,
  mergeIssues,
  pickBestImageIndex,
} from './helpers'

function createNode(
  id: string,
  type: MeasurementGraphNode['type'],
  side: MeasurementGraphNode['side'],
  landmark: ReturnType<typeof chooseBestLandmark>,
): MeasurementGraphNode {
  return {
    id,
    type,
    side,
    point: landmark?.point ?? null,
    confidence: landmark?.confidence ?? 0,
    visible: !!landmark?.visible,
    inferred: !!landmark?.inferred,
    sourceImageIndex: landmark?.sourceImageIndex ?? null,
  }
}

function createEdge(
  id: string,
  type: MeasurementGraphEdge['type'],
  from: string,
  to: string,
  side: MeasurementGraphEdge['side'],
  confidence: number,
  sourceImageIndex: number | null,
): MeasurementGraphEdge {
  return { id, type, from, to, side, confidence, sourceImageIndex }
}

export function buildAntlerMeasurementGraph(
  images: DetectionImageAnalysis[],
): AntlerMeasurementGraph | null {
  const accepted = images.filter(isAcceptedSubject)
  if (!accepted.length) return null

  const burrLeft = chooseBestLandmark(accepted, 'burr_left')
  const burrRight = chooseBestLandmark(accepted, 'burr_right')
  const beamTipLeft = chooseBestLandmark(accepted, 'beam_tip_left')
  const beamTipRight = chooseBestLandmark(accepted, 'beam_tip_right')
  const spreadLeft = chooseBestLandmark(accepted, 'spread_anchor_left')
  const spreadRight = chooseBestLandmark(accepted, 'spread_anchor_right')

  const nodes: MeasurementGraphNode[] = [
    createNode('burr_left', 'burr_left', 'left', burrLeft),
    createNode('burr_right', 'burr_right', 'right', burrRight),
    createNode('beam_tip_left', 'beam_tip_left', 'left', beamTipLeft),
    createNode('beam_tip_right', 'beam_tip_right', 'right', beamTipRight),
    createNode('spread_anchor_left', 'spread_anchor_left', 'left', spreadLeft),
    createNode('spread_anchor_right', 'spread_anchor_right', 'right', spreadRight),
  ]

  const edges: MeasurementGraphEdge[] = []

  if (burrLeft?.point && beamTipLeft?.point) {
    edges.push(
      createEdge(
        'beam_left',
        'beam_path',
        'burr_left',
        'beam_tip_left',
        'left',
        avg([burrLeft.confidence, beamTipLeft.confidence]),
        beamTipLeft.sourceImageIndex,
      ),
    )
  }

  if (burrRight?.point && beamTipRight?.point) {
    edges.push(
      createEdge(
        'beam_right',
        'beam_path',
        'burr_right',
        'beam_tip_right',
        'right',
        avg([burrRight.confidence, beamTipRight.confidence]),
        beamTipRight.sourceImageIndex,
      ),
    )
  }

  if (spreadLeft?.point && spreadRight?.point) {
    edges.push(
      createEdge(
        'spread',
        'spread_line',
        'spread_anchor_left',
        'spread_anchor_right',
        'center',
        avg([spreadLeft.confidence, spreadRight.confidence]),
        spreadLeft.sourceImageIndex,
      ),
    )
  }

  const sourceImagesUsed = Array.from(
    new Set(
      nodes
        .map(n => n.sourceImageIndex)
        .filter((n): n is number => typeof n === 'number'),
    ),
  )

  const graphConfidence = avg(nodes.map(n => n.confidence).filter(Boolean))

  const notes: string[] = []
  if (!edges.find(e => e.id === 'spread')) {
    notes.push('Inside spread anchors were not confidently established.')
  }
  if (!edges.find(e => e.id === 'beam_left')) {
    notes.push('Left main beam path is incomplete.')
  }
  if (!edges.find(e => e.id === 'beam_right')) {
    notes.push('Right main beam path is incomplete.')
  }

  return {
    nodes,
    edges,
    sourceImagesUsed,
    graphConfidence,
    notes,
  }
}

export function buildMultiImageDetectionSummary(
  images: DetectionImageAnalysis[],
): MultiImageDetectionResult {
  const acceptedImages = images.filter(isAcceptedSubject)
  const graph = buildAntlerMeasurementGraph(images)

  const rejectionReasons = mergeIssues(
    ...images.filter(img => !img.accepted).map(img => img.issues),
  )

  const bestImageByPurpose = {
    fullRack: pickBestImageIndex(
      images,
      img =>
        img.accepted &&
        (img.view === 'front' || img.view === 'front_left' || img.view === 'front_right'),
      computeImageCompositeScore,
    ),
    leftAntler: pickBestImageIndex(
      images,
      img => img.accepted && (img.view === 'left' || img.view === 'front_left'),
      computeImageCompositeScore,
    ),
    rightAntler: pickBestImageIndex(
      images,
      img => img.accepted && (img.view === 'right' || img.view === 'front_right'),
      computeImageCompositeScore,
    ),
    spread: pickBestImageIndex(
      images,
      img =>
        img.accepted &&
        (img.view === 'front' || img.view === 'front_left' || img.view === 'front_right'),
      computeImageCompositeScore,
    ),
  }

  const overallSubjectType =
    acceptedImages[0]?.subjectType ?? images[0]?.subjectType ?? 'unknown'

  const overallConfidence = avg(
    acceptedImages.map(img => computeImageCompositeScore(img)),
  )

  return {
    accepted: acceptedImages.length > 0 && !!graph,
    overallSubjectType,
    overallConfidence,
    images,
    bestImageByPurpose,
    graph,
    rejectionReasons,
  }
}
