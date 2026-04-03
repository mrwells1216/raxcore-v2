import { NextRequest, NextResponse } from 'next/server'
import {
  getBenchmarkPackExamples,
  addExamplesToBenchmarkPack,
  removeExamplesFromBenchmarkPack,
} from '@/lib/benchmark/service'

// GET /api/admin/benchmarks/packs/[id]/examples - Get all examples in a pack
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const examples = await getBenchmarkPackExamples(id)

    return NextResponse.json({
      success: true,
      data: examples,
      count: examples.length,
    })
  } catch (error) {
    console.error('Error getting benchmark pack examples:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to get benchmark pack examples' },
      { status: 500 }
    )
  }
}

// POST /api/admin/benchmarks/packs/[id]/examples - Add examples to a pack
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { example_ids } = body as { example_ids: string[] }

    if (!example_ids || example_ids.length === 0) {
      return NextResponse.json(
        { success: false, error: 'At least one example ID is required' },
        { status: 400 }
      )
    }

    const addedCount = await addExamplesToBenchmarkPack(id, example_ids)

    return NextResponse.json({
      success: true,
      added: addedCount,
      message: `Added ${addedCount} examples to pack`,
    })
  } catch (error) {
    console.error('Error adding examples to benchmark pack:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to add examples to benchmark pack' },
      { status: 500 }
    )
  }
}

// DELETE /api/admin/benchmarks/packs/[id]/examples - Remove examples from a pack
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { example_ids } = body as { example_ids: string[] }

    if (!example_ids || example_ids.length === 0) {
      return NextResponse.json(
        { success: false, error: 'At least one example ID is required' },
        { status: 400 }
      )
    }

    const removedCount = await removeExamplesFromBenchmarkPack(id, example_ids)

    return NextResponse.json({
      success: true,
      removed: removedCount,
      message: `Removed ${removedCount} examples from pack`,
    })
  } catch (error) {
    console.error('Error removing examples from benchmark pack:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to remove examples from benchmark pack' },
      { status: 500 }
    )
  }
}
