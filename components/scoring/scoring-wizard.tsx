'use client'

import { useState, useCallback } from 'react'
import { ArrowRight, Loader2, Camera, Upload, CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ScoringForm } from './scoring-form'
import { IntakeQualityDisplay } from './intake-quality-display'
import { PhotoGridUploader, type GridImage } from './photo-grid-uploader'
import { EditableImageCarousel } from './editable-image-carousel'
import { ScanModePanel } from '@/components/scanning/scan-mode-panel'
import { computeIntakeQuality, type IntakeQualityAssessment } from '@/lib/scoring/intake-quality'
import { buildCaptureQualitySummary, type CaptureAngle } from '@/lib/scoring/capture-quality'
import { buildReferenceModeSummary } from '@/lib/scoring/reference-mode'
import { summarizeDiagnostics, type ImageDiagnostics, type ImageDiagnosticsSummary } from '@/lib/scoring/image-diagnostics'
import { preprocessImage } from '@/lib/scoring/image-preprocessor'
import type { ScoringResult, ScoringFormData, AngleType, IntakeQualitySummary } from '@/lib/types'
import type { ScanAngle } from '@/lib/capture/scan-session'
import { toast } from 'sonner'

type ScoreInputMode = 'upload' | 'scan'

interface CapturedImage {
  id: string
  url: string
  file?: File
  angleType: AngleType
  width: number
  height: number
}

interface ScoringWizardProps {
  initialMode: 'camera' | 'upload'
  userId?: string | null
  onComplete: (result: ScoringResult, formData: ScoringFormData) => void
}

export function ScoringWizard({ initialMode: _initialMode, userId, onComplete }: ScoringWizardProps) {
  const [inputMode, setInputMode] = useState<ScoreInputMode>('upload')
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [gridImages, setGridImages] = useState<GridImage[]>([])
  const [selectedImageAngles, setSelectedImageAngles] = useState<(CaptureAngle | null)[]>([])
  const [formData, setFormData] = useState<ScoringFormData | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [intakeQuality, setIntakeQuality] = useState<IntakeQualityAssessment | null>(null)
  const [imageDiagnostics, setImageDiagnostics] = useState<ImageDiagnostics[]>([])
  const [imageDiagnosticsSummary, setImageDiagnosticsSummary] = useState<ImageDiagnosticsSummary | null>(null)

  // Normalise GridImage[] → CapturedImage[] for the pipeline
  const toCapturedImages = (imgs: GridImage[]): CapturedImage[] =>
    imgs.map(({ id, url, file, angleType, width, height }) => ({
      id, url, file, angleType, width, height,
    }))

  // Recompute intake quality whenever grid changes
  const updateIntakeQuality = useCallback((imgs: GridImage[], earsVisible?: boolean, sourceType?: string) => {
    if (imgs.length === 0) { setIntakeQuality(null); return }
    const assessment = computeIntakeQuality({
      images: imgs.map(img => ({ angleType: img.angleType, width: img.width, height: img.height })),
      earsFullyVisible: earsVisible,
      sourceType: sourceType as any,
    })
    setIntakeQuality(assessment)
  }, [])

  const handleGridChange = useCallback((imgs: GridImage[]) => {
    setGridImages(imgs)
    if (imgs.length > 0) setDetailsOpen(true)
    setSelectedImageAngles(prev => {
      const updated = [...prev]
      while (updated.length < imgs.length) updated.push(null)
      return updated.slice(0, imgs.length)
    })
    updateIntakeQuality(imgs)
  }, [updateIntakeQuality])

  // Handle scan mode files ready
  const handleScanFilesReady = useCallback(async (files: File[], angles: ScanAngle[]) => {
    const scanImages: GridImage[] = []
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const angle = angles[i]
      
      // Convert File to data URL for preview
      const url = await new Promise<string>((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.readAsDataURL(file)
      })
      
      // Get image dimensions
      const { width, height } = await new Promise<{ width: number; height: number }>((resolve) => {
        const img = new Image()
        img.onload = () => resolve({ width: img.width, height: img.height })
        img.src = url
      })
      
      // Map scan angle to grid slot
      const slotKey = angle === 'front' ? 'front_center' : angle === 'left' ? 'left_side' : 'right_side'
      
      scanImages.push({
        id: `scan-${angle}-${Date.now()}`,
        url,
        file,
        slotKey: slotKey as any,
        angleType: angle,
        width,
        height,
      })
    }
    
    setGridImages(scanImages)
    setSelectedImageAngles(angles.map(a => a as CaptureAngle))
    updateIntakeQuality(scanImages, undefined, 'live_deer')
    setDetailsOpen(true)
  }, [updateIntakeQuality])

  const images = toCapturedImages(gridImages)

  const handleFormSubmit = (data: ScoringFormData) => {
    setFormData(data)
    handleAnalyze(data)
  }

  const handleAnalyze = async (data: ScoringFormData) => {
    // Re-compute intake quality with form data
    const finalQuality = computeIntakeQuality({
      images: gridImages.map(img => ({
        angleType: img.angleType,
        width: img.width,
        height: img.height,
      })),
      earsFullyVisible: data.ears_fully_visible,
      sourceType: data.source_type,
      captureDevice: data.capture_device,
    })
    setIntakeQuality(finalQuality)
    setIsAnalyzing(true)

    try {
      // Prepare form data for API
      const apiFormData = new FormData()
      apiFormData.append('state', data.state)
      apiFormData.append('rack_type', data.rack_type)
      if (data.harvest_method) apiFormData.append('harvest_method', data.harvest_method)
      if (data.source_type) apiFormData.append('source_type', data.source_type)
      if (data.capture_device) apiFormData.append('capture_device', data.capture_device)
      if (data.harvest_year !== undefined) apiFormData.append('harvest_year', String(data.harvest_year))
      if (data.main_frame_points !== undefined) apiFormData.append('main_frame_points', String(data.main_frame_points))
      if (data.ears_fully_visible !== undefined) {
        apiFormData.append('ears_fully_visible', String(data.ears_fully_visible))
      }
      if (data.notes) apiFormData.append('notes', data.notes)
      
      // Phase 54: Abnormal/Irregular Points
      if (data.irregular_points_present) apiFormData.append('irregular_points_present', data.irregular_points_present)
      if (data.non_typical_traits_present) apiFormData.append('non_typical_traits_present', data.non_typical_traits_present)
      if (data.estimated_irregular_points_count !== undefined) {
        apiFormData.append('estimated_irregular_points_count', String(data.estimated_irregular_points_count))
      }
      if (data.abnormal_point_notes) apiFormData.append('abnormal_point_notes', data.abnormal_point_notes)
      if (data.abnormal_point_tags?.length) {
        apiFormData.append('abnormal_point_tags', JSON.stringify(data.abnormal_point_tags))
      }
      
      // Pass authenticated user ID for notifications
      if (userId) apiFormData.append('user_id', userId)

      // Include intake quality summary
      if (finalQuality) {
        const qualitySummary: IntakeQualitySummary = {
          tier: finalQuality.tier,
          overallScore: finalQuality.overallScore,
          strongestFactors: finalQuality.strongestFactors,
          weakestFactors: finalQuality.weakestFactors,
          confidenceAdjustment: finalQuality.confidenceAdjustment,
          errorBandWidening: finalQuality.errorBandWidening,
          recommendations: finalQuality.recommendations,
          summary: finalQuality.summary,
        }
        apiFormData.append('intake_quality', JSON.stringify(qualitySummary))
      }

      // Include capture quality (angle coverage check)
      const captureQuality = buildCaptureQualitySummary({
        images: gridImages.map(img => ({ name: `Image ${img.id}` })),
        selectedAngles: selectedImageAngles.map(a => a ?? undefined),
      })
      apiFormData.append('selected_image_angles', JSON.stringify(selectedImageAngles))
      apiFormData.append('capture_quality_summary', JSON.stringify({
        coverage: captureQuality.coverage,
        recommendation: captureQuality.recommendation,
        recommendationReason: captureQuality.recommendationReason,
      }))

      // Include precision mode metadata
      if (data.precision_mode_enabled) {
        const referenceModeSummary = buildReferenceModeSummary({
          precisionModeEnabled: data.precision_mode_enabled,
          referenceType: data.reference_type,
          referenceNotes: data.reference_notes,
        })
        apiFormData.append('precision_mode_enabled', String(data.precision_mode_enabled))
        apiFormData.append('reference_type', data.reference_type ?? 'none')
        if (data.reference_notes) apiFormData.append('reference_notes', data.reference_notes)
        apiFormData.append('reference_mode_summary', JSON.stringify(referenceModeSummary))
      }

      // Include image diagnostics (quality analysis)
      if (imageDiagnostics.length > 0) {
        apiFormData.append('image_diagnostics', JSON.stringify(imageDiagnostics))
      }
      if (imageDiagnosticsSummary) {
        apiFormData.append('image_diagnostics_summary', JSON.stringify(imageDiagnosticsSummary))
      }

      // Preprocess and add images (resize + compress to reduce payload)
      for (let index = 0; index < images.length; index++) {
        const img = images[index]
        try {
          // Get source - either file or data URL
          const source = img.file || img.url
          
          // Preprocess: resize to max 1200px, JPEG quality 0.7 to reduce payload
          const processed = await preprocessImage(source, {
            maxDimension: 1200,
            quality: 0.7,
          })
          
          // Send as data URL (smaller than raw file for large images)
          apiFormData.append(`image_data_${index}`, processed.dataUrl)
          apiFormData.append(`angle_${index}`, img.angleType)
        } catch (preprocessError) {
          console.error(`Failed to preprocess image ${index}:`, preprocessError)
          // Fallback to original if preprocessing fails
          if (img.file) {
            apiFormData.append(`image_${index}`, img.file)
          } else {
            apiFormData.append(`image_url_${index}`, img.url)
          }
          apiFormData.append(`angle_${index}`, img.angleType)
        }
      }

      const response = await fetch('/api/score', {
        method: 'POST',
        body: apiFormData,
      })

      if (!response.ok) {
        const rawText = await response.text()
        let errorMessage = 'Scoring failed'

        try {
          const errorJson = JSON.parse(rawText)
          // Prefer userMessage (user-friendly) over error (generic), include details if available
          errorMessage = errorJson.userMessage || errorJson.details || errorJson.error || JSON.stringify(errorJson)
        } catch {
          errorMessage = rawText || 'Scoring failed'
        }

        console.error('Scoring API error:', errorMessage, 'Raw:', rawText)
        throw new Error(errorMessage)
      }

      const result: ScoringResult = await response.json()
      onComplete(result, data)
    } catch (error) {
      console.error('Scoring error:', error)
      toast.error('Analysis failed. Please try again.')
    } finally {
      setIsAnalyzing(false)
    }
  }

  const canSubmit = gridImages.length >= 1 && (intakeQuality?.canProceed ?? true)
  const captureQuality = gridImages.length > 0
    ? buildCaptureQualitySummary({
        images: gridImages.map(img => ({ name: `Image ${img.id}` })),
        selectedAngles: selectedImageAngles.map(a => a ?? undefined),
      })
    : null

  if (isAnalyzing) {
    return (
      <div className="max-w-2xl mx-auto">
        <Card>
          <CardContent className="py-20">
            <div className="flex flex-col items-center justify-center text-center gap-4">
              <Loader2 className="h-12 w-12 animate-spin text-primary" />
              <div>
                <h3 className="text-lg font-semibold">Analyzing Your Buck</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Detecting landmarks and calculating measurements...
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto pb-28 space-y-4">

      {/* ── Photos section ───────────────────────────────────────────────── */}
      <Card>
        <CardContent className="pt-5 space-y-4">

          {/* Mode pill toggle */}
          <div className="flex gap-1.5 p-1 bg-secondary/60 rounded-xl border border-border/40">
            <button
              type="button"
              onClick={() => setInputMode('upload')}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-all touch-manipulation ${
                inputMode === 'upload'
                  ? 'bg-card text-foreground shadow-sm border border-border/60'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Upload className="h-3.5 w-3.5" />
              Upload
            </button>
            <button
              type="button"
              onClick={() => setInputMode('scan')}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-all touch-manipulation ${
                inputMode === 'scan'
                  ? 'bg-card text-foreground shadow-sm border border-border/60'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Camera className="h-3.5 w-3.5" />
              Scan Rack
              <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-primary/15 text-primary font-semibold leading-none">
                Best
              </span>
            </button>
          </div>

          {inputMode === 'upload' && (
            <PhotoGridUploader images={gridImages} onChange={handleGridChange} />
          )}

          {inputMode === 'scan' && (
            <ScanModePanel onFilesReady={handleScanFilesReady} />
          )}

          {/* Coverage chips */}
          {inputMode === 'upload' && gridImages.length > 0 && captureQuality && (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {[
                  { label: 'Front', ok: captureQuality.coverage.hasFront },
                  { label: 'Left',  ok: captureQuality.coverage.hasLeft  },
                  { label: 'Right', ok: captureQuality.coverage.hasRight },
                ].map(({ label, ok }) => (
                  <span
                    key={label}
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium border ${
                      ok
                        ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/40'
                        : 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800/40'
                    }`}
                  >
                    <CheckCircle2 className={`h-3 w-3 ${ok ? 'opacity-100' : 'opacity-30'}`} />
                    {label}
                  </span>
                ))}
                <span className="inline-flex items-center rounded-full px-2.5 py-1 text-xs text-muted-foreground border border-border/40">
                  {captureQuality.coverage.coverageLabel}
                </span>
              </div>
              {captureQuality.recommendation === 'needs_better_photos' && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Weak angle coverage — results may be less accurate.
                </p>
              )}
            </div>
          )}

          {/* Intake quality display */}
          {inputMode === 'upload' && intakeQuality && gridImages.length > 0 && (
            <IntakeQualityDisplay
              quality={{
                tier: intakeQuality.tier,
                overallScore: intakeQuality.overallScore,
                strongestFactors: intakeQuality.strongestFactors,
                weakestFactors: intakeQuality.weakestFactors,
                confidenceAdjustment: intakeQuality.confidenceAdjustment,
                errorBandWidening: intakeQuality.errorBandWidening,
                recommendations: intakeQuality.recommendations,
                summary: intakeQuality.summary,
              }}
              showRecommendations={false}
              compact={true}
              onAddPhoto={() => toast.info('Tap "Add more" to upload another photo')}
            />
          )}
        </CardContent>
      </Card>

      {/* ── Editable carousel ───────────────────────────────────────────── */}
      {gridImages.length > 0 && (
        <EditableImageCarousel
          images={gridImages}
          onImageEdit={(index, newUrl) => {
            setGridImages(prev => prev.map((img, i) =>
              i === index ? { ...img, url: newUrl, file: undefined } : img
            ))
          }}
        />
      )}

      {/* ── Buck Details (collapsible) ───────────────────────────────────── */}
      <Card>
        <button
          type="button"
          onClick={() => setDetailsOpen(v => !v)}
          className="w-full flex items-center justify-between px-5 py-4 text-left touch-manipulation"
          aria-expanded={detailsOpen}
        >
          <div className="flex items-center gap-2.5">
            <span className="text-sm font-semibold">Buck Details</span>
            {gridImages.length > 0 && !detailsOpen && (
              <span className="text-xs text-muted-foreground font-normal">
                tap to improve accuracy
              </span>
            )}
          </div>
          {detailsOpen
            ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
            : <ChevronDown className="h-4 w-4 text-muted-foreground" />
          }
        </button>

        {detailsOpen && (
          <CardContent className="pt-0">
            <ScoringForm
              onSubmit={handleFormSubmit}
              onBack={() => setDetailsOpen(false)}
              isSubmitting={isAnalyzing}
              hideBackButton
              hideSubmitButton
              onImageDiagnosticsComputed={(diags, summary) => {
                setImageDiagnostics(diags)
                setImageDiagnosticsSummary(summary)
              }}
            />
          </CardContent>
        )}
      </Card>

      {/* ── Sticky bottom CTA ───────────────────────────────────────────── */}
      <div className="fixed bottom-0 inset-x-0 z-40 bg-background/90 backdrop-blur-sm border-t border-border/50">
        <div className="max-w-2xl mx-auto px-4 py-3">
          <Button
            form="scoring-details-form"
            type="submit"
            size="lg"
            className="w-full min-h-[52px] text-base font-semibold gap-2 rounded-2xl"
            disabled={!canSubmit || isAnalyzing}
            onClick={(e) => {
              if (!detailsOpen) {
                e.preventDefault()
                handleFormSubmit({} as any)
              }
            }}
          >
            Analyze Buck
            <ArrowRight className="h-5 w-5" />
          </Button>
        </div>
      </div>
    </div>
  )
}
