'use client'

/**
 * §4.5 — Circumference taper refinement UI.
 *
 * Shown on the scoring result page. User tapes H1 on one side (60 sec) and
 * the API derives H2–H4 plus the opposite-side ladder. Derived values are
 * tagged with `source: 'derived_taper'` server-side and NEVER unlock
 * Verified Score.
 */

import { useState } from 'react'
import { ChevronDown, ChevronUp, Ruler } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  TAPER_H1_TO_H1_MIN_INCHES,
  TAPER_H1_TO_H1_MAX_INCHES,
  TAPER_RATIOS,
} from '@/lib/scoring/circumference-taper'
import { toast } from 'sonner'

interface CircumferenceTaperCardProps {
  predictionId: string
  onRefined?: () => void
}

export function CircumferenceTaperCard({ predictionId, onRefined }: CircumferenceTaperCardProps) {
  const [open, setOpen] = useState(false)
  const [side, setSide] = useState<'left' | 'right'>('left')
  const [inches, setInches] = useState<string>('')
  const [busy, setBusy] = useState(false)

  const parsedInches = (() => {
    const n = Number(inches)
    return Number.isFinite(n) ? n : NaN
  })()
  const inBand =
    Number.isFinite(parsedInches) &&
    parsedInches >= TAPER_H1_TO_H1_MIN_INCHES &&
    parsedInches <= TAPER_H1_TO_H1_MAX_INCHES

  // Live preview of the derived ladder so the user sees what they'll get
  // before submitting.
  const preview = inBand
    ? {
        h1: parsedInches,
        h2: Math.round(parsedInches * TAPER_RATIOS.H2 * 10) / 10,
        h3: Math.round(parsedInches * TAPER_RATIOS.H3 * 10) / 10,
        h4: Math.round(parsedInches * TAPER_RATIOS.H4 * 10) / 10,
      }
    : null

  async function submit() {
    if (!inBand) {
      toast.error(`H1 must be between ${TAPER_H1_TO_H1_MIN_INCHES}" and ${TAPER_H1_TO_H1_MAX_INCHES}"`)
      return
    }
    setBusy(true)
    try {
      const resp = await fetch('/api/scoring/refine-circumference', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          predictionId,
          measuredH1Inches: parsedInches,
          side,
        }),
      })
      const json = await resp.json()
      if (!resp.ok) {
        throw new Error(json?.message || json?.error || 'Refinement failed')
      }
      toast.success(`Circumferences refined (Δ ${json.grossDelta > 0 ? '+' : ''}${json.grossDelta}")`)
      onRefined?.()
      setOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Refinement failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          className="flex w-full items-center justify-between text-left"
          aria-expanded={open}
        >
          <CardTitle className="text-base flex items-center gap-2">
            <Ruler className="h-4 w-4" />
            Refine Circumferences (Optional Tape Measurement)
          </CardTitle>
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </CardHeader>
      {open && (
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Tape one circumference (H1, between the burr and the G1 tine), pick the side, and
            we&apos;ll derive H2&ndash;H4 plus the opposite-side ladder using whitetail
            taper ratios ({Math.round(TAPER_RATIOS.H2 * 100)}% / {Math.round(TAPER_RATIOS.H3 * 100)}% /{' '}
            {Math.round(TAPER_RATIOS.H4 * 100)}%). Derived values are labeled <em>derived</em>;
            this never unlocks Verified Score.
          </p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span>Side</span>
              <div className="mt-1 flex gap-2">
                {(['left', 'right'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSide(s)}
                    className={`rounded border px-3 py-1.5 text-sm capitalize ${
                      side === s
                        ? 'border-amber-500 bg-amber-500/10 text-amber-300'
                        : 'border-zinc-700 text-zinc-400'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </label>

            <label className="block text-sm">
              <span>H1 (inches)</span>
              <input
                type="number"
                step="0.1"
                min={TAPER_H1_TO_H1_MIN_INCHES}
                max={TAPER_H1_TO_H1_MAX_INCHES}
                value={inches}
                onChange={(e) => setInches(e.target.value)}
                placeholder="e.g. 4.5"
                className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
              />
              {inches && !inBand && (
                <span className="mt-1 block text-xs text-red-400">
                  Must be {TAPER_H1_TO_H1_MIN_INCHES}&ndash;{TAPER_H1_TO_H1_MAX_INCHES}&quot;
                </span>
              )}
            </label>
          </div>

          {preview && (
            <div className="rounded border border-zinc-800 bg-zinc-950 p-3 text-xs">
              <div className="text-zinc-400">Preview ({side})</div>
              <div className="mt-1 grid grid-cols-4 gap-2 font-mono">
                <div>H1: <span className="text-amber-400">{preview.h1.toFixed(1)}&quot;</span></div>
                <div>H2: <span className="text-amber-400">{preview.h2.toFixed(1)}&quot;</span></div>
                <div>H3: <span className="text-amber-400">{preview.h3.toFixed(1)}&quot;</span></div>
                <div>H4: <span className="text-amber-400">{preview.h4.toFixed(1)}&quot;</span></div>
              </div>
              <div className="mt-2 text-zinc-500">
                Opposite side mirrors with the same ladder (symmetric ±5% assumption).
              </div>
            </div>
          )}

          <Button onClick={submit} disabled={!inBand || busy}>
            {busy ? 'Refining…' : 'Apply taper'}
          </Button>
        </CardContent>
      )}
    </Card>
  )
}
