'use client'

import { useState, useRef, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { Loader2, Upload, X, Sparkles } from 'lucide-react'
import { REQUIRED_BC_FIELDS } from '@/lib/advanced-scoring/cross-validation'
import type { MeasurementField } from '@/lib/advanced-scoring/types'

// ─── Field metadata ───────────────────────────────────────────────────────────

const FIELD_LABELS: Record<MeasurementField, string> = {
  main_beam_left: 'Main Beam L', main_beam_right: 'Main Beam R',
  g1_left: 'G1 L', g1_right: 'G1 R',
  g2_left: 'G2 L', g2_right: 'G2 R',
  g3_left: 'G3 L', g3_right: 'G3 R',
  g4_left: 'G4 L', g4_right: 'G4 R',
  h1_left: 'H1 L', h1_right: 'H1 R',
  h2_left: 'H2 L', h2_right: 'H2 R',
  h3_left: 'H3 L', h3_right: 'H3 R',
  h4_left: 'H4 L', h4_right: 'H4 R',
  inside_spread: 'Inside Spread',
  abnormal_points: 'Abnormal Pts',
}

const FIELD_GROUPS: Array<{ label: string; fields: MeasurementField[] }> = [
  { label: 'Main Beams', fields: ['main_beam_left', 'main_beam_right'] },
  { label: 'G1 Tines', fields: ['g1_left', 'g1_right'] },
  { label: 'G2 Tines', fields: ['g2_left', 'g2_right'] },
  { label: 'G3 Tines', fields: ['g3_left', 'g3_right'] },
  { label: 'G4 Tines', fields: ['g4_left', 'g4_right'] },
  { label: 'H1 Circumference', fields: ['h1_left', 'h1_right'] },
  { label: 'H2 Circumference', fields: ['h2_left', 'h2_right'] },
  { label: 'H3 Circumference', fields: ['h3_left', 'h3_right'] },
  { label: 'H4 Circumference', fields: ['h4_left', 'h4_right'] },
  { label: 'Inside Spread', fields: ['inside_spread'] },
]

const IMAGE_TYPES = [
  { value: 'live',       label: 'Live Animal' },
  { value: 'mounted',    label: 'Mounted' },
  { value: 'harvest',    label: 'Harvest / Field' },
  { value: 'front',      label: 'Front View' },
  { value: 'side',       label: 'Side View' },
  { value: 'angled',     label: 'Angled View' },
  { value: 'trail_cam',  label: 'Trail Camera' },
]

const BENCHMARK_DISCLAIMER = 'RAX CORE measurements are AI-assisted and user-verified. Official acceptance depends on governing organization rules.'

// ─── Types ────────────────────────────────────────────────────────────────────

interface FilePreview {
  file: File
  preview: string
  type: string
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TrainingImportForm() {
  const [system, setSystem] = useState('BC')
  const [scoreFields, setScoreFields] = useState<Record<string, string>>({})
  const [grossScore, setGrossScore] = useState('')
  const [netScore, setNetScore] = useState('')
  const [files, setFiles] = useState<FilePreview[]>([])
  const [isBenchmark, setIsBenchmark] = useState(false)
  const [showBenchmarkConfirm, setShowBenchmarkConfirm] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isOcrLoading, setIsOcrLoading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const ocrInputRef = useRef<HTMLInputElement>(null)

  const setField = useCallback((key: string, val: string) => {
    setScoreFields(prev => ({ ...prev, [key]: val }))
  }, [])

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.currentTarget.files
    if (!selected) return
    const newFiles: FilePreview[] = []
    for (let i = 0; i < selected.length; i++) {
      newFiles.push({ file: selected[i], preview: URL.createObjectURL(selected[i]), type: '' })
    }
    setFiles(prev => [...prev, ...newFiles])
    e.target.value = ''
  }

  const removeFile = (index: number) => {
    setFiles(prev => {
      const updated = [...prev]
      URL.revokeObjectURL(updated[index].preview)
      updated.splice(index, 1)
      return updated
    })
  }

  const updateFileType = (index: number, type: string) => {
    setFiles(prev => {
      const updated = [...prev]
      updated[index] = { ...updated[index], type }
      return updated
    })
  }

  const handleOcr = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.currentTarget.files?.[0]
    e.target.value = ''
    if (!f) return
    setIsOcrLoading(true)
    try {
      const fd = new FormData()
      fd.append('file', f)
      const res = await fetch('/api/admin/training-import/ocr', { method: 'POST', body: fd })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.message || `OCR failed (${res.status})`)
      }
      const { data } = await res.json() as {
        data: Record<string, number | string | null> & { confidence: number; notes: string; scoring_system: string }
      }
      const next: Record<string, string> = {}
      let filledCount = 0
      for (const field of REQUIRED_BC_FIELDS) {
        const v = data[field]
        if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
          next[field] = v.toFixed(2)
          filledCount++
        }
      }
      setScoreFields(prev => ({ ...prev, ...next }))
      if (typeof data.gross_score === 'number' && Number.isFinite(data.gross_score)) {
        setGrossScore(data.gross_score.toFixed(2))
      }
      if (typeof data.net_score === 'number' && Number.isFinite(data.net_score)) {
        setNetScore(data.net_score.toFixed(2))
      }
      if (data.scoring_system === 'BC' || data.scoring_system === 'PY') {
        setSystem(data.scoring_system)
      }
      const confidencePct = Math.round((data.confidence ?? 0) * 100)
      toast.success(
        `OCR transcribed ${filledCount}/${REQUIRED_BC_FIELDS.length} fields (model confidence ${confidencePct}%). Verify each value before submitting.`
      )
      if (data.notes && data.notes.trim()) {
        toast.message('OCR notes', { description: data.notes })
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'OCR transcription failed')
    } finally {
      setIsOcrLoading(false)
    }
  }

  const filledRequired = REQUIRED_BC_FIELDS.filter(f => {
    const v = scoreFields[f]?.trim()
    return v !== undefined && v !== '' && !isNaN(parseFloat(v))
  })
  const allRequiredFilled = filledRequired.length === REQUIRED_BC_FIELDS.length

  const doSubmit = async () => {
    setShowBenchmarkConfirm(false)
    setIsLoading(true)
    try {
      const scoreData: Record<string, number> = {}
      for (const [key, val] of Object.entries(scoreFields)) {
        if (val.trim() === '') continue
        const num = parseFloat(val)
        if (!isNaN(num)) scoreData[key] = num
      }
      const gNum = parseFloat(grossScore)
      const nNum = parseFloat(netScore)
      if (!isNaN(gNum)) scoreData['gross_score'] = gNum
      if (!isNaN(nNum)) scoreData['net_score'] = nNum

      const formData = new FormData()
      formData.append('scoring_system', system)
      formData.append('score_data', JSON.stringify(scoreData))
      formData.append('is_benchmark', isBenchmark ? 'true' : 'false')
      files.forEach((f, idx) => {
        formData.append(`file_${idx}`, f.file)
        formData.append(`file_${idx}_type`, f.type || '')
      })

      const response = await fetch('/api/admin/training-import', { method: 'POST', body: formData })
      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.message || 'Failed to import training data')
      }

      toast.success('Training data imported successfully')
      setScoreFields({})
      setGrossScore('')
      setNetScore('')
      setIsBenchmark(false)
      files.forEach(f => URL.revokeObjectURL(f.preview))
      setFiles([])
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to import training data')
    } finally {
      setIsLoading(false)
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!allRequiredFilled) {
      toast.error(`Please fill all ${REQUIRED_BC_FIELDS.length} required measurement fields.`)
      return
    }
    if (isBenchmark) {
      setShowBenchmarkConfirm(true)
      return
    }
    doSubmit()
  }

  const previewRows = REQUIRED_BC_FIELDS.filter(f => {
    const v = scoreFields[f]?.trim()
    return v !== undefined && v !== '' && !isNaN(parseFloat(v))
  })

  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Scoring System */}
        <div className="space-y-2">
          <Label htmlFor="system">Scoring System</Label>
          <Select value={system} onValueChange={setSystem}>
            <SelectTrigger id="system" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="BC">Boone &amp; Crockett</SelectItem>
              <SelectItem value="PY">Pope &amp; Young</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* OCR helper */}
        <div className="rounded border bg-muted/30 p-3 flex items-start gap-3">
          <Sparkles className="h-5 w-5 mt-0.5 text-amber-500 shrink-0" />
          <div className="flex-1 space-y-2">
            <div>
              <p className="text-sm font-medium">Auto-transcribe from score sheet image</p>
              <p className="text-xs text-muted-foreground">
                Upload a photo or scan of an official sheet — OpenAI vision will pre-fill the fields. Always verify each value before submitting.
              </p>
            </div>
            <Input
              ref={ocrInputRef}
              type="file"
              accept="image/*"
              onChange={handleOcr}
              disabled={isOcrLoading || isLoading}
              className="hidden"
              id="ocrInput"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isOcrLoading || isLoading}
              onClick={() => ocrInputRef.current?.click()}
            >
              {isOcrLoading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
                  Transcribing…
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5 mr-2" />
                  Upload sheet & transcribe
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Per-field measurement inputs */}
        <div className="space-y-4">
          <div>
            <Label className="text-base font-semibold">Official Measurements (inches)</Label>
            <p className="text-sm text-muted-foreground mt-0.5">
              All {REQUIRED_BC_FIELDS.length} fields required for submission.
            </p>
          </div>

          <div className="grid gap-4">
            {FIELD_GROUPS.map(group => (
              <div key={group.label} className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {group.label}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {group.fields.map(field => (
                    <div key={field} className="space-y-1">
                      <Label htmlFor={`field-${field}`} className="text-xs">
                        {FIELD_LABELS[field]}
                        <span className="text-destructive ml-0.5">*</span>
                      </Label>
                      <Input
                        id={`field-${field}`}
                        type="number"
                        step="0.01"
                        min="0"
                        max="100"
                        value={scoreFields[field] ?? ''}
                        onChange={e => setField(field, e.target.value)}
                        placeholder="0.00"
                        className="h-8 text-sm font-mono"
                        disabled={isLoading}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Summary inputs */}
          <div className="border-t pt-3 grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="gross-score" className="text-xs">Gross Score</Label>
              <Input
                id="gross-score"
                type="number"
                step="0.01"
                min="0"
                value={grossScore}
                onChange={e => setGrossScore(e.target.value)}
                placeholder="0.00"
                className="h-8 text-sm font-mono"
                disabled={isLoading}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="net-score" className="text-xs">Net Score</Label>
              <Input
                id="net-score"
                type="number"
                step="0.01"
                min="0"
                value={netScore}
                onChange={e => setNetScore(e.target.value)}
                placeholder="0.00"
                className="h-8 text-sm font-mono"
                disabled={isLoading}
              />
            </div>
          </div>
        </div>

        {/* Preview table */}
        {previewRows.length > 0 && (
          <div className="space-y-2">
            <Label className="text-sm font-medium">Entry Preview</Label>
            <div className="rounded border overflow-hidden text-sm">
              <table className="w-full">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="text-left px-3 py-1.5 text-xs font-medium text-muted-foreground">Field</th>
                    <th className="text-right px-3 py-1.5 text-xs font-medium text-muted-foreground">Value (in)</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map(field => (
                    <tr key={field} className="border-t">
                      <td className="px-3 py-1 text-xs">{FIELD_LABELS[field]}</td>
                      <td className="px-3 py-1 text-xs font-mono text-right">
                        {parseFloat(scoreFields[field]).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                  {grossScore && !isNaN(parseFloat(grossScore)) && (
                    <tr className="border-t bg-muted/30">
                      <td className="px-3 py-1 text-xs font-medium">Gross Score</td>
                      <td className="px-3 py-1 text-xs font-mono text-right">{parseFloat(grossScore).toFixed(2)}</td>
                    </tr>
                  )}
                  {netScore && !isNaN(parseFloat(netScore)) && (
                    <tr className="border-t bg-muted/30">
                      <td className="px-3 py-1 text-xs font-medium">Net Score</td>
                      <td className="px-3 py-1 text-xs font-mono text-right">{parseFloat(netScore).toFixed(2)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">
              {previewRows.length}/{REQUIRED_BC_FIELDS.length} required fields filled
            </p>
          </div>
        )}

        {/* Image upload */}
        <div className="space-y-4">
          <div>
            <Label className="text-base font-semibold">Support Images</Label>
            <p className="text-sm text-muted-foreground mt-0.5">
              Upload up to 6 photos with angle type tags.
            </p>
          </div>

          <div className="border-2 border-dashed rounded-lg p-6 text-center hover:border-primary/50 transition-colors">
            <Input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*"
              onChange={handleFileSelect}
              disabled={isLoading}
              className="hidden"
              id="fileInput"
            />
            <label htmlFor="fileInput" className="cursor-pointer">
              <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
              <p className="font-medium text-sm">Click to upload or drag and drop</p>
              <p className="text-xs text-muted-foreground">PNG, JPG, WEBP up to 10MB each</p>
            </label>
          </div>

          {files.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm font-medium">Uploaded Images ({files.length})</p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {files.map((f, idx) => (
                  <Card key={idx} className="overflow-hidden">
                    <div className="aspect-square overflow-hidden bg-muted relative group">
                      <img src={f.preview} alt={`Preview ${idx + 1}`} className="w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={() => removeFile(idx)}
                        className="absolute top-1 right-1 bg-destructive/80 hover:bg-destructive text-white rounded p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                        aria-label="Remove image"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="p-2 bg-background border-t">
                      <Select value={f.type} onValueChange={(type) => updateFileType(idx, type)}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Select type" />
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
            </div>
          )}
        </div>

        {/* Benchmark checkbox */}
        <div className="flex items-start gap-3 p-3 rounded border bg-muted/30">
          <input
            id="is-benchmark"
            type="checkbox"
            checked={isBenchmark}
            onChange={e => setIsBenchmark(e.target.checked)}
            disabled={isLoading}
            className="mt-0.5 accent-amber-500"
          />
          <label htmlFor="is-benchmark" className="text-sm cursor-pointer">
            <span className="font-medium">Promote to Benchmark on import</span>
            <p className="text-xs text-muted-foreground mt-0.5">
              Marks this score sheet as benchmark ground truth used for model evaluation. Requires confirmation.
            </p>
          </label>
        </div>

        <Button
          type="submit"
          disabled={isLoading || !allRequiredFilled}
          className="w-full"
        >
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Importing…
            </>
          ) : (
            isBenchmark ? 'Submit & Promote to Benchmark…' : 'Submit Training Data'
          )}
        </Button>
      </form>

      {/* Benchmark confirm dialog */}
      <Dialog open={showBenchmarkConfirm} onOpenChange={setShowBenchmarkConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Promote to Benchmark?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">{BENCHMARK_DISCLAIMER}</p>
            <p className="font-medium">
              This will mark this score sheet as benchmark ground truth. It will be used to evaluate model accuracy and may affect automated regression thresholds.
            </p>
            <p>Continue?</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBenchmarkConfirm(false)} disabled={isLoading}>
              Cancel
            </Button>
            <Button onClick={doSubmit} disabled={isLoading}>
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Confirm Import'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
