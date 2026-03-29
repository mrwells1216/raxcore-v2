import { NextRequest, NextResponse } from 'next/server'
import { listEvaluationRuns, createEvaluationRun } from '@/lib/sandbox'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const variantId = searchParams.get('variant') || undefined

    const { data: runs } = await listEvaluationRuns({
      variantId,
      limit: 50,
    })

    return NextResponse.json({ runs })
  } catch (error) {
    console.error('Error fetching evaluations:', error)
    return NextResponse.json(
      { error: 'Failed to fetch evaluations' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    const run = await createEvaluationRun({
      variantId: body.variant_id,
      datasetType: body.dataset_type,
      exportPackId: body.export_pack_id,
      benchmarkPackId: body.benchmark_pack_id,
      config: body.config,
      notes: body.notes,
    })

    return NextResponse.json({ run })
  } catch (error) {
    console.error('Error creating evaluation:', error)
    return NextResponse.json(
      { error: 'Failed to create evaluation' },
      { status: 500 }
    )
  }
}
