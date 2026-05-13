'use client'

import { CheckCircle2, Circle, Crosshair } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  useMeasureStore,
  FIELD_DEFS,
  type FieldId,
  type MeasurePhase,
} from './measure-store'

interface FieldListProps {
  phase: MeasurePhase
}

// Paired rows so left/right sit side by side and everything fits without scroll
const FIELD_ROWS: { group: string; label: string; ids: FieldId[] }[] = [
  { group: 'Beams',          label: 'Beam', ids: ['beam-left', 'beam-right'] },
  { group: 'Tines',          label: 'G1',   ids: ['g1-left',   'g1-right']   },
  { group: 'Tines',          label: 'G2',   ids: ['g2-left',   'g2-right']   },
  { group: 'Tines',          label: 'G3',   ids: ['g3-left',   'g3-right']   },
  { group: 'Tines',          label: 'G4',   ids: ['g4-left',   'g4-right']   },
  { group: 'Circumferences', label: 'H1',   ids: ['h1-left',   'h1-right']   },
  { group: 'Circumferences', label: 'H2',   ids: ['h2-left',   'h2-right']   },
  { group: 'Circumferences', label: 'H3',   ids: ['h3-left',   'h3-right']   },
  { group: 'Circumferences', label: 'H4',   ids: ['h4-left',   'h4-right']   },
  { group: 'Spread',         label: 'Sp.',  ids: ['spread']                  },
]

function StatusIcon({
  state,
  color,
}: {
  state: 'finalized' | 'measured' | 'active' | 'idle'
  color: string
}) {
  if (state === 'finalized') return <CheckCircle2 className="h-3 w-3" style={{ color }} />
  if (state === 'measured')  return <Circle        className="h-3 w-3" style={{ color }} />
  if (state === 'active')    return <Crosshair     className="h-3 w-3" style={{ color }} />
  return <Circle className="h-3 w-3 opacity-30" style={{ color }} />
}

export function FieldList({ phase }: FieldListProps) {
  const {
    activeField, setActiveField,
    measurements2D, measurements3D,
    finalizeField2D, finalizeField3D,
  } = useMeasureStore()

  const getMeasure = (id: FieldId) =>
    phase === 'photo' ? measurements2D[id] : measurements3D[id]

  const handleSelect = (id: FieldId) => {
    if (activeField === id) {
      if (phase === 'photo') finalizeField2D(id)
      else finalizeField3D(id)
      return
    }
    setActiveField(id)
  }

  const renderCell = (id: FieldId) => {
    const fd = FIELD_DEFS.find(f => f.id === id)!
    const m = getMeasure(id)
    const active = activeField === id
    const measured = m.points.length > 0
    const finalized = m.finalized
    const inches = m.inchLength
    const state: 'finalized' | 'measured' | 'active' | 'idle' =
      finalized ? 'finalized' : measured ? 'measured' : active ? 'active' : 'idle'

    // Strip prefix like "G1 L" -> "L", "Beam R" -> "R", "Spread" stays
    const sideLabel = fd.side === 'n/a'
      ? fd.shortLabel
      : fd.side === 'left' ? 'L' : 'R'

    return (
      <button
        key={id}
        onClick={() => handleSelect(id)}
        className={cn(
          'flex items-center gap-1 px-1.5 py-1 rounded text-left w-full transition-colors',
          active ? '' : measured ? 'hover:bg-muted/40' : 'hover:bg-muted/20',
        )}
        style={{
          background: active ? `${fd.color}22` : measured ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.02)',
          border: `1px solid ${active ? fd.color : measured ? `${fd.color}44` : 'rgba(255,255,255,0.06)'}`,
          minHeight: 26,
        }}
      >
        <StatusIcon state={state} color={fd.color} />
        <span
          className="text-[10px] font-mono font-semibold"
          style={{ color: active ? fd.color : measured ? '#e8d8b8' : 'rgba(255,255,255,0.45)' }}
        >
          {sideLabel}
        </span>
        {inches > 0 && (
          <span
            className="text-[10px] font-mono ml-auto"
            style={{ color: finalized ? fd.color : 'rgba(232,216,184,0.7)' }}
          >
            {inches.toFixed(1)}&quot;
          </span>
        )}
      </button>
    )
  }

  // Group rows under their section headers
  let lastGroup = ''
  return (
    <div className="flex flex-col gap-1.5">
      {FIELD_ROWS.map(row => {
        const showHeader = row.group !== lastGroup
        lastGroup = row.group
        return (
          <div key={row.label}>
            {showHeader && (
              <p
                className="text-[9px] font-bold tracking-widest uppercase mb-1 mt-1 px-0.5"
                style={{ color: 'var(--muted-foreground)' }}
              >
                {row.group}
              </p>
            )}
            <div className="flex items-center gap-1">
              <span
                className="text-[10px] font-mono font-bold w-7 shrink-0"
                style={{ color: 'rgba(200,169,110,0.7)' }}
              >
                {row.label}
              </span>
              {row.ids.length === 2 ? (
                <div className="grid grid-cols-2 gap-1 flex-1">
                  {row.ids.map(renderCell)}
                </div>
              ) : (
                <div className="flex-1">
                  {renderCell(row.ids[0])}
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
