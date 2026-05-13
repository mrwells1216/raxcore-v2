import type { GraphEvidenceInputs } from '@/lib/confidence/engine'
import { getLowConfidenceMeasurements } from '@/lib/scoring'
import type { GraphScoreResult } from '@/lib/scoring/score-from-graph'
import type { EffectiveGraphSource } from '@/lib/scoring/load-effective-measurement-graph'
import type { MeasurementGraph, MeasurementProvenance } from '@/lib/types'

function finitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function getProvenance(segment: unknown): MeasurementProvenance | undefined {
  if (!segment || typeof segment !== 'object') return undefined
  return (segment as { provenance?: MeasurementProvenance }).provenance
}

export function collectGraphEvidence(input: {
  graph: MeasurementGraph
  graphScore: GraphScoreResult
  graphSource: EffectiveGraphSource
  legacyGross?: number | null
}): GraphEvidenceInputs {
  const { graph, graphScore, graphSource, legacyGross } = input
  const segments: unknown[] = [
    graph.beams.left,
    graph.beams.right,
    graph.spread,
    ...graph.tines,
    ...graph.circumferences,
  ]

  let correctedSegmentCount = 0
  let inferredSegmentCount = 0

  for (const segment of segments) {
    const provenance = getProvenance(segment)
    if (provenance?.origin === 'human' || provenance?.visibility === 'corrected') {
      correctedSegmentCount++
    }
    if (provenance?.visibility === 'inferred') {
      inferredSegmentCount++
    }
  }

  return {
    graphSource,
    graphCompleteness: graphScore.completeness,
    correctedSegmentCount,
    inferredSegmentCount,
    lowConfidenceSegmentCount: getLowConfidenceMeasurements(graph, 0.5).length,
    legacyGraphGrossDelta:
      finitePositive(legacyGross) && finitePositive(graphScore.grossScore)
        ? Math.abs(graphScore.grossScore - legacyGross)
        : null,
    missingCircumferences:
      graph.circumferences.length === 0 ||
      graph.circumferences.every((circ) => !finitePositive(circ.circumference)),
  }
}
