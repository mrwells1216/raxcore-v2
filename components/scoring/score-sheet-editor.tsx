'use client'

/**
 * Score Sheet Editor Component
 * 
 * Allows human review and correction of AI-generated B&C measurements.
 * Displays AI values alongside editable corrected values.
 */

import { useState, useCallback, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Separator } from '@/components/ui/separator'
import { 
  CheckCircle2, 
  AlertCircle, 
  Save, 
  RotateCcw, 
  BookCheck, 
  GraduationCap,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import type { ScoreSheet } from '@/lib/scoring/score-sheet'
import type { 
  CorrectedMeasurements, 
  HumanReviewSheet,
  ReviewStatus,
} from '@/lib/review/types'
import {
  calculateGrossScore,
  calculateNetScore,
  calculateSymmetryDeductions,
} from '@/lib/review/client'

interface ScoreSheetEditorProps {
  /** Prediction ID for creating/loading review */
  predictionId: string
  /** Buck ID for the review */
  buckId: string
  /** AI-generated score sheet to review */
  aiScoreSheet: ScoreSheet
  /** AI gross score */
  aiGrossScore: number
  /** AI net score */
  aiNetScore: number
  /** AI confidence percent */
  aiConfidence: number
  /** Whether the score was a fallback (disables editing) */
  isFallback?: boolean
  /** Existing review sheet if editing */
  existingReview?: HumanReviewSheet | null
  /** Callback when review is saved */
  onSave?: (sheet: HumanReviewSheet) => void
  /** Callback when review is finalized */
  onFinalize?: (sheet: HumanReviewSheet) => void
}

/**
 * Editable number input with AI comparison
 */
function MeasurementInput({
  label,
  aiValue,
  value,
  onChange,
  disabled,
  note,
}: {
  label: string
  aiValue: number | null
  value: number | null
  onChange: (value: number | null) => void
  disabled?: boolean
  note?: string
}) {
  const hasChanged = value !== aiValue && value !== null && aiValue !== null
  const diff = (value ?? 0) - (aiValue ?? 0)
  
  return (
    <div className="grid grid-cols-[1fr_80px_100px_60px] gap-2 items-center py-1.5 border-b border-border/50 last:border-0">
      <Label className="text-sm font-medium">{label}</Label>
      <div className="text-sm text-muted-foreground text-right tabular-nums">
        {aiValue !== null ? aiValue.toFixed(2) : '—'}
      </div>
      <Input
        type="number"
        step="0.125"
        min="0"
        max="50"
        value={value ?? ''}
        onChange={(e) => {
          const val = e.target.value
          onChange(val === '' ? null : parseFloat(val))
        }}
        disabled={disabled}
        className={`h-8 text-sm tabular-nums ${hasChanged ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/20' : ''}`}
      />
      <div className="text-xs tabular-nums text-right">
        {hasChanged && (
          <span className={diff > 0 ? 'text-green-600' : 'text-red-600'}>
            {diff > 0 ? '+' : ''}{diff.toFixed(2)}
          </span>
        )}
      </div>
    </div>
  )
}

export function ScoreSheetEditor({
  predictionId,
  buckId,
  aiScoreSheet,
  aiGrossScore,
  aiNetScore,
  aiConfidence,
  isFallback = false,
  existingReview,
  onSave,
  onFinalize,
}: ScoreSheetEditorProps) {
  // Initialize measurements from existing review or AI values
  const getInitialMeasurements = useCallback((): CorrectedMeasurements => {
    if (existingReview) {
      return existingReview.corrected_measurements
    }
    // Extract from AI score sheet
    return {
      inside_spread: aiScoreSheet.spread.inside.value,
      main_beam_left: aiScoreSheet.left.main_beam.value,
      main_beam_right: aiScoreSheet.right.main_beam.value,
      g1_left: aiScoreSheet.left.g1.value,
      g1_right: aiScoreSheet.right.g1.value,
      g2_left: aiScoreSheet.left.g2.value,
      g2_right: aiScoreSheet.right.g2.value,
      g3_left: aiScoreSheet.left.g3.value,
      g3_right: aiScoreSheet.right.g3.value,
      g4_left: aiScoreSheet.left.g4.value,
      g4_right: aiScoreSheet.right.g4.value,
      g5_left: aiScoreSheet.left.g5.value,
      g5_right: aiScoreSheet.right.g5.value,
      h1_left: aiScoreSheet.left.h1.value,
      h1_right: aiScoreSheet.right.h1.value,
      h2_left: aiScoreSheet.left.h2.value,
      h2_right: aiScoreSheet.right.h2.value,
      h3_left: aiScoreSheet.left.h3.value,
      h3_right: aiScoreSheet.right.h3.value,
      h4_left: aiScoreSheet.left.h4.value,
      h4_right: aiScoreSheet.right.h4.value,
      abnormal_points: aiScoreSheet.abnormal_points.total_length.value,
      deductions: aiScoreSheet.deductions.symmetry_total.value,
    }
  }, [aiScoreSheet, existingReview])

  const [measurements, setMeasurements] = useState<CorrectedMeasurements>(getInitialMeasurements)
  const [rackType, setRackType] = useState<'typical' | 'non-typical'>(
    existingReview?.rack_type ?? aiScoreSheet.metadata.rack_type
  )
  const [mainFramePoints, setMainFramePoints] = useState<number>(
    existingReview?.main_frame_points ?? aiScoreSheet.metadata.main_frame_points
  )
  const [reviewNotes, setReviewNotes] = useState<string>(existingReview?.review_notes ?? '')
  const [reviewStatus, setReviewStatus] = useState<ReviewStatus>(existingReview?.review_status ?? 'draft')
  const [isExpanded, setIsExpanded] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [reviewSheetId, setReviewSheetId] = useState<string | null>(existingReview?.id ?? null)

  // Calculate scores based on corrected measurements
  const correctedGross = calculateGrossScore(measurements)
  const correctedNet = calculateNetScore(measurements, rackType)
  const correctedDeductions = calculateSymmetryDeductions(measurements)
  
  // Update deductions when measurements change
  useEffect(() => {
    setMeasurements(prev => ({
      ...prev,
      deductions: correctedDeductions,
    }))
  }, [
    measurements.main_beam_left, measurements.main_beam_right,
    measurements.g1_left, measurements.g1_right,
    measurements.g2_left, measurements.g2_right,
    measurements.g3_left, measurements.g3_right,
    measurements.g4_left, measurements.g4_right,
    measurements.g5_left, measurements.g5_right,
    measurements.h1_left, measurements.h1_right,
    measurements.h2_left, measurements.h2_right,
    measurements.h3_left, measurements.h3_right,
    measurements.h4_left, measurements.h4_right,
    correctedDeductions,
  ])

  const updateMeasurement = useCallback((key: keyof CorrectedMeasurements, value: number | null) => {
    setMeasurements(prev => ({ ...prev, [key]: value }))
  }, [])

  const resetToAiValues = useCallback(() => {
    setMeasurements({
      inside_spread: aiScoreSheet.spread.inside.value,
      main_beam_left: aiScoreSheet.left.main_beam.value,
      main_beam_right: aiScoreSheet.right.main_beam.value,
      g1_left: aiScoreSheet.left.g1.value,
      g1_right: aiScoreSheet.right.g1.value,
      g2_left: aiScoreSheet.left.g2.value,
      g2_right: aiScoreSheet.right.g2.value,
      g3_left: aiScoreSheet.left.g3.value,
      g3_right: aiScoreSheet.right.g3.value,
      g4_left: aiScoreSheet.left.g4.value,
      g4_right: aiScoreSheet.right.g4.value,
      g5_left: aiScoreSheet.left.g5.value,
      g5_right: aiScoreSheet.right.g5.value,
      h1_left: aiScoreSheet.left.h1.value,
      h1_right: aiScoreSheet.right.h1.value,
      h2_left: aiScoreSheet.left.h2.value,
      h2_right: aiScoreSheet.right.h2.value,
      h3_left: aiScoreSheet.left.h3.value,
      h3_right: aiScoreSheet.right.h3.value,
      h4_left: aiScoreSheet.left.h4.value,
      h4_right: aiScoreSheet.right.h4.value,
      abnormal_points: aiScoreSheet.abnormal_points.total_length.value,
      deductions: aiScoreSheet.deductions.symmetry_total.value,
    })
    setRackType(aiScoreSheet.metadata.rack_type)
    setMainFramePoints(aiScoreSheet.metadata.main_frame_points)
  }, [aiScoreSheet])

  const handleSave = useCallback(async (asFinal: boolean = false) => {
    setIsSaving(true)
    setSaveError(null)
    
    try {
      const newStatus: ReviewStatus = asFinal ? 'final' : 'draft'
      
      if (!reviewSheetId) {
        // Create new review sheet
        const res = await fetch('/api/review/sheets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            buck_id: buckId,
            prediction_id: predictionId,
            ai_score_sheet: aiScoreSheet,
            ai_gross_score: aiGrossScore,
            ai_net_score: aiNetScore,
            ai_confidence: aiConfidence,
            rack_type: rackType,
            main_frame_points: mainFramePoints,
          }),
        })
        
        if (res.status === 409) {
          // Already exists, load it
          const data = await res.json()
          setReviewSheetId(data.existing_sheet_id)
          // Fall through to update
        } else if (!res.ok) {
          throw new Error('Failed to create review sheet')
        } else {
          const data = await res.json()
          setReviewSheetId(data.sheet.id)
          
          // Now update with corrections
          await updateReviewSheet(data.sheet.id, newStatus)
          return
        }
      }
      
      // Update existing review sheet
      await updateReviewSheet(reviewSheetId!, newStatus)
    } catch (error) {
      console.error('[score-sheet-editor] Save error:', error)
      setSaveError(error instanceof Error ? error.message : 'Failed to save review')
    } finally {
      setIsSaving(false)
    }
  }, [
    reviewSheetId,
    buckId,
    predictionId,
    aiScoreSheet,
    aiGrossScore,
    aiNetScore,
    aiConfidence,
    rackType,
    mainFramePoints,
  ])

  const updateReviewSheet = async (sheetId: string, newStatus: ReviewStatus) => {
    const res = await fetch(`/api/review/sheets/${sheetId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        corrected_measurements: measurements,
        corrected_gross_score: correctedGross,
        corrected_net_score: correctedNet,
        review_status: newStatus,
        review_notes: reviewNotes,
        rack_type: rackType,
        main_frame_points: mainFramePoints,
        is_training_truth: newStatus === 'final',
      }),
    })
    
    if (!res.ok) {
      throw new Error('Failed to update review sheet')
    }
    
    const data = await res.json()
    setReviewStatus(newStatus)
    
    if (newStatus === 'final' && onFinalize) {
      onFinalize(data.sheet)
    } else if (onSave) {
      onSave(data.sheet)
    }
  }

  // Calculate score differences
  const grossDiff = correctedGross - aiGrossScore
  const netDiff = correctedNet - aiNetScore

  if (isFallback) {
    return (
      <Card className="border-amber-200 bg-amber-50/50 dark:bg-amber-950/10">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-amber-700">
            <AlertCircle className="h-5 w-5" />
            Review Mode Not Available
          </CardTitle>
          <CardDescription>
            This score was generated using fallback/heuristic methods because AI vision scoring was unavailable.
            Human review mode is only available for true AI-scored entries.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader 
        className="cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <BookCheck className="h-5 w-5 text-primary" />
              Score Sheet Review
              {reviewStatus === 'final' && (
                <Badge variant="default" className="bg-green-600">Finalized</Badge>
              )}
              {reviewStatus === 'draft' && reviewSheetId && (
                <Badge variant="secondary">Draft</Badge>
              )}
            </CardTitle>
            <CardDescription>
              Compare AI estimates with corrected measurements
            </CardDescription>
          </div>
          <div className="flex items-center gap-4">
            {/* Score summary */}
            <div className="text-right">
              <div className="text-sm text-muted-foreground">Corrected</div>
              <div className="text-lg font-bold tabular-nums">
                {correctedGross.toFixed(1)} / {correctedNet.toFixed(1)}
              </div>
              <div className="text-xs tabular-nums">
                {grossDiff !== 0 && (
                  <span className={grossDiff > 0 ? 'text-green-600' : 'text-red-600'}>
                    {grossDiff > 0 ? '+' : ''}{grossDiff.toFixed(1)} gross
                  </span>
                )}
              </div>
            </div>
            {isExpanded ? (
              <ChevronUp className="h-5 w-5 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
        </div>
      </CardHeader>

      {isExpanded && (
        <CardContent className="space-y-4">
          {saveError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{saveError}</AlertDescription>
            </Alert>
          )}

          {/* Classification row */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Rack Type</Label>
              <Select value={rackType} onValueChange={(v) => setRackType(v as 'typical' | 'non-typical')}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="typical">Typical</SelectItem>
                  <SelectItem value="non-typical">Non-Typical</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Main Frame Points</Label>
              <Select value={String(mainFramePoints)} onValueChange={(v) => setMainFramePoints(parseInt(v))}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[6, 8, 10, 12, 14, 16, 18, 20].map(n => (
                    <SelectItem key={n} value={String(n)}>{n}-point</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Separator />

          {/* Column headers */}
          <div className="grid grid-cols-[1fr_80px_100px_60px] gap-2 text-xs font-medium text-muted-foreground">
            <div>Measurement</div>
            <div className="text-right">AI Value</div>
            <div>Corrected</div>
            <div className="text-right">Diff</div>
          </div>

          <Tabs defaultValue="main" className="w-full">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="main">Main</TabsTrigger>
              <TabsTrigger value="tines">Tines</TabsTrigger>
              <TabsTrigger value="mass">Mass</TabsTrigger>
              <TabsTrigger value="deductions">Deductions</TabsTrigger>
            </TabsList>

            <TabsContent value="main" className="mt-3 space-y-1">
              <MeasurementInput
                label="Inside Spread"
                aiValue={aiScoreSheet.spread.inside.value}
                value={measurements.inside_spread}
                onChange={(v) => updateMeasurement('inside_spread', v)}
              />
              <MeasurementInput
                label="Main Beam (L)"
                aiValue={aiScoreSheet.left.main_beam.value}
                value={measurements.main_beam_left}
                onChange={(v) => updateMeasurement('main_beam_left', v)}
              />
              <MeasurementInput
                label="Main Beam (R)"
                aiValue={aiScoreSheet.right.main_beam.value}
                value={measurements.main_beam_right}
                onChange={(v) => updateMeasurement('main_beam_right', v)}
              />
            </TabsContent>

            <TabsContent value="tines" className="mt-3 space-y-1">
              <MeasurementInput
                label="G1 (L)"
                aiValue={aiScoreSheet.left.g1.value}
                value={measurements.g1_left}
                onChange={(v) => updateMeasurement('g1_left', v)}
              />
              <MeasurementInput
                label="G1 (R)"
                aiValue={aiScoreSheet.right.g1.value}
                value={measurements.g1_right}
                onChange={(v) => updateMeasurement('g1_right', v)}
              />
              <MeasurementInput
                label="G2 (L)"
                aiValue={aiScoreSheet.left.g2.value}
                value={measurements.g2_left}
                onChange={(v) => updateMeasurement('g2_left', v)}
              />
              <MeasurementInput
                label="G2 (R)"
                aiValue={aiScoreSheet.right.g2.value}
                value={measurements.g2_right}
                onChange={(v) => updateMeasurement('g2_right', v)}
              />
              <MeasurementInput
                label="G3 (L)"
                aiValue={aiScoreSheet.left.g3.value}
                value={measurements.g3_left}
                onChange={(v) => updateMeasurement('g3_left', v)}
              />
              <MeasurementInput
                label="G3 (R)"
                aiValue={aiScoreSheet.right.g3.value}
                value={measurements.g3_right}
                onChange={(v) => updateMeasurement('g3_right', v)}
              />
              <MeasurementInput
                label="G4 (L)"
                aiValue={aiScoreSheet.left.g4.value}
                value={measurements.g4_left}
                onChange={(v) => updateMeasurement('g4_left', v)}
              />
              <MeasurementInput
                label="G4 (R)"
                aiValue={aiScoreSheet.right.g4.value}
                value={measurements.g4_right}
                onChange={(v) => updateMeasurement('g4_right', v)}
              />
              <MeasurementInput
                label="G5 (L)"
                aiValue={aiScoreSheet.left.g5.value}
                value={measurements.g5_left}
                onChange={(v) => updateMeasurement('g5_left', v)}
              />
              <MeasurementInput
                label="G5 (R)"
                aiValue={aiScoreSheet.right.g5.value}
                value={measurements.g5_right}
                onChange={(v) => updateMeasurement('g5_right', v)}
              />
            </TabsContent>

            <TabsContent value="mass" className="mt-3 space-y-1">
              <MeasurementInput
                label="H1 (L)"
                aiValue={aiScoreSheet.left.h1.value}
                value={measurements.h1_left}
                onChange={(v) => updateMeasurement('h1_left', v)}
              />
              <MeasurementInput
                label="H1 (R)"
                aiValue={aiScoreSheet.right.h1.value}
                value={measurements.h1_right}
                onChange={(v) => updateMeasurement('h1_right', v)}
              />
              <MeasurementInput
                label="H2 (L)"
                aiValue={aiScoreSheet.left.h2.value}
                value={measurements.h2_left}
                onChange={(v) => updateMeasurement('h2_left', v)}
              />
              <MeasurementInput
                label="H2 (R)"
                aiValue={aiScoreSheet.right.h2.value}
                value={measurements.h2_right}
                onChange={(v) => updateMeasurement('h2_right', v)}
              />
              <MeasurementInput
                label="H3 (L)"
                aiValue={aiScoreSheet.left.h3.value}
                value={measurements.h3_left}
                onChange={(v) => updateMeasurement('h3_left', v)}
              />
              <MeasurementInput
                label="H3 (R)"
                aiValue={aiScoreSheet.right.h3.value}
                value={measurements.h3_right}
                onChange={(v) => updateMeasurement('h3_right', v)}
              />
              <MeasurementInput
                label="H4 (L)"
                aiValue={aiScoreSheet.left.h4.value}
                value={measurements.h4_left}
                onChange={(v) => updateMeasurement('h4_left', v)}
              />
              <MeasurementInput
                label="H4 (R)"
                aiValue={aiScoreSheet.right.h4.value}
                value={measurements.h4_right}
                onChange={(v) => updateMeasurement('h4_right', v)}
              />
            </TabsContent>

            <TabsContent value="deductions" className="mt-3 space-y-1">
              <MeasurementInput
                label="Abnormal Points"
                aiValue={aiScoreSheet.abnormal_points.total_length.value}
                value={measurements.abnormal_points}
                onChange={(v) => updateMeasurement('abnormal_points', v)}
              />
              <div className="grid grid-cols-[1fr_80px_100px_60px] gap-2 items-center py-1.5 border-b border-border/50">
                <Label className="text-sm font-medium">Symmetry Deductions</Label>
                <div className="text-sm text-muted-foreground text-right tabular-nums">
                  {aiScoreSheet.deductions.symmetry_total.value?.toFixed(2) ?? '—'}
                </div>
                <div className="text-sm font-medium tabular-nums">
                  {correctedDeductions.toFixed(2)}
                </div>
                <div className="text-xs tabular-nums text-right text-muted-foreground">
                  (auto)
                </div>
              </div>
            </TabsContent>
          </Tabs>

          <Separator />

          {/* Score summary */}
          <div className="grid grid-cols-2 gap-4 p-3 bg-muted/30 rounded-lg">
            <div>
              <div className="text-sm text-muted-foreground">AI Scores</div>
              <div className="text-lg font-bold tabular-nums">
                {aiGrossScore.toFixed(1)} gross / {aiNetScore.toFixed(1)} net
              </div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Corrected Scores</div>
              <div className="text-lg font-bold tabular-nums">
                {correctedGross.toFixed(1)} gross / {correctedNet.toFixed(1)} net
              </div>
              {(grossDiff !== 0 || netDiff !== 0) && (
                <div className="text-sm tabular-nums">
                  <span className={grossDiff > 0 ? 'text-green-600' : grossDiff < 0 ? 'text-red-600' : ''}>
                    {grossDiff > 0 ? '+' : ''}{grossDiff.toFixed(1)} gross
                  </span>
                  {' / '}
                  <span className={netDiff > 0 ? 'text-green-600' : netDiff < 0 ? 'text-red-600' : ''}>
                    {netDiff > 0 ? '+' : ''}{netDiff.toFixed(1)} net
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="review-notes">Review Notes</Label>
            <Textarea
              id="review-notes"
              placeholder="Add notes about corrections, measurement sources, or confidence..."
              value={reviewNotes}
              onChange={(e) => setReviewNotes(e.target.value)}
              rows={3}
            />
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={resetToAiValues}
              disabled={isSaving}
            >
              <RotateCcw className="h-4 w-4 mr-1.5" />
              Reset to AI
            </Button>
            <div className="flex-1" />
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleSave(false)}
              disabled={isSaving}
            >
              <Save className="h-4 w-4 mr-1.5" />
              {isSaving ? 'Saving...' : 'Save Draft'}
            </Button>
            <Button
              size="sm"
              onClick={() => handleSave(true)}
              disabled={isSaving || reviewStatus === 'final'}
              className="bg-green-600 hover:bg-green-700"
            >
              <CheckCircle2 className="h-4 w-4 mr-1.5" />
              {reviewStatus === 'final' ? 'Finalized' : 'Mark as Final'}
            </Button>
            {reviewStatus === 'final' && (
              <Button
                variant="secondary"
                size="sm"
                disabled={isSaving}
              >
                <GraduationCap className="h-4 w-4 mr-1.5" />
                Use for Training
              </Button>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  )
}
