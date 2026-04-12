import type { MeasurementGraph, Tine } from '@/lib/types';

/**
 * Scoring engine that calculates scores directly from MeasurementGraph
 * 
 * Flow: AI -> Graph -> Score
 *       User edits Graph -> Re-score
 */

export interface ScoreBreakdown {
  leftBeam: number;
  rightBeam: number;
  tines: {
    left: { label: string; length: number }[];
    right: { label: string; length: number }[];
  };
  spread: number;
  circumferences: {
    left: { label: string; value: number }[];
    right: { label: string; value: number }[];
  };
  grossScore: number;
  deductions: number;
  netScore: number;
}

/**
 * Calculate the gross score from a MeasurementGraph
 * This is the primary scoring function - all scores flow through the graph
 */
export function scoreFromGraph(graph: MeasurementGraph): ScoreBreakdown {
  // Beam lengths
  const leftBeam = graph.beams.left.length;
  const rightBeam = graph.beams.right.length;

  // Tines by side
  const leftTines = graph.tines
    .filter(t => t.side === 'left')
    .map(t => ({ label: t.label, length: t.length }));
  
  const rightTines = graph.tines
    .filter(t => t.side === 'right')
    .map(t => ({ label: t.label, length: t.length }));

  // Spread
  const spread = graph.spread.distance;

  // Circumferences by side
  const leftCircs = graph.circumferences
    .filter(c => c.side === 'left')
    .map(c => ({ label: c.label, value: c.circumference }));
  
  const rightCircs = graph.circumferences
    .filter(c => c.side === 'right')
    .map(c => ({ label: c.label, value: c.circumference }));

  // Calculate gross score
  let grossScore = 0;

  // Add beams
  grossScore += leftBeam;
  grossScore += rightBeam;

  // Add all tines
  leftTines.forEach(t => { grossScore += t.length; });
  rightTines.forEach(t => { grossScore += t.length; });

  // Add spread
  grossScore += spread;

  // Add all circumferences
  leftCircs.forEach(c => { grossScore += c.value; });
  rightCircs.forEach(c => { grossScore += c.value; });

  // Calculate deductions (differences between left/right)
  const deductions = calculateDeductions(graph);

  const netScore = grossScore - deductions;

  return {
    leftBeam,
    rightBeam,
    tines: { left: leftTines, right: rightTines },
    spread,
    circumferences: { left: leftCircs, right: rightCircs },
    grossScore,
    deductions,
    netScore
  };
}

/**
 * Calculate deductions based on asymmetry between left and right
 */
function calculateDeductions(graph: MeasurementGraph): number {
  let deductions = 0;

  // Beam difference
  deductions += Math.abs(graph.beams.left.length - graph.beams.right.length);

  // Tine differences by matching labels
  const leftTineMap = new Map<string, number>();
  const rightTineMap = new Map<string, number>();
  
  graph.tines.forEach(t => {
    if (t.side === 'left') {
      leftTineMap.set(t.label, t.length);
    } else {
      rightTineMap.set(t.label, t.length);
    }
  });

  // Compare matching tines
  const allLabels = new Set([...leftTineMap.keys(), ...rightTineMap.keys()]);
  allLabels.forEach(label => {
    const leftLen = leftTineMap.get(label) ?? 0;
    const rightLen = rightTineMap.get(label) ?? 0;
    deductions += Math.abs(leftLen - rightLen);
  });

  // Circumference differences by matching labels
  const leftCircMap = new Map<string, number>();
  const rightCircMap = new Map<string, number>();
  
  graph.circumferences.forEach(c => {
    if (c.side === 'left') {
      leftCircMap.set(c.label, c.circumference);
    } else {
      rightCircMap.set(c.label, c.circumference);
    }
  });

  // Compare matching circumferences
  const allCircLabels = new Set([...leftCircMap.keys(), ...rightCircMap.keys()]);
  allCircLabels.forEach(label => {
    const leftVal = leftCircMap.get(label) ?? 0;
    const rightVal = rightCircMap.get(label) ?? 0;
    deductions += Math.abs(leftVal - rightVal);
  });

  return deductions;
}

/**
 * Recalculate measurements based on point positions
 * Call this after moving control points to update lengths/distances
 */
export function recalculateMeasurements(graph: MeasurementGraph): MeasurementGraph {
  const newGraph = structuredClone(graph);

  // Recalculate beam lengths from points
  newGraph.beams.left.length = calculatePolylineLength(newGraph.beams.left.points);
  newGraph.beams.right.length = calculatePolylineLength(newGraph.beams.right.points);

  // Recalculate tine lengths
  newGraph.tines = newGraph.tines.map(tine => ({
    ...tine,
    length: calculateDistance(tine.basePoint, tine.tipPoint)
  }));

  // Recalculate spread distance
  newGraph.spread.distance = calculateDistance(
    newGraph.spread.leftPoint,
    newGraph.spread.rightPoint
  );

  return newGraph;
}

/**
 * Calculate distance between two points
 */
function calculateDistance(p1: { x: number; y: number }, p2: { x: number; y: number }): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Calculate total length of a polyline
 */
function calculatePolylineLength(points: { x: number; y: number }[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += calculateDistance(points[i - 1], points[i]);
  }
  return total;
}

/**
 * Compare AI graph to official scores and calculate errors
 */
export function calculateErrors(
  aiGraph: MeasurementGraph,
  officialScore: Record<string, number>
): { field: string; ai: number; official: number; delta: number }[] {
  const errors: { field: string; ai: number; official: number; delta: number }[] = [];
  const aiScore = scoreFromGraph(aiGraph);

  // Map common field names
  const fieldMappings: [string, number, string[]][] = [
    ['left_beam', aiScore.leftBeam, ['main_beam_left', 'left_main_beam', 'beam_left']],
    ['right_beam', aiScore.rightBeam, ['main_beam_right', 'right_main_beam', 'beam_right']],
    ['spread', aiScore.spread, ['inside_spread', 'spread', 'inside_spread_main_beams']],
    ['gross_score', aiScore.grossScore, ['gross_score', 'gross', 'total_gross']],
    ['net_score', aiScore.netScore, ['net_score', 'net', 'final_score']],
  ];

  fieldMappings.forEach(([fieldName, aiValue, possibleKeys]) => {
    for (const key of possibleKeys) {
      if (key in officialScore) {
        const officialValue = officialScore[key];
        errors.push({
          field: fieldName,
          ai: aiValue,
          official: officialValue,
          delta: aiValue - officialValue
        });
        break;
      }
    }
  });

  return errors;
}

/**
 * Get average confidence from graph
 */
export function getGraphConfidence(graph: MeasurementGraph): number {
  const confidences: number[] = [
    graph.beams.left.confidence,
    graph.beams.right.confidence,
    graph.spread.confidence,
    ...graph.tines.map(t => t.confidence),
    ...graph.circumferences.map(c => c.confidence)
  ];

  if (confidences.length === 0) return 0;
  return confidences.reduce((a, b) => a + b, 0) / confidences.length;
}

/**
 * Get lowest confidence measurements (for prioritizing human review)
 */
export function getLowConfidenceMeasurements(
  graph: MeasurementGraph,
  threshold = 0.5
): { type: string; id: string; confidence: number }[] {
  const lowConf: { type: string; id: string; confidence: number }[] = [];

  if (graph.beams.left.confidence < threshold) {
    lowConf.push({ type: 'beam', id: 'beam-left', confidence: graph.beams.left.confidence });
  }
  if (graph.beams.right.confidence < threshold) {
    lowConf.push({ type: 'beam', id: 'beam-right', confidence: graph.beams.right.confidence });
  }
  if (graph.spread.confidence < threshold) {
    lowConf.push({ type: 'spread', id: 'spread', confidence: graph.spread.confidence });
  }

  graph.tines.forEach(t => {
    if (t.confidence < threshold) {
      lowConf.push({ type: 'tine', id: t.id, confidence: t.confidence });
    }
  });

  graph.circumferences.forEach(c => {
    if (c.confidence < threshold) {
      lowConf.push({ type: 'circumference', id: c.id, confidence: c.confidence });
    }
  });

  return lowConf.sort((a, b) => a.confidence - b.confidence);
}
