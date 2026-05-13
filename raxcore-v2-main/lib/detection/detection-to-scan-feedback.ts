import type { MultiImageDetectionResult } from './types'

export interface ScanFeedback {
  accepted: boolean
  headline: string
  subline: string
  color: 'green' | 'yellow' | 'red'
  nextPrompt: string
  lowConfidenceSegments: string[]
}

export function detectionToScanFeedback(
  result: MultiImageDetectionResult,
): ScanFeedback {
  if (!result.accepted) {
    const first = result.rejectionReasons[0]

    return {
      accepted: false,
      headline: 'No usable rack detected',
      subline: first?.message ?? 'Try a clearer deer image with visible antlers.',
      color: 'red',
      nextPrompt: 'Center the deer and make sure the antlers are clearly visible.',
      lowConfidenceSegments: [],
    }
  }

  const graph = result.graph
  const weakSegments =
    graph?.edges
      .filter(edge => edge.confidence < 0.65)
      .map(edge => edge.id) ?? []

  const spreadReady = graph?.edges.some(edge => edge.id === 'spread') ?? false
  const leftReady = graph?.edges.some(edge => edge.id === 'beam_left') ?? false
  const rightReady = graph?.edges.some(edge => edge.id === 'beam_right') ?? false

  let nextPrompt = 'Add more angles to strengthen the rack model.'
  if (!spreadReady) nextPrompt = 'Get a cleaner front angle for spread.'
  else if (!leftReady) nextPrompt = 'Get a cleaner left-side angle.'
  else if (!rightReady) nextPrompt = 'Get a cleaner right-side angle.'
  else if (!weakSegments.length) nextPrompt = 'Rack coverage is strong. Ready for precision scoring.'

  return {
    accepted: true,
    headline: 'Rack detected',
    subline: `Detection confidence ${(result.overallConfidence * 100).toFixed(0)}%`,
    color: weakSegments.length ? 'yellow' : 'green',
    nextPrompt,
    lowConfidenceSegments: weakSegments,
  }
}
