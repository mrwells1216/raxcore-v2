'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useMeasureStore } from '@/components/measure/measure-store'
import type {
  ReconstructionAsset,
  ReconstructionInputImage,
  ReconstructionJob,
  ReconstructionJobStatus,
} from '@/lib/reconstruction/types'
import { isActiveReconstructionStatus } from '@/lib/reconstruction/types'

interface SubmitOptions {
  allowLowPhotoCount?: boolean
}

interface StatusResponse {
  status: ReconstructionJobStatus
  progress?: number
  assets?: ReconstructionAsset[]
  message?: string | null
}

export function useReconstructionJob() {
  const setReconstructionJob = useMeasureStore((s) => s.setReconstructionJob)
  const setReconstructionStatus = useMeasureStore((s) => s.setReconstructionStatus)
  const setReconstructionAssets = useMeasureStore((s) => s.setReconstructionAssets)
  const setReconstructionError = useMeasureStore((s) => s.setReconstructionError)
  const storeJob = useMeasureStore((s) => s.reconstructionJob)

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isPolling, setIsPolling] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)

  const cancelPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    abortRef.current?.abort()
    abortRef.current = null
    if (mountedRef.current) setIsPolling(false)
  }, [])

  const pollStatusOnce = useCallback(async (externalJobId: string): Promise<StatusResponse | null> => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    const response = await fetch('/api/reconstruction/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ externalJobId }),
      signal: controller.signal,
    })

    if (!response.ok) {
      const body = await response.json().catch(() => null)
      throw new Error(body?.error ?? `Status request failed (${response.status}).`)
    }

    return response.json() as Promise<StatusResponse>
  }, [])

  const startPolling = useCallback((job: ReconstructionJob) => {
    cancelPolling()
    if (!job.externalJobId || !isActiveReconstructionStatus(job.status)) return

    setIsPolling(true)
    const tick = async () => {
      try {
        const status = await pollStatusOnce(job.externalJobId as string)
        if (!status || !mountedRef.current) return

        setReconstructionStatus(status.status, status.progress, status.message ?? null)
        if (status.assets) setReconstructionAssets(status.assets)

        if (!isActiveReconstructionStatus(status.status)) {
          cancelPolling()
        }
      } catch (err) {
        if (!mountedRef.current) return
        if (err instanceof DOMException && err.name === 'AbortError') return
        const message = err instanceof Error ? err.message : 'Reconstruction status polling failed.'
        setError(message)
        setReconstructionError(message)
        cancelPolling()
      }
    }

    intervalRef.current = setInterval(tick, 15_000)
    void tick()
  }, [cancelPolling, pollStatusOnce, setReconstructionAssets, setReconstructionError, setReconstructionStatus])

  const submitJob = useCallback(async (images: ReconstructionInputImage[], options: SubmitOptions = {}) => {
    cancelPolling()
    setIsSubmitting(true)
    setError(null)
    setReconstructionError(null)

    try {
      const response = await fetch('/api/reconstruction/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          images,
          allowLowPhotoCount: options.allowLowPhotoCount === true,
        }),
      })

      const body = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(body?.error ?? `Reconstruction submit failed (${response.status}).`)
      }

      const job = body?.job as ReconstructionJob | undefined
      if (!job) throw new Error('Reconstruction submit did not return a job.')

      if (!mountedRef.current) return job
      setReconstructionJob(job)
      if (job.assets.length > 0) setReconstructionAssets(job.assets)
      startPolling(job)
      return job
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Reconstruction submit failed.'
      if (mountedRef.current) {
        setError(message)
        setReconstructionError(message)
      }
      throw err
    } finally {
      if (mountedRef.current) setIsSubmitting(false)
    }
  }, [cancelPolling, setReconstructionAssets, setReconstructionError, setReconstructionJob, startPolling])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      cancelPolling()
    }
  }, [cancelPolling])

  useEffect(() => {
    if (storeJob && isActiveReconstructionStatus(storeJob.status) && !intervalRef.current) {
      startPolling(storeJob)
    }
  }, [startPolling, storeJob])

  return {
    submitJob,
    cancelPolling,
    isSubmitting,
    isPolling,
    job: storeJob,
    error,
  }
}
