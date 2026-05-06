import { NextRequest, NextResponse } from 'next/server'
import {
  isLumaReconstructionConfigured,
  submitLumaReconstructionJob,
  LumaConfigurationError,
} from '@/lib/reconstruction/luma-adapter'
import type { ReconstructionInputImage, ReconstructionJob } from '@/lib/reconstruction/types'

const MIN_RECONSTRUCTION_IMAGES = 8
const RECOMMENDED_RECONSTRUCTION_IMAGES = 12

function nowIso(): string {
  return new Date().toISOString()
}

function isValidImage(image: unknown): image is ReconstructionInputImage {
  if (!image || typeof image !== 'object') return false
  const record = image as Partial<ReconstructionInputImage>
  const hasSource = typeof record.url === 'string' || typeof record.dataUrl === 'string'
  return typeof record.id === 'string' && typeof record.fileName === 'string' && hasSource
}

function manualFallbackJob(images: ReconstructionInputImage[], message: string): ReconstructionJob {
  const timestamp = nowIso()
  return {
    id: `manual_${Date.now()}`,
    provider: 'manual',
    externalJobId: null,
    status: 'requires_manual_upload',
    progress: 0,
    message,
    inputImages: images,
    assets: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

export async function POST(request: NextRequest) {
  let body: {
    images?: unknown
    allowLowPhotoCount?: boolean
    callbackUrl?: string | null
  }

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid reconstruction request body.' }, { status: 400 })
  }

  const images = Array.isArray(body.images) ? body.images.filter(isValidImage) : []
  if (images.length === 0) {
    return NextResponse.json({ error: 'At least one reconstruction image is required.' }, { status: 400 })
  }

  if (images.length < MIN_RECONSTRUCTION_IMAGES && body.allowLowPhotoCount !== true) {
    return NextResponse.json(
      {
        error: `At least ${MIN_RECONSTRUCTION_IMAGES} photos are required unless low-photo-count submission is confirmed.`,
        warning: `${RECOMMENDED_RECONSTRUCTION_IMAGES}+ photos are recommended for professional reconstruction quality.`,
        requiredConfirmation: 'allowLowPhotoCount',
      },
      { status: 400 },
    )
  }

  console.log('[reconstruction] submit', { provider: isLumaReconstructionConfigured() ? 'luma' : 'manual', imageCount: images.length })

  if (!isLumaReconstructionConfigured()) {
    console.warn('[reconstruction] unavailable', { reason: 'missing_luma_config' })
    return NextResponse.json({
      job: manualFallbackJob(
        images,
        'Luma reconstruction is not configured. Use manual GLB, point cloud, or splat upload fallback.',
      ),
      warning: `${RECOMMENDED_RECONSTRUCTION_IMAGES}+ photos are recommended for best reconstruction quality.`,
    })
  }

  try {
    const result = await submitLumaReconstructionJob({
      images,
      callbackUrl: typeof body.callbackUrl === 'string' ? body.callbackUrl : null,
    })
    const timestamp = nowIso()
    const job: ReconstructionJob = {
      id: `luma_${result.externalJobId}`,
      provider: 'luma',
      externalJobId: result.externalJobId,
      status: result.status,
      progress: result.status === 'completed' ? 100 : 0,
      message: 'Reconstructing 3D model - this can take several minutes.',
      inputImages: images,
      assets: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    return NextResponse.json({
      job,
      warning: images.length < RECOMMENDED_RECONSTRUCTION_IMAGES
        ? `${RECOMMENDED_RECONSTRUCTION_IMAGES}+ photos are recommended for best reconstruction quality.`
        : null,
    })
  } catch (error) {
    const reason = error instanceof LumaConfigurationError ? 'missing_luma_config' : 'provider_submit_failed'
    console.warn('[reconstruction] unavailable', { reason })
    return NextResponse.json({
      job: manualFallbackJob(
        images,
        error instanceof Error
          ? `Luma reconstruction unavailable: ${error.message}. Use manual upload fallback.`
          : 'Luma reconstruction unavailable. Use manual upload fallback.',
      ),
      warning: `${RECOMMENDED_RECONSTRUCTION_IMAGES}+ photos are recommended for best reconstruction quality.`,
    })
  }
}
