'use client'

/**
 * Score Sheet Editor Component
 * 
 * Allows human review and correction of AI-generated B&C measurements.
 * Displays AI values alongside editable corrected values.
 * 
 * UNIFIED: Uses /api/review/save-score-sheet route and reviewed_score_sheets table.
 * No dependency on old human_review_sheets system.
 */

import { useState, useCallback, useEffect, useRef } from 'react'
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
  Pencil,
} from 'lucide-react'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { ManualCorrectionPanel } from './manual-correction-panel'
import {
  getMeasurementDisplayConfidence,
} from '@/lib/scoring/measurement-display-confidence'
import { getOverrideFieldLabel } from '@/lib/scoring/manual-overrides'
import type { ManualOverrideFieldKey } from '@/lib/scoring/manual-overrides'
import type { ScoreSheet } from '@/lib/scoring/score-sheet'
import type { CorrectedMeasurements } from '@/lib/review/types'
import {
  calculateGrossScore,
  calculateNetScore,
  calculateSymmetryDeductions,
} from '@/lib/review/client'
import { 
  toScoreSheetPayload, 
  createReviewedPayload,
} from '@/lib/scoring/adapters/to-score-sheet-payload'
import { 
  ProvenanceBadge, 
  TotalsProvenanceBadge 
} from './provenance-badge'
import type { 
  ProvenanceSource,
  FieldProvenanceMap,
  MeasuredField,
} from '@/lib/rules-engine'

// Local type - no dependency on old review system
type ReviewStatus = 'draft' | 'final'

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
  /**
   * Optional prior field provenance map.
   * Pass this when you have precision-pass provenance available.
   */
  aiFieldProvenance?: FieldProvenanceMap | null
  /**
   * Optional stable runId from the precision-pass that produced aiScoreSheet.
   * When provided, the editor uses `${predictionId}:${precisionRunId}` as its
   * hydration key so it re-initializes exactly once when a new precision run
   * lands, but not on every re-render caused by object-reference churn.
   */
  precisionRunId?: string | null
  /** Primary image URL used for the manual correction overlay */
  imageUrl?: string | null
  /** Raw landmarks from the scoring payload for handle initialization */
  landmarks?: Record<string, unknown> | null
  /** Callback when review is saved */
  onSave?: () => void
  /** Callback when review is finalized */
  onFinalize?: () => void
}

function getDisplayField(
  savedField: MeasuredField | null | undefined,
  currentValue: number | null,
  aiValue: number | null,
  isFallbackSource: boolean
): MeasuredField {
  const base: MeasuredField = savedField ?? {
    value: aiValue,
    provenance: isFallbackSource ? 'fallback' : 'ai_raw',
    confidence: isFallbackSource ? 'low' : 'medium',
    originalValue: aiValue,
    wasEdited: false,
    editStatus: 'unchanged',
  }

  const hasChanged = currentValue !== base.value

  if (!hasChanged) {
    return {
      ...base,
      value: currentValue,
      wasEdited: false,
      editStatus: 'unchanged',
    }
  }

  return {
    value: currentValue,
    provenance: 'human_review',
    confidence: 'high',
    originalValue: base.originalValue ?? base.value ?? aiValue,
    wasEdited: true,
    editStatus:
      base.provenance === 'precision_pass'
        ? 'adjusted'
        : base.provenance === 'human_review'
          ? 'adjusted'
          : 'overridden',
  }
}

function getOverallTotalsProvenance(
  fields: Array<MeasuredField | null | undefined>
): ProvenanceSource {
  if (fields.some((f) => f?.provenance === 'human_review')) return 'human_review'
  if (fields.some((f) => f?.provenance === 'precision_pass')) return 'precision_pass'
  if (fields.some((f) => f?.provenance === 'fallback')) return 'fallback'
  return 'ai_raw'
}

/**
 * Editable number input with AI comparison and provenance badge
 */
function MeasurementInput({
  label,
  aiValue,
  value,
  onChange,
  disabled,
  field,
  isFallbackSource = false,
  onRequestCorrection,
}: {
  label: string
  aiValue: number | null
  value: number | null
  onChange: (value: number | null) => void
  disabled?: boolean
  field?: MeasuredField | null
  isFallbackSource?: boolean
  onRequestCorrection?: () => void
}) {
  const displayField = getDisplayField(field, value, aiValue, isFallbackSource)
  const diff = (value ?? 0) - (aiValue ?? 0)
  const hasChanged = displayField.wasEdited === true

  // Derive display confidence for correction CTA visibility
  const displayConf = getMeasurementDisplayConfidence(field ?? undefined)
  const showReview = displayConf === 'low'
  const showAdjust = displayConf === 'medium' || displayConf === 'unknown'
  const isHumanReviewed = displayField.provenance === 'human_review'

  return (
    <div className="border-b border-border/50 last:border-0">
      <div className="grid grid-cols-[1fr_auto_80px_100px_60px] gap-2 items-center py-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <Label className="text-sm font-medium truncate">{label}</Label>
          {isHumanReviewed && (
            <span className="shrink-0 text-[9px] font-semibold text-emerald-600 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-700 rounded px-1 py-0 leading-4">
              Corrected
            </span>
          )}
        </div>
        <ProvenanceBadge
          provenance={displayField.provenance}
          confidence={displayField.confidence}
          wasEdited={displayField.wasEdited}
          originalValue={displayField.originalValue}
          currentValue={displayField.value}
          size="sm"
        />
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
            const raw = e.target.value
            onChange(raw === '' ? null : Number(raw))
          }}
          disabled={disabled}
          className="h-9"
        />
        <div className="text-xs tabular-nums text-right text-muted-foreground">
          {hasChanged ? `${diff > 0 ? '+' : ''}${diff.toFixed(2)}` : '—'}
        </div>
      </div>

      {/* Correction CTA — only visible for low/medium confidence, not already human-reviewed */}
      {onRequestCorrection && !isHumanReviewed && (showReview || showAdjust) && (
        <div className="pb-1.5 pl-0">
          <button
            type="button"
            onClick={onRequestCorrection}
            className={cn(
              'inline-flex items-center gap-1 text-[10px] font-medium rounded px-1.5 py-0.5 transition-colors',
              showReview
                ? 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 hover:bg-red-100 dark:hover:bg-red-950/50 border border-red-200 dark:border-red-800/50'
                : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 border border-transparent hover:border-zinc-300 dark:hover:border-zinc-700'
            )}
          >
            <Pencil className="h-2.5 w-2.5" />
            {showReview ? 'Review measurement' : 'Adjust'}
          </button>
        </div>
      )}
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
  aiFieldProvenance = null,
  precisionRunId = null,
  imageUrl = null,
  landmarks = null,
  onSave,
  onFinalize,
}: ScoreSheetEditorProps) {
  // Stable hydration guard — only re-initialize when the effective editor key changes.
  // Key is predictionId + precisionRunId so a new precision run re-hydrates the editor
  // once, but object-reference churn on aiScoreSheet does not.
  const lastHydratedKeyRef = useRef<string | null>(null)

  const buildInitialMeasurements = (sheet: typeof aiScoreSheet): CorrectedMeasurements => ({
    inside_spread: sheet.spread.inside.value,
    main_beam_left: sheet.left.main_beam.value,
    main_beam_right: sheet.right.main_beam.value,
    g1_left: sheet.left.g1.value,
    g1_right: sheet.right.g1.value,
    g2_left: sheet.left.g2.value,
    g2_right: sheet.right.g2.value,
    g3_left: sheet.left.g3.value,
    g3_right: sheet.right.g3.value,
    g4_left: sheet.left.g4.value,
    g4_right: sheet.right.g4.value,
    g5_left: sheet.left.g5.value,
    g5_right: sheet.right.g5.value,
    h1_left: sheet.left.h1.value,
    h1_right: sheet.right.h1.value,
    h2_left: sheet.left.h2.value,
    h2_right: sheet.right.h2.value,
    h3_left: sheet.left.h3.value,
    h3_right: sheet.right.h3.value,
    h4_left: sheet.left.h4.value,
    h4_right: sheet.right.h4.value,
    abnormal_points: sheet.abnormal_points.total_length.value,
    deductions: sheet.deductions.symmetry_total.value,
  })

  const [measurements, setMeasurements] = useState<CorrectedMeasurements>(() =>
    buildInitialMeasurements(aiScoreSheet)
  )
  const [rackType, setRackType] = useState<'typical' | 'non-typical'>(aiScoreSheet.metadata.rack_type)
  const [mainFramePoints, setMainFramePoints] = useState<number>(aiScoreSheet.metadata.main_frame_points)
  const [reviewNotes, setReviewNotes] = useState<string>('')
  const [reviewStatus, setReviewStatus] = useState<ReviewStatus>('draft')
  const [isExpanded, setIsExpanded] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [hasSaved, setHasSaved] = useState(false)

  // Manual correction sheet state
  const [correctionField, setCorrectionField] = useState<{
    fieldKey: string
    fieldLabel: string
    currentValue: number | null
    aiValue: number | null
    provenance: string | null
    confidence: string | null
    measurementKey: keyof CorrectedMeasurements
  } | null>(null)

  const openCorrection = useCallback((
    fieldKey: string,
    fieldLabel: string,
    currentValue: number | null,
    aiValue: number | null,
    provenance: string | null,
    confidence: string | null,
    measurementKey: keyof CorrectedMeasurements,
  ) => {
    setCorrectionField({ fieldKey, fieldLabel, currentValue, aiValue, provenance, confidence, measurementKey })
  }, [])

  const handleCorrectionSave = useCallback((override: {
    fieldKey: string
    value: number | null
    geometry?: unknown
  }) => {
    if (!correctionField) return
    if (override.value !== null) {
      updateMeasurement(correctionField.measurementKey, override.value)
    }
    setCorrectionField(null)
  }, [correctionField, updateMeasurement])

  // Re-hydrate editor state only when the effective editor key changes.
  // Using a ref-based guard means the effect body can safely read aiScoreSheet
  // without listing it as a dependency (avoiding re-fires on every render).
  useEffect(() => {
    const editorKey = `${predictionId}:${precisionRunId ?? 'base'}`
    if (lastHydratedKeyRef.current === editorKey) return
    lastHydratedKeyRef.current = editorKey
    setMeasurements(buildInitialMeasurements(aiScoreSheet))
    setRackType(aiScoreSheet.metadata.rack_type)
    setMainFramePoints(aiScoreSheet.metadata.main_frame_points)
    setHasSaved(false)
    setReviewStatus('draft')
    setSaveError(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [predictionId, precisionRunId])

  // Calculate scores based on corrected measurements
  const correctedGross = calculateGrossScore(measurements)
  const correctedNet = calculateNetScore(measurements, rackType)
  const correctedDeductions = calculateSymmetryDeductions(measurements)

  // Sync auto-computed symmetry deductions back into measurements without recursion.
  // Use a ref to compare the previous computed value so we only call setMeasurements
  // when the value actually changes, preventing an infinite update loop.
  const prevDeductionsRef = useRef<number | null>(null)
  useEffect(() => {
    if (prevDeductionsRef.current === correctedDeductions) return
    prevDeductionsRef.current = correctedDeductions
    setMeasurements(prev => ({ ...prev, deductions: correctedDeductions }))
  }, [correctedDeductions])

  const updateMeasurement = useCallback((key: keyof CorrectedMeasurements, value: number | null) => {
    setMeasurements(prev => ({ ...prev, [key]: value }))
  }, [])

  const resetToAiValues = useCallback(() => {
    setMeasurements(buildInitialMeasurements(aiScoreSheet))
    setRackType(aiScoreSheet.metadata.rack_type)
    setMainFramePoints(aiScoreSheet.metadata.main_frame_points)
  }, [aiScoreSheet])

  /**
   * Save reviewed sheet using the unified /api/review/save-score-sheet route.
   * Converts to canonical ScoreSheetPayload format.
   */
  const handleSave = useCallback(async (asFinal: boolean = false) => {
    setIsSaving(true)
    setSaveError(null)
    
    try {
      const newStatus: ReviewStatus = asFinal ? 'final' : 'draft'
      
      // Convert AI sheet to canonical payload
      const aiPayload = toScoreSheetPayload(aiScoreSheet, {
        source: 'ai',
        scoringSystem: rackType === 'typical' ? 'boone_and_crockett_typical' : 'boone_and_crockett_non_typical',
        grossScore: aiGrossScore,
        netScore: aiNetScore,
      })
      
      // Convert corrected measurements to canonical payload with provenance
      const reviewedPayload = createReviewedPayload(
        measurements,
        correctedGross,
        correctedNet,
        {
          scoringSystem: rackType === 'typical' ? 'boone_and_crockett_typical' : 'boone_and_crockett_non_typical',
          aiMeasurements: {
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
          },
          aiGross: aiGrossScore,
          aiNet: aiNetScore,
          isFallback,
          aiProvenance: aiFieldProvenance,
        }
      )
      
      // Save via unified route
      const res = await fetch('/api/review/save-score-sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          predictionId,
          buckId,
          reviewedSheet: reviewedPayload,
          aiSheet: aiPayload,
          notes: reviewNotes || null,
          isTrainingTruth: asFinal,
        }),
      })
      
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to save reviewed score sheet')
      }
      
      setReviewStatus(newStatus)
      setHasSaved(true)
      
      if (asFinal && onFinalize) {
        onFinalize()
      } else if (onSave) {
        onSave()
      }
    } catch (error) {
      console.error('[score-sheet-editor] Save error:', error)
      setSaveError(error instanceof Error ? error.message : 'Failed to save review')
    } finally {
      setIsSaving(false)
    }
  }, [
    predictionId,
    buckId,
    aiScoreSheet,
    aiGrossScore,
    aiNetScore,
    rackType,
    measurements,
    correctedGross,
    correctedNet,
    reviewNotes,
    onSave,
    onFinalize,
  ])

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
              {reviewStatus === 'draft' && hasSaved && (
                <Badge variant="secondary">Draft Saved</Badge>
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
                field={aiFieldProvenance?.insideSpread}
                onRequestCorrection={() => openCorrection('inside_spread', 'Inside Spread', measurements.inside_spread, aiScoreSheet.spread.inside.value, aiFieldProvenance?.insideSpread?.provenance ?? null, aiFieldProvenance?.insideSpread?.confidence ?? null, 'inside_spread')}
              />
              <MeasurementInput
                label="Main Beam (L)"
                aiValue={aiScoreSheet.left.main_beam.value}
                value={measurements.main_beam_left}
                onChange={(v) => updateMeasurement('main_beam_left', v)}
                field={aiFieldProvenance?.leftMainBeam}
                onRequestCorrection={() => openCorrection('left_beam_length', 'Left Main Beam', measurements.main_beam_left, aiScoreSheet.left.main_beam.value, aiFieldProvenance?.leftMainBeam?.provenance ?? null, aiFieldProvenance?.leftMainBeam?.confidence ?? null, 'main_beam_left')}
              />
              <MeasurementInput
                label="Main Beam (R)"
                aiValue={aiScoreSheet.right.main_beam.value}
                value={measurements.main_beam_right}
                onChange={(v) => updateMeasurement('main_beam_right', v)}
                field={aiFieldProvenance?.rightMainBeam}
                onRequestCorrection={() => openCorrection('right_beam_length', 'Right Main Beam', measurements.main_beam_right, aiScoreSheet.right.main_beam.value, aiFieldProvenance?.rightMainBeam?.provenance ?? null, aiFieldProvenance?.rightMainBeam?.confidence ?? null, 'main_beam_right')}
              />
            </TabsContent>

            <TabsContent value="tines" className="mt-3 space-y-1">
              <MeasurementInput label="G1 (L)" aiValue={aiScoreSheet.left.g1.value} value={measurements.g1_left} onChange={(v) => updateMeasurement('g1_left', v)} field={aiFieldProvenance?.leftTines?.[1]} onRequestCorrection={() => openCorrection('g1_left', 'G1 Left', measurements.g1_left, aiScoreSheet.left.g1.value, aiFieldProvenance?.leftTines?.[1]?.provenance ?? null, aiFieldProvenance?.leftTines?.[1]?.confidence ?? null, 'g1_left')} />
              <MeasurementInput label="G1 (R)" aiValue={aiScoreSheet.right.g1.value} value={measurements.g1_right} onChange={(v) => updateMeasurement('g1_right', v)} field={aiFieldProvenance?.rightTines?.[1]} onRequestCorrection={() => openCorrection('g1_right', 'G1 Right', measurements.g1_right, aiScoreSheet.right.g1.value, aiFieldProvenance?.rightTines?.[1]?.provenance ?? null, aiFieldProvenance?.rightTines?.[1]?.confidence ?? null, 'g1_right')} />
              <MeasurementInput label="G2 (L)" aiValue={aiScoreSheet.left.g2.value} value={measurements.g2_left} onChange={(v) => updateMeasurement('g2_left', v)} field={aiFieldProvenance?.leftTines?.[2]} onRequestCorrection={() => openCorrection('g2_left', 'G2 Left', measurements.g2_left, aiScoreSheet.left.g2.value, aiFieldProvenance?.leftTines?.[2]?.provenance ?? null, aiFieldProvenance?.leftTines?.[2]?.confidence ?? null, 'g2_left')} />
              <MeasurementInput label="G2 (R)" aiValue={aiScoreSheet.right.g2.value} value={measurements.g2_right} onChange={(v) => updateMeasurement('g2_right', v)} field={aiFieldProvenance?.rightTines?.[2]} onRequestCorrection={() => openCorrection('g2_right', 'G2 Right', measurements.g2_right, aiScoreSheet.right.g2.value, aiFieldProvenance?.rightTines?.[2]?.provenance ?? null, aiFieldProvenance?.rightTines?.[2]?.confidence ?? null, 'g2_right')} />
              <MeasurementInput label="G3 (L)" aiValue={aiScoreSheet.left.g3.value} value={measurements.g3_left} onChange={(v) => updateMeasurement('g3_left', v)} field={aiFieldProvenance?.leftTines?.[3]} onRequestCorrection={() => openCorrection('g3_left', 'G3 Left', measurements.g3_left, aiScoreSheet.left.g3.value, aiFieldProvenance?.leftTines?.[3]?.provenance ?? null, aiFieldProvenance?.leftTines?.[3]?.confidence ?? null, 'g3_left')} />
              <MeasurementInput label="G3 (R)" aiValue={aiScoreSheet.right.g3.value} value={measurements.g3_right} onChange={(v) => updateMeasurement('g3_right', v)} field={aiFieldProvenance?.rightTines?.[3]} onRequestCorrection={() => openCorrection('g3_right', 'G3 Right', measurements.g3_right, aiScoreSheet.right.g3.value, aiFieldProvenance?.rightTines?.[3]?.provenance ?? null, aiFieldProvenance?.rightTines?.[3]?.confidence ?? null, 'g3_right')} />
              <MeasurementInput label="G4 (L)" aiValue={aiScoreSheet.left.g4.value} value={measurements.g4_left} onChange={(v) => updateMeasurement('g4_left', v)} field={aiFieldProvenance?.leftTines?.[4]} onRequestCorrection={() => openCorrection('g4_left', 'G4 Left', measurements.g4_left, aiScoreSheet.left.g4.value, aiFieldProvenance?.leftTines?.[4]?.provenance ?? null, aiFieldProvenance?.leftTines?.[4]?.confidence ?? null, 'g4_left')} />
              <MeasurementInput label="G4 (R)" aiValue={aiScoreSheet.right.g4.value} value={measurements.g4_right} onChange={(v) => updateMeasurement('g4_right', v)} field={aiFieldProvenance?.rightTines?.[4]} onRequestCorrection={() => openCorrection('g4_right', 'G4 Right', measurements.g4_right, aiScoreSheet.right.g4.value, aiFieldProvenance?.rightTines?.[4]?.provenance ?? null, aiFieldProvenance?.rightTines?.[4]?.confidence ?? null, 'g4_right')} />
              <MeasurementInput label="G5 (L)" aiValue={aiScoreSheet.left.g5.value} value={measurements.g5_left} onChange={(v) => updateMeasurement('g5_left', v)} field={aiFieldProvenance?.leftTines?.[5]} onRequestCorrection={() => openCorrection('g5_left', 'G5 Left', measurements.g5_left, aiScoreSheet.left.g5.value, aiFieldProvenance?.leftTines?.[5]?.provenance ?? null, aiFieldProvenance?.leftTines?.[5]?.confidence ?? null, 'g5_left')} />
              <MeasurementInput label="G5 (R)" aiValue={aiScoreSheet.right.g5.value} value={measurements.g5_right} onChange={(v) => updateMeasurement('g5_right', v)} field={aiFieldProvenance?.rightTines?.[5]} onRequestCorrection={() => openCorrection('g5_right', 'G5 Right', measurements.g5_right, aiScoreSheet.right.g5.value, aiFieldProvenance?.rightTines?.[5]?.provenance ?? null, aiFieldProvenance?.rightTines?.[5]?.confidence ?? null, 'g5_right')} />
            </TabsContent>

            <TabsContent value="mass" className="mt-3 space-y-1">
              <MeasurementInput label="H1 (L)" aiValue={aiScoreSheet.left.h1.value} value={measurements.h1_left} onChange={(v) => updateMeasurement('h1_left', v)} field={aiFieldProvenance?.leftMasses?.[1]} onRequestCorrection={() => openCorrection('h1_left', 'H1 Left', measurements.h1_left, aiScoreSheet.left.h1.value, aiFieldProvenance?.leftMasses?.[1]?.provenance ?? null, aiFieldProvenance?.leftMasses?.[1]?.confidence ?? null, 'h1_left')} />
              <MeasurementInput label="H1 (R)" aiValue={aiScoreSheet.right.h1.value} value={measurements.h1_right} onChange={(v) => updateMeasurement('h1_right', v)} field={aiFieldProvenance?.rightMasses?.[1]} onRequestCorrection={() => openCorrection('h1_right', 'H1 Right', measurements.h1_right, aiScoreSheet.right.h1.value, aiFieldProvenance?.rightMasses?.[1]?.provenance ?? null, aiFieldProvenance?.rightMasses?.[1]?.confidence ?? null, 'h1_right')} />
              <MeasurementInput label="H2 (L)" aiValue={aiScoreSheet.left.h2.value} value={measurements.h2_left} onChange={(v) => updateMeasurement('h2_left', v)} field={aiFieldProvenance?.leftMasses?.[2]} onRequestCorrection={() => openCorrection('h2_left', 'H2 Left', measurements.h2_left, aiScoreSheet.left.h2.value, aiFieldProvenance?.leftMasses?.[2]?.provenance ?? null, aiFieldProvenance?.leftMasses?.[2]?.confidence ?? null, 'h2_left')} />
              <MeasurementInput label="H2 (R)" aiValue={aiScoreSheet.right.h2.value} value={measurements.h2_right} onChange={(v) => updateMeasurement('h2_right', v)} field={aiFieldProvenance?.rightMasses?.[2]} onRequestCorrection={() => openCorrection('h2_right', 'H2 Right', measurements.h2_right, aiScoreSheet.right.h2.value, aiFieldProvenance?.rightMasses?.[2]?.provenance ?? null, aiFieldProvenance?.rightMasses?.[2]?.confidence ?? null, 'h2_right')} />
              <MeasurementInput label="H3 (L)" aiValue={aiScoreSheet.left.h3.value} value={measurements.h3_left} onChange={(v) => updateMeasurement('h3_left', v)} field={aiFieldProvenance?.leftMasses?.[3]} onRequestCorrection={() => openCorrection('h3_left', 'H3 Left', measurements.h3_left, aiScoreSheet.left.h3.value, aiFieldProvenance?.leftMasses?.[3]?.provenance ?? null, aiFieldProvenance?.leftMasses?.[3]?.confidence ?? null, 'h3_left')} />
              <MeasurementInput label="H3 (R)" aiValue={aiScoreSheet.right.h3.value} value={measurements.h3_right} onChange={(v) => updateMeasurement('h3_right', v)} field={aiFieldProvenance?.rightMasses?.[3]} onRequestCorrection={() => openCorrection('h3_right', 'H3 Right', measurements.h3_right, aiScoreSheet.right.h3.value, aiFieldProvenance?.rightMasses?.[3]?.provenance ?? null, aiFieldProvenance?.rightMasses?.[3]?.confidence ?? null, 'h3_right')} />
              <MeasurementInput label="H4 (L)" aiValue={aiScoreSheet.left.h4.value} value={measurements.h4_left} onChange={(v) => updateMeasurement('h4_left', v)} field={aiFieldProvenance?.leftMasses?.[4]} onRequestCorrection={() => openCorrection('h4_left', 'H4 Left', measurements.h4_left, aiScoreSheet.left.h4.value, aiFieldProvenance?.leftMasses?.[4]?.provenance ?? null, aiFieldProvenance?.leftMasses?.[4]?.confidence ?? null, 'h4_left')} />
              <MeasurementInput label="H4 (R)" aiValue={aiScoreSheet.right.h4.value} value={measurements.h4_right} onChange={(v) => updateMeasurement('h4_right', v)} field={aiFieldProvenance?.rightMasses?.[4]} onRequestCorrection={() => openCorrection('h4_right', 'H4 Right', measurements.h4_right, aiScoreSheet.right.h4.value, aiFieldProvenance?.rightMasses?.[4]?.provenance ?? null, aiFieldProvenance?.rightMasses?.[4]?.confidence ?? null, 'h4_right')} />
            </TabsContent>

            <TabsContent value="deductions" className="mt-3 space-y-1">
              <MeasurementInput
                label="Abnormal Points"
                aiValue={aiScoreSheet.abnormal_points.total_length.value}
                value={measurements.abnormal_points}
                onChange={(v) => updateMeasurement('abnormal_points', v)}
                field={aiFieldProvenance?.abnormalPoints}
                onRequestCorrection={() => openCorrection('abnormal_points', 'Abnormal Points', measurements.abnormal_points, aiScoreSheet.abnormal_points.total_length.value, aiFieldProvenance?.abnormalPoints?.provenance ?? null, aiFieldProvenance?.abnormalPoints?.confidence ?? null, 'abnormal_points')}
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

          {/* Score summary with provenance */}
          <div className="grid grid-cols-2 gap-4 p-3 bg-muted/30 rounded-lg">
            <div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                AI Scores
                <ProvenanceBadge 
                  provenance={isFallback ? 'fallback' : 'ai_raw'} 
                  confidence={isFallback ? 'low' : 'medium'}
                  size="sm"
                />
              </div>
              <div className="text-lg font-bold tabular-nums">
                {aiGrossScore.toFixed(1)} gross / {aiNetScore.toFixed(1)} net
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                Corrected Scores
                <TotalsProvenanceBadge
                  grossProvenance={getDisplayField(
                    aiFieldProvenance?.grossScore,
                    correctedGross,
                    aiGrossScore,
                    !!isFallback
                  ).provenance}
                  netProvenance={getDisplayField(
                    aiFieldProvenance?.netScore,
                    correctedNet,
                    aiNetScore,
                    !!isFallback
                  ).provenance}
                  hasHumanEdits={
                    getOverallTotalsProvenance([
                      aiFieldProvenance?.insideSpread,
                      aiFieldProvenance?.leftMainBeam,
                      aiFieldProvenance?.rightMainBeam,
                      aiFieldProvenance?.grossScore,
                      aiFieldProvenance?.netScore,
                    ]) === 'human_review' || grossDiff !== 0 || netDiff !== 0
                  }
                />
              </div>
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
                Training Truth
              </Button>
            )}
          </div>
        </CardContent>
      )}

      {/* Manual Correction Sheet */}
      <Sheet open={!!correctionField} onOpenChange={(open) => { if (!open) setCorrectionField(null) }}>
        <SheetContent
          side="bottom"
          className="h-[90dvh] p-0 bg-zinc-950 border-zinc-800"
        >
          {correctionField && (
            <ManualCorrectionPanel
              imageUrl={imageUrl ?? ''}
              fieldKey={correctionField.fieldKey}
              fieldLabel={correctionField.fieldLabel}
              currentValue={correctionField.currentValue}
              aiValue={correctionField.aiValue}
              provenance={correctionField.provenance}
              confidence={correctionField.confidence}
              landmarks={landmarks}
              onCancel={() => setCorrectionField(null)}
              onSave={handleCorrectionSave}
            />
          )}
        </SheetContent>
      </Sheet>
    </Card>
  )
}
