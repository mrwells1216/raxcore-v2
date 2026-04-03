import { NextRequest, NextResponse } from 'next/server'
import {
  createPromotionDecision,
  listPromotionDecisions,
} from '@/lib/benchmark/service'
import type { PromotionDecisionInput } from '@/lib/types'

// GET /api/admin/benchmarks/promotions - List all promotion decisions
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const decision = searchParams.get('decision') || undefined
    const modelVersionId = searchParams.get('modelVersionId') || undefined
    const limit = parseInt(searchParams.get('limit') || '20')
    const offset = parseInt(searchParams.get('offset') || '0')

    const { data, count } = await listPromotionDecisions({
      decision,
      modelVersionId,
      limit,
      offset,
    })

    return NextResponse.json({
      success: true,
      data,
      pagination: {
        total: count,
        limit,
        offset,
        hasMore: offset + data.length < count,
      },
    })
  } catch (error) {
    console.error('Error listing promotion decisions:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to list promotion decisions' },
      { status: 500 }
    )
  }
}

// POST /api/admin/benchmarks/promotions - Create a promotion decision
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      benchmark_run_id,
      decision,
      decision_reason,
      decision_notes,
      candidate_model_version_id,
      candidate_calibration_profile_id,
      active_model_version_id,
      active_calibration_profile_id,
      metrics_snapshot,
      guardrail_results,
      decided_by,
    } = body as PromotionDecisionInput

    if (!decision) {
      return NextResponse.json(
        { success: false, error: 'Decision is required' },
        { status: 400 }
      )
    }

    if (!decision_reason) {
      return NextResponse.json(
        { success: false, error: 'Decision reason is required' },
        { status: 400 }
      )
    }

    const promotionDecision = await createPromotionDecision({
      benchmark_run_id,
      decision,
      decision_reason,
      decision_notes,
      candidate_model_version_id,
      candidate_calibration_profile_id,
      active_model_version_id,
      active_calibration_profile_id,
      metrics_snapshot,
      guardrail_results,
      decided_by,
    })

    return NextResponse.json({
      success: true,
      data: promotionDecision,
    })
  } catch (error) {
    console.error('Error creating promotion decision:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to create promotion decision' },
      { status: 500 }
    )
  }
}
