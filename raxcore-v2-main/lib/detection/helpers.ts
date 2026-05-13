import type {
  DetectionImageAnalysis,
  DetectionIssue,
  LandmarkConfidenceBand,
  RackLandmark,
  Point2D,
} from './types'

export function toBand(confidence: number): LandmarkConfidenceBand {
  if (confidence >= 0.8) return 'high'
  if (confidence >= 0.55) return 'medium'
  return 'low'
}

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

export function avg(values: number[]): number {
  if (!values.length) return 0
  return values.reduce((sum, n) => sum + n, 0) / values.length
}

export function pickBestImageIndex(
  images: DetectionImageAnalysis[],
  predicate: (img: DetectionImageAnalysis) => boolean,
  score: (img: DetectionImageAnalysis) => number,
): number | null {
  const candidates = images.filter(predicate)
  if (!candidates.length) return null
  const best = [...candidates].sort((a, b) => score(b) - score(a))[0]
  return best.imageIndex
}

export function pointDistance(a: Point2D | null, b: Point2D | null): number | null {
  if (!a || !b) return null
  const dx = a.x - b.x
  const dy = a.y - b.y
  return Math.sqrt(dx * dx + dy * dy)
}

export function getLandmark(
  landmarks: RackLandmark[],
  key: string,
): RackLandmark | undefined {
  return landmarks.find(l => l.key === key)
}

export function mergeIssues(...groups: DetectionIssue[][]): DetectionIssue[] {
  const seen = new Set<string>()
  const merged: DetectionIssue[] = []

  for (const group of groups) {
    for (const item of group) {
      const k = `${item.code}:${item.message}`
      if (seen.has(k)) continue
      seen.add(k)
      merged.push(item)
    }
  }

  return merged
}

export function chooseBestLandmark(
  images: DetectionImageAnalysis[],
  key: string,
): RackLandmark | null {
  const matches = images
    .map(img => getLandmark(img.landmarks, key))
    .filter((x): x is RackLandmark => !!x && !!x.point && x.visible)

  if (!matches.length) return null

  return [...matches].sort((a, b) => b.confidence - a.confidence)[0]
}

export function computeImageCompositeScore(img: DetectionImageAnalysis): number {
  return (
    img.usableFrameScore * 0.35 +
    img.antlerPresenceConfidence * 0.25 +
    img.rackVisibilityConfidence * 0.2 +
    (1 - img.occlusionScore) * 0.1 +
    img.lightingScore * 0.05 +
    (1 - img.blurScore) * 0.05
  )
}

export function isAcceptedSubject(img: DetectionImageAnalysis): boolean {
  return (
    (img.subjectType === 'deer' ||
      img.subjectType === 'mounted_deer' ||
      img.subjectType === 'shed_antlers') &&
    img.antlerPresenceConfidence >= 0.45 &&
    img.usableFrameScore >= 0.45
  )
}
