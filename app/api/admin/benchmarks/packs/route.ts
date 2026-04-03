import { NextRequest, NextResponse } from 'next/server'
import {
  createBenchmarkPack,
  listBenchmarkPacks,
} from '@/lib/benchmark/service'
import type { BenchmarkPackInput } from '@/lib/types'

// GET /api/admin/benchmarks/packs - List all benchmark packs
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const includeArchived = searchParams.get('includeArchived') === 'true'
    const tags = searchParams.get('tags')?.split(',').filter(Boolean)
    const limit = parseInt(searchParams.get('limit') || '20')
    const offset = parseInt(searchParams.get('offset') || '0')

    const { data, count } = await listBenchmarkPacks({
      includeArchived,
      tags,
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
    console.error('Error listing benchmark packs:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to list benchmark packs' },
      { status: 500 }
    )
  }
}

// POST /api/admin/benchmarks/packs - Create a new benchmark pack
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { name, description, tags, example_ids } = body as BenchmarkPackInput

    if (!name) {
      return NextResponse.json(
        { success: false, error: 'Pack name is required' },
        { status: 400 }
      )
    }

    if (!example_ids || example_ids.length === 0) {
      return NextResponse.json(
        { success: false, error: 'At least one example is required' },
        { status: 400 }
      )
    }

    const pack = await createBenchmarkPack({
      name,
      description,
      tags,
      example_ids,
    })

    return NextResponse.json({
      success: true,
      data: pack,
    })
  } catch (error) {
    console.error('Error creating benchmark pack:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to create benchmark pack' },
      { status: 500 }
    )
  }
}
