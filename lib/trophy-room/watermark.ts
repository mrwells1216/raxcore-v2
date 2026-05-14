import 'server-only'
import sharp from 'sharp'
import type { TrophyScoringSystem } from './types'

const SCORING_SYSTEM_LABEL: Record<TrophyScoringSystem, string> = {
  bc_typical: 'B&C TYPICAL',
  bc_nontypical: 'B&C NON-TYPICAL',
  py_typical: 'P&Y TYPICAL',
  py_nontypical: 'P&Y NON-TYPICAL',
}

const FRACTION_MAP: Record<number, string> = {
  1: '⅛', 2: '¼', 3: '⅜', 4: '½',
  5: '⅝', 6: '¾', 7: '⅞',
}

export function formatScoreWithFraction(score: number): string {
  if (!isFinite(score)) return '—'
  const sign = score < 0 ? '-' : ''
  const abs = Math.abs(score)
  const whole = Math.floor(abs)
  const eighths = Math.round((abs - whole) * 8)
  if (eighths === 0) return `${sign}${whole}`
  if (eighths === 8) return `${sign}${whole + 1}`
  return `${sign}${whole} ${FRACTION_MAP[eighths]}`
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export interface WatermarkInput {
  sourceImageUrl: string
  grossScore: number
  netScore: number | null
  scoringSystem: TrophyScoringSystem
  isVerified: boolean
  buckName: string | null
}

/**
 * Generates a watermarked trophy image with score overlay, RAX CORE logo,
 * and scoring system badge. Returns a JPEG buffer at quality 90.
 */
export async function generateTrophyWatermark(input: WatermarkInput): Promise<Buffer> {
  // 1. Fetch source image
  const res = await fetch(input.sourceImageUrl)
  if (!res.ok) throw new Error(`Failed to fetch source image: ${res.status}`)
  const sourceBuffer = Buffer.from(await res.arrayBuffer())

  // 2. Resize to max 2400px width, preserving aspect ratio
  const resized = sharp(sourceBuffer).resize({ width: 2400, withoutEnlargement: true })
  const meta = await resized.metadata()
  const width = meta.width ?? 2400
  const height = meta.height ?? Math.round(width * 0.66)

  // 3. Build the SVG badge overlay sized to image width and 30% of height
  const badgeHeight = Math.round(height * 0.32)
  const badgeY = height - badgeHeight

  const grossText = escapeXml(formatScoreWithFraction(input.grossScore))
  const systemLabel = SCORING_SYSTEM_LABEL[input.scoringSystem]
  const verifiedSuffix = input.isVerified ? ' · VERIFIED' : ''
  const systemText = escapeXml(`${systemLabel}${verifiedSuffix}`)
  const buckNameText = input.buckName ? escapeXml(input.buckName.slice(0, 40)) : ''
  const netText = input.netScore != null ? escapeXml(formatScoreWithFraction(input.netScore)) : ''

  // Scale fonts based on image width (designed at 2400px reference)
  const scale = width / 2400
  const fs = (size: number) => Math.round(size * scale)
  const xPad = Math.round(80 * scale)

  const svg = `
<svg width="${width}" height="${badgeHeight}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%"   stop-color="rgba(0,0,0,0)"/>
      <stop offset="100%" stop-color="rgba(0,0,0,0.72)"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="${width}" height="${badgeHeight}" fill="url(#bg)"/>
  ${buckNameText ? `<text x="${width / 2}" y="${fs(120)}" text-anchor="middle"
        font-family="Georgia, serif" font-size="${fs(72)}" font-weight="600"
        fill="rgba(232,213,179,0.95)" letter-spacing="0.04em">${buckNameText}</text>` : ''}
  <text x="${xPad}" y="${badgeHeight - fs(120)}" font-family="Helvetica, Arial, sans-serif" font-size="${fs(240)}" font-weight="800"
        fill="#e8d5b3" letter-spacing="-0.02em">${grossText}</text>
  <text x="${xPad}" y="${badgeHeight - fs(40)}" font-family="Helvetica, Arial, sans-serif" font-size="${fs(44)}" font-weight="400"
        fill="rgba(232,213,179,0.7)" letter-spacing="0.18em">${systemText}</text>
  <text x="${width / 2}" y="${badgeHeight - fs(60)}" text-anchor="middle"
        font-family="Helvetica, Arial, sans-serif" font-size="${fs(56)}" font-weight="700"
        fill="rgba(232,213,179,0.85)" letter-spacing="0.32em">RAX CORE</text>
  ${netText ? `<text x="${width - xPad}" y="${badgeHeight - fs(100)}" text-anchor="end"
        font-family="Helvetica, Arial, sans-serif" font-size="${fs(64)}" font-weight="600"
        fill="rgba(232,213,179,0.85)">${netText}</text>
  <text x="${width - xPad}" y="${badgeHeight - fs(50)}" text-anchor="end"
        font-family="Helvetica, Arial, sans-serif" font-size="${fs(32)}"
        fill="rgba(232,213,179,0.55)" letter-spacing="0.12em">NET</text>` : ''}
</svg>
`.trim()

  // 4. Composite and output JPEG
  return await sharp(sourceBuffer)
    .resize({ width: 2400, withoutEnlargement: true })
    .composite([{ input: Buffer.from(svg), top: badgeY, left: 0 }])
    .jpeg({ quality: 90 })
    .toBuffer()
}

export const TROPHY_WATERMARKS_BUCKET = 'trophy-watermarks'
