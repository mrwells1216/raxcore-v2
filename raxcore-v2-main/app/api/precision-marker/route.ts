import { NextResponse } from 'next/server'
import {
  DEFAULT_MARKER_EDGE_INCHES,
  buildPrecisionMarkerSvg,
  normalizeReferenceSizeInches,
  type ReferenceSizeUnit,
} from '@/lib/scoring/precision-marker'

export function GET(request: Request) {
  const url = new URL(request.url)
  const value = url.searchParams.get('edge')
  const unit = (url.searchParams.get('unit') ?? 'in') as ReferenceSizeUnit
  const edgeInches =
    normalizeReferenceSizeInches(value, unit) ?? DEFAULT_MARKER_EDGE_INCHES
  const boundedEdge = Math.max(1, Math.min(4, edgeInches))
  const svg = buildPrecisionMarkerSvg({ edgeInches: boundedEdge })

  return new NextResponse(svg, {
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'public, max-age=3600',
      'content-disposition': `inline; filename="raxcore-${boundedEdge.toFixed(2)}in-marker.svg"`,
    },
  })
}
