import type { GraphScoreResult } from '@/lib/scoring/score-from-graph'
import type { EffectiveGraphSource } from '@/lib/scoring/load-effective-measurement-graph'
import type { LandmarkScoreResult } from '@/lib/scoring/landmark-geometry'

export type ActiveScoreSource = 'graph_native' | 'legacy' | 'landmark_geometry'

export interface ScoreComparison {
  activeSource: ActiveScoreSource
  legacyGross: number | null
  graphGross: number | null
  legacyNet: number | null
  graphNet: number | null
  grossDelta: number | null
  netDelta: number | null
  graphCompleteness: number
  graphSource: EffectiveGraphSource
  reason: string
  // Landmark geometry fields (present when landmark detection ran)
  landmarkGross: number | null
  landmarkNet: number | null
  landmarkLocatedFieldFraction: number | null
}

export const GRAPH_ACTIVE_COMPLETENESS_THRESHOLD = 0.75
export const GRAPH_EXTREME_DELTA_THRESHOLD_INCHES = 18
export const GRAPH_LOW_CONFIDENCE_THRESHOLD_PERCENT = 45

function finitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function finiteNullable(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function buildScoreComparison(input: {
  legacyGross?: number | null
  legacyNet?: number | null
  graphScore: GraphScoreResult
  graphSource: EffectiveGraphSource
  confidencePercent?: number | null
  landmarkScore?: LandmarkScoreResult | null
}): ScoreComparison {
  const legacyGross = finiteNullable(input.legacyGross)
  const legacyNet = finiteNullable(input.legacyNet)
  const graphGross = finiteNullable(input.graphScore.grossScore)
  const graphNet = finiteNullable(input.graphScore.netScore)
  const grossDelta =
    legacyGross != null && graphGross != null ? Math.abs(graphGross - legacyGross) : null
  const netDelta =
    legacyNet != null && graphNet != null ? Math.abs(graphNet - legacyNet) : null

  const landmarkGross = finiteNullable(input.landmarkScore?.grossScore)
  const landmarkNet = finiteNullable(input.landmarkScore?.netScore ?? null)
  const landmarkLocatedFieldFraction =
    input.landmarkScore != null && input.landmarkScore.totalFieldCount > 0
      ? input.landmarkScore.locatedFieldCount / input.landmarkScore.totalFieldCount
      : null

  let activeSource: ActiveScoreSource = 'legacy'
  let reason = ''

  // Landmark geometry wins when ≥60% of fields are located and agrees within 8% of legacy
  const landmarkFraction = landmarkLocatedFieldFraction ?? 0
  const landmarkDelta =
    legacyGross != null && landmarkGross != null ? Math.abs(landmarkGross - legacyGross) : null
  if (
    landmarkGross != null &&
    landmarkFraction >= 0.6 &&
    (landmarkDelta == null || landmarkDelta / Math.max(legacyGross ?? 1, 1) <= 0.08)
  ) {
    activeSource = 'landmark_geometry'
    reason = `Landmark geometry selected: ${Math.round(landmarkFraction * 100)}% fields located, delta ${landmarkDelta != null ? landmarkDelta.toFixed(1) + '"' : 'n/a'}.`
  } else if (input.graphSource === 'fallback') {
    reason = 'Graph source is fallback; using legacy score.'
  } else if (input.graphScore.completeness < GRAPH_ACTIVE_COMPLETENESS_THRESHOLD) {
    reason = `Graph completeness too low (${Math.round(input.graphScore.completeness * 100)}% < ${Math.round(GRAPH_ACTIVE_COMPLETENESS_THRESHOLD * 100)}%).`
  } else if (!finitePositive(graphGross)) {
    reason = 'Graph gross score is invalid or zero; using legacy score.'
  } else if (
    grossDelta != null &&
    grossDelta > GRAPH_EXTREME_DELTA_THRESHOLD_INCHES &&
    (input.confidencePercent ?? 0) < GRAPH_LOW_CONFIDENCE_THRESHOLD_PERCENT
  ) {
    reason = `Graph/legacy gross delta is extreme (${grossDelta.toFixed(1)}") while confidence is low; using legacy score.`
  } else {
    activeSource = 'graph_native'
    reason = `Graph-native score selected from ${input.graphSource} with ${Math.round(input.graphScore.completeness * 100)}% completeness.`
  }

  return {
    activeSource,
    legacyGross,
    graphGross,
    legacyNet,
    graphNet,
    grossDelta,
    netDelta,
    graphCompleteness: Number.isFinite(input.graphScore.completeness)
      ? input.graphScore.completeness
      : 0,
    graphSource: input.graphSource,
    reason,
    landmarkGross,
    landmarkNet,
    landmarkLocatedFieldFraction,
  }
}
