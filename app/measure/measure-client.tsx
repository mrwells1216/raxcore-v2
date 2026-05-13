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
      className="flex flex-col no-zoom"
      style={{
        height: 'calc(100dvh - 56px)',  // subtract header height
        background: '#0d0a06',
        color: '#e8d8b8',
      }}
    >
      {/* Phase tabs + back button */}
      <div
        className="flex items-center justify-between flex-shrink-0 overflow-x-auto"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}
      >
        <div className="flex">
          {PHASES.map(p => (
            <PhaseTab key={p.id} id={p.id} label={p.label} active={phase === p.id} />
          ))}
        </div>
        <Link
          href="/score"
          className="flex items-center gap-1 px-3 py-2 text-xs font-bold tracking-widest uppercase transition-all mr-2 flex-shrink-0"
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
            className="flex-shrink-0 overflow-y-auto p-2 hidden md:block"
            style={{
              width: 196,
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

      {/* Mobile bottom field list grid (photo / 3D) - all buttons visible, no horizontal scroll */}
      {showFieldList && (
        <div
          className="flex-shrink-0 md:hidden"
          style={{
            borderTop: '1px solid rgba(255,255,255,0.07)',
            background: '#0a0907',
            paddingBottom: 'env(safe-area-inset-bottom)',
          }}
        >
          <MobileFieldGrid phase={phase} />
        </div>
      )}
    </div>
  )
}

// ─── Mobile field grid (wraps, no horizontal scroll) ─────────────────────────

function MobileFieldGrid({ phase }: { phase: MeasurePhase }) {
  const {
    measurements2D, measurements3D,
    activeField, setActiveField,
    finalizeField2D, finalizeField3D,
  } = useMeasureStore()

  const getMeasure = (id: string) =>
    phase === 'photo'
      ? measurements2D[id as keyof typeof measurements2D]
      : measurements3D[id as keyof typeof measurements3D]

  // Group fields into rows so left/right are visually paired
  const GRID_ROWS: { label: string; ids: string[] }[] = [
    { label: 'Beam', ids: ['beam-left', 'beam-right'] },
    { label: 'G1',   ids: ['g1-left', 'g1-right'] },
    { label: 'G2',   ids: ['g2-left', 'g2-right'] },
    { label: 'G3',   ids: ['g3-left', 'g3-right'] },
    { label: 'G4',   ids: ['g4-left', 'g4-right'] },
    { label: 'H1',   ids: ['h1-left', 'h1-right'] },
    { label: 'H2',   ids: ['h2-left', 'h2-right'] },
    { label: 'H3',   ids: ['h3-left', 'h3-right'] },
    { label: 'H4',   ids: ['h4-left', 'h4-right'] },
    { label: 'Spr',  ids: ['spread'] },
  ]

  const renderBtn = (id: string) => {
    const fd = FIELD_DEFS.find(f => f.id === id)
    if (!fd) return null
    const m = getMeasure(id)
    const active = activeField === id
    const hasVal = m?.points?.length > 0

    return (
      <button
        key={id}
        onClick={() => {
          if (active) {
            if (phase === 'photo') finalizeField2D(id as FieldId)
            else finalizeField3D(id as FieldId)
          } else {
            setActiveField(id as FieldId)
          }
        }}
        className="rounded text-[10px] font-mono transition-all flex flex-col items-center justify-center leading-tight py-1 w-full"
        style={{
          background: active
            ? `${fd.color}22`
            : hasVal
            ? 'rgba(255,255,255,0.06)'
            : 'rgba(255,255,255,0.03)',
          border: `1px solid ${active ? fd.color : hasVal ? `${fd.color}44` : 'rgba(255,255,255,0.08)'}`,
          color: active ? fd.color : hasVal ? '#e8d8b8' : 'rgba(255,255,255,0.4)',
          minHeight: 32,
        }}
      >
        <span className="font-bold">{fd.shortLabel}</span>
        {hasVal && (
          <span className="opacity-70 text-[9px]">{(m?.inchLength ?? 0).toFixed(1)}&quot;</span>
        )}
      </button>
    )
  }

  return (
    <div className="grid grid-cols-4 gap-1 px-2 py-2">
      {GRID_ROWS.flatMap(row => {
        // Paired rows render both buttons; spread spans 2 columns
        if (row.ids.length === 2) {
          return row.ids.map(renderBtn)
        }
        return [
          <div key={row.label} className="col-span-2">
            {renderBtn(row.ids[0])}
          </div>,
        ]
      })}
    </div>
  )
}
