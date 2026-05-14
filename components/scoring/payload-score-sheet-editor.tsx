'use client'

/**
 * Score Sheet Editor using ScoreSheetPayload
 * 
 * Displays AI measurements in editable B&C form, computes scores via rules engine,
 * and saves reviewed sheets to the database.
 */

import { useState, useCallback, useMemo } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { 
  CheckCircle2, 
  Save, 
  RotateCcw, 
  GraduationCap,
  ChevronDown,
  ChevronUp,
  AlertCircle,
} from 'lucide-react'
import type { 
  ScoreSheetPayload, 
  ScoreSheetMeasurements,
  SideBreakdown,
  TineMeasurement,
  MassMeasurement,
  ScoringSystem,
} from '@/lib/rules-engine/types'
import { computeAllScores } from '@/lib/rules-engine/compute'

// ============================================================================
// TYPES
// ============================================================================

interface PayloadScoreSheetEditorProps {
  predictionId: string
  buckId: string
  initialSheet: ScoreSheetPayload
  rawAiResponse?: unknown
  onSave?: (sheet: ScoreSheetPayload) => void
}

// ============================================================================
// HELPERS
// ============================================================================

function clonePayload(p: ScoreSheetPayload): ScoreSheetPayload {
  return JSON.parse(JSON.stringify(p))
}

function formatValue(v: number | null): string {
  if (v === null || v === undefined) return ''
  return v.toFixed(1)
}

function parseValue(s: string): number | null {
  if (!s || s.trim() === '') return null
  const n = parseFloat(s)
  return isNaN(n) ? null : Math.round(n * 8) / 8 // Round to nearest 1/8
}

// ============================================================================
// MEASUREMENT INPUT COMPONENT
// ============================================================================

function MeasurementInput({
  label,
  aiValue,
  value,
  onChange,
  disabled,
}: {
  label: string
  aiValue: number | null
  value: number | null
  onChange: (value: number | null) => void
  disabled?: boolean
}) {
  const hasChanged = aiValue !== null && value !== null && Math.abs(aiValue - value) > 0.01

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium">{label}</Label>
        {aiValue !== null && (
          <span className="text-[10px] text-muted-foreground">
            AI: {formatValue(aiValue)}"
          </span>
        )}
      </div>
      <div className="relative">
        <Input
          type="number"
          step="0.125"
          value={value !== null ? value : ''}
          onChange={(e) => onChange(parseValue(e.target.value))}
          disabled={disabled}
          className={`h-8 text-sm pr-6 ${hasChanged ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/20' : ''}`}
        />
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">"</span>
      </div>
    </div>
  )
}

// ============================================================================
// SAVE HANDLER
// ============================================================================

async function saveReviewedSheet(input: {
  predictionId: string
  buckId: string
  reviewedSheet: ScoreSheetPayload
  aiSheet: ScoreSheetPayload
  rawAiResponse?: unknown
  notes?: string
}) {
  const res = await fetch('/api/review/save-score-sheet', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })

  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Failed to save reviewed score sheet')
  }

  return res.json()
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function PayloadScoreSheetEditor({
  predictionId,
  buckId,
  initialSheet,
  rawAiResponse,
  onSave,
}: PayloadScoreSheetEditorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [notes, setNotes] = useState('')
  
  // Store the original AI sheet for comparison
  const [aiSheet] = useState<ScoreSheetPayload>(() => clonePayload(initialSheet))
  
  // Editable sheet
  const [sheet, setSheet] = useState<ScoreSheetPayload>(() => {
    const s = clonePayload(initialSheet)
    s.source = 'reviewed'
    return s
  })

  // Compute scores via rules engine
  const computed = useMemo(() => {
    try {
      return computeAllScores(sheet.measurements, sheet.scoringSystem)
    } catch {
      return null
    }
  }, [sheet])

  // Update a measurement value
  const updateMeasurement = useCallback((
    path: 'insideSpread' | 'left.mainBeamLength' | 'right.mainBeamLength',
    value: number | null
  ) => {
    setSheet(prev => {
      const next = clonePayload(prev)
      if (path === 'insideSpread') {
        next.measurements.insideSpread = value
      } else if (path === 'left.mainBeamLength') {
        next.measurements.left.mainBeamLength = value
      } else if (path === 'right.mainBeamLength') {
        next.measurements.right.mainBeamLength = value
      }
      next.updatedAt = new Date().toISOString()
      return next
    })
  }, [])

  // Update a tine measurement
  const updateTine = useCallback((side: 'left' | 'right', index: number, value: number | null) => {
    setSheet(prev => {
      const next = clonePayload(prev)
      const tine = next.measurements[side].tines.find(t => t.index === index)
      if (tine) {
        tine.length = value
        tine.source = 'reviewed'
      }
      next.updatedAt = new Date().toISOString()
      return next
    })
  }, [])

  // Update a mass measurement
  const updateMass = useCallback((side: 'left' | 'right', index: number, value: number | null) => {
    setSheet(prev => {
      const next = clonePayload(prev)
      const mass = next.measurements[side].masses.find(m => m.index === index)
      if (mass) {
        mass.circumference = value
        mass.source = 'reviewed'
      }
      next.updatedAt = new Date().toISOString()
      return next
    })
  }, [])

  // Update scoring system
  const updateScoringSystem = useCallback((system: ScoringSystem) => {
    setSheet(prev => {
      const next = clonePayload(prev)
      next.scoringSystem = system
      next.updatedAt = new Date().toISOString()
      return next
    })
  }, [])

  // Reset to AI values
  const handleReset = useCallback(() => {
    const reset = clonePayload(aiSheet)
    reset.source = 'reviewed'
    setSheet(reset)
    setSaveSuccess(false)
    setSaveError(null)
  }, [aiSheet])

  // Save the reviewed sheet
  const handleSave = useCallback(async () => {
    setIsSaving(true)
    setSaveError(null)
    setSaveSuccess(false)

    try {
      // Update computed scores before saving
      const finalSheet = clonePayload(sheet)
      if (computed) {
        finalSheet.measurements.grossScore = computed.gross
        finalSheet.measurements.netScore = computed.net
        finalSheet.measurements.deductions = {
          sideToSideDifferences: computed.totalDeductions - (computed.deductionBreakdown.abnormalDeduction ?? 0),
          abnormalPointDeductions: computed.deductionBreakdown.abnormalDeduction,
          totalDeductions: computed.totalDeductions,
        }
      }
      finalSheet.updatedAt = new Date().toISOString()

      await saveReviewedSheet({
        predictionId,
        buckId,
        reviewedSheet: finalSheet,
        aiSheet,
        rawAiResponse,
        notes: notes || undefined,
      })

      setSaveSuccess(true)
      onSave?.(finalSheet)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setIsSaving(false)
    }
  }, [sheet, computed, predictionId, buckId, aiSheet, rawAiResponse, notes, onSave])

  // Get tine value helper
  const getTineValue = (side: SideBreakdown, index: number): number | null => {
    return side.tines.find(t => t.index === index)?.length ?? null
  }

  // Get mass value helper
  const getMassValue = (side: SideBreakdown, index: number): number | null => {
    return side.masses.find(m => m.index === index)?.circumference ?? null
  }

  const aiMeasurements = aiSheet.measurements
  const measurements = sheet.measurements

  return (
    <Card className="border-dashed">
      <CardHeader 
        className="cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GraduationCap className="h-5 w-5 text-muted-foreground" />
            <div>
              <CardTitle className="text-base">Review Score Sheet</CardTitle>
              <CardDescription className="text-xs">
                Edit measurements and save as training truth
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {computed && (
              <div className="text-right">
                <div className="text-lg font-bold">{computed.net.toFixed(1)}"</div>
                <div className="text-xs text-muted-foreground">
                  Gross: {computed.gross.toFixed(1)}"
                </div>
              </div>
            )}
            {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </div>
        </div>
      </CardHeader>

      {isOpen && (
        <CardContent className="pt-0 space-y-4">
          {/* Scoring System Selector */}
          <div className="flex items-center gap-4">
            <Label className="text-sm">Scoring System</Label>
            <Select
              value={sheet.scoringSystem}
              onValueChange={(v) => updateScoringSystem(v as ScoringSystem)}
            >
              <SelectTrigger className="w-[220px] h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="boone_and_crockett_typical">B&C Typical</SelectItem>
                <SelectItem value="boone_and_crockett_non_typical">B&C Non-Typical</SelectItem>
                <SelectItem value="pope_and_young_typical">P&Y Typical</SelectItem>
                <SelectItem value="pope_and_young_non_typical">P&Y Non-Typical</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Tabs defaultValue="main" className="w-full">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="main" className="text-xs">Main</TabsTrigger>
              <TabsTrigger value="tines" className="text-xs">Tines</TabsTrigger>
              <TabsTrigger value="mass" className="text-xs">Mass</TabsTrigger>
              <TabsTrigger value="totals" className="text-xs">Totals</TabsTrigger>
            </TabsList>

            {/* Main Tab - Spread & Beams */}
            <TabsContent value="main" className="space-y-4 mt-4">
              <MeasurementInput
                label="Inside Spread"
                aiValue={aiMeasurements.insideSpread}
                value={measurements.insideSpread}
                onChange={(v) => updateMeasurement('insideSpread', v)}
              />
              <div className="grid grid-cols-2 gap-4">
                <MeasurementInput
                  label="Left Main Beam"
                  aiValue={aiMeasurements.left.mainBeamLength}
                  value={measurements.left.mainBeamLength}
                  onChange={(v) => updateMeasurement('left.mainBeamLength', v)}
                />
                <MeasurementInput
                  label="Right Main Beam"
                  aiValue={aiMeasurements.right.mainBeamLength}
                  value={measurements.right.mainBeamLength}
                  onChange={(v) => updateMeasurement('right.mainBeamLength', v)}
                />
              </div>
            </TabsContent>

            {/* Tines Tab - G1-G5 */}
            <TabsContent value="tines" className="space-y-4 mt-4">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="grid grid-cols-2 gap-4">
                  <MeasurementInput
                    label={`G${i} Left`}
                    aiValue={getTineValue(aiMeasurements.left, i)}
                    value={getTineValue(measurements.left, i)}
                    onChange={(v) => updateTine('left', i, v)}
                  />
                  <MeasurementInput
                    label={`G${i} Right`}
                    aiValue={getTineValue(aiMeasurements.right, i)}
                    value={getTineValue(measurements.right, i)}
                    onChange={(v) => updateTine('right', i, v)}
                  />
                </div>
              ))}
            </TabsContent>

            {/* Mass Tab - H1-H4 */}
            <TabsContent value="mass" className="space-y-4 mt-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="grid grid-cols-2 gap-4">
                  <MeasurementInput
                    label={`H${i} Left`}
                    aiValue={getMassValue(aiMeasurements.left, i)}
                    value={getMassValue(measurements.left, i)}
                    onChange={(v) => updateMass('left', i, v)}
                  />
                  <MeasurementInput
                    label={`H${i} Right`}
                    aiValue={getMassValue(aiMeasurements.right, i)}
                    value={getMassValue(measurements.right, i)}
                    onChange={(v) => updateMass('right', i, v)}
                  />
                </div>
              ))}
            </TabsContent>

            {/* Totals Tab - Computed values */}
            <TabsContent value="totals" className="space-y-4 mt-4">
              {computed ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-3 bg-muted rounded-lg">
                      <div className="text-xs text-muted-foreground">Spread Credit</div>
                      <div className="text-lg font-semibold">{computed.spreadCredit.toFixed(1)}"</div>
                    </div>
                    <div className="p-3 bg-muted rounded-lg">
                      <div className="text-xs text-muted-foreground">Deductions</div>
                      <div className="text-lg font-semibold text-red-600">-{computed.totalDeductions.toFixed(1)}"</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-3 bg-muted rounded-lg">
                      <div className="text-xs text-muted-foreground">Left Total</div>
                      <div className="text-lg font-semibold">{computed.leftTotal.toFixed(1)}"</div>
                    </div>
                    <div className="p-3 bg-muted rounded-lg">
                      <div className="text-xs text-muted-foreground">Right Total</div>
                      <div className="text-lg font-semibold">{computed.rightTotal.toFixed(1)}"</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-3 bg-green-50 dark:bg-green-950/20 rounded-lg border border-green-200 dark:border-green-800">
                      <div className="text-xs text-green-700 dark:text-green-400">Gross Score</div>
                      <div className="text-xl font-bold text-green-800 dark:text-green-300">{computed.gross.toFixed(1)}"</div>
                    </div>
                    <div className="p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg border border-blue-200 dark:border-blue-800">
                      <div className="text-xs text-blue-700 dark:text-blue-400">Net Score</div>
                      <div className="text-xl font-bold text-blue-800 dark:text-blue-300">{computed.net.toFixed(1)}"</div>
                    </div>
                  </div>
                </div>
              ) : (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>Unable to compute scores. Check measurements.</AlertDescription>
                </Alert>
              )}
            </TabsContent>
          </Tabs>

          {/* Notes */}
          <div className="space-y-2">
            <Label className="text-sm">Review Notes</Label>
            <Textarea
              placeholder="Add notes about corrections or issues..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="h-20 text-sm"
            />
          </div>

          {/* Status Messages */}
          {saveError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{saveError}</AlertDescription>
            </Alert>
          )}
          {saveSuccess && (
            <Alert>
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <AlertDescription>Score sheet saved as training truth!</AlertDescription>
            </Alert>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleReset}
              className="gap-1"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset to AI
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={isSaving}
              className="gap-1 ml-auto"
            >
              <Save className="h-3.5 w-3.5" />
              {isSaving ? 'Saving...' : 'Save as Truth'}
            </Button>
          </div>

          {/* AI vs Human Badge */}
          <div className="flex items-center gap-2 pt-2">
            <Badge variant="outline" className="text-xs">
              AI: {aiMeasurements.grossScore?.toFixed(1) ?? '?'}" gross
            </Badge>
            {computed && (
              <Badge variant="secondary" className="text-xs">
                Reviewed: {computed.gross.toFixed(1)}" gross
              </Badge>
            )}
            {computed && aiMeasurements.grossScore && (
              <Badge 
                variant={Math.abs(computed.gross - aiMeasurements.grossScore) > 5 ? 'destructive' : 'outline'}
                className="text-xs"
              >
                Diff: {(computed.gross - aiMeasurements.grossScore).toFixed(1)}"
              </Badge>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  )
}
