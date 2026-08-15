'use client'

/**
 * Per-photo editing window.
 *
 * Crop, Blackout, and Pedicle used to live in three separate wizard sections,
 * each looping over every photo. That made it impossible to say "crop this one,
 * black out that one" and — worse — the crop handles and the pedicle dots were
 * mounted over the same image at the same time, so a drag meant for one was
 * frequently caught by the other.
 *
 * Here each photo owns one card. Every tool has an independent on/off switch
 * for THAT photo, and only the selected tool's overlay is mounted, so the
 * interaction layers can never fight over a pointer. Switching tools is
 * non-destructive: each tool's data lives in wizard state and is preserved
 * while it is off-screen.
 */

import { useState } from 'react'
import { Crop, PenLine, Ruler, Check } from 'lucide-react'
import { AntlerCropBox, type CropRegion } from './antler-crop-box'
import { RedactionPen, type RedactionStroke } from './redaction-pen'
import { CalibrationDots, type PedicleDotPlacement } from './calibration-dots'

export type PhotoTool = 'crop' | 'blackout' | 'pedicle'

export interface PhotoToolFlags {
  crop: boolean
  blackout: boolean
  pedicle: boolean
}

/** Crop defaults on to preserve the pre-existing behavior of every photo
 *  receiving a default centered crop region unless the user opts out. */
export const DEFAULT_TOOL_FLAGS: PhotoToolFlags = {
  crop: true,
  blackout: false,
  pedicle: false,
}

interface PhotoEditorProps {
  imageUrl: string
  imageIndex: number
  imageWidth: number
  imageHeight: number
  label: string

  flags: PhotoToolFlags
  onFlagsChange: (flags: PhotoToolFlags) => void

  cropRegion: CropRegion | null
  onCropChange: (region: CropRegion) => void

  strokes: RedactionStroke[]
  onStrokesChange: (strokes: RedactionStroke[]) => void

  pedicle: PedicleDotPlacement | null
  onPedicleChange: (placement: PedicleDotPlacement | null) => void
}

const TOOL_META: Record<
  PhotoTool,
  { label: string; icon: typeof Crop; blurb: string }
> = {
  crop: {
    label: 'Crop',
    icon: Crop,
    blurb: 'Tighten the box around the rack to give the AI 4–8× more detail.',
  },
  blackout: {
    label: 'Blackout',
    icon: PenLine,
    blurb: 'Paint over other deer, wall mounts, or anything that is not this rack.',
  },
  pedicle: {
    label: 'Pedicle',
    icon: Ruler,
    blurb: 'Drop two dots on the burr bases to add a measured scale reference.',
  },
}

export function PhotoEditor({
  imageUrl,
  imageIndex,
  imageWidth,
  imageHeight,
  label,
  flags,
  onFlagsChange,
  cropRegion,
  onCropChange,
  strokes,
  onStrokesChange,
  pedicle,
  onPedicleChange,
}: PhotoEditorProps) {
  const [activeTool, setActiveTool] = useState<PhotoTool>('crop')

  const setFlag = (tool: PhotoTool, on: boolean) => {
    onFlagsChange({ ...flags, [tool]: on })
  }

  const summary: Record<PhotoTool, string> = {
    crop: flags.crop ? 'on' : 'off',
    blackout: flags.blackout
      ? strokes.length > 0
        ? `${strokes.length} stroke${strokes.length === 1 ? '' : 's'}`
        : 'on'
      : 'off',
    pedicle: flags.pedicle ? (pedicle ? 'placed' : 'on') : 'off',
  }

  const meta = TOOL_META[activeTool]
  const activeOn = flags[activeTool]

  return (
    <div
      className="rounded overflow-hidden"
      style={{
        border: '1px solid var(--bronze-dark)',
        background: 'linear-gradient(180deg, #1e1b18 0%, #1a1714 100%)',
      }}
    >
      <div className="px-4 pt-3 pb-2">
        <span className="text-[10px] font-black tracking-[0.22em] uppercase" style={{ color: 'var(--bronze-light)' }}>
          {label}
        </span>
      </div>

      {/* Tool selector. Selecting a tool only changes what you're looking at;
          the switch inside the panel controls whether it is applied. */}
      <div role="tablist" aria-label={`${label} tools`} className="flex gap-1 px-3">
        {(Object.keys(TOOL_META) as PhotoTool[]).map((tool) => {
          const t = TOOL_META[tool]
          const Icon = t.icon
          const selected = activeTool === tool
          const on = flags[tool]
          return (
            <button
              key={tool}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setActiveTool(tool)}
              className="flex flex-1 flex-col items-center gap-0.5 rounded-t px-2 py-2 transition-colors"
              style={{
                background: selected ? 'rgba(0,0,0,0.42)' : 'transparent',
                borderBottom: selected
                  ? '2px solid var(--bronze-light)'
                  : '2px solid transparent',
              }}
            >
              <span className="flex items-center gap-1.5">
                <Icon
                  className="h-3.5 w-3.5"
                  style={{ color: on ? 'var(--bronze-light)' : 'rgba(255,255,255,0.35)' }}
                  aria-hidden
                />
                <span
                  className="text-[11px] font-semibold"
                  style={{ color: selected ? '#fff' : 'rgba(255,255,255,0.6)' }}
                >
                  {t.label}
                </span>
              </span>
              <span
                className="text-[9px] font-mono uppercase tracking-wider"
                style={{ color: on ? 'var(--bronze-light)' : 'rgba(255,255,255,0.3)' }}
              >
                {summary[tool]}
              </span>
            </button>
          )
        })}
      </div>

      <div className="px-4 pb-4 pt-3 space-y-3" role="tabpanel">
        <div className="flex items-start justify-between gap-3">
          <p className="text-[11px] font-mono text-muted-foreground">{meta.blurb}</p>
          <ToolSwitch
            label={`Use ${meta.label} on this photo`}
            checked={activeOn}
            onChange={(on) => setFlag(activeTool, on)}
          />
        </div>

        {!activeOn ? (
          <div className="space-y-2">
            <div
              className="relative w-full overflow-hidden rounded"
              style={{ border: '1px solid var(--bronze-dark)', opacity: 0.5 }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imageUrl} alt={label} className="block h-auto w-full" draggable={false} />
            </div>
            <p className="text-[11px] font-mono text-muted-foreground">
              {meta.label} is off for this photo. Turn it on to edit.
            </p>
          </div>
        ) : activeTool === 'crop' ? (
          <AntlerCropBox
            imageUrl={imageUrl}
            region={cropRegion}
            skipped={false}
            onChange={onCropChange}
            onSkip={() => setFlag('crop', false)}
            hideSkipControl
          />
        ) : activeTool === 'blackout' ? (
          <RedactionPen imageUrl={imageUrl} strokes={strokes} onChange={onStrokesChange} />
        ) : (
          <CalibrationDots
            imageUrl={imageUrl}
            imageIndex={imageIndex}
            imageWidth={imageWidth}
            imageHeight={imageHeight}
            initial={pedicle}
            onChange={onPedicleChange}
          />
        )}
      </div>
    </div>
  )
}

function ToolSwitch({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="flex shrink-0 items-center gap-1.5 rounded-full px-2.5 transition-colors"
      style={{
        height: 32,
        touchAction: 'manipulation',
        border: `1px solid ${checked ? 'var(--bronze-light)' : 'var(--bronze-dark)'}`,
        background: checked ? 'rgba(212,168,75,0.16)' : 'rgba(0,0,0,0.3)',
      }}
    >
      <span
        className="grid place-items-center rounded-full"
        style={{
          width: 16,
          height: 16,
          background: checked ? 'var(--bronze-light)' : 'transparent',
          border: checked ? 'none' : '1px solid rgba(255,255,255,0.3)',
        }}
      >
        {checked && <Check className="h-3 w-3" style={{ color: '#0d0a06' }} aria-hidden />}
      </span>
      <span
        className="text-[10px] font-black uppercase tracking-widest"
        style={{ color: checked ? 'var(--bronze-light)' : 'rgba(255,255,255,0.45)' }}
      >
        {checked ? 'On' : 'Off'}
      </span>
    </button>
  )
}
