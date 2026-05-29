import { NextRequest, NextResponse } from 'next/server'
import { getBenchmarkRun, evaluateGuardrails } from '@/lib/benchmark/service'
import {
  executeBulkValidationRun,
  BulkRunNotPendingError,
} from '@/lib/validation/bulk-service'

// Scoring an entire gold-standard pack can take minutes; allow the full window.
export const maxDuration = 300

// POST /api/admin/benchmarks/runs/[id]/execute
// Runs the benchmark end-to-end: score every example against ground truth, then
// evaluate regression guardrails. Mirrors the `benchmark_run` job pipeline but
// runs inline so the headline accuracy number can be produced without a worker.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    const run = await getBenchmarkRun(id)
    if (!run) {
      return NextResponse.json(
        { success: false, error: 'Benchmark run not found' },
        { status: 404 }
      )
    }
    if (!run.bulk_validation_run_id) {
      return NextResponse.json(
        { success: false, error: 'Benchmark run has no bulk validation run' },
        { status: 400 }
      )
    }

    const result = await executeBulkValidationRun(run.bulk_validation_run_id)
    const guardrails = await evaluateGuardrails(id)

    return NextResponse.json({
      success: true,
      data: {
        processed: result.processed,
        total: result.total,
        totalTimeMs: result.totalTimeMs,
        guardrailsPassed: guardrails.overall_passed,
        criticalFailures: guardrails.critical_failures,
        summaryMetrics: result.summaryMetrics,
      },
    })
  } catch (error) {
    if (error instanceof BulkRunNotPendingError) {
      return NextResponse.json(
        { success: false, error: 'This benchmark run has already been executed' },
        { status: 400 }
      )
    }
    console.error('Error executing benchmark run:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to execute benchmark run' },
      { status: 500 }
    )
  }
}
