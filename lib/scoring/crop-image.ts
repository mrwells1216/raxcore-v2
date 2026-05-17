import 'server-only'
import sharp from 'sharp'
import type { CropRegion } from '@/components/scoring/antler-crop-box'

export interface CropResult {
  croppedBuffer: Buffer
  /** Original image dimensions in pixels */
  originalWidth: number
  originalHeight: number
  /** Final crop window in original pixels (after padding + clamping) */
  cropPxX: number
  cropPxY: number
  cropPxWidth: number
  cropPxHeight: number
  /** Padding fraction actually applied (0 when skipped) */
  paddingApplied: number
  /** MIME type of the produced buffer */
  contentType: string
}

const DEFAULT_PADDING = 0.12
const MIN_CROP_FRACTION = 0.20
const SKIP_PADDING_THRESHOLD = 0.90

export async function cropImageToRegion(
  imageBuffer: Buffer,
  region: CropRegion,
  options?: { paddingFraction?: number },
): Promise<CropResult | null> {
  if (
    !region ||
    !isFiniteNumber(region.x) || !isFiniteNumber(region.y) ||
    !isFiniteNumber(region.width) || !isFiniteNumber(region.height)
  ) {
    return null
  }
  if (region.width <= 0 || region.height <= 0) return null
  if (region.x < 0 || region.y < 0) return null
  if (region.x + region.width > 1.001 || region.y + region.height > 1.001) {
    return null
  }

  try {
    const img = sharp(imageBuffer, { failOn: 'none' })
    const meta = await img.metadata()
    const originalWidth = meta.width ?? 0
    const originalHeight = meta.height ?? 0
    if (originalWidth <= 0 || originalHeight <= 0) return null

    const cropPxX = Math.round(region.x * originalWidth)
    const cropPxY = Math.round(region.y * originalHeight)
    const cropPxW = Math.round(region.width * originalWidth)
    const cropPxH = Math.round(region.height * originalHeight)

    const paddingFraction = options?.paddingFraction ?? DEFAULT_PADDING
    const cropCoversMost =
      region.width >= SKIP_PADDING_THRESHOLD ||
      region.height >= SKIP_PADDING_THRESHOLD
    const effectivePadding = cropCoversMost ? 0 : paddingFraction

    const padX = Math.round(cropPxW * effectivePadding)
    const padY = Math.round(cropPxH * effectivePadding)

    let left = Math.max(0, cropPxX - padX)
    let top = Math.max(0, cropPxY - padY)
    let right = Math.min(originalWidth, cropPxX + cropPxW + padX)
    let bottom = Math.min(originalHeight, cropPxY + cropPxH + padY)

    let width = right - left
    let height = bottom - top

    if (width < originalWidth * MIN_CROP_FRACTION) return null
    if (height < originalHeight * MIN_CROP_FRACTION) return null

    const contentType = meta.format === 'png' ? 'image/png' : 'image/jpeg'
    const pipeline = sharp(imageBuffer, { failOn: 'none' }).extract({
      left,
      top,
      width,
      height,
    })
    const croppedBuffer =
      contentType === 'image/png'
        ? await pipeline.png().toBuffer()
        : await pipeline.jpeg({ quality: 85 }).toBuffer()

    return {
      croppedBuffer,
      originalWidth,
      originalHeight,
      cropPxX: left,
      cropPxY: top,
      cropPxWidth: width,
      cropPxHeight: height,
      paddingApplied: effectivePadding,
      contentType,
    }
  } catch (err) {
    console.warn('[crop-image] sharp failed:', err instanceof Error ? err.message : String(err))
    return null
  }
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}
