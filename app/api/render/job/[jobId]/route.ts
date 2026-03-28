import { NextRequest, NextResponse } from 'next/server'
import { 
  getRenderJob, 
  updateRenderJob, 
  deleteRenderJob,
  getRenderOutputs 
} from '@/lib/render/service'
import { createGatedUserNotification, createAdminTask } from '@/lib/notifications/service'

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

    // Phase 34: Fire user + admin notifications on terminal status transitions
    if (body.status === 'completed' || body.status === 'failed') {
      const userId = (job as Record<string, unknown>).user_id as string | undefined

      if (userId) {
        if (body.status === 'completed') {
          createGatedUserNotification({
            userId,
            type: 'render_complete',
            title: '3D render is ready',
            body: 'Your antler model has finished rendering and is ready to view.',
            linkHref: `/render/${(job as Record<string, unknown>).buck_id ?? jobId}`,
            buckId: (job as Record<string, unknown>).buck_id as string | undefined,
            priority: 'normal',
          }).catch(err => console.error('[render] notification error:', err))
        } else {
          createGatedUserNotification({
            userId,
            type: 'render_failed',
            title: '3D render failed',
            body: body.error_message ?? 'An error occurred while generating your 3D model.',
            linkHref: `/results/${(job as Record<string, unknown>).buck_id ?? jobId}`,
            buckId: (job as Record<string, unknown>).buck_id as string | undefined,
            priority: 'high',
          }).catch(err => console.error('[render] notification error:', err))

          // Admin task for failed renders
          createAdminTask({
            type: 'failed_validation',
            title: `Render failed: job ${jobId.slice(-8)}`,
            body: body.error_message ?? 'Render job ended in failed state.',
            priority: 'normal',
            linkHref: `/admin/submissions/${(job as Record<string, unknown>).buck_id ?? jobId}`,
            relatedId: jobId,
            relatedType: 'render_job',
          }).catch(err => console.error('[render] admin task error:', err))
        }
      }
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
