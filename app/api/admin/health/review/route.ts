import { NextRequest, NextResponse } from 'next/server'
import { createHealthReviewDecision, getReviewDecisions } from '@/lib/health'
import { createAdminTask } from '@/lib/notifications/service'
import type { HealthReviewDecisionInput } from '@/lib/types'

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const exampleId = searchParams.get('example_id')

    if (!exampleId) {
      return NextResponse.json(
        { error: 'example_id is required' },
        { status: 400 }
      )
    }

    const decisions = await getReviewDecisions(exampleId)

    return NextResponse.json({ decisions })
  } catch (error) {
    console.error('Failed to get review decisions:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get decisions' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as HealthReviewDecisionInput

    if (!body.training_example_id) {
      return NextResponse.json(
        { error: 'training_example_id is required' },
        { status: 400 }
      )
    }

    if (!body.decision) {
      return NextResponse.json(
        { error: 'decision is required' },
        { status: 400 }
      )
    }

    if (!body.decision_reason) {
      return NextResponse.json(
        { error: 'decision_reason is required' },
        { status: 400 }
      )
    }

    const decision = await createHealthReviewDecision(body)

    // Phase 34: Create admin task when examples are flagged for review
    if (body.decision === 'needs_review' || body.decision === 'reject') {
      createAdminTask({
        type: 'review_example',
        title: `Training example flagged: ${body.decision}`,
        body: body.decision_reason,
        priority: body.decision === 'reject' ? 'high' : 'normal',
        linkHref: `/admin/dataset-health`,
        relatedId: body.training_example_id,
        relatedType: 'training_example',
      }).catch(err => console.error('[health-review] admin task error:', err))
    }

    return NextResponse.json({ decision })
  } catch (error) {
    console.error('Failed to create review decision:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create decision' },
      { status: 500 }
    )
  }
}
