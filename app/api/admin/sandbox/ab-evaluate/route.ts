import { NextRequest, NextResponse } from 'next/server'
import { runAbEvaluation } from '@/lib/sandbox/ab-runner'

// Evaluates two variants over a benchmark pack (two full scoring passes), so
// allow the full window — the §3.30 precision-pass pattern.
export const maxDuration = 300

// POST /api/admin/sandbox/ab-evaluate
// Body: { candidateVariantId, benchmarkPackId, productionVariantId? }
// Runs the candidate + production variants against the pack, compares them, and
// returns a promote / review / reject recommendation. Never promotes.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { candidateVariantId, benchmarkPackId, productionVariantId } = body as {
      candidateVariantId?: string
      benchmarkPackId?: string
      productionVariantId?: string
    }

    if (!candidateVariantId || !benchmarkPackId) {
      return NextResponse.json(
        { success: false, error: 'candidateVariantId and benchmarkPackId are required' },
        { status: 400 }
      )
    }

    const result = await runAbEvaluation({
      candidateVariantId,
      benchmarkPackId,
      productionVariantId,
    })

    return NextResponse.json({ success: true, data: result })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to run A/B evaluation'
    console.error('Error running A/B evaluation:', error)
    // Client-actionable validation errors come back as 400; everything else 500.
    const isValidation = /not found|must differ|to compare against|required/i.test(message)
    return NextResponse.json(
      { success: false, error: message },
      { status: isValidation ? 400 : 500 }
    )
  }
}
