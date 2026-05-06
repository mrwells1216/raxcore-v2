'use client'

import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useMeasureStore, FIELD_DEFS, type MeasurePhase, type FieldId } from '@/components/measure/measure-store'
import { MeasureToolbar } from '@/components/measure/measure-toolbar'
import { FieldList } from '@/components/measure/field-list'
import { ScorePanel } from '@/components/measure/score-panel'
import { PhotogrammetryPanel } from '@/components/measure/photogrammetry-panel'
import { X } from 'lucide-react'

// Dynamically import heavy canvas/3D components (no SSR)
const PhotoCanvas = dynamic(
  () => import('@/components/measure/photo-canvas').then(m => m.PhotoCanvas),
  { ssr: false, loading: () => <LoadingSlate label="Loading canvas..." /> },
)
const Scene3D = dynamic(
  () => import('@/components/measure/scene-3d').then(m => m.Scene3D),
  { ssr: false, loading: () => <LoadingSlate label="Loading 3D scene..." /> },
)

// ─── Loading slate ────────────────────────────────────────────────────────────

function LoadingSlate({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center w-full h-full">
      <p className="text-sm" style={{ color: 'rgba(200,169,110,0.5)' }}>{label}</p>
    </div>
  )
}

// ─── Phase tab ────────────────────────────────────────────────────────────────

const PHASES: { id: MeasurePhase; label: string }[] = [
  { id: 'photo',         label: 'Photo' },
  { id: '3d',            label: '3D' },
  { id: 'photogrammetry', label: 'Photogrammetry' },
  { id: 'score',         label: 'Score' },
]

function PhaseTab({ id, label, active }: { id: MeasurePhase; label: string; active: boolean }) {
  const { setPhase } = useMeasureStore()
  return (
    <button
      onClick={() => setPhase(id)}
      className="px-4 py-2.5 text-xs font-bold tracking-widest uppercase transition-all relative flex-shrink-0"
      style={{
        color: active ? '#c8a96e' : 'rgba(255,255,255,0.38)',
        background: 'transparent',
        borderBottom: active ? '2px solid #c8a96e' : '2px solid transparent',
      }}
    >
      {label}
    </button>
  )
}

// ─── Main client component ────────────────────────────────────────────────────

export function MeasureClient() {
  const { phase, mode } = useMeasureStore()

  const showFieldList = phase === 'photo' || phase === '3d'
  const showScore     = phase === 'score'
  const showPhotoGram = phase === 'photogrammetry'

  return (
    <div
      className="flex flex-col"
      style={{
        height: 'calc(100dvh - 56px)',  // subtract header height
        background: '#0d0a06',
        color: '#e8d8b8',
      }}
    >
      {/* Phase tabs + back button */}
      <div
        className="flex items-center justify-between flex-shrink-0"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}
      >
        <div className="flex">
          {PHASES.map(p => (
            <PhaseTab key={p.id} id={p.id} label={p.label} active={phase === p.id} />
          ))}
        </div>
        <Link
          href="/score"
          className="flex items-center gap-1 px-3 py-2.5 text-xs font-bold tracking-widest uppercase transition-all mr-2"
          style={{
            color: 'rgba(255,255,255,0.38)',
            textDecoration: 'none',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = '#c8a96e')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(255,255,255,0.38)')}
          title="Return to Score page"
        >
          <X size={16} />
          Exit
        </Link>
      </div>

      {/* Toolbar (photo / 3D only) */}
      {(phase === 'photo' || phase === '3d') && <MeasureToolbar />}

      {/* Main content area */}
      <div className="flex flex-1 min-h-0">
        {/* Left sidebar: field list */}
        {showFieldList && (
          <aside
            className="flex-shrink-0 overflow-y-auto p-3 hidden md:block"
            style={{
              width: 168,
              borderRight: '1px solid rgba(255,255,255,0.07)',
              background: '#0a0907',
            }}
          >
            <FieldList phase={phase} />
          </aside>
        )}

        {/* Canvas / main area */}
        <main className="flex-1 min-w-0 relative">
          {phase === 'photo'          && <PhotoCanvas />}
          {phase === '3d'             && <Scene3D />}
          {phase === 'photogrammetry' && (
            <div className="h-full overflow-y-auto">
              <PhotogrammetryPanel />
            </div>
          )}
          {phase === 'score' && (
            <div className="h-full overflow-y-auto">
              <ScorePanel />
            </div>
          )}
        </main>

        {/* Right sidebar: score panel (photo / 3D only) */}
        {showFieldList && (
          <aside
            className="flex-shrink-0 overflow-y-auto hidden lg:block"
            style={{
              width: 280,
              borderLeft: '1px solid rgba(255,255,255,0.07)',
              background: '#0a0907',
            }}
          >
            <ScorePanel />
          </aside>
        )}
      </div>

      {/* Mobile bottom field list strip (photo / 3D) */}
      {showFieldList && (
        <div
          className="flex-shrink-0 md:hidden overflow-x-auto"
          style={{
            borderTop: '1px solid rgba(255,255,255,0.07)',
            background: '#0a0907',
            paddingBottom: 'env(safe-area-inset-bottom)',
          }}
        >
          <MobileFieldStrip phase={phase} />
        </div>
      )}
    </div>
  )
}

// ─── Mobile horizontal field strip ───────────────────────────────────────────

function MobileFieldStrip({ phase }: { phase: MeasurePhase }) {
  const {
    measurements2D, measurements3D,
    activeField, setActiveField,
    finalizeField2D, finalizeField3D,
  } = useMeasureStore()

  const getMeasure = (id: string) =>
    phase === 'photo'
      ? measurements2D[id as keyof typeof measurements2D]
      : measurements3D[id as keyof typeof measurements3D]

  return (
    <div className="flex gap-1 px-2 py-2 min-w-max">
      {FIELD_DEFS.map((fd) => {
        const m = getMeasure(fd.id)
        const active = activeField === fd.id
        const hasVal = m?.points?.length > 0

        return (
          <button
            key={fd.id}
            onClick={() => {
              if (active) {
                if (phase === 'photo') finalizeField2D(fd.id as FieldId)
                else finalizeField3D(fd.id as FieldId)
              } else {
                setActiveField(fd.id as FieldId)
              }
            }}
            className="px-2.5 py-1.5 rounded text-xs font-mono whitespace-nowrap flex-shrink-0 transition-all"
            style={{
              background: active
                ? `${fd.color}22`
                : hasVal
                ? 'rgba(255,255,255,0.06)'
                : 'rgba(255,255,255,0.03)',
              border: `1px solid ${active ? fd.color : hasVal ? `${fd.color}44` : 'rgba(255,255,255,0.08)'}`,
              color: active ? fd.color : hasVal ? '#e8d8b8' : 'rgba(255,255,255,0.35)',
            }}
          >
            {fd.shortLabel}
            {hasVal && !active && (
              <span className="ml-1 opacity-60">{(m?.inchLength ?? 0).toFixed(1)}&quot;</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
