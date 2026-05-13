import { NextRequest, NextResponse } from 'next/server'
import {
  getBenchmarkPack,
  updateBenchmarkPack,
  deleteBenchmarkPack,
  archiveBenchmarkPack,
} from '@/lib/benchmark/service'

// GET /api/admin/benchmarks/packs/[id] - Get a specific benchmark pack
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const pack = await getBenchmarkPack(id)

    if (!pack) {
      return NextResponse.json(
        { success: false, error: 'Benchmark pack not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      data: pack,
    })
  } catch (error) {
    console.error('Error getting benchmark pack:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to get benchmark pack' },
      { status: 500 }
    )
  }
}

// PATCH /api/admin/benchmarks/packs/[id] - Update a benchmark pack
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { name, description, tags, is_archived } = body

    // Check if this is an archive operation
    if (is_archived === true) {
      await archiveBenchmarkPack(id)
      return NextResponse.json({ success: true })
    }

    const pack = await updateBenchmarkPack(id, {
      name,
      description,
      tags,
      is_archived,
    })

    return NextResponse.json({
      success: true,
      data: pack,
    })
  } catch (error) {
    console.error('Error updating benchmark pack:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to update benchmark pack' },
      { status: 500 }
    )
  }
}

// DELETE /api/admin/benchmarks/packs/[id] - Delete a benchmark pack
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    await deleteBenchmarkPack(id)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting benchmark pack:', error)
    const message = error instanceof Error ? error.message : 'Failed to delete benchmark pack'
    return NextResponse.json(
      { success: false, error: message },
      { status: 400 }
    )
  }
}
