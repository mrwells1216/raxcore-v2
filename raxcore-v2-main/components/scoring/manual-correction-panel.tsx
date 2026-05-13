'use client'

/**
 * ManualCorrectionPanel
 *
 * Full-screen sheet (mobile-first) that lets the user correct a single
 * measurement field. Supports:
 *   - Drag-handle geometry correction on the image overlay
 *   - Numeric fallback input (always available)
 *   - Mode toggle: Endpoint / Trace (coming soon)
 *   - Save → structured ManualOverrideEntry
 */

import { useState, useCallback, useMemo } from 'react'
import {
  X,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Bot,
  User,
  AlertCircle,
  Crosshair,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { ManualCorrectionOverlay } from './manual-correction-overlay'
import {
  getCorrectionHandleDefinition,
  resolveLandmarkHandles,
} from '@/lib/scoring/manual-correction-mapping'
import type { ManualOverrideFieldKey } from '@/lib/scoring/manual-overrides'

// ─── Props ──────────────────────────────────────────────────────────────────

interface ManualCorrectionPanelProps {
  imageUrl: string
  fieldKey: ManualOverrideFieldKey | string
  fieldLabel: string
  currentValue: number | null
  /** Raw AI value before any precision pass (shown for reference) */
  aiValue?: number | null
  /** Provenance of current value */
  provenance?: string | null
  /** Confidence of current value */
  confidence?: string | null
  /** Normalized landmarks from the scoring payload */
  landmarks?: Record<string, unknown> | null
  onCancel: () => void
  onSave: (override: {
    fieldKey: string
    value: number | null
    geometry?: {
      start?: { x: number; y: number } | null
      end?: { x: number; y: number } | null
      points?: { x: number; y: number }[] | null
    } | null
  }) => void
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatVal(v: number | null | undefined): string {
  if (v == null) return '—'
  return `${v.toFixed(2)}\u2033`
}

function parseInput(s: string): number | null {
  if (!s.trim()) return null
  const n = parseFloat(s)
  if (isNaN(n) || n < 0) return null
  return Math.round(n * 8) / 8 // nearest 1/8 inch
}

function confidenceClass(confidence: string | null | undefined): string {
  switch (confidence) {
    case 'high': return 'text-emerald-400'
    case 'medium': return 'text-amber-400'
    case 'low': return 'text-red-400'
    default: return 'text-zinc-400'
  }
}

// ─── Component ──────────────────────────────────────────────────────────────

export function ManualCorrectionPanel({
  imageUrl,
  fieldKey,
  fieldLabel,
  currentValue,
  aiValue,
  provenance,
  confidence,
  landmarks,
  onCancel,
  onSave,
}: ManualCorrectionPanelProps) {
  // Resolve definition and initial handle positions from landmarks
  const definition = getCorrectionHandleDefinition(fieldKey)
  const initialHandles = useMemo(() => {
    if (!definition) return { start: null, end: null }
    return resolveLandmarkHandles(definition, landmarks)
  }, [definition, landmarks])

  const [handles, setHandles] = useState(initialHandles)
  const [numericInput, setNumericInput] = useState(
    currentValue != null ? currentValue.toFixed(2) : ''
  )
  const [mode] = useState<'endpoint' | 'trace'>('endpoint')

  // Derive display value: numeric input takes precedence over geometry
  const parsedNumeric = parseInput(numericInput)
  const correctedValue = parsedNumeric

  // Reset to current AI value
  const handleReset = useCallback(() => {
    setHandles(initialHandles)
    setNumericInput(currentValue != null ? currentValue.toFixed(2) : '')
  }, [initialHandles, currentValue])

  const handleSave = useCallback(() => {
    const geometry = (handles.start || handles.end)
      ? {
          start: handles.start ?? null,
          end: handles.end ?? null,
          points: null,
        }
      : null

    onSave({
      fieldKey,
      value: correctedValue,
      geometry,
    })
  }, [fieldKey, correctedValue, handles, onSave])

  const hasChange = correctedValue !== null && correctedValue !== currentValue

  const provenanceLabel =
    provenance === 'human_review'
      ? 'Human'
      : provenance === 'precision_pass'
      ? 'Precision'
      : provenance === 'ai_raw'
      ? 'AI'
      : provenance ?? 'AI'

  return (
    <div className="flex flex-col h-full min-h-0 bg-zinc-950 text-zinc-100">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3 border-b border-zinc-800 shrink-0">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-white">{fieldLabel}</span>
            {confidence && (
              <span className={cn('text-xs font-medium capitalize', confidenceClass(confidence))}>
                {confidence} confidence
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs text-zinc-400">
            <span>
              AI value:{' '}
              <span className="text-zinc-200 font-mono">{formatVal(aiValue ?? currentValue)}</span>
            </span>
            {provenanceLabel && (
              <Badge
                variant="outline"
                className="text-[10px] h-4 px-1.5 border-zinc-700 text-zinc-400"
              >
                {provenanceLabel}
              </Badge>
            )}
          </div>
        </div>

        <Button
          variant="ghost"
          size="icon"
          onClick={onCancel}
          className="shrink-0 h-8 w-8 text-zinc-400 hover:text-white"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* ── Image + Overlay ────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="p-3">
          {imageUrl ? (
            <>
              {/* Mode hint */}
              <div className="flex items-center gap-2 mb-2">
                <Crosshair className="h-3.5 w-3.5 text-zinc-500" />
                <span className="text-xs text-zinc-500">
                  {!handles.start
                    ? 'Tap image to place start point (S)'
                    : !handles.end
                    ? 'Tap image to place end point (E)'
                    : 'Drag handles to adjust. S = start, E = end.'}
                </span>
              </div>

              <ManualCorrectionOverlay
                imageUrl={imageUrl}
                handles={handles}
                onChange={setHandles}
                accentColor="#b87333"
              />

              {/* Endpoint labels */}
              {definition && (handles.start || handles.end) && (
                <div className="flex items-center gap-4 mt-2 text-xs text-zinc-500">
                  {handles.start && (
                    <span>
                      <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-[#b87333] text-white text-[9px] font-bold mr-1">
                        S
                      </span>
                      {definition.startLabel ?? 'Start'}
                    </span>
                  )}
                  {handles.end && (
                    <span>
                      <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-[#b87333] text-white text-[9px] font-bold mr-1">
                        E
                      </span>
                      {definition.endLabel ?? 'End'}
                    </span>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-6 text-center text-xs text-zinc-500">
              No image available — use numeric input below.
            </div>
          )}
        </div>

        {/* ── Correction Controls ─────────────────────────────────────── */}
        <div className="px-4 pb-4 space-y-4">
          {/* Numeric input */}
          <div className="space-y-2">
            <Label htmlFor="correction-value" className="text-xs text-zinc-400 uppercase tracking-wide">
              Corrected Value (inches)
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="correction-value"
                type="number"
                step="0.125"
                min="0"
                max="100"
                value={numericInput}
                onChange={(e) => setNumericInput(e.target.value)}
                placeholder={currentValue != null ? currentValue.toFixed(2) : '0.00'}
                className="bg-zinc-900 border-zinc-700 text-white text-base font-mono h-11 flex-1"
              />
              <span className="text-zinc-500 text-sm shrink-0">&Prime;</span>
            </div>
            {correctedValue !== null && (
              <div className="text-xs text-zinc-400">
                Will save:{' '}
                <span className="text-white font-mono font-medium">
                  {correctedValue.toFixed(3)}&Prime;
                </span>
                {hasChange && (
                  <span
                    className={cn(
                      'ml-2 font-medium',
                      (correctedValue - (currentValue ?? 0)) >= 0
                        ? 'text-emerald-400'
                        : 'text-red-400'
                    )}
                  >
                    {(correctedValue - (currentValue ?? 0)) >= 0 ? '+' : ''}
                    {(correctedValue - (currentValue ?? 0)).toFixed(3)}&Prime;
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Provenance note */}
          <div className="rounded-md border border-zinc-800 bg-zinc-900/50 px-3 py-2.5 flex items-start gap-2">
            <AlertCircle className="h-3.5 w-3.5 text-zinc-500 mt-0.5 shrink-0" />
            <p className="text-xs text-zinc-500 leading-relaxed">
              Adjust only if the system measured this field incorrectly. Saving
              will mark this field as{' '}
              <span className="text-emerald-400 font-medium">human review</span> and
              update the score sheet immediately.
            </p>
          </div>

          {/* Mode toggle placeholder */}
          <div className="flex items-center gap-2 text-xs text-zinc-600">
            <SlidersHorizontal className="h-3 w-3" />
            <span>Endpoint mode</span>
            <span className="border border-zinc-800 rounded px-1.5 py-0.5 text-[10px] text-zinc-600">
              Trace mode — coming soon
            </span>
          </div>
        </div>
      </div>

      {/* ── Footer Actions ──────────────────────────────────────────────── */}
      <div className="shrink-0 border-t border-zinc-800 px-4 py-3 flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleReset}
          className="text-zinc-400 hover:text-white h-9 gap-1.5"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Reset
        </Button>

        <div className="flex-1" />

        <Button
          variant="outline"
          size="sm"
          onClick={onCancel}
          className="border-zinc-700 text-zinc-300 hover:bg-zinc-800 h-9"
        >
          Cancel
        </Button>

        <Button
          size="sm"
          onClick={handleSave}
          disabled={correctedValue === null}
          className="bg-[#b87333] hover:bg-[#a06020] text-white border-0 h-9 gap-1.5 font-medium"
        >
          <Save className="h-3.5 w-3.5" />
          Save Correction
        </Button>
      </div>
    </div>
  )
}
