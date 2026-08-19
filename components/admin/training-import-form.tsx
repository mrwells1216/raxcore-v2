'use client'

import { useState, useRef, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent } from '@/components/ui/card'
import { toast } from 'sonner'
import { Loader2, Upload, X, CheckCircle2 } from 'lucide-react'

// ── Field schemas ─────────────────────────────────────────────────────────────

const TINE_FIELDS = ['g1', 'g2', 'g3', 'g4', 'g5'] as const
const CIRC_FIELDS = ['h1', 'h2', 'h3', 'h4'] as const
type Side = 'left' | 'right'
type TineField = typeof TINE_FIELDS[number]
type CircField = typeof CIRC_FIELDS[number]

const TINE_LABELS: Record<TineField, string> = {
  g1: 'G1 (brow tine)',
  g2: 'G2',
  g3: 'G3',
  g4: 'G4',
  g5: 'G5',
}
const CIRC_LABELS: Record<CircField, string> = {
  h1: 'H1 (base)',
  h2: 'H2',
  h3: 'H3',
  h4: 'H4',
}

const SCORING_SYSTEMS = [
  { value: 'BC_TYPICAL',     label: 'B&C Typical' },
  { value: 'BC_NONTYPICAL',  label: 'B&C Non-Typical' },
  { value: 'PY_TYPICAL',     label: 'P&Y Typical' },
  { value: 'PY_NONTYPICAL',  label: 'P&Y Non-Typical' },
]

// Angle positions first, then context types. The angle values are what the
// per-angle accuracy run buckets by, so a guide buck shot from 9 positions
// stays distinguishable — 'angled' is a catch-all that tells us nothing about
// WHICH angle, which is the whole point of the exercise.
// Additive only: every pre-existing value is still present and valid.
const IMAGE_TYPES = [
  { value: 'front',            label: 'Front (0°)' },
  { value: 'front_left_45',    label: 'Front-Left (45°)' },
  { value: 'side_left',        label: 'Left Side (90°)' },
  { value: 'rear_left_135',    label: 'Rear-Left (135°)' },
  { value: 'rear',             label: 'Rear (180°)' },
  { value: 'rear_right_135',   label: 'Rear-Right (135°)' },
  { value: 'side_right',       label: 'Right Side (90°)' },
  { value: 'front_right_45',   label: 'Front-Right (45°)' },
  { value: 'elevated',         label: 'Elevated / Top-Down' },
  { value: 'angled',           label: 'Angled (unspecified)' },
  { value: 'live',             label: 'Live Photo' },
  { value: 'mounted',          label: 'Mounted' },
  { value: 'harvest',          label: 'Harvest' },
  { value: 'trail_cam',        label: 'Trail Cam' },
]

// ── Types ─────────────────────────────────────────────────────────────────────

interface SideVals {
  main_beam: string
  g1: string; g2: string; g3: string; g4: string; g5: string
  h1: string; h2: string; h3: string; h4: string
}

interface FilePreview {
  file: File
  preview: string
  type: string
}

interface Measurements {
  inside_spread: string
  abnormal_points: string
  left: SideVals
  right: SideVals
}

const emptySide = (): SideVals => ({
  main_beam: '', g1: '', g2: '', g3: '', g4: '', g5: '',
  h1: '', h2: '', h3: '', h4: '',
})

const emptyMeasurements = (): Measurements => ({
  inside_spread: '', abnormal_points: '',
  left: emptySide(), right: emptySide(),
})

// ── Calculation helpers ───────────────────────────────────────────────────────

/**
 * Parse a measurement written the way scorers actually write it.
 *
 * B&C is recorded in eighths — a scorer writes `4 6/8`, not `4.75`. The old
 * implementation was a bare parseFloat, which stops at the first non-numeric
 * character: "4 6/8" silently became 4 and "6/8" became 6. Since this feeds
 * the ground-truth sheet that every later accuracy claim is measured against,
 * a silent truncation here would look like AI error for months.
 *
 * Accepts: "4.75", "4", "4 6/8", "4-6/8", "6/8", any of the above with a
 * trailing inch mark. Anything unparseable is 0, and the result is always
 * finite (a /0 denominator yields 0, never Infinity).
 */
export function parseInch(v: string): number {
  if (typeof v !== 'string') return 0
  const cleaned = v.trim().replace(/["\u201d\s]+$/, '').trim()
  if (!cleaned) return 0

  // Mixed fraction: "4 6/8" or "4-6/8"
  const mixed = cleaned.match(/^(\d+)\s*[-\s]\s*(\d+)\s*\/\s*(\d+)$/)
  if (mixed) {
    const whole = Number(mixed[1])
    const num = Number(mixed[2])
    const den = Number(mixed[3])
    if (!den) return 0
    const out = whole + num / den
    return Number.isFinite(out) ? out : 0
  }

  // Bare fraction: "6/8"
  const frac = cleaned.match(/^(\d+)\s*\/\s*(\d+)$/)
  if (frac) {
    const den = Number(frac[2])
    if (!den) return 0
    const out = Number(frac[1]) / den
    return Number.isFinite(out) ? out : 0
  }

  const n = parseFloat(cleaned)
  return Number.isFinite(n) ? n : 0
}

/** The eight legal B&C fractions. Kept in eighths rather than reduced to
 *  1/4 and 1/2 — scorers read a tape and write a sheet in eighths, so a
 *  constant denominator avoids a conversion step at entry time. */
export const EIGHTHS_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '0', label: '—' },
  { value: '1', label: '1/8' },
  { value: '2', label: '2/8' },
  { value: '3', label: '3/8' },
  { value: '4', label: '4/8' },
  { value: '5', label: '5/8' },
  { value: '6', label: '6/8' },
  { value: '7', label: '7/8' },
]

/**
 * Split a stored measurement into whole inches + eighths for the two-control
 * editor. `whole: null` means the field is genuinely blank (an unmeasured G5
 * must stay blank rather than becoming a hard 0).
 */
export function toEighths(value: string): { whole: number | null; eighths: number } {
  if (typeof value !== 'string' || value.trim() === '') return { whole: null, eighths: 0 }
  const total = parseInch(value)
  if (!Number.isFinite(total) || total < 0) return { whole: null, eighths: 0 }
  let whole = Math.floor(total)
  let eighths = Math.round((total - whole) * 8)
  // Carry: 3.99 rounds to 8 eighths, which is 4 whole inches and 0 eighths.
  if (eighths >= 8) {
    whole += 1
    eighths = 0
  }
  return { whole, eighths }
}

/** Recompose into the canonical string parseInch already reads. */
export function fromEighths(whole: number | null, eighths: number): string {
  const e = Number.isFinite(eighths) ? Math.max(0, Math.min(7, Math.trunc(eighths))) : 0
  const w = whole == null || !Number.isFinite(whole) ? null : Math.max(0, Math.trunc(whole))
  if (w == null) return e === 0 ? '' : `${e}/8`
  if (e === 0) return String(w)
  return `${w} ${e}/8`
}

export function calcGross(m: Measurements): number {
  // B&C: spread credit may equal but not exceed the longer antler. With no
  // beam entered yet there is nothing to cap against, so credit the raw
  // spread rather than zeroing it while the sheet is half filled in.
  const spread = parseInch(m.inside_spread)
  const beams = [parseInch(m.left.main_beam), parseInch(m.right.main_beam)].filter(b => b > 0)
  let total = beams.length > 0 ? Math.min(spread, Math.max(...beams)) : spread
  for (const side of ['left', 'right'] as Side[]) {
    const s = m[side]
    total += parseInch(s.main_beam)
    for (const f of TINE_FIELDS) total += parseInch(s[f])
    for (const f of CIRC_FIELDS) total += parseInch(s[f])
  }
  return total
}

function calcDeductions(m: Measurements, isTypical: boolean): number {
  let ded = 0
  const fields: Array<keyof SideVals> = ['main_beam', ...TINE_FIELDS, ...CIRC_FIELDS]
  for (const f of fields) {
    const diff = Math.abs(parseInch(m.left[f]) - parseInch(m.right[f]))
    ded += diff
  }
  if (isTypical) ded += parseInch(m.abnormal_points)
  return ded
}

// ── Sub-components ────────────────────────────────────────────────────────────

function MeasInput({
  label, value, onChange,
}: { label: string; value: string; onChange: (v: string) => void }) {
  // Whole inches + an eighths dropdown. B&C is measured to the nearest 1/8,
  // so restricting the fraction to the eight legal values makes an illegal
  // measurement unrepresentable rather than something to validate after the
  // fact — this form enters the ground truth everything else is judged
  // against. The stored string format is unchanged, so calcGross,
  // calcDeductions and score_data are untouched.
  const { whole, eighths } = toEighths(value)

  return (
    <div className="space-y-0.5">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <div className="flex items-center gap-1.5">
        <Input
          type="text"
          inputMode="numeric"
          aria-label={`${label} whole inches`}
          value={whole == null ? '' : String(whole)}
          onChange={e => {
            const digits = e.target.value.replace(/[^0-9]/g, '').slice(0, 2)
            onChange(fromEighths(digits === '' ? null : Number(digits), eighths))
          }}
          placeholder="0"
          className="h-9 w-14 shrink-0 text-center text-sm font-mono"
        />
        <span className="shrink-0 text-[11px] text-muted-foreground">in</span>
        <Select
          value={String(eighths)}
          onValueChange={v => onChange(fromEighths(whole, Number(v)))}
        >
          <SelectTrigger className="h-9 min-w-0 flex-1 text-sm font-mono" aria-label={`${label} eighths`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {EIGHTHS_OPTIONS.map(o => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

function SidePanel({
  side, vals, onChange,
}: { side: Side; vals: SideVals; onChange: (field: keyof SideVals, value: string) => void }) {
  const label = side === 'left' ? 'Left Antler' : 'Right Antler'
  return (
    <div className="space-y-3">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</h4>
      <MeasInput label="Main Beam" value={vals.main_beam} onChange={v => onChange('main_beam', v)} />
      <div className="pt-1">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">Tines</p>
        <div className="space-y-2">
          {TINE_FIELDS.map(f => (
            <MeasInput key={f} label={TINE_LABELS[f]} value={vals[f]} onChange={v => onChange(f, v)} />
          ))}
        </div>
      </div>
      <div className="pt-1">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">Circumferences</p>
        <div className="space-y-2">
          {CIRC_FIELDS.map(f => (
            <MeasInput key={f} label={CIRC_LABELS[f]} value={vals[f]} onChange={v => onChange(f, v)} />
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Main form ─────────────────────────────────────────────────────────────────

export function TrainingImportForm() {
  const [system, setSystem] = useState('BC_TYPICAL')
  const [buckName, setBuckName] = useState('')
  const [yearTaken, setYearTaken] = useState('')
  const [state, setState] = useState('')
  const [county, setCounty] = useState('')
  const [hunterName, setHunterName] = useState('')
  const [measurements, setMeasurements] = useState<Measurements>(emptyMeasurements())
  const [files, setFiles] = useState<FilePreview[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [imported, setImported] = useState<{ sheetId: string; imagesUploaded: number } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const isTypical = system.endsWith('_TYPICAL')
  const gross = calcGross(measurements)
  const deductions = calcDeductions(measurements, isTypical)
  const net = gross - deductions

  const updateSide = useCallback((side: Side, field: keyof SideVals, value: string) => {
    setMeasurements(prev => ({
      ...prev,
      [side]: { ...prev[side], [field]: value },
    }))
  }, [])

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.currentTarget.files
    if (!selected) return
    const next: FilePreview[] = []
    for (let i = 0; i < selected.length; i++) {
      next.push({ file: selected[i], preview: URL.createObjectURL(selected[i]), type: '' })
    }
    setFiles(prev => [...prev, ...next])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const removeFile = (idx: number) => {
    setFiles(prev => {
      const updated = [...prev]
      URL.revokeObjectURL(updated[idx].preview)
      updated.splice(idx, 1)
      return updated
    })
  }

  const updateFileType = (idx: number, type: string) => {
    setFiles(prev => prev.map((f, i) => i === idx ? { ...f, type } : f))
  }

  function buildScoreData() {
    const m = measurements
    const parseOrNull = (v: string) => { const n = parseFloat(v); return isFinite(n) ? n : null }
    const side = (s: SideVals) => ({
      main_beam: parseOrNull(s.main_beam),
      g1: parseOrNull(s.g1), g2: parseOrNull(s.g2), g3: parseOrNull(s.g3),
      g4: parseOrNull(s.g4), g5: parseOrNull(s.g5),
      h1: parseOrNull(s.h1), h2: parseOrNull(s.h2), h3: parseOrNull(s.h3), h4: parseOrNull(s.h4),
    })
    return {
      scoring_system: system,
      inside_spread: parseOrNull(m.inside_spread),
      abnormal_points: parseOrNull(m.abnormal_points),
      left: side(m.left),
      right: side(m.right),
      calculated_gross: parseFloat(gross.toFixed(3)),
      calculated_net: parseFloat(net.toFixed(3)),
      calculated_deductions: parseFloat(deductions.toFixed(3)),
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const scoreData = buildScoreData()
    const hasAnyMeasurement = scoreData.inside_spread != null ||
      TINE_FIELDS.some(f => scoreData.left[f] != null || scoreData.right[f] != null) ||
      scoreData.left.main_beam != null || scoreData.right.main_beam != null

    if (!hasAnyMeasurement) {
      toast.error('Enter at least one measurement before importing')
      return
    }

    setIsLoading(true)
    try {
      const formData = new FormData()
      formData.append('scoring_system', system)
      formData.append('score_data', JSON.stringify(scoreData))
      if (buckName) formData.append('buck_name', buckName)
      if (yearTaken) formData.append('year_taken', yearTaken)
      if (state) formData.append('state', state)
      if (county) formData.append('county', county)
      if (hunterName) formData.append('hunter_name', hunterName)
      files.forEach((f, idx) => {
        formData.append(`file_${idx}`, f.file)
        formData.append(`file_${idx}_type`, f.type || '')
      })

      const res = await fetch('/api/admin/training-import', { method: 'POST', body: formData })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.message ?? 'Import failed')
      }
      const data = await res.json()
      setImported({ sheetId: data.sheet_id, imagesUploaded: data.images_uploaded ?? 0 })
      toast.success('Score sheet imported')

      // Reset
      setBuckName(''); setYearTaken(''); setState(''); setCounty(''); setHunterName('')
      setMeasurements(emptyMeasurements())
      files.forEach(f => URL.revokeObjectURL(f.preview))
      setFiles([])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setIsLoading(false)
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (imported) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 text-emerald-600">
          <CheckCircle2 className="h-5 w-5" />
          <div>
            <p className="font-semibold text-sm">Sheet imported</p>
            <p className="text-xs text-muted-foreground">{imported.imagesUploaded} image{imported.imagesUploaded !== 1 ? 's' : ''} attached</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" asChild>
            <a href={`/admin/training-import/${imported.sheetId}`}>View Sheet</a>
          </Button>
          <Button size="sm" variant="outline" onClick={() => setImported(null)}>Import Another</Button>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">

      {/* ── 1. Buck Info ── */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold">Buck Info</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="system">Scoring System</Label>
            <Select value={system} onValueChange={setSystem}>
              <SelectTrigger id="system">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SCORING_SYSTEMS.map(s => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="buckName">Buck Name / ID</Label>
            <Input id="buckName" value={buckName} onChange={e => setBuckName(e.target.value)} placeholder="e.g. Typical 8pt 2022" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="yearTaken">Year Taken</Label>
            <Input id="yearTaken" type="number" min="1900" max="2100" value={yearTaken} onChange={e => setYearTaken(e.target.value)} placeholder="2023" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="state">State</Label>
            <Input id="state" value={state} onChange={e => setState(e.target.value)} placeholder="e.g. Iowa" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="county">County</Label>
            <Input id="county" value={county} onChange={e => setCounty(e.target.value)} placeholder="Optional" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hunterName">Hunter Name</Label>
            <Input id="hunterName" value={hunterName} onChange={e => setHunterName(e.target.value)} placeholder="Optional" />
          </div>
        </div>
      </section>

      {/* ── 2. Measurements ── */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold">Official Measurements (inches)</h3>

        {/* Spread + abnormal */}
        <div className="grid grid-cols-2 gap-3">
          <MeasInput
            label="Inside Spread"
            value={measurements.inside_spread}
            onChange={v => setMeasurements(prev => ({ ...prev, inside_spread: v }))}
          />
          <MeasInput
            label={isTypical ? 'Abnormal Points (deducted)' : 'Abnormal Points (added)'}
            value={measurements.abnormal_points}
            onChange={v => setMeasurements(prev => ({ ...prev, abnormal_points: v }))}
          />
        </div>

        {/* Left / Right side columns */}
        <div className="grid grid-cols-2 gap-6">
          <SidePanel side="left" vals={measurements.left} onChange={(f, v) => updateSide('left', f, v)} />
          <SidePanel side="right" vals={measurements.right} onChange={(f, v) => updateSide('right', f, v)} />
        </div>

        {/* Live gross/net summary */}
        {gross > 0 && (
          <Card className="bg-secondary/20 border-border/40">
            <CardContent className="p-4 grid grid-cols-3 gap-3 text-sm text-center">
              <div>
                <div className="text-xs text-muted-foreground mb-0.5">Gross</div>
                <div className="text-lg font-bold tabular-nums">{gross.toFixed(1)}&quot;</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-0.5">Deductions</div>
                <div className="text-lg font-bold tabular-nums text-amber-600">-{deductions.toFixed(1)}&quot;</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-0.5">Net</div>
                <div className="text-lg font-bold tabular-nums text-emerald-600">{net.toFixed(1)}&quot;</div>
              </div>
            </CardContent>
          </Card>
        )}
      </section>

      {/* ── 3. Images ── */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold">Images</h3>
        <div className="border-2 border-dashed rounded-lg p-5 text-center hover:border-primary/50 transition-colors">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*"
            onChange={handleFileSelect}
            disabled={isLoading}
            className="hidden"
            id="fileInput"
          />
          <label htmlFor="fileInput" className="cursor-pointer flex flex-col items-center gap-1">
            <Upload className="h-7 w-7 text-muted-foreground" />
            <span className="text-sm font-medium">Click to upload images</span>
            <span className="text-xs text-muted-foreground">PNG, JPG, WEBP — tag each with its angle</span>
          </label>
        </div>

        {files.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {files.map((f, idx) => (
              <Card key={idx} className="overflow-hidden">
                <div className="aspect-square bg-muted relative group">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={f.preview} alt="" className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removeFile(idx)}
                    className="absolute top-1 right-1 bg-black/60 hover:bg-black/80 text-white rounded p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="p-1.5 border-t bg-background">
                  <Select value={f.type} onValueChange={type => updateFileType(idx, type)}>
                    <SelectTrigger className="h-7 text-xs">
                      <SelectValue placeholder="Select angle" />
                    </SelectTrigger>
                    <SelectContent>
                      {IMAGE_TYPES.map(t => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* ── Submit ── */}
      <Button type="submit" disabled={isLoading} className="w-full">
        {isLoading ? (
          <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Importing…</>
        ) : (
          'Import Score Sheet'
        )}
      </Button>
    </form>
  )
}
