import { NextRequest, NextResponse } from 'next/server'
import {
  getBenchmarkRun,
  evaluateGuardrails,
  getPromotionReadiness,
} from '@/lib/benchmark/service'

// GET /api/admin/benchmarks/runs/[id] - Get a specific benchmark run with details
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { searchParams } = new URL(request.url)
    const includeReadiness = searchParams.get('includeReadiness') === 'true'

    const run = await getBenchmarkRun(id)

    if (!run) {
      return NextResponse.json(
        { success: false, error: 'Benchmark run not found' },
        { status: 404 }
      )
    }

    // If readiness is requested and run is complete, include promotion readiness
    if (includeReadiness && run.bulk_run_status === 'completed') {
      const readiness = await getPromotionReadiness(id)
      return NextResponse.json({
        success: true,
        data: run,
        readiness,
      })
    }

    return NextResponse.json({
      success: true,
      data: run,
    })
  } catch (error) {
    console.error('Error getting benchmark run:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to get benchmark run' },
      { status: 500 }
    )
  }
}

// POST /api/admin/benchmarks/runs/[id] - Re-evaluate guardrails
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { action } = body as { action: 'evaluate_guardrails' }

    if (action === 'evaluate_guardrails') {
      const result = await evaluateGuardrails(id)
      return NextResponse.json({
        success: true,
        data: result,
      })
    }

    return NextResponse.json(
      { success: false, error: 'Invalid action' },
      { status: 400 }
    )
  } catch (error) {
    console.error('Error processing benchmark run action:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to process action' },
      { status: 500 }
    )
  }
}
