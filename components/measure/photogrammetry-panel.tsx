'use client'

import { useRef } from 'react'
import { useMeasureStore, CAPTURE_ANGLES } from './measure-store'

const MIN_CAPTURES = 8

export function PhotogrammetryPanel() {
  const {
    captures,
    setCaptureImage,
    polycamStatus,
    setPolycamStatus,
    setPolycamJobId,
    polycamJobId,
    setGlbUrl,
    setPhase,
  } = useMeasureStore()

  const fileRefs = useRef<Array<HTMLInputElement | null>>([])

  const capturedCount = captures.filter(c => c.captured).length
  const canProcess    = capturedCount >= MIN_CAPTURES && polycamStatus === 'idle'

  // ── Image upload ──────────────────────────────────────────────────────────
  const handleImageUpload = (angleIndex: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string
      setCaptureImage(angleIndex, dataUrl)
    }
    reader.readAsDataURL(file)
  }

  // ── Submit to Polycam ─────────────────────────────────────────────────────
  const handleSubmit = async () => {
    setPolycamStatus('uploading')

    const formData = new FormData()
    for (const capture of captures) {
      if (!capture.imageDataUrl) continue
      // Convert data URL to blob
      const res = await fetch(capture.imageDataUrl)
      const blob = await res.blob()
      formData.append('images', blob, `${capture.angle.replace(/\s+/g, '_')}.jpg`)
    }

    try {
      // POST to Polycam API (requires POLYCAM_API_KEY env var on server)
      const res = await fetch('/api/photogrammetry/submit', {
        method: 'POST',
        body: formData,
      })
      if (!res.ok) throw new Error(`Submit failed: ${res.status}`)
      const { jobId } = await res.json()
      setPolycamJobId(jobId)
      setPolycamStatus('processing')
      pollStatus(jobId)
    } catch (err) {
      console.error('[photogrammetry] submit error', err)
      setPolycamStatus('error')
    }
  }

  // ── Poll Polycam job status ────────────────────────────────────────────────
  const pollStatus = (jobId: string) => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/photogrammetry/status?jobId=${jobId}`)
        if (!res.ok) throw new Error(`Poll failed: ${res.status}`)
        const { status, glbUrl } = await res.json()
        if (status === 'complete' && glbUrl) {
          clearInterval(interval)
          setPolycamStatus('complete')
          setGlbUrl(glbUrl)
          setPhase('3d')
        } else if (status === 'error') {
          clearInterval(interval)
          setPolycamStatus('error')
        }
      } catch {
        clearInterval(interval)
        setPolycamStatus('error')
      }
    }, 15_000)
  }

  // ── Manual GLB upload fallback ────────────────────────────────────────────
  const manualGlbRef = useRef<HTMLInputElement>(null)
  const handleManualGlb = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const url = URL.createObjectURL(file)
    setGlbUrl(url)
    setPolycamStatus('complete')
    setPhase('3d')
  }

  // ── Status text ───────────────────────────────────────────────────────────
  const statusMessages: Record<typeof polycamStatus, string> = {
    idle:       '',
    uploading:  'Uploading photos...',
    processing: 'Processing 3D reconstruction (2-4 min)...',
    complete:   'Reconstruction complete — switching to 3D view.',
    error:      'Reconstruction failed. Please try again or upload a GLB manually.',
  }

  return (
    <div className="flex flex-col gap-6 h-full overflow-y-auto p-4">
      {/* Header */}
      <div>
        <h2 className="text-base font-semibold" style={{ color: '#c8a96e' }}>Photogrammetry Capture</h2>
        <p className="text-xs mt-1 leading-relaxed" style={{ color: 'rgba(200,169,110,0.6)' }}>
          Upload photos from at least {MIN_CAPTURES} angles. Polycam will generate a 3D model automatically.
          You need {Math.max(0, MIN_CAPTURES - capturedCount)} more photo{Math.max(0, MIN_CAPTURES - capturedCount) !== 1 ? 's' : ''}.
        </p>
      </div>

      {/* Progress bar */}
      <div>
        <div className="flex justify-between text-xs mb-1.5" style={{ color: 'rgba(200,169,110,0.6)' }}>
          <span>{capturedCount} / {CAPTURE_ANGLES.length} angles captured</span>
          <span>{Math.round((capturedCount / CAPTURE_ANGLES.length) * 100)}%</span>
        </div>
        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${(capturedCount / CAPTURE_ANGLES.length) * 100}%`,
              background: capturedCount >= MIN_CAPTURES ? '#4fc36e' : '#c8a96e',
            }}
          />
        </div>
      </div>

      {/* Angle grid */}
      <div className="grid grid-cols-3 gap-2">
        {CAPTURE_ANGLES.map((angle, i) => {
          const capture = captures[i]
          return (
            <button
              key={angle}
              onClick={() => fileRefs.current[i]?.click()}
              className="relative aspect-square rounded overflow-hidden flex flex-col items-center justify-center gap-1.5 text-xs transition-all"
              style={{
                background: capture.captured ? 'rgba(79,195,110,0.08)' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${capture.captured ? '#4fc36e44' : 'rgba(255,255,255,0.1)'}`,
                color: capture.captured ? '#4fc36e' : 'rgba(200,169,110,0.6)',
              }}
            >
              {capture.imageDataUrl ? (
                <img
                  src={capture.imageDataUrl}
                  alt={angle}
                  className="absolute inset-0 w-full h-full object-cover opacity-60"
                />
              ) : null}
              <span className="relative z-10 font-medium leading-tight text-center px-1">{angle}</span>
              {capture.captured && (
                <span className="relative z-10 text-xs" style={{ color: '#4fc36e' }}>&#10003;</span>
              )}
              <input
                ref={el => { fileRefs.current[i] = el }}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => handleImageUpload(i, e)}
              />
            </button>
          )
        })}
      </div>

      {/* Warning if under minimum */}
      {capturedCount > 0 && capturedCount < MIN_CAPTURES && (
        <p className="text-xs px-3 py-2 rounded" style={{ background: 'rgba(200,169,110,0.08)', color: '#fbbf24' }}>
          At least {MIN_CAPTURES} photos are required for a reliable reconstruction.
        </p>
      )}

      {/* Status message */}
      {polycamStatus !== 'idle' && (
        <p
          className="text-xs px-3 py-2 rounded"
          style={{
            background: polycamStatus === 'error' ? 'rgba(200,50,50,0.1)' : 'rgba(79,195,110,0.08)',
            color: polycamStatus === 'error' ? '#f87171' : '#4fc36e',
          }}
        >
          {statusMessages[polycamStatus]}
          {polycamJobId && polycamStatus === 'processing' && (
            <span className="ml-1 opacity-60">· Job: {polycamJobId}</span>
          )}
        </p>
      )}

      {/* Submit button */}
      {polycamStatus === 'idle' || polycamStatus === 'error' ? (
        <button
          onClick={handleSubmit}
          disabled={!canProcess}
          className="w-full py-2.5 rounded text-sm font-semibold transition-all"
          style={{
            background: canProcess ? '#c8a96e' : 'rgba(200,169,110,0.15)',
            color: canProcess ? '#0d0a06' : 'rgba(200,169,110,0.4)',
            cursor: canProcess ? 'pointer' : 'not-allowed',
          }}
        >
          Generate 3D Model
        </button>
      ) : (
        <div className="flex items-center justify-center gap-2 py-2.5">
          {polycamStatus === 'complete' ? null : (
            <span className="text-sm" style={{ color: '#c8a96e' }}>
              {polycamStatus === 'uploading' ? 'Uploading...' : 'Processing...'}
            </span>
          )}
        </div>
      )}

      {/* Manual GLB fallback */}
      <div className="border-t pt-4" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
        <p className="text-xs mb-2" style={{ color: 'rgba(200,169,110,0.5)' }}>
          Or manually upload a GLB exported from Polycam or another app:
        </p>
        <button
          onClick={() => manualGlbRef.current?.click()}
          className="w-full py-2 rounded text-sm transition-all"
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.12)',
            color: 'rgba(200,169,110,0.7)',
          }}
        >
          Upload GLB Manually
        </button>
        <input
          ref={manualGlbRef}
          type="file"
          accept=".glb,.gltf"
          className="hidden"
          onChange={handleManualGlb}
        />
      </div>
    </div>
  )
}
