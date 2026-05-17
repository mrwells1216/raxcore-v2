'use client'

import { useState } from 'react'
import { Ruler, Loader2, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'

interface RefineResponse {
  predictionId: string
  newGross: number | null
  deltaInches: number
  measurements: Record<string, number | null>
  derivedCircumferences: Array<{
    field: 'h1' | 'h2' | 'h3' | 'h4'
    side: 'left' | 'right'
    valueInches: number
    source: 'measured' | 'derived_taper'
    confidence: number
  }>
  warnings: string[]
}

interface CircumferenceRefineCardProps {
  predictionId: string
  buckId?: string
  /** True when raw_ai_response.circumferenceRefinement already exists */
  alreadyRefined?: boolean
  onRefined?: (result: RefineResponse) => void
}

export function CircumferenceRefineCard({
  predictionId,
  buckId,
  alreadyRefined,
  onRefined,
}: CircumferenceRefineCardProps) {
  const [h1Left, setH1Left] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [skipped, setSkipped] = useState(false)
  const [done, setDone] = useState<RefineResponse | null>(null)

  if (skipped || (alreadyRefined && !done)) return null

  if (done) {
    return (
      <div
        className="rounded p-4 space-y-2"
        style={{
          border: '1px solid var(--bronze-dark)',
          background: 'linear-gradient(180deg, #1e1b18 0%, #1a1714 100%)',
        }}
      >
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-amber-400" />
          <span className="text-[11px] font-black tracking-widest uppercase text-amber-200">
            Refined
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          H1–H4 derived from your H1 measurement. New gross:{' '}
          <span className="font-mono text-foreground">{done.newGross ?? '—'}&quot;</span>
          {done.deltaInches !== 0 && (
            <>
              {' '}
              ({done.deltaInches > 0 ? '+' : ''}
              {done.deltaInches}&quot; from prior)
            </>
          )}
        </p>
        <p className="text-[10px] font-mono text-muted-foreground">
          Derived values tagged{' '}
          <span className="text-amber-300/80">derived_taper</span> — H1 left is{' '}
          <span className="text-amber-300/80">measured</span>.
        </p>
      </div>
    )
  }

  const submit = async () => {
    const value = Number(h1Left)
    if (!Number.isFinite(value) || value <= 0) {
      toast.error('Enter a positive H1 measurement in inches')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/scoring/refine-circumference', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ predictionId, buckId, h1LeftInches: value }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error || 'Refinement failed')
        return
      }
      setDone(json)
      onRefined?.(json)
      toast.success('Score refined from your H1 measurement')
    } catch (err) {
      toast.error('Network error — refinement not saved')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="rounded p-4 space-y-3"
      style={{
        border: '1px solid var(--bronze-dark)',
        background: 'linear-gradient(180deg, #1e1b18 0%, #1a1714 100%)',
      }}
    >
      <div className="flex items-center gap-2">
        <Ruler className="h-4 w-4" style={{ color: 'var(--bronze-mid)' }} />
        <span
          className="text-[11px] font-black tracking-widest uppercase"
          style={{ color: 'var(--bronze-light)' }}
        >
          Refine circumference measurements
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        Wrap a soft tape around the main beam just above the burr — that is H1, the
        thinnest part of the beam. Even one measurement improves all 8 H-fields.
      </p>
      <div className="space-y-1">
        <label className="text-[11px] font-mono tracking-widest uppercase text-muted-foreground">
          Left beam H1
        </label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            inputMode="decimal"
            min="2.5"
            max="8"
            step="0.05"
            placeholder='e.g. 4.5"'
            value={h1Left}
            onChange={(e) => setH1Left(e.target.value)}
            className="flex-1 min-h-[40px] rounded px-3 text-sm bg-black/40 text-foreground"
            style={{ border: '1px solid var(--bronze-dark)' }}
          />
          <span className="text-xs text-muted-foreground">inches</span>
        </div>
      </div>
      <p className="text-[10px] font-mono text-muted-foreground">
        Derived values are labeled{' '}
        <span className="text-amber-300/80">derived_taper</span>, never{' '}
        <span className="text-amber-300/80">measured</span>.
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={submitting || !h1Left.trim()}
          className="flex-1 min-h-[40px] rounded text-xs font-black tracking-widest uppercase transition-all touch-manipulation disabled:opacity-60"
          style={{
            background:
              'linear-gradient(180deg, var(--bronze-light) 0%, var(--bronze-mid) 55%, var(--bronze-dark) 100%)',
            color: '#161412',
            boxShadow:
              '0 1px 0 rgba(255,230,150,0.22) inset, 0 -1px 0 rgba(0,0,0,0.35) inset, 0 3px 14px rgba(0,0,0,0.55)',
          }}
        >
          {submitting ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Refining…
            </span>
          ) : (
            'Refine score'
          )}
        </button>
        <button
          type="button"
          onClick={() => setSkipped(true)}
          className="min-h-[40px] px-4 rounded text-xs font-bold tracking-widest uppercase text-muted-foreground hover:text-foreground transition-colors"
          style={{ border: '1px solid var(--bronze-dark)', background: '#1a1714' }}
        >
          Skip
        </button>
      </div>
    </div>
  )
}
