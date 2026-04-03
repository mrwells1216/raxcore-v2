import { NextRequest, NextResponse } from 'next/server'
import { getOutlierRecords, createOutlierRecord, markExampleAsOutlier } from '@/lib/health'
import type { OutlierType, OutlierSeverity } from '@/lib/types'

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const exampleId = searchParams.get('example_id')
    const outlierType = searchParams.get('outlier_type') as OutlierType | null
    const severity = searchParams.get('severity') as OutlierSeverity | null
    const resolved = searchParams.get('resolved')
    const limit = parseInt(searchParams.get('limit') || '50')

    const outliers = await getOutlierRecords({
      exampleId: exampleId || undefined,
      outlierType: outlierType || undefined,
      severity: severity || undefined,
      resolved: resolved !== null ? resolved === 'true' : undefined,
      limit,
    })

    return NextResponse.json({ outliers })
  } catch (error) {
    console.error('Failed to get outlier records:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get outliers' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    if (!body.training_example_id) {
      return NextResponse.json(
        { error: 'training_example_id is required' },
        { status: 400 }
      )
    }

    if (!body.outlier_type) {
      return NextResponse.json(
        { error: 'outlier_type is required' },
        { status: 400 }
      )
    }

    if (!body.severity) {
      return NextResponse.json(
        { error: 'severity is required' },
        { status: 400 }
      )
    }

    if (!body.reason) {
      return NextResponse.json(
        { error: 'reason is required' },
        { status: 400 }
      )
    }

    const outlier = await createOutlierRecord(
      body.training_example_id,
      body.outlier_type,
      body.severity,
      body.reason,
      body.statistical_details
    )

    return NextResponse.json({ outlier })
  } catch (error) {
    console.error('Failed to create outlier record:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create outlier' },
      { status: 500 }
    )
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()

    if (!body.training_example_id) {
      return NextResponse.json(
        { error: 'training_example_id is required' },
        { status: 400 }
      )
    }

    await markExampleAsOutlier(
      body.training_example_id,
      body.is_outlier ?? true,
      body.review_reason
    )

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to update outlier status:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update outlier' },
      { status: 500 }
    )
  }
}
