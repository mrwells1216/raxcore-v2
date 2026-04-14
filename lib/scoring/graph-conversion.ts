import type { MeasurementGraph, Beam, CircumferencePoint, Tine, Vec2 } from '@/lib/types';
import type { AntlerMeasurementGraph, MeasurementGraphNode } from '@/lib/detection/types';

const TINE_LABELS = ['G1', 'G2', 'G3', 'G4'] as const;
const CIRCUMFERENCE_LABELS = ['H1', 'H2', 'H3', 'H4'] as const;

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function toVec2(node: MeasurementGraphNode | null | undefined, fallback: Vec2): Vec2 {
  if (!node?.point) return fallback;
  return { x: node.point.x, y: node.point.y };
}

function polylineLength(points: Vec2[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    total += Math.sqrt(dx * dx + dy * dy);
  }
  return total;
}

function samplePointOnPolyline(points: Vec2[], ratio: number): Vec2 {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return points[0];

  const clampedRatio = Math.max(0, Math.min(1, ratio));
  const segments: number[] = [];
  let totalLength = 0;

  for (let i = 1; i < points.length; i += 1) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    const segmentLength = Math.sqrt(dx * dx + dy * dy);
    segments.push(segmentLength);
    totalLength += segmentLength;
  }

  if (totalLength === 0) return points[0];

  const target = totalLength * clampedRatio;
  let traveled = 0;

  for (let i = 0; i < segments.length; i += 1) {
    const segmentLength = segments[i];
    if (traveled + segmentLength >= target) {
      const localRatio = (target - traveled) / segmentLength;
      return {
        x: points[i].x + (points[i + 1].x - points[i].x) * localRatio,
        y: points[i].y + (points[i + 1].y - points[i].y) * localRatio,
      };
    }
    traveled += segmentLength;
  }

  return points[points.length - 1];
}

function getNodesByType(
  graph: AntlerMeasurementGraph,
  type: MeasurementGraphNode['type'],
  side?: MeasurementGraphNode['side']
): MeasurementGraphNode[] {
  return graph.nodes.filter((node) => node.type === type && (!side || node.side === side));
}

function getBestNode(
  graph: AntlerMeasurementGraph,
  type: MeasurementGraphNode['type'],
  side?: MeasurementGraphNode['side']
): MeasurementGraphNode | null {
  const matches = getNodesByType(graph, type, side).filter((node) => !!node.point);
  if (matches.length === 0) return null;
  return matches.sort((a, b) => b.confidence - a.confidence)[0];
}

function buildBeam(graph: AntlerMeasurementGraph, side: 'left' | 'right', fallbackX: number): Beam {
  const burr = getBestNode(graph, side === 'left' ? 'burr_left' : 'burr_right', side);
  const tip = getBestNode(graph, side === 'left' ? 'beam_tip_left' : 'beam_tip_right', side);
  const curveNodes = getNodesByType(graph, 'beam_curve', side)
    .filter((node) => !!node.point)
    .sort((a, b) => (b.point?.y ?? 0) - (a.point?.y ?? 0));

  const fallbackBase = { x: fallbackX, y: 430 };
  const fallbackTip = { x: fallbackX + (side === 'left' ? 30 : -30), y: 180 };

  const points = [
    toVec2(burr, fallbackBase),
    ...curveNodes.map((node) => toVec2(node, fallbackBase)),
    toVec2(tip, fallbackTip),
  ].filter((point, index, array) => {
    if (index === 0) return true;
    const prev = array[index - 1];
    return prev.x !== point.x || prev.y !== point.y;
  });

  const pointSources = [burr, ...curveNodes, tip].filter(Boolean) as MeasurementGraphNode[];
  const sourceImageIndexes = [
    ...new Set(pointSources.map((node) => node.sourceImageIndex).filter((value) => typeof value === 'number')),
  ];

  return {
    id: `beam-${side}`,
    points,
    length: polylineLength(points),
    confidence: average(pointSources.map((node) => node.confidence)),
    source:
      sourceImageIndexes.length === 1
        ? sourceImageIndexes[0] === 0
          ? 'front'
          : sourceImageIndexes[0] === 1
            ? 'left'
            : 'right'
        : 'fused',
  };
}

function buildTines(graph: AntlerMeasurementGraph): Tine[] {
  const tines: Tine[] = [];

  (['left', 'right'] as const).forEach((side) => {
    const baseNodes = getNodesByType(graph, 'tine_base', side)
      .filter((node) => !!node.point)
      .sort((a, b) => (b.point?.y ?? 0) - (a.point?.y ?? 0));

    const tipNodes = getNodesByType(graph, 'tine_tip', side)
      .filter((node) => !!node.point)
      .sort((a, b) => (b.point?.y ?? 0) - (a.point?.y ?? 0));

    const count = Math.min(baseNodes.length, tipNodes.length, TINE_LABELS.length);

    for (let i = 0; i < count; i += 1) {
      const base = toVec2(baseNodes[i], { x: side === 'left' ? 170 : 330, y: 360 - i * 45 });
      const tip = toVec2(tipNodes[i], { x: side === 'left' ? 130 : 370, y: 300 - i * 55 });
      const dx = tip.x - base.x;
      const dy = tip.y - base.y;

      tines.push({
        id: `${TINE_LABELS[i].toLowerCase()}-${side}`,
        side,
        parentBeamId: `beam-${side}`,
        basePoint: base,
        tipPoint: tip,
        length: Math.sqrt(dx * dx + dy * dy),
        label: TINE_LABELS[i],
        confidence: average([baseNodes[i]?.confidence ?? 0, tipNodes[i]?.confidence ?? 0]),
      });
    }
  });

  return tines;
}

function buildSpread(graph: AntlerMeasurementGraph, leftBeam: Beam, rightBeam: Beam) {
  const leftAnchor = getBestNode(graph, 'spread_anchor_left', 'left') ?? getBestNode(graph, 'burr_left', 'left');
  const rightAnchor = getBestNode(graph, 'spread_anchor_right', 'right') ?? getBestNode(graph, 'burr_right', 'right');
  const leftPoint = toVec2(leftAnchor, leftBeam.points[0] ?? { x: 160, y: 430 });
  const rightPoint = toVec2(rightAnchor, rightBeam.points[0] ?? { x: 340, y: 430 });
  const dx = rightPoint.x - leftPoint.x;
  const dy = rightPoint.y - leftPoint.y;

  return {
    leftPoint,
    rightPoint,
    distance: Math.sqrt(dx * dx + dy * dy),
    confidence: average([leftAnchor?.confidence ?? leftBeam.confidence, rightAnchor?.confidence ?? rightBeam.confidence]),
  };
}

function buildCircumferences(leftBeam: Beam, rightBeam: Beam): CircumferencePoint[] {
  const ratios = [0.15, 0.35, 0.6, 0.8];
  const circumferences: CircumferencePoint[] = [];

  (['left', 'right'] as const).forEach((side) => {
    const beam = side === 'left' ? leftBeam : rightBeam;

    ratios.forEach((ratio, index) => {
      circumferences.push({
        id: `${CIRCUMFERENCE_LABELS[index].toLowerCase()}-${side}`,
        side,
        label: CIRCUMFERENCE_LABELS[index],
        position: samplePointOnPolyline(beam.points, ratio),
        circumference: 0,
        confidence: Math.max(0.2, beam.confidence * 0.7),
      });
    });
  });

  return circumferences;
}

export function convertDetectionGraphToMeasurementGraph(
  detectionGraph: AntlerMeasurementGraph
): MeasurementGraph {
  const leftBeam = buildBeam(detectionGraph, 'left', 160);
  const rightBeam = buildBeam(detectionGraph, 'right', 340);
  const tines = buildTines(detectionGraph);
  const spread = buildSpread(detectionGraph, leftBeam, rightBeam);
  const circumferences = buildCircumferences(leftBeam, rightBeam);

  return {
    beams: {
      left: leftBeam,
      right: rightBeam,
    },
    tines,
    spread,
    circumferences,
  };
}
