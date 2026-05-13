import { NextResponse } from 'next/server'
import { normalizeLumaStatus, extractLumaAssets } from '@/lib/reconstruction/luma-adapter'
import { storeWebhookResult } from '@/lib/reconstruction/webhook-cache'

export async function POST(req: Request) {
  try {
    const body = await req.json()

    const externalJobId = typeof body?.externalJobId === 'string' ? body.externalJobId : null
    if (!externalJobId) {
      return NextResponse.json({ error: 'externalJobId is required.' }, { status: 400 })
    }

    const webhookSecret = process.env.LUMA_WEBHOOK_SECRET
    if (webhookSecret) {
      const signature = req.headers.get('x-luma-signature')
      if (signature !== webhookSecret) {
        return NextResponse.json({ error: 'Invalid webhook signature.' }, { status: 401 })
      }
    }

    const status = normalizeLumaStatus(body.status)
    const assets = extractLumaAssets(body.assets ?? [])
    const progress = typeof body.progress === 'number' ? body.progress : 0
    const message = typeof body.message === 'string' ? body.message : null

    storeWebhookResult(externalJobId, { status, progress, assets, message })

    console.log('[reconstruction/webhook] received', { externalJobId, status, assetCount: assets.length })

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('[reconstruction/webhook] failed', error)
    return NextResponse.json(
      { error: 'Webhook processing failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
