'use server'

import { toggleScheduledJob, cancelJob } from '@/lib/jobs'
import { revalidatePath } from 'next/cache'

export async function toggleScheduledJobAction(
  definitionId: string,
  isEnabled: boolean
): Promise<{ success: boolean; error?: string }> {
  try {
    await toggleScheduledJob(definitionId, isEnabled)
    revalidatePath('/admin/jobs')
    return { success: true }
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }
  }
}

export async function cancelJobAction(
  jobId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await cancelJob(jobId)
    revalidatePath('/admin/jobs')
    return { success: true }
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }
  }
}
