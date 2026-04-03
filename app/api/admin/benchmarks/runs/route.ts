import { NextRequest, NextResponse } from 'next/server'
import {
  createBenchmarkRun,
  listBenchmarkRuns,
} from '@/lib/benchmark/service'
import type { BenchmarkRunInput } from '@/lib/types'

// GET /api/admin/benchmarks/runs - List all benchmark runs
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const packId = searchParams.get('packId') || undefined
    const purpose = searchParams.get('purpose') || undefined
    const limit = parseInt(searchParams.get('limit') || '20')
    const offset = parseInt(searchParams.get('offset') || '0')

    const { data, count } = await listBenchmarkRuns({
      packId,
      purpose,
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
    console.error('Error listing benchmark runs:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to list benchmark runs' },
      { status: 500 }
    )
  }
}

// POST /api/admin/benchmarks/runs - Create and start a new benchmark run
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      benchmark_pack_id,
      run_purpose,
      run_notes,
      active_model_version_id,
      candidate_model_version_id,
      active_calibration_profile_id,
      candidate_calibration_profile_id,
      guardrail_config,
    } = body as BenchmarkRunInput

    if (!benchmark_pack_id) {
      return NextResponse.json(
        { success: false, error: 'Benchmark pack ID is required' },
        { status: 400 }
      )
    }

    const run = await createBenchmarkRun({
      benchmark_pack_id,
      run_purpose,
      run_notes,
      active_model_version_id,
      candidate_model_version_id,
      active_calibration_profile_id,
      candidate_calibration_profile_id,
      guardrail_config,
    })

    return NextResponse.json({
      success: true,
      data: run,
    })
  } catch (error) {
    console.error('Error creating benchmark run:', error)
    const message = error instanceof Error ? error.message : 'Failed to create benchmark run'
    return NextResponse.json(
      { success: false, error: message },
      { status: 400 }
    )
  }
}
