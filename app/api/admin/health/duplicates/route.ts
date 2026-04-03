import { NextRequest, NextResponse } from 'next/server'
import { getDuplicateClusters, createDuplicateCluster } from '@/lib/health'

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const resolved = searchParams.get('resolved')
    const clusterType = searchParams.get('cluster_type') as 'exact' | 'near' | 'suspected' | null
    const limit = parseInt(searchParams.get('limit') || '50')

    const clusters = await getDuplicateClusters({
      resolved: resolved !== null ? resolved === 'true' : undefined,
      clusterType: clusterType || undefined,
      limit,
    })

    return NextResponse.json({ clusters })
  } catch (error) {
    console.error('Failed to get duplicate clusters:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get duplicates' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    if (!body.cluster_type) {
      return NextResponse.json(
        { error: 'cluster_type is required' },
        { status: 400 }
      )
    }

    if (!body.member_ids || !Array.isArray(body.member_ids) || body.member_ids.length < 2) {
      return NextResponse.json(
        { error: 'member_ids must be an array with at least 2 items' },
        { status: 400 }
      )
    }

    const cluster = await createDuplicateCluster(
      body.cluster_type,
      body.reason || 'Manual duplicate detection',
      body.member_ids,
      body.primary_id
    )

    return NextResponse.json({ cluster })
  } catch (error) {
    console.error('Failed to create duplicate cluster:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create cluster' },
      { status: 500 }
    )
  }
}
