'use client'

import { CheckCircle2, Circle, Crosshair, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
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

const FIELD_GROUPS = [
  { label: 'Beams', ids: ['beam-left', 'beam-right'] as FieldId[] },
  { label: 'Tines', ids: ['g1-left', 'g1-right', 'g2-left', 'g2-right', 'g3-left', 'g3-right', 'g4-left', 'g4-right'] as FieldId[] },
  { label: 'Spread', ids: ['spread'] as FieldId[] },
  { label: 'Circumferences', ids: ['h1-left', 'h1-right', 'h2-left', 'h2-right', 'h3-left', 'h3-right', 'h4-left', 'h4-right'] as FieldId[] },
]

function ConfidenceDot({ confidence }: { confidence: 'high' | 'medium' | 'low' }) {
  if (confidence === 'high') return <span className="w-2 h-2 rounded-full shrink-0" style={{ background: '#4ade80' }} />
  if (confidence === 'medium') return <span className="w-2 h-2 rounded-full shrink-0" style={{ background: '#fbbf24' }} />
  return <span className="w-2 h-2 rounded-full shrink-0" style={{ background: '#f87171' }} />
}

export function FieldList({ phase }: FieldListProps) {
  const {
    activeField, setActiveField,
    measurements2D, measurements3D,
    clearField2D, clearField3D,
    finalizeField2D, finalizeField3D,
  } = useMeasureStore()

  const getMeasure = (id: FieldId) =>
    phase === 'photo' ? measurements2D[id] : measurements3D[id]

  const hasPoints = (id: FieldId) => {
    const m = getMeasure(id)
    return m.points.length > 0
  }

  const getInches = (id: FieldId) => {
    const m = getMeasure(id)
    return m.inchLength
  }

  const isFinalized = (id: FieldId) => getMeasure(id).finalized

  const handleSelect = (id: FieldId) => {
    if (activeField === id) {
      // Second click finalizes
      if (phase === 'photo') finalizeField2D(id)
      else finalizeField3D(id)
      return
    }
    setActiveField(id)
  }

  const handleClear = (e: React.MouseEvent, id: FieldId) => {
    e.stopPropagation()
    if (phase === 'photo') clearField2D(id)
    else clearField3D(id)
  }

  return (
    <div className="flex flex-col gap-3 overflow-y-auto">
      {FIELD_GROUPS.map(group => (
        <div key={group.label}>
          <p
            className="text-[9px] font-bold tracking-widest uppercase mb-1.5 px-1"
            style={{ color: 'var(--muted-foreground)' }}
          >
            {group.label}
          </p>
          <div className="flex flex-col gap-0.5">
            {group.ids.map(id => {
              const fd = FIELD_DEFS.find(f => f.id === id)!
              const active = activeField === id
              const measured = hasPoints(id)
              const finalized = isFinalized(id)
              const inches = getInches(id)

              return (
                <button
                  key={id}
                  onClick={() => handleSelect(id)}
                  className={cn(
                    'flex items-center gap-2 px-2 py-1.5 rounded text-left w-full transition-colors group',
                    active
                      ? 'bg-primary/15'
                      : measured
                      ? 'hover:bg-muted/40'
                      : 'hover:bg-muted/20 opacity-75',
                  )}
                  style={active ? { borderLeft: `2px solid ${fd.color}` } : { borderLeft: '2px solid transparent' }}
                >
                  {/* Status icon */}
                  <span className="shrink-0">
                    {finalized ? (
                      <CheckCircle2 className="h-3.5 w-3.5" style={{ color: fd.color }} />
                    ) : measured ? (
                      <Circle className="h-3.5 w-3.5" style={{ color: fd.color }} />
                    ) : active ? (
                      <Crosshair className="h-3.5 w-3.5" style={{ color: fd.color }} />
                    ) : (
                      <Circle className="h-3.5 w-3.5 opacity-30" style={{ color: fd.color }} />
                    )}
                  </span>

                  {/* Label */}
                  <span
                    className="text-[11px] font-mono flex-1 truncate"
                    style={{ color: active ? fd.color : 'var(--foreground)' }}
                  >
                    {fd.shortLabel}
                  </span>

                  {/* Value */}
                  {inches > 0 && (
                    <span
                      className="text-[11px] font-mono shrink-0"
                      style={{ color: finalized ? fd.color : 'var(--muted-foreground)' }}
                    >
                      {inches.toFixed(1)}"
                    </span>
                  )}

                  {/* Confidence dot */}
                  {measured && (
                    <ConfidenceDot confidence={getMeasure(id).confidence} />
                  )}

                  {/* Clear button */}
                  {measured && !finalized && (
                    <button
                      className="opacity-0 group-hover:opacity-100 transition-opacity ml-1"
                      onClick={(e) => handleClear(e, id)}
                      aria-label={`Clear ${fd.label}`}
                    >
                      <Trash2 className="h-3 w-3" style={{ color: 'var(--muted-foreground)' }} />
                    </button>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
