import { NextRequest, NextResponse } from 'next/server'
import {
  getLumaReconstructionStatus,
  isLumaReconstructionConfigured,
} from '@/lib/reconstruction/luma-adapter'
import { getWebhookResult } from '@/lib/reconstruction/webhook-cache'

export async function POST(request: NextRequest) {
  let externalJobId: string | null = null

  try {
    const body = await request.json()
    externalJobId = typeof body.externalJobId === 'string' ? body.externalJobId : null
  } catch {
    return NextResponse.json({ error: 'Invalid reconstruction status request body.' }, { status: 400 })
  }

  if (!externalJobId) {
    return NextResponse.json({ error: 'externalJobId is required.' }, { status: 400 })
  }

  const cached = getWebhookResult(externalJobId)
  if (cached) {
    return NextResponse.json({
      provider: 'luma',
      externalJobId,
      status: cached.status,
      progress: cached.progress,
      assets: cached.assets,
      message: cached.message,
    })
  }

  if (!isLumaReconstructionConfigured()) {
    console.warn('[reconstruction] unavailable', { reason: 'missing_luma_config' })
    return NextResponse.json({
      provider: 'manual',
      externalJobId,
      status: 'requires_manual_upload',
      progress: 0,
      assets: [],
      message: 'Luma reconstruction is not configured. Use manual upload fallback.',
    })
  }

  try {
    const result = await getLumaReconstructionStatus({ externalJobId })
    console.log('[reconstruction] status', {
      provider: 'luma',
      externalJobId,
      status: result.status,
      progress: result.progress,
    })

    return NextResponse.json({
      provider: 'luma',
      externalJobId,
      status: result.status,
      progress: result.progress,
      assets: result.assets,
      message: result.message ?? null,
    })
  } catch (error) {
    console.warn('[reconstruction] unavailable', { reason: 'provider_status_failed' })
    return NextResponse.json({
      provider: 'manual',
      externalJobId,
      status: 'requires_manual_upload',
      progress: 0,
      assets: [],
      message: error instanceof Error
        ? `Luma status unavailable: ${error.message}. Use manual upload fallback.`
        : 'Luma status unavailable. Use manual upload fallback.',
    })
  }
}
