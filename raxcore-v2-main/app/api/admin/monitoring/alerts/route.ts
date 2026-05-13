/**
 * Phase 39: Admin monitoring alerts endpoint
 *
 * GET  /api/admin/monitoring/alerts  — run alert check and return summary
 * POST /api/admin/monitoring/cleanup — clean up events older than 30 days
 *
 * Intended to be called from:
 *  - A Vercel cron job (vercel.json crons or edge cron)
 *  - The admin monitoring page (manual trigger)
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  maybeCreateMonitoringAlerts,
  runEventCleanup,
  getEventSummary,
} from '@/lib/monitoring/service'

export async function GET(request: NextRequest) {
  try {
    // Run alert checks for the last hour with default thresholds
    await maybeCreateMonitoringAlerts(1, 30, 50)

    // Return a summary for the caller
    const [score, vision, render] = await Promise.all([
      getEventSummary(1, 'score'),
      getEventSummary(1, 'vision'),
      getEventSummary(1, 'render'),
    ])

    return NextResponse.json({
      ok: true,
      checked: true,
      summary: { score, vision, render },
    })
  } catch (error) {
    console.error('[monitoring-alerts] alert check failed:', error)
    return NextResponse.json({ ok: false, error: 'Alert check failed' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const action = body?.action as string | undefined

    if (action === 'cleanup') {
      const result = await runEventCleanup()
      return NextResponse.json({ ok: true, deleted: result.deleted })
    }

    return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 })
  } catch (error) {
    console.error('[monitoring-alerts] cleanup failed:', error)
    return NextResponse.json({ ok: false, error: 'Cleanup failed' }, { status: 500 })
  }
}
