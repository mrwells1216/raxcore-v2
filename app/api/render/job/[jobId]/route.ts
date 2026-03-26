import { NextRequest, NextResponse } from 'next/server'
import { 
  getRenderJob, 
  updateRenderJob, 
  deleteRenderJob,
  getRenderOutputs 
} from '@/lib/render/service'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params
    const job = await getRenderJob(jobId)
    
    if (!job) {
      return NextResponse.json({ error: 'Render job not found' }, { status: 404 })
    }
    
    const outputs = await getRenderOutputs(jobId)
    
    return NextResponse.json({ job, outputs })
  } catch (error) {
    console.error('Error fetching render job:', error)
    return NextResponse.json(
      { error: 'Failed to fetch render job' },
      { status: 500 }
    )
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params
    const body = await request.json()
    
    const updates: { 
      status?: 'pending' | 'processing' | 'completed' | 'failed'
      progress_percent?: number
      error_message?: string
    } = {}
    
    if (body.status) updates.status = body.status
    if (typeof body.progress_percent === 'number') updates.progress_percent = body.progress_percent
    if (body.error_message !== undefined) updates.error_message = body.error_message
    
    const job = await updateRenderJob(jobId, updates)
    
    if (!job) {
      return NextResponse.json({ error: 'Render job not found' }, { status: 404 })
    }
    
    return NextResponse.json({ job })
  } catch (error) {
    console.error('Error updating render job:', error)
    return NextResponse.json(
      { error: 'Failed to update render job' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params
    const deleted = await deleteRenderJob(jobId)
    
    if (!deleted) {
      return NextResponse.json({ error: 'Render job not found' }, { status: 404 })
    }
    
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting render job:', error)
    return NextResponse.json(
      { error: 'Failed to delete render job' },
      { status: 500 }
    )
  }
}
