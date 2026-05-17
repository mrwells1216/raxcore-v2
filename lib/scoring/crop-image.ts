import 'server-only'
import sharp from 'sharp'
import type { CropRegion } from '@/components/scoring/antler-crop-box'

export interface CropResult {
  croppedBuffer: Buffer
  originalWidth: number
  originalHeight: number
  cropPxX: number
  cropPxY: number
  cropPxWidth: number
  cropPxHeight: number
  paddingApplied: number
}

const DEFAULT_PADDING_FRACTION = 0.12
const MIN_DIMENSION_FRACTION = 0.20
const SKIP_PADDING_THRESHOLD = 0.90

export async function cropImageToRegion(
  imageBuffer: Buffer,
  region: CropRegion,
  options?: { paddingFraction?: number },
): Promise<CropResult | null> {
  if (
    !region ||
    !Number.isFinite(region.x) ||
    !Number.isFinite(region.y) ||
    !Number.isFinite(region.width) ||
    !Number.isFinite(region.height) ||
    region.width <= 0 ||
    region.height <= 0 ||
    region.x < 0 ||
    region.y < 0 ||
    region.x + region.width > 1.0001 ||
    region.y + region.height > 1.0001
  ) {
    return null
  }

  try {
    const meta = await sharp(imageBuffer).metadata()
    const origW = meta.width ?? 0
    const origH = meta.height ?? 0
    if (origW <= 0 || origH <= 0) return null

    let cropW = region.width * origW
    let cropH = region.height * origH
    let cropX = region.x * origW
    let cropY = region.y * origH

    const requestedPad = options?.paddingFraction ?? DEFAULT_PADDING_FRACTION
    const tooLarge =
      region.width >= SKIP_PADDING_THRESHOLD || region.height >= SKIP_PADDING_THRESHOLD
    const padFraction = tooLarge ? 0 : Math.max(0, requestedPad)

    const padX = cropW * padFraction
    const padY = cropH * padFraction

    let left = Math.max(0, Math.floor(cropX - padX))
    let top = Math.max(0, Math.floor(cropY - padY))
    let right = Math.min(origW, Math.ceil(cropX + cropW + padX))
    let bottom = Math.min(origH, Math.ceil(cropY + cropH + padY))

    let width = right - left
    let height = bottom - top

    if (
      width < origW * MIN_DIMENSION_FRACTION ||
      height < origH * MIN_DIMENSION_FRACTION
    ) {
      return null
    }

    if (width <= 0 || height <= 0) return null

    const croppedBuffer = await sharp(imageBuffer)
      .extract({ left, top, width, height })
      .jpeg({ quality: 90 })
      .toBuffer()

    return {
      croppedBuffer,
      originalWidth: origW,
      originalHeight: origH,
      cropPxX: left,
      cropPxY: top,
      cropPxWidth: width,
      cropPxHeight: height,
      paddingApplied: padFraction,
    }
  } catch (err) {
    console.warn('[crop-image] sharp extract failed:', err)
    return null
  }
}
