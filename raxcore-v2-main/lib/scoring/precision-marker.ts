export type ReferenceSizeUnit = 'in' | 'cm' | 'mm'

export type ReferencePlacement =
  | 'same_depth_plane'
  | 'near_antler_plane'
  | 'in_front_or_behind'
  | 'unknown'

export const DEFAULT_MARKER_EDGE_INCHES = 2

export function normalizeReferenceSizeInches(
  value: number | string | null | undefined,
  unit: ReferenceSizeUnit | string | null | undefined,
): number | null {
  const numericValue =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseFloat(value)
        : Number.NaN

  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return null
  }

  switch (unit) {
    case 'cm':
      return numericValue / 2.54
    case 'mm':
      return numericValue / 25.4
    case 'in':
    default:
      return numericValue
  }
}

export function getPlacementQualityMultiplier(
  placement: ReferencePlacement | string | null | undefined,
): number {
  switch (placement) {
    case 'same_depth_plane':
      return 1
    case 'near_antler_plane':
      return 0.85
    case 'unknown':
      return 0.65
    case 'in_front_or_behind':
      return 0.45
    default:
      return 0.65
  }
}

export function getPlacementLabel(
  placement: ReferencePlacement | string | null | undefined,
): string {
  switch (placement) {
    case 'same_depth_plane':
      return 'same depth plane as the rack'
    case 'near_antler_plane':
      return 'near the rack plane'
    case 'in_front_or_behind':
      return 'in front of or behind the rack plane'
    case 'unknown':
    default:
      return 'unknown rack-plane alignment'
  }
}

export function buildPrecisionMarkerSvg(params?: {
  edgeInches?: number | null
  label?: string | null
}): string {
  const edgeInches = params?.edgeInches && params.edgeInches > 0
    ? params.edgeInches
    : DEFAULT_MARKER_EDGE_INCHES
  const label = escapeXml(params?.label ?? 'RAXcore precision marker')
  const edgeUnits = 200
  const unitsPerInch = edgeUnits / edgeInches
  const pageWidth = Math.max(4, edgeInches + 2)
  const pageHeight = Math.max(5.25, edgeInches + 3.25)
  const viewWidth = Math.round(pageWidth * unitsPerInch)
  const viewHeight = Math.round(pageHeight * unitsPerInch)
  const left = Math.round((viewWidth - edgeUnits) / 2)
  const top = Math.round(unitsPerInch * 0.9)
  const cell = edgeUnits / 6
  const cells = [
    '111111',
    '100101',
    '101011',
    '110001',
    '101101',
    '111111',
  ]

  const pattern = cells.flatMap((row, y) =>
    row.split('').map((bit, x) => {
      const fill = bit === '1' ? '#000' : '#fff'
      return `<rect x="${left + x * cell}" y="${top + y * cell}" width="${cell}" height="${cell}" fill="${fill}"/>`
    }),
  ).join('')

  const rulerY = top + edgeUnits + Math.round(unitsPerInch * 0.45)
  const tickMarks = Array.from({ length: Math.floor(edgeInches * 4) + 1 }, (_, i) => {
    const x = left + (i / 4) * unitsPerInch
    const isInch = i % 4 === 0
    const height = isInch ? 18 : i % 2 === 0 ? 12 : 8
    const labelText = isInch ? `<text x="${x}" y="${rulerY + 38}" font-size="12" text-anchor="middle" fill="#111">${i / 4}</text>` : ''
    return `<line x1="${x}" y1="${rulerY}" x2="${x}" y2="${rulerY + height}" stroke="#111" stroke-width="1.5"/>${labelText}`
  }).join('')

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${pageWidth}in" height="${pageHeight}in" viewBox="0 0 ${viewWidth} ${viewHeight}">
  <rect width="100%" height="100%" fill="#fff"/>
  <text x="${viewWidth / 2}" y="${Math.round(unitsPerInch * 0.35)}" font-family="Arial, sans-serif" font-size="18" font-weight="700" text-anchor="middle" fill="#111">${label}</text>
  <text x="${viewWidth / 2}" y="${Math.round(unitsPerInch * 0.58)}" font-family="Arial, sans-serif" font-size="12" text-anchor="middle" fill="#333">Outer black square edge = ${edgeInches.toFixed(2)} in</text>
  <rect x="${left}" y="${top}" width="${edgeUnits}" height="${edgeUnits}" fill="#fff" stroke="#000" stroke-width="8"/>
  ${pattern}
  <rect x="${left}" y="${top}" width="${edgeUnits}" height="${edgeUnits}" fill="none" stroke="#000" stroke-width="8"/>
  <line x1="${left}" y1="${rulerY}" x2="${left + edgeInches * unitsPerInch}" y2="${rulerY}" stroke="#111" stroke-width="2"/>
  ${tickMarks}
  <text x="${viewWidth / 2}" y="${rulerY + 64}" font-family="Arial, sans-serif" font-size="12" text-anchor="middle" fill="#333">Print at actual size. Do not scale to fit.</text>
</svg>`
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}
