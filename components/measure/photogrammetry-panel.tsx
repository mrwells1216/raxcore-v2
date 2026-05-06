'use client'

import { useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useReconstructionJob } from '@/hooks/use-reconstruction-job'
import { useMeasureStore, CAPTURE_ANGLES } from './measure-store'
import type { ReconstructionAsset, ReconstructionInputImage, ReconstructionAssetType } from '@/lib/reconstruction/types'

const MIN_CAPTURES = 8
const RECOMMENDED_CAPTURES = 12

function safeFileName(label: string, fallback: string): string {
  const cleaned = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `${cleaned || fallback}.jpg`
}

function inferManualAssetType(file: File): ReconstructionAssetType {
  const name = file.name.toLowerCase()
  if (name.endsWith('.glb') || name.endsWith('.gltf')) return 'mesh_glb'
  if (name.endsWith('.xyz') || name.endsWith('.pts')) return 'point_cloud_xyz'
  if (name.endsWith('.csv')) return 'point_cloud_csv'
  if (name.endsWith('.ply')) return 'point_cloud_ply'
  if (name.endsWith('.splat') || name.endsWith('.ksplat')) return 'gaussian_splat'
  return 'unknown'
}

function assetLabel(type: ReconstructionAssetType): string {
  switch (type) {
    case 'mesh_glb': return 'Mesh GLB'
    case 'point_cloud_xyz': return 'Point Cloud XYZ/PTS'
    case 'point_cloud_ply': return 'Point Cloud PLY'
    case 'point_cloud_csv': return 'Point Cloud CSV'
    case 'gaussian_splat': return 'Gaussian Splat'
    case 'preview_image': return 'Preview Image'
    default: return 'Reference Asset'
  }
}

export function PhotogrammetryPanel() {
  const captures = useMeasureStore((s) => s.captures)
  const setCaptureImage = useMeasureStore((s) => s.setCaptureImage)
  const setGlbUrl = useMeasureStore((s) => s.setGlbUrl)
  const setPhase = useMeasureStore((s) => s.setPhase)
  const loadPointCloudText = useMeasureStore((s) => s.loadPointCloudText)
  const attachReconstructionAsset = useMeasureStore((s) => s.attachReconstructionAsset)
  const reconstructionStatus = useMeasureStore((s) => s.reconstructionStatus)
  const reconstructionProgress = useMeasureStore((s) => s.reconstructionProgress)
  const reconstructionMessage = useMeasureStore((s) => s.reconstructionMessage)
  const reconstructionAssets = useMeasureStore((s) => s.reconstructionAssets)
  const reconstructionError = useMeasureStore((s) => s.reconstructionError)

  const { submitJob, isSubmitting, isPolling, error: hookError } = useReconstructionJob()

  const fileRefs = useRef<Array<HTMLInputElement | null>>([])
  const manualGlbRef = useRef<HTMLInputElement>(null)
  const manualPointCloudRef = useRef<HTMLInputElement>(null)
  const manualSplatRef = useRef<HTMLInputElement>(null)
  const [allowLowPhotoCount, setAllowLowPhotoCount] = useState(false)
  const [localMessage, setLocalMessage] = useState<string | null>(null)

  const capturedCount = captures.filter((capture) => capture.captured && capture.imageDataUrl).length
  const inputImages = useMemo<ReconstructionInputImage[]>(() => {
    const images: ReconstructionInputImage[] = []
    captures.forEach((capture, index) => {
      if (!capture.imageDataUrl) return
      images.push({
        id: `capture-${index}`,
        fileName: safeFileName(capture.angle, `capture-${index}`),
        dataUrl: capture.imageDataUrl,
        angleHint: capture.angle,
      })
    })
    return images
  }, [captures])

  const canSubmit = inputImages.length > 0 && !isSubmitting && !isPolling
  const activeError = hookError ?? reconstructionError

  const handleImageUpload = (angleIndex: number, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (ev) => {
      const dataUrl = typeof ev.target?.result === 'string' ? ev.target.result : null
      if (dataUrl) setCaptureImage(angleIndex, dataUrl)
    }
    reader.readAsDataURL(file)
  }

  const handleSubmit = async () => {
    if (!canSubmit) return
    setLocalMessage(null)
    try {
      await submitJob(inputImages, { allowLowPhotoCount })
    } catch (error) {
      setLocalMessage(error instanceof Error ? error.message : 'Reconstruction submit failed.')
    }
  }

  const attachMeshAsset = (asset: ReconstructionAsset) => {
    setGlbUrl(asset.url)
    attachReconstructionAsset(asset)
    setLocalMessage('Mesh asset loaded into the 3D scene. Measurements still prefer point-cloud anchors when available.')
    setPhase('3d')
  }

  const attachPointCloudAsset = async (asset: ReconstructionAsset) => {
    try {
      const response = await fetch(asset.url)
      if (!response.ok) throw new Error(`Point cloud download failed (${response.status}).`)
      const text = await response.text()
      loadPointCloudText(text, asset.fileName ?? 'reconstruction-point-cloud.xyz')
      attachReconstructionAsset(asset)
      setLocalMessage('Point cloud loaded. 3D measurements will snap to real cloud anchors when within snap range.')
      setPhase('3d')
    } catch (error) {
      setLocalMessage(error instanceof Error ? error.message : 'Point cloud asset could not be loaded.')
    }
  }

  const attachSplatAsset = (asset: ReconstructionAsset) => {
    attachReconstructionAsset(asset)
    setLocalMessage('Splat asset attached as visual evidence. Rendering support is pending; splats are not measurement truth.')
  }

  const handleManualGlb = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const url = URL.createObjectURL(file)
    const asset: ReconstructionAsset = {
      id: `manual-mesh-${Date.now()}`,
      type: 'mesh_glb',
      url,
      fileName: file.name,
      mimeType: file.type || 'model/gltf-binary',
      sizeBytes: file.size,
      provider: 'manual',
    }
    attachMeshAsset(asset)
  }

  const handleManualPointCloud = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = typeof ev.target?.result === 'string' ? ev.target.result : ''
      loadPointCloudText(text, file.name)
      attachReconstructionAsset({
        id: `manual-point-cloud-${Date.now()}`,
        type: inferManualAssetType(file),
        url: URL.createObjectURL(file),
        fileName: file.name,
        mimeType: file.type || 'text/plain',
        sizeBytes: file.size,
        provider: 'manual',
      })
      setLocalMessage('Manual point cloud loaded. Snapping uses parsed points, not rendered downsampled points.')
      setPhase('3d')
    }
    reader.readAsText(file)
  }

  const handleManualSplat = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    attachSplatAsset({
      id: `manual-splat-${Date.now()}`,
      type: 'gaussian_splat',
      url: URL.createObjectURL(file),
      fileName: file.name,
      mimeType: file.type || null,
      sizeBytes: file.size,
      provider: 'manual',
    })
  }

  const meshAssets = reconstructionAssets.filter((asset) => asset.type === 'mesh_glb')
  const pointCloudAssets = reconstructionAssets.filter((asset) =>
    asset.type === 'point_cloud_xyz' || asset.type === 'point_cloud_ply' || asset.type === 'point_cloud_csv'
  )
  const splatAssets = reconstructionAssets.filter((asset) => asset.type === 'gaussian_splat')
  const referenceAssets = reconstructionAssets.filter((asset) =>
    asset.type === 'preview_image' || asset.type === 'unknown'
  )

  return (
    <div className="flex flex-col gap-6 h-full overflow-y-auto p-4">
      <div>
        <h2 className="text-base font-semibold" style={{ color: '#c8a96e' }}>Luma Reconstruction</h2>
        <p className="text-xs mt-1 leading-relaxed" style={{ color: 'rgba(200,169,110,0.6)' }}>
          Submit a photo set to the server-side Luma adapter, or attach manual GLB / point-cloud / splat assets.
          Measurement truth remains point cloud first, mesh fallback second, and splats visual-only until a renderer is added.
        </p>
      </div>

      <div className="rounded-lg p-3" style={{ background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.08)' }}>
        <p className="text-xs font-semibold mb-2" style={{ color: '#c8a96e' }}>Recommended capture checklist</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
          {CAPTURE_ANGLES.map((angle) => (
            <span key={angle} className="text-xs" style={{ color: 'rgba(232,216,184,0.72)' }}>
              {angle}
            </span>
          ))}
        </div>
      </div>

      <div>
        <div className="flex justify-between text-xs mb-1.5" style={{ color: 'rgba(200,169,110,0.6)' }}>
          <span>{capturedCount} / {CAPTURE_ANGLES.length} angles captured</span>
          <span>{capturedCount < MIN_CAPTURES ? 'Strong warning' : capturedCount < RECOMMENDED_CAPTURES ? 'Acceptable' : 'Recommended'}</span>
        </div>
        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${Math.min(100, (capturedCount / RECOMMENDED_CAPTURES) * 100)}%`,
              background: capturedCount >= RECOMMENDED_CAPTURES ? '#4fc36e' : capturedCount >= MIN_CAPTURES ? '#fbbf24' : '#c8a96e',
            }}
          />
        </div>
      </div>

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
                <img src={capture.imageDataUrl} alt={angle} className="absolute inset-0 w-full h-full object-cover opacity-60" />
              ) : null}
              <span className="relative z-10 font-medium leading-tight text-center px-1">{angle}</span>
              {capture.captured && <span className="relative z-10 text-xs" style={{ color: '#4fc36e' }}>&#10003;</span>}
              <input
                ref={el => { fileRefs.current[i] = el }}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => handleImageUpload(i, event)}
              />
            </button>
          )
        })}
      </div>

      {capturedCount > 0 && capturedCount < MIN_CAPTURES && (
        <label className="flex items-start gap-2 text-xs px-3 py-2 rounded" style={{ background: 'rgba(251,191,36,0.08)', color: '#fbbf24' }}>
          <input
            type="checkbox"
            checked={allowLowPhotoCount}
            onChange={(event) => setAllowLowPhotoCount(event.target.checked)}
            className="mt-0.5"
          />
          <span>
            Fewer than {MIN_CAPTURES} photos can be submitted only as a low-quality attempt.
            {RECOMMENDED_CAPTURES}+ photos are recommended for professional reconstruction.
          </span>
        </label>
      )}

      <button
        onClick={handleSubmit}
        disabled={!canSubmit || (capturedCount < MIN_CAPTURES && !allowLowPhotoCount)}
        className="w-full py-2.5 rounded text-sm font-semibold transition-all"
        style={{
          background: canSubmit && (capturedCount >= MIN_CAPTURES || allowLowPhotoCount) ? '#c8a96e' : 'rgba(200,169,110,0.15)',
          color: canSubmit && (capturedCount >= MIN_CAPTURES || allowLowPhotoCount) ? '#0d0a06' : 'rgba(200,169,110,0.4)',
          cursor: canSubmit && (capturedCount >= MIN_CAPTURES || allowLowPhotoCount) ? 'pointer' : 'not-allowed',
        }}
      >
        {isSubmitting ? 'Submitting...' : 'Submit to Luma Reconstruction'}
      </button>

      {reconstructionStatus !== 'idle' && (
        <div className="rounded-lg p-3 text-xs" style={{ background: 'rgba(79,195,110,0.08)', color: '#4fc36e', border: '1px solid rgba(79,195,110,0.18)' }}>
          <div className="flex items-center justify-between gap-3">
            <span className="font-semibold capitalize">{reconstructionStatus.replace(/_/g, ' ')}</span>
            <span className="font-mono">{Math.round(reconstructionProgress)}%</span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden mt-2" style={{ background: 'rgba(255,255,255,0.08)' }}>
            <div className="h-full rounded-full" style={{ width: `${Math.min(100, reconstructionProgress)}%`, background: '#4fc36e' }} />
          </div>
          <p className="mt-2" style={{ color: 'rgba(232,216,184,0.75)' }}>
            {reconstructionMessage ?? 'Reconstructing 3D model - this can take several minutes.'}
          </p>
        </div>
      )}

      {(activeError || localMessage) && (
        <p className="text-xs px-3 py-2 rounded" style={{ background: activeError ? 'rgba(200,50,50,0.1)' : 'rgba(79,195,110,0.08)', color: activeError ? '#f87171' : '#4fc36e' }}>
          {activeError ?? localMessage}
        </p>
      )}

      {reconstructionAssets.length > 0 && (
        <div className="flex flex-col gap-3">
          <p className="text-xs font-semibold" style={{ color: '#c8a96e' }}>Reconstruction assets</p>
          {[...meshAssets, ...pointCloudAssets, ...splatAssets, ...referenceAssets].map((asset) => (
            <div key={`${asset.id}-${asset.url}`} className="flex items-center justify-between gap-3 rounded px-3 py-2" style={{ background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <div className="min-w-0">
                <p className="text-xs font-medium truncate" style={{ color: '#e8d8b8' }}>{asset.fileName ?? assetLabel(asset.type)}</p>
                <p className="text-xs" style={{ color: 'rgba(200,169,110,0.45)' }}>{assetLabel(asset.type)} - {asset.provider ?? 'manual'}</p>
              </div>
              {asset.type === 'mesh_glb' ? (
                <button className="text-xs px-2 py-1 rounded" style={{ background: '#c8a96e', color: '#0d0a06' }} onClick={() => attachMeshAsset(asset)}>Load Mesh</button>
              ) : asset.type === 'point_cloud_xyz' || asset.type === 'point_cloud_ply' || asset.type === 'point_cloud_csv' ? (
                <button className="text-xs px-2 py-1 rounded" style={{ background: '#c8a96e', color: '#0d0a06' }} onClick={() => void attachPointCloudAsset(asset)}>Load Cloud</button>
              ) : asset.type === 'gaussian_splat' ? (
                <button className="text-xs px-2 py-1 rounded" style={{ background: 'rgba(255,255,255,0.08)', color: '#c8a96e' }} onClick={() => attachSplatAsset(asset)}>Attach</button>
              ) : (
                <a className="text-xs px-2 py-1 rounded" style={{ background: 'rgba(255,255,255,0.08)', color: '#c8a96e' }} href={asset.url} target="_blank" rel="noreferrer">Open</a>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="border-t pt-4 flex flex-col gap-2" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
        <p className="text-xs" style={{ color: 'rgba(200,169,110,0.55)' }}>
          Manual fallback is always available. Mesh fallback remains lower-confidence; point cloud upload is preferred for anchored measurements.
        </p>
        <button onClick={() => manualGlbRef.current?.click()} className="w-full py-2 rounded text-sm transition-all" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(200,169,110,0.7)' }}>
          Upload GLB Manually
        </button>
        <button onClick={() => manualPointCloudRef.current?.click()} className="w-full py-2 rounded text-sm transition-all" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(200,169,110,0.7)' }}>
          Upload Point Cloud Manually
        </button>
        <button onClick={() => manualSplatRef.current?.click()} className="w-full py-2 rounded text-sm transition-all" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(200,169,110,0.7)' }}>
          Attach Splat Manually
        </button>
        <input ref={manualGlbRef} type="file" accept=".glb,.gltf" className="hidden" onChange={handleManualGlb} />
        <input ref={manualPointCloudRef} type="file" accept=".xyz,.pts,.csv,.ply" className="hidden" onChange={handleManualPointCloud} />
        <input ref={manualSplatRef} type="file" accept=".splat,.ksplat" className="hidden" onChange={handleManualSplat} />
      </div>
    </div>
  )
}
