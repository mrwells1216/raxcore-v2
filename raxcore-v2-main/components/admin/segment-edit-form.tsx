'use client'

/**
 * Phase 41: Inline edit form for a single segment × measurement-type calibration row.
 * Pops a small popover with three inputs: multiplier, bias, confidence_adjustment.
 * Submits via a server action that upserts the calibration_values row.
 */

import { useState, useTransition } from 'react'
import { Pencil, Check, X, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { updateSegmentCalibrationValue } from '@/app/admin/segments/actions'

interface Props {
  segmentId: string
  measurementType: string
  currentMultiplier: number
  currentBias: number
  currentConfAdj: number
  disabled?: boolean
}

export function SegmentEditForm({
  segmentId,
  measurementType,
  currentMultiplier,
  currentBias,
  currentConfAdj,
  disabled = false,
}: Props) {
  const [open, setOpen] = useState(false)
  const [multiplier, setMultiplier] = useState(String(currentMultiplier))
  const [bias, setBias] = useState(String(currentBias))
  const [confAdj, setConfAdj] = useState(String(currentConfAdj))
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleOpen(next: boolean) {
    if (!next) {
      // reset on close
      setMultiplier(String(currentMultiplier))
      setBias(String(currentBias))
      setConfAdj(String(currentConfAdj))
      setError(null)
    }
    setOpen(next)
  }

  function handleSave() {
    const mult = parseFloat(multiplier)
    const b = parseFloat(bias)
    const ca = parseFloat(confAdj)
    if (isNaN(mult) || isNaN(b) || isNaN(ca)) {
      setError('All values must be valid numbers.')
      return
    }
    if (mult < 0.1 || mult > 3.0) {
      setError('Multiplier must be between 0.1 and 3.0.')
      return
    }
    if (Math.abs(b) > 20) {
      setError('Bias must be between -20 and 20.')
      return
    }
    if (Math.abs(ca) > 30) {
      setError('Confidence adjustment must be between -30 and 30.')
      return
    }
    setError(null)
    startTransition(async () => {
      try {
        await updateSegmentCalibrationValue({
          segmentId,
          measurementType,
          multiplier: mult,
          bias: b,
          confidenceAdjustment: ca,
        })
        setOpen(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save.')
      }
    })
  }

  if (disabled) return null

  return (
    <Popover open={open} onOpenChange={handleOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
          title={`Edit ${measurementType} calibration`}
        >
          <Pencil className="h-3 w-3" />
          <span className="sr-only">Edit {measurementType}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-4 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {measurementType} calibration
        </p>

        <div className="space-y-2">
          <div>
            <Label htmlFor={`mult-${segmentId}-${measurementType}`} className="text-xs">
              Multiplier
              <span className="ml-1 text-muted-foreground font-normal">(0.1–3.0, identity=1.0)</span>
            </Label>
            <Input
              id={`mult-${segmentId}-${measurementType}`}
              value={multiplier}
              onChange={e => setMultiplier(e.target.value)}
              className="h-7 text-xs font-mono mt-0.5"
              step="0.001"
              type="number"
            />
          </div>
          <div>
            <Label htmlFor={`bias-${segmentId}-${measurementType}`} className="text-xs">
              Bias (inches)
              <span className="ml-1 text-muted-foreground font-normal">(-20–20, identity=0)</span>
            </Label>
            <Input
              id={`bias-${segmentId}-${measurementType}`}
              value={bias}
              onChange={e => setBias(e.target.value)}
              className="h-7 text-xs font-mono mt-0.5"
              step="0.1"
              type="number"
            />
          </div>
          <div>
            <Label htmlFor={`ca-${segmentId}-${measurementType}`} className="text-xs">
              Confidence Adj. (points)
              <span className="ml-1 text-muted-foreground font-normal">(-30–30)</span>
            </Label>
            <Input
              id={`ca-${segmentId}-${measurementType}`}
              value={confAdj}
              onChange={e => setConfAdj(e.target.value)}
              className="h-7 text-xs font-mono mt-0.5"
              step="0.5"
              type="number"
            />
          </div>
        </div>

        {error && (
          <p className="text-xs text-destructive">{error}</p>
        )}

        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => handleOpen(false)}
            disabled={isPending}
          >
            <X className="h-3 w-3 mr-1" /> Cancel
          </Button>
          <Button
            size="sm"
            className="h-7 text-xs"
            onClick={handleSave}
            disabled={isPending}
          >
            {isPending ? (
              <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Saving</>
            ) : (
              <><Check className="h-3 w-3 mr-1" /> Save</>
            )}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
