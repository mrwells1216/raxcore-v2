export type ConfidenceReasonType =
  | 'coverage_penalty'
  | 'image_quality_penalty'
  | 'reference_boost'
  | 'measurement_completeness_penalty'
  | 'fallback_penalty'
  | 'calibration_adjustment'
  | 'symmetry_penalty'
  | 'deduction_penalty'
  | 'missing_metadata_penalty'
  // Graph evidence types (Part 3)
  | 'graph_source_boost'
  | 'graph_completeness_boost'
  | 'graph_human_correction_boost'
  | 'graph_inferred_penalty'
  | 'graph_low_confidence_penalty'
  | 'graph_missing_circumference_penalty'
  | 'graph_legacy_delta_penalty'

export type ConfidenceReason = {
  type: ConfidenceReasonType
  label: string
  impact: number
  direction: 'boost' | 'penalty'
  details?: string | null
}

export type GraphEvidenceInputs = {
  /** 'persisted_graph' | 'prediction_graph' | 'fallback' */
  graphSource?: string | null
  /** 0–1 weighted completeness from scoreFromGraph */
  graphCompleteness?: number | null
  /** Number of segments with origin='human' / visibility='corrected' */
  correctedSegmentCount?: number | null
  /** Number of segments with visibility='inferred' */
  inferredSegmentCount?: number | null
  /** Number of segments with confidence < 0.5 */
  lowConfidenceSegmentCount?: number | null
  /** |graphGross - legacyGross| — null if either missing */
  legacyGraphGrossDelta?: number | null
  /** True when graph has no circumference values at all */
  missingCircumferences?: boolean | null
}

export type ConfidenceInputs = {
  rawConfidence: number | null

  captureQualitySummary?: any | null
  imageDiagnosticsSummary?: any | null
  referenceModeSummary?: any | null

  measurements?: any | null

  isFallback?: boolean | null
  calibrationApplied?: boolean | null
  calibrationMeta?: any | null
  /** Part 3: graph evidence signals layered on top of existing confidence */
  graphEvidence?: GraphEvidenceInputs | null
  /** Depth map LiDAR calibration result — boosts confidence when present */
  depthCalibration?: {
    source: 'depth_map_lidar'
    confidence: number
    subjectDistanceMeters: number
  } | null
}

export type ConfidenceResult = {
  rawConfidence: number | null
  finalConfidence: number
  confidenceBand: 'low' | 'medium' | 'high'
  reasons: ConfidenceReason[]
  componentScores: {
    baseScore: number
    coverageScore: number
    imageQualityScore: number
    referenceScore: number
    completenessScore: number
    fallbackScore: number
    calibrationScore: number
    symmetryScore: number
    deductionScore: number
    graphEvidenceScore: number
  }
  /** Part 3: structured summary of graph evidence factors that affected confidence */
  confidenceEvidence?: {
    graphSource: string | null
    graphCompleteness: number | null
    correctedSegmentCount: number | null
    inferredSegmentCount: number | null
    lowConfidenceSegmentCount: number | null
    legacyGraphGrossDelta: number | null
    reasons: string[]
  } | null
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function toNumber(value: any): number | null {
  return typeof value === 'number' && !Number.isNaN(value) ? value : null
}

function countNumeric(values: any[]) {
  return values.filter((v) => typeof v === 'number' && !Number.isNaN(v)).length
}

function getMeasurementCompleteness(measurements: any | null | undefined) {
  if (!measurements) return 0

  const values = [
    measurements?.insideSpread ?? measurements?.inside_spread,
    measurements?.leftBeamLength ?? measurements?.main_beam_left,
    measurements?.rightBeamLength ?? measurements?.main_beam_right,

    measurements?.g1_left,
    measurements?.g2_left,
    measurements?.g3_left,
    measurements?.g4_left,
    measurements?.g5_left,
    measurements?.g1_right,
    measurements?.g2_right,
    measurements?.g3_right,
    measurements?.g4_right,
    measurements?.g5_right,

    measurements?.h1_left,
    measurements?.h2_left,
    measurements?.h3_left,
    measurements?.h4_left,
    measurements?.h1_right,
    measurements?.h2_right,
    measurements?.h3_right,
    measurements?.h4_right,

    measurements?.grossScore ?? measurements?.gross_score,
    measurements?.netScore ?? measurements?.net_score,
  ]

  const total = values.length
  const present = countNumeric(values)
  return total > 0 ? present / total : 0
}

function getSymmetryPenalty(measurements: any | null | undefined) {
  if (!measurements) return { score: -4, reason: 'Missing measurements for symmetry checks.' }

  const leftBeam = toNumber(measurements?.leftBeamLength ?? measurements?.main_beam_left)
  const rightBeam = toNumber(measurements?.rightBeamLength ?? measurements?.main_beam_right)

  if (leftBeam === null || rightBeam === null) {
    return { score: -3, reason: 'Missing beam lengths for symmetry checks.' }
  }

  const beamDiff = Math.abs(leftBeam - rightBeam)

  const tineDiffs: number[] = []
  for (let i = 1; i <= 5; i++) {
    const left = toNumber(measurements?.[`g${i}_left`])
    const right = toNumber(measurements?.[`g${i}_right`])
    if (left !== null && right !== null) {
      tineDiffs.push(Math.abs(left - right))
    }
  }

  const avgTineDiff =
    tineDiffs.length > 0
      ? tineDiffs.reduce((sum, v) => sum + v, 0) / tineDiffs.length
      : 0

  let penalty = 0

  if (beamDiff > 4) penalty -= 8
  else if (beamDiff > 2) penalty -= 4
  else if (beamDiff > 1) penalty -= 2

  if (avgTineDiff > 3) penalty -= 6
  else if (avgTineDiff > 2) penalty -= 3
  else if (avgTineDiff > 1) penalty -= 1

  return {
    score: penalty,
    reason:
      penalty < 0
        ? `Beam/tine asymmetry detected (beam diff ${beamDiff.toFixed(1)}, avg tine diff ${avgTineDiff.toFixed(1)}).`
        : null,
  }
}

function getDeductionPenalty(measurements: any | null | undefined) {
  if (!measurements) return { score: -2, reason: 'Missing deduction context.' }

  const deduction =
    toNumber(measurements?.deductions) ??
    toNumber(measurements?.totalDeductions) ??
    toNumber(measurements?.deduction_total) ??
    0

  let penalty = 0
  if (deduction > 15) penalty -= 6
  else if (deduction > 10) penalty -= 4
  else if (deduction > 5) penalty -= 2

  return {
    score: penalty,
    reason:
      penalty < 0 ? `Higher deduction burden (${deduction.toFixed(1)}) increases uncertainty.` : null,
  }
}

export function computeConfidence(inputs: ConfidenceInputs): ConfidenceResult {
  const reasons: ConfidenceReason[] = []

  const baseScore =
    typeof inputs.rawConfidence === 'number'
      ? clamp(inputs.rawConfidence, 25, 95)
      : 60

  let total = baseScore

  // Coverage
  let coverageScore = 0
  const coverageLabel = inputs.captureQualitySummary?.coverage?.coverageLabel
  const missingAngles: string[] = inputs.captureQualitySummary?.coverage?.missingAngles ?? []

  if (coverageLabel === 'strong') {
    coverageScore += 6
    reasons.push({
      type: 'coverage_penalty',
      label: 'Strong angle coverage',
      impact: 6,
      direction: 'boost',
      details: 'Front, left, and right coverage present.',
    })
  } else if (coverageLabel === 'partial') {
    coverageScore -= 8
    reasons.push({
      type: 'coverage_penalty',
      label: 'Partial angle coverage',
      impact: 8,
      direction: 'penalty',
      details: `Missing: ${missingAngles.join(', ') || 'one key angle'}.`,
    })
  } else if (coverageLabel === 'weak') {
    coverageScore -= 18
    reasons.push({
      type: 'coverage_penalty',
      label: 'Weak angle coverage',
      impact: 18,
      direction: 'penalty',
      details: `Missing: ${missingAngles.join(', ') || 'multiple key angles'}.`,
    })
  } else {
    coverageScore -= 6
    reasons.push({
      type: 'missing_metadata_penalty',
      label: 'Capture coverage unknown',
      impact: 6,
      direction: 'penalty',
      details: 'No structured coverage summary was available.',
    })
  }
  total += coverageScore

  // Image diagnostics
  let imageQualityScore = 0
  const imageOverall = inputs.imageDiagnosticsSummary?.overall
  const poorCount = toNumber(inputs.imageDiagnosticsSummary?.poorCount) ?? 0
  const okCount = toNumber(inputs.imageDiagnosticsSummary?.okCount) ?? 0

  if (imageOverall === 'strong' || imageOverall === 'good') {
    imageQualityScore += 4
    reasons.push({
      type: 'image_quality_penalty',
      label: 'Strong image quality',
      impact: 4,
      direction: 'boost',
      details: 'No major image quality issues detected.',
    })
  } else if (imageOverall === 'mixed') {
    imageQualityScore -= 6
    reasons.push({
      type: 'image_quality_penalty',
      label: 'Mixed image quality',
      impact: 6,
      direction: 'penalty',
      details: `${okCount} image(s) had moderate quality limitations.`,
    })
  } else if (imageOverall === 'weak' || poorCount > 0) {
    imageQualityScore -= Math.min(18, 8 + poorCount * 4)
    reasons.push({
      type: 'image_quality_penalty',
      label: 'Weak image quality',
      impact: Math.min(18, 8 + poorCount * 4),
      direction: 'penalty',
      details: `${poorCount} image(s) may reduce scoring accuracy.`,
    })
  } else {
    imageQualityScore -= 4
    reasons.push({
      type: 'missing_metadata_penalty',
      label: 'Image diagnostics unavailable',
      impact: 4,
      direction: 'penalty',
      details: 'Per-image quality data was not available.',
    })
  }
  total += imageQualityScore

  // Reference mode
  let referenceScore = 0
  const referenceSummary = inputs.referenceModeSummary
  if (referenceSummary?.precisionModeEnabled && referenceSummary?.referencePresent) {
    if (referenceSummary?.supportsScaleCalibration) {
      const placement = referenceSummary?.referencePlacement
      const placementAdjustment =
        placement === 'same_depth_plane'
          ? 0
          : placement === 'near_antler_plane'
            ? -1
            : placement === 'in_front_or_behind'
              ? -4
              : -2
      const impact = Math.max(1, 5 + placementAdjustment)
      referenceScore += impact
      reasons.push({
        type: 'reference_boost',
        label: 'Strong scale reference recorded',
        impact,
        direction: 'boost',
        details: referenceSummary.referenceSizeInches
          ? `Reference type: ${referenceSummary.referenceType}; known size ${referenceSummary.referenceSizeInches.toFixed(2)}".`
          : `Reference type: ${referenceSummary.referenceType}.`,
      })
    } else {
      referenceScore += 2
      reasons.push({
        type: 'reference_boost',
        label: 'Reference object recorded',
        impact: 2,
        direction: 'boost',
        details: `Reference type: ${referenceSummary.referenceType}.`,
      })
    }
  } else if (referenceSummary?.precisionModeEnabled && !referenceSummary?.referencePresent) {
    referenceScore -= 3
    reasons.push({
      type: 'reference_boost',
      label: 'Precision mode incomplete',
      impact: 3,
      direction: 'penalty',
      details: 'Precision mode was enabled, but no concrete reference was specified.',
    })
  }
  total += referenceScore

  // Measurement completeness
  let completenessScore = 0
  const completeness = getMeasurementCompleteness(inputs.measurements)
  if (completeness >= 0.9) {
    completenessScore += 8
    reasons.push({
      type: 'measurement_completeness_penalty',
      label: 'High measurement completeness',
      impact: 8,
      direction: 'boost',
      details: `${Math.round(completeness * 100)}% of tracked measurements present.`,
    })
  } else if (completeness >= 0.75) {
    completenessScore += 2
    reasons.push({
      type: 'measurement_completeness_penalty',
      label: 'Moderate measurement completeness',
      impact: 2,
      direction: 'boost',
      details: `${Math.round(completeness * 100)}% of tracked measurements present.`,
    })
  } else if (completeness >= 0.5) {
    completenessScore -= 8
    reasons.push({
      type: 'measurement_completeness_penalty',
      label: 'Partial measurement completeness',
      impact: 8,
      direction: 'penalty',
      details: `${Math.round(completeness * 100)}% of tracked measurements present.`,
    })
  } else {
    completenessScore -= 16
    reasons.push({
      type: 'measurement_completeness_penalty',
      label: 'Low measurement completeness',
      impact: 16,
      direction: 'penalty',
      details: `${Math.round(completeness * 100)}% of tracked measurements present.`,
    })
  }
  total += completenessScore

  // Fallback usage
  let fallbackScore = 0
  if (inputs.isFallback) {
    fallbackScore -= 20
    reasons.push({
      type: 'fallback_penalty',
      label: 'Fallback scoring path used',
      impact: 20,
      direction: 'penalty',
      details: 'Confidence reduced because the primary structured vision path did not complete.',
    })
  }
  total += fallbackScore

  // Calibration
  let calibrationScore = 0
  if (inputs.calibrationApplied) {
    const sampleCount = toNumber(inputs.calibrationMeta?.sample_count) ?? 0
    if (sampleCount >= 25) {
      calibrationScore += 4
      reasons.push({
        type: 'calibration_adjustment',
        label: 'Calibration backed by reviewed data',
        impact: 4,
        direction: 'boost',
        details: `${sampleCount} reviewed samples support this calibration profile.`,
      })
    } else if (sampleCount >= 5) {
      calibrationScore += 2
      reasons.push({
        type: 'calibration_adjustment',
        label: 'Calibration applied',
        impact: 2,
        direction: 'boost',
        details: `${sampleCount} reviewed samples support this profile.`,
      })
    }
  }

  // LiDAR depth calibration boost (NOT physical_reference — does not unlock Verified Score)
  if (
    inputs.depthCalibration &&
    inputs.depthCalibration.source === 'depth_map_lidar' &&
    inputs.depthCalibration.confidence > 0.5
  ) {
    const lidarBoost = Math.round(inputs.depthCalibration.confidence * 6)
    calibrationScore += lidarBoost
    reasons.push({
      type: 'calibration_adjustment',
      label: 'LiDAR auto-calibration',
      impact: lidarBoost,
      direction: 'boost',
      details: `iPhone LiDAR depth at ${inputs.depthCalibration.subjectDistanceMeters.toFixed(1)}m (confidence ${(inputs.depthCalibration.confidence * 100).toFixed(0)}%).`,
    })
  }

  total += calibrationScore

  // Symmetry
  const symmetry = getSymmetryPenalty(inputs.measurements)
  const symmetryScore = symmetry.score
  if (symmetryScore !== 0) {
    reasons.push({
      type: 'symmetry_penalty',
      label: symmetryScore < 0 ? 'Asymmetry increases uncertainty' : 'Stable bilateral geometry',
      impact: Math.abs(symmetryScore),
      direction: symmetryScore < 0 ? 'penalty' : 'boost',
      details: symmetry.reason,
    })
  }
  total += symmetryScore

  // Deductions
  const deduction = getDeductionPenalty(inputs.measurements)
  const deductionScore = deduction.score
  if (deductionScore !== 0) {
    reasons.push({
      type: 'deduction_penalty',
      label: 'Deduction profile increases uncertainty',
      impact: Math.abs(deductionScore),
      direction: 'penalty',
      details: deduction.reason,
    })
  }
  total += deductionScore

  // ── Part 3: Graph evidence layer ──────────────────────────────────────────
  // Applied conservatively on top of all existing signals.
  let graphEvidenceScore = 0
  const graphEvidenceReasons: string[] = []
  const ge = inputs.graphEvidence

  if (ge) {
    // Persisted graph boost (strongest signal — human-validated geometry)
    if (ge.graphSource === 'persisted_graph') {
      graphEvidenceScore += 5
      reasons.push({
        type: 'graph_source_boost',
        label: 'Persisted measurement graph',
        impact: 5,
        direction: 'boost',
        details: 'Canonical geometry was saved to the database.',
      })
      graphEvidenceReasons.push('Persisted graph source +5')
    } else if (ge.graphSource === 'prediction_graph') {
      graphEvidenceScore += 2
      reasons.push({
        type: 'graph_source_boost',
        label: 'Prediction-derived graph',
        impact: 2,
        direction: 'boost',
        details: 'Graph derived from latest AI prediction.',
      })
      graphEvidenceReasons.push('Prediction graph source +2')
    }

    // Graph completeness boost
    const gComp = ge.graphCompleteness ?? 0
    if (gComp >= 0.85) {
      graphEvidenceScore += 6
      reasons.push({
        type: 'graph_completeness_boost',
        label: 'High graph completeness',
        impact: 6,
        direction: 'boost',
        details: `Graph completeness ${(gComp * 100).toFixed(0)}%.`,
      })
      graphEvidenceReasons.push(`Graph completeness ${(gComp * 100).toFixed(0)}% +6`)
    } else if (gComp >= 0.65) {
      graphEvidenceScore += 2
      reasons.push({
        type: 'graph_completeness_boost',
        label: 'Moderate graph completeness',
        impact: 2,
        direction: 'boost',
        details: `Graph completeness ${(gComp * 100).toFixed(0)}%.`,
      })
      graphEvidenceReasons.push(`Graph completeness ${(gComp * 100).toFixed(0)}% +2`)
    } else if (gComp < 0.4 && ge.graphSource !== 'fallback') {
      graphEvidenceScore -= 4
      reasons.push({
        type: 'graph_completeness_boost',
        label: 'Low graph completeness',
        impact: 4,
        direction: 'penalty',
        details: `Graph completeness ${(gComp * 100).toFixed(0)}%.`,
      })
      graphEvidenceReasons.push(`Graph completeness ${(gComp * 100).toFixed(0)}% -4`)
    }

    // Human-corrected segments boost
    const corrected = ge.correctedSegmentCount ?? 0
    if (corrected >= 3) {
      graphEvidenceScore += 5
      reasons.push({
        type: 'graph_human_correction_boost',
        label: 'Multiple human-corrected segments',
        impact: 5,
        direction: 'boost',
        details: `${corrected} segments corrected by human review.`,
      })
      graphEvidenceReasons.push(`${corrected} human-corrected segments +5`)
    } else if (corrected >= 1) {
      graphEvidenceScore += 2
      reasons.push({
        type: 'graph_human_correction_boost',
        label: 'Human-corrected segment(s)',
        impact: 2,
        direction: 'boost',
        details: `${corrected} segment(s) corrected by human review.`,
      })
      graphEvidenceReasons.push(`${corrected} human-corrected segment(s) +2`)
    }

    // Inferred geometry penalty
    const inferred = ge.inferredSegmentCount ?? 0
    if (inferred >= 4) {
      graphEvidenceScore -= 6
      reasons.push({
        type: 'graph_inferred_penalty',
        label: 'Many inferred graph segments',
        impact: 6,
        direction: 'penalty',
        details: `${inferred} segments use inferred geometry.`,
      })
      graphEvidenceReasons.push(`${inferred} inferred segments -6`)
    } else if (inferred >= 2) {
      graphEvidenceScore -= 3
      reasons.push({
        type: 'graph_inferred_penalty',
        label: 'Some inferred graph segments',
        impact: 3,
        direction: 'penalty',
        details: `${inferred} segments use inferred geometry.`,
      })
      graphEvidenceReasons.push(`${inferred} inferred segments -3`)
    }

    // Low-confidence segment penalty
    const lowConf = ge.lowConfidenceSegmentCount ?? 0
    if (lowConf >= 3) {
      graphEvidenceScore -= 5
      reasons.push({
        type: 'graph_low_confidence_penalty',
        label: 'Several low-confidence segments',
        impact: 5,
        direction: 'penalty',
        details: `${lowConf} segments with confidence < 0.5.`,
      })
      graphEvidenceReasons.push(`${lowConf} low-confidence segments -5`)
    } else if (lowConf >= 1) {
      graphEvidenceScore -= 2
      reasons.push({
        type: 'graph_low_confidence_penalty',
        label: 'Low-confidence segment(s)',
        impact: 2,
        direction: 'penalty',
        details: `${lowConf} segment(s) with confidence < 0.5.`,
      })
      graphEvidenceReasons.push(`${lowConf} low-confidence segment(s) -2`)
    }

    // Missing circumferences penalty
    if (ge.missingCircumferences) {
      graphEvidenceScore -= 5
      reasons.push({
        type: 'graph_missing_circumference_penalty',
        label: 'No circumference values in graph',
        impact: 5,
        direction: 'penalty',
        details: 'Circumference measurements increase gross score accuracy.',
      })
      graphEvidenceReasons.push('No circumferences in graph -5')
    }

    // Large legacy-vs-graph delta penalty
    const delta = ge.legacyGraphGrossDelta
    if (delta != null && delta > 15) {
      graphEvidenceScore -= 8
      reasons.push({
        type: 'graph_legacy_delta_penalty',
        label: 'Large AI vs graph score discrepancy',
        impact: 8,
        direction: 'penalty',
        details: `|legacy - graph| gross delta: ${delta.toFixed(1)} inches.`,
      })
      graphEvidenceReasons.push(`Legacy-graph delta ${delta.toFixed(1)}" -8`)
    } else if (delta != null && delta > 8) {
      graphEvidenceScore -= 4
      reasons.push({
        type: 'graph_legacy_delta_penalty',
        label: 'Moderate AI vs graph score discrepancy',
        impact: 4,
        direction: 'penalty',
        details: `|legacy - graph| gross delta: ${delta.toFixed(1)} inches.`,
      })
      graphEvidenceReasons.push(`Legacy-graph delta ${delta.toFixed(1)}" -4`)
    }

    total += graphEvidenceScore
  }

  const finalConfidence = clamp(Math.round(total), 5, 99)

  let confidenceBand: ConfidenceResult['confidenceBand'] = 'low'
  if (finalConfidence >= 75) confidenceBand = 'high'
  else if (finalConfidence >= 45) confidenceBand = 'medium'

  return {
    rawConfidence: inputs.rawConfidence,
    finalConfidence,
    confidenceBand,
    reasons: reasons.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact)),
    componentScores: {
      baseScore,
      coverageScore,
      imageQualityScore,
      referenceScore,
      completenessScore,
      fallbackScore,
      calibrationScore,
      symmetryScore,
      deductionScore,
      graphEvidenceScore,
    },
    confidenceEvidence: ge
      ? {
          graphSource: ge.graphSource ?? null,
          graphCompleteness: ge.graphCompleteness ?? null,
          correctedSegmentCount: ge.correctedSegmentCount ?? null,
          inferredSegmentCount: ge.inferredSegmentCount ?? null,
          lowConfidenceSegmentCount: ge.lowConfidenceSegmentCount ?? null,
          legacyGraphGrossDelta: ge.legacyGraphGrossDelta ?? null,
          reasons: graphEvidenceReasons,
        }
      : null,
  }
}
