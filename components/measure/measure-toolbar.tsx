'use client'

import { useRef } from 'react'
import { useMeasureStore, type PhotoFilter, type RenderMode } from './measure-store'

const PHOTO_FILTERS: { id: PhotoFilter; label: string }[] = [
  { id: 'none',     label: 'Normal' },
  { id: 'brighten', label: 'Brighten' },
  { id: 'contrast', label: 'Contrast' },
  { id: 'sharpen',  label: 'Sharpen' },
  { id: 'thermal',  label: 'Thermal' },
]

const RENDER_MODES: { id: RenderMode; label: string }[] = [
  { id: 'solid',     label: 'Solid' },
  { id: 'wireframe', label: 'Wireframe' },
  { id: 'xray',      label: 'X-Ray' },
  { id: 'thermal',   label: 'Thermal' },
  { id: 'zones',     label: 'Zones' },
]

// ─── Small toggle button ──────────────────────────────────────────────────────

function ToggleBtn({
  active,
  onClick,
  children,
  title,
}: {
  active?: boolean
  onClick: () => void
  children: React.ReactNode
  title?: string
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="px-2.5 py-1 rounded text-xs transition-all whitespace-nowrap"
      style={{
        background: active ? 'rgba(200,169,110,0.18)' : 'rgba(255,255,255,0.05)',
        border:     active ? '1px solid rgba(200,169,110,0.4)' : '1px solid rgba(255,255,255,0.08)',
        color:      active ? '#c8a96e' : 'rgba(255,255,255,0.55)',
      }}
    >
      {children}
    </button>
  )
}

// ─── Toolbar ──────────────────────────────────────────────────────────────────

export function MeasureToolbar() {
  const {
    phase,
    mode, setMode,
    calibration, finalizeCalibration, resetCalibration, setCalibrationInches,
    photoFilter, setPhotoFilter,
    renderMode, setRenderMode,
    setPhotoDataUrl,
    stageScale, stagePos, setStageViewport,
    activeField,
    resetSession,
  } = useMeasureStore()

  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── Zoom helpers (photo only) ─────────────────────────────────────────────
  const zoomBy = (factor: number) => {
    const next = Math.max(0.1, Math.min(12, stageScale * factor))
    setStageViewport(next, stagePos)
  }
  const zoomFit = () => setStageViewport(1, { x: 0, y: 0 })

  // ── Photo upload ──────────────────────────────────────────────────────────
  const handlePhotoFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const url = ev.target?.result as string
      setPhotoDataUrl(url)
    }
    reader.readAsDataURL(file)
  }

  return (
    <div
      className="flex items-center gap-2 flex-wrap px-3 py-2 flex-shrink-0"
      style={{
        background: 'rgba(10,9,7,0.95)',
        borderBottom: '1px solid rgba(255,255,255,0.07)',
        backdropFilter: 'blur(4px)',
      }}
    >
      {/* Photo upload (Phase 1 only) */}
      {phase === 'photo' && (
        <>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-2.5 py-1 rounded text-xs font-medium"
            style={{ background: '#c8a96e', color: '#0d0a06' }}
          >
            Upload Photo
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handlePhotoFile}
          />
          <div className="w-px h-4 bg-white/10" />
        </>
      )}

      {/* Photo mode: calibrate / measure / view */}
      {phase === 'photo' && (
        <>
          <ToggleBtn
            active={mode === 'view'}
            onClick={() => setMode('view')}
            title="Pan and inspect (V)"
          >
            View
          </ToggleBtn>
          <ToggleBtn
            active={mode === 'calibrate'}
            onClick={() => setMode('calibrate')}
            title="Draw calibration reference line"
          >
            Calibrate
          </ToggleBtn>

          {/* Calibration inches input */}
          {(mode === 'calibrate' || calibration.linePoints.length > 0) && (
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                value={calibration.realInches}
                min={0.1}
                step={0.5}
                onChange={e => setCalibrationInches(parseFloat(e.target.value) || 12)}
                className="w-14 px-1.5 py-0.5 rounded text-xs font-mono text-center"
                style={{
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  color: '#e8d8b8',
                }}
                title="Known length in inches"
              />
              <span className="text-xs" style={{ color: 'rgba(200,169,110,0.5)' }}>in</span>
              {calibration.linePoints.length >= 2 && !calibration.finalized && (
                <button
                  onClick={finalizeCalibration}
                  className="px-2 py-0.5 rounded text-xs font-medium"
                  style={{ background: '#4fc36e', color: '#0d0a06' }}
                >
                  Set Scale
                </button>
              )}
              {calibration.finalized && (
                <button
                  onClick={resetCalibration}
                  className="px-2 py-0.5 rounded text-xs"
                  style={{ color: '#f87171', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)' }}
                >
                  Reset
                </button>
              )}
            </div>
          )}

          {calibration.finalized && (
            <span className="text-xs font-mono" style={{ color: '#4fc36e' }}>
              {calibration.pixelsPerInch.toFixed(1)} px/in
            </span>
          )}

          <div className="w-px h-4 bg-white/10" />

          {/* Zoom */}
          <ToggleBtn onClick={() => zoomBy(1.3)} title="Zoom in">+</ToggleBtn>
          <ToggleBtn onClick={() => zoomBy(1 / 1.3)} title="Zoom out">-</ToggleBtn>
          <ToggleBtn onClick={zoomFit} title="Zoom to fit">Fit</ToggleBtn>

          <div className="w-px h-4 bg-white/10" />

          {/* Photo filters */}
          <div className="flex items-center gap-1">
            {PHOTO_FILTERS.map(f => (
              <ToggleBtn key={f.id} active={photoFilter === f.id} onClick={() => setPhotoFilter(f.id)}>
                {f.label}
              </ToggleBtn>
            ))}
          </div>
        </>
      )}

      {/* 3D toolbar */}
      {phase === '3d' && (
        <>
          <div className="flex items-center gap-1">
            {RENDER_MODES.map(m => (
              <ToggleBtn key={m.id} active={renderMode === m.id} onClick={() => setRenderMode(m.id)}>
                {m.label}
              </ToggleBtn>
            ))}
          </div>
        </>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Active field info */}
      {activeField && (
        <span
          className="text-xs px-2 py-0.5 rounded font-semibold"
          style={{ background: 'rgba(200,169,110,0.1)', color: '#c8a96e' }}
        >
          Measuring — Esc to cancel
        </span>
      )}

      {/* Reset session */}
      <button
        onClick={() => {
          if (confirm('Reset all measurements and start over?')) resetSession()
        }}
        className="px-2 py-1 rounded text-xs"
        style={{ color: 'rgba(255,255,255,0.3)', border: '1px solid rgba(255,255,255,0.07)' }}
      >
        Reset
      </button>
    </div>
  )
}
