'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, Ruler } from 'lucide-react'
import { Input } from '@/components/ui/input'
import type { PreScoringMeasurements } from '@/lib/types'

interface PreScoringMeasurementsProps {
  value: PreScoringMeasurements
  onChange: (value: PreScoringMeasurements) => void
}

const BEAM_RANGE = { warn_low: 8, warn_high: 40 }
const TINE_RANGE = { warn_low: 0.5, warn_high: 22 }
const CIRC_RANGE = { warn_low: 2, warn_high: 14 }
const SPREAD_RANGE = { warn_low: 6, warn_high: 36 }

function plausibilityWarning(val: number | null | undefined, range: { warn_low: number; warn_high: number }): string | null {
  if (val == null) return null
  if (val < range.warn_low) return `Value seems low — confirm measurement`
  if (val > range.warn_high) return `Value seems high — confirm measurement`
  return null
}

interface FieldInputProps {
  id: string
  label: string
  value: number | null | undefined
  range: { warn_low: number; warn_high: number }
  onChange: (v: number | null) => void
}

function FieldInput({ id, label, value, range, onChange }: FieldInputProps) {
  const warning = plausibilityWarning(value, range)
  const hasValue = value != null

  return (
    <div className="space-y-0.5">
      <label htmlFor={id} className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground">
        {label}
      </label>
      <div className="relative">
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          step="0.125"
          min="0"
          max="99"
          placeholder="—"
          value={value ?? ''}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            const raw = e.target.value
            if (raw === '' || raw === null) {
              onChange(null)
              return
            }
            const n = parseFloat(raw)
            onChange(Number.isFinite(n) ? n : null)
          }}
          className="h-8 text-sm pr-7"
          style={hasValue ? {
            boxShadow: 'inset 0 0 0 1px rgba(212,168,75,0.5)',
          } : undefined}
        />
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
          in
        </span>
      </div>
      {warning && (
        <p className="text-[10px] text-amber-500/80">{warning}</p>
      )}
    </div>
  )
}

export function PreScoringMeasurementsPanel({ value, onChange }: PreScoringMeasurementsProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [showMoreCircs, setShowMoreCircs] = useState(false)

  const set = (field: keyof PreScoringMeasurements, v: number | null) => {
    onChange({ ...value, [field]: v })
  }

  const enteredCount = Object.values(value).filter((v) => v != null).length

  return (
    <div className="rounded-lg border border-border/60 bg-card/30">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
        onClick={() => setIsExpanded((v) => !v)}
        aria-expanded={isExpanded}
      >
        <div className="flex items-center gap-2">
          <Ruler className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold">Known Measurements</span>
          <span className="text-[10px] text-muted-foreground">(optional)</span>
        </div>
        <div className="flex items-center gap-2">
          {enteredCount > 0 && (
            <span
              className="text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded-full"
              style={{
                background: 'rgba(212,168,75,0.15)',
                color: 'rgba(212,168,75,0.9)',
                border: '1px solid rgba(212,168,75,0.3)',
              }}
            >
              {enteredCount} entered
            </span>
          )}
          {isExpanded ? (
            <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </div>
      </button>

      {isExpanded && (
        <div className="border-t border-border/40 px-3 pb-3 pt-2 space-y-4">
          <p className="text-[11px] text-muted-foreground">
            Enter any measurements you already have from a tape measure. None are required — even one helps significantly by anchoring all AI estimates.
          </p>

          {/* Main Beams */}
          <div className="space-y-1.5">
            <p className="text-[10px] font-black uppercase tracking-[0.15em] text-muted-foreground">Main Beams</p>
            <div className="grid grid-cols-2 gap-2">
              <FieldInput id="mb-left" label="Left beam" value={value.main_beam_left} range={BEAM_RANGE} onChange={(v) => set('main_beam_left', v)} />
              <FieldInput id="mb-right" label="Right beam" value={value.main_beam_right} range={BEAM_RANGE} onChange={(v) => set('main_beam_right', v)} />
            </div>
          </div>

          {/* Tine Lengths */}
          <div className="space-y-1.5">
            <p className="text-[10px] font-black uppercase tracking-[0.15em] text-muted-foreground">Tine Lengths (G1–G4)</p>
            <div className="grid grid-cols-2 gap-2">
              <FieldInput id="g1l" label="G1 Left" value={value.g1_left} range={TINE_RANGE} onChange={(v) => set('g1_left', v)} />
              <FieldInput id="g1r" label="G1 Right" value={value.g1_right} range={TINE_RANGE} onChange={(v) => set('g1_right', v)} />
              <FieldInput id="g2l" label="G2 Left" value={value.g2_left} range={TINE_RANGE} onChange={(v) => set('g2_left', v)} />
              <FieldInput id="g2r" label="G2 Right" value={value.g2_right} range={TINE_RANGE} onChange={(v) => set('g2_right', v)} />
              <FieldInput id="g3l" label="G3 Left" value={value.g3_left} range={TINE_RANGE} onChange={(v) => set('g3_left', v)} />
              <FieldInput id="g3r" label="G3 Right" value={value.g3_right} range={TINE_RANGE} onChange={(v) => set('g3_right', v)} />
              <FieldInput id="g4l" label="G4 Left" value={value.g4_left} range={TINE_RANGE} onChange={(v) => set('g4_left', v)} />
              <FieldInput id="g4r" label="G4 Right" value={value.g4_right} range={TINE_RANGE} onChange={(v) => set('g4_right', v)} />
            </div>
          </div>

          {/* Circumferences H1/H2 */}
          <div className="space-y-1.5">
            <p className="text-[10px] font-black uppercase tracking-[0.15em] text-muted-foreground">Circumferences (H1–H2)</p>
            <div className="grid grid-cols-2 gap-2">
              <FieldInput id="h1l" label="H1 Left" value={value.h1_left} range={CIRC_RANGE} onChange={(v) => set('h1_left', v)} />
              <FieldInput id="h1r" label="H1 Right" value={value.h1_right} range={CIRC_RANGE} onChange={(v) => set('h1_right', v)} />
              <FieldInput id="h2l" label="H2 Left" value={value.h2_left} range={CIRC_RANGE} onChange={(v) => set('h2_left', v)} />
              <FieldInput id="h2r" label="H2 Right" value={value.h2_right} range={CIRC_RANGE} onChange={(v) => set('h2_right', v)} />
            </div>
          </div>

          {/* H3/H4 collapsible */}
          <button
            type="button"
            className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
            onClick={() => setShowMoreCircs((v) => !v)}
          >
            {showMoreCircs ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {showMoreCircs ? 'Hide H3–H4' : 'More circumferences (H3–H4)'}
          </button>

          {showMoreCircs && (
            <div className="grid grid-cols-2 gap-2">
              <FieldInput id="h3l" label="H3 Left" value={value.h3_left} range={CIRC_RANGE} onChange={(v) => set('h3_left', v)} />
              <FieldInput id="h3r" label="H3 Right" value={value.h3_right} range={CIRC_RANGE} onChange={(v) => set('h3_right', v)} />
              <FieldInput id="h4l" label="H4 Left" value={value.h4_left} range={CIRC_RANGE} onChange={(v) => set('h4_left', v)} />
              <FieldInput id="h4r" label="H4 Right" value={value.h4_right} range={CIRC_RANGE} onChange={(v) => set('h4_right', v)} />
            </div>
          )}

          {/* Inside Spread */}
          <div className="space-y-1.5">
            <p className="text-[10px] font-black uppercase tracking-[0.15em] text-muted-foreground">Inside Spread</p>
            <div className="w-1/2 pr-1">
              <FieldInput id="spread" label="Inside spread" value={value.inside_spread} range={SPREAD_RANGE} onChange={(v) => set('inside_spread', v)} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
