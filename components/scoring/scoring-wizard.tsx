'use client'

import { useState, useCallback, useRef } from 'react'
import { ArrowRight, Loader2, Camera, Upload, CheckCircle2, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ScoringForm, type ScoringFormHandle } from './scoring-form'
import { IntakeQualityDisplay } from './intake-quality-display'
import { PhotoGridUploader, type GridImage } from './photo-grid-uploader'
import { GuidedUploadPanel } from './guided-upload-panel'
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

type ScoreInputMode = 'guided-upload' | 'smart-scan'

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
  const scoringFormRef = useRef<ScoringFormHandle>(null)
  const [inputMode, setInputMode] = useState<ScoreInputMode>('smart-scan')
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [gridImages, setGridImages] = useState<GridImage[]>([])
  const [selectedImageAngles, setSelectedImageAngles] = useState<(CaptureAngle | null)[]>([])
  const [formData, setFormData] = useState<ScoringFormData | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [intakeQuality, setIntakeQuality] = useState<IntakeQualityAssessment | null>(null)
  const [imageDiagnostics, setImageDiagnostics] = useState<ImageDiagnostics[]>([])
  const [imageDiagnosticsSummary, setImageDiagnosticsSummary] = useState<ImageDiagnosticsSummary | null>(null)

  const toCapturedImages = (imgs: GridImage[]): CapturedImage[] =>
    imgs.map(({ id, url, file, angleType, width, height }) => ({
      id, url, file, angleType, width, height,
    }))

  // Validate image set before scoring
  function validateImageSet(images: GridImage[]) {
    if (!images.length) {
      throw new Error('No images uploaded')
    }

    const hasFullRack = images.some(img => img.angleType === 'front')

    if (!hasFullRack) {
      throw new Error('At least one full rack (front) image is required')
    }

    return true
  }

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
    // Use requestAnimationFrame to avoid setState during render chain
    requestAnimationFrame(() => {
      setGridImages(imgs)
      if (imgs.length > 0) setDetailsOpen(true)
      setSelectedImageAngles(prev => {
        const updated = [...prev]
        while (updated.length < imgs.length) updated.push(null)
        return updated.slice(0, imgs.length)
      })
      updateIntakeQuality(imgs)
    })
  }, [updateIntakeQuality])

  const handleScanFilesReady = useCallback(async (files: File[], angles: ScanAngle[]) => {
    const scanImages: GridImage[] = []

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const angle = angles[i]

      const url = await new Promise<string>((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.readAsDataURL(file)
      })

      const { width, height } = await new Promise<{ width: number; height: number }>((resolve) => {
        const img = new Image()
        img.onload = () => resolve({ width: img.width, height: img.height })
        img.src = url
      })

      const slotKey = angle === 'front' ? 'front_center' : angle === 'left' ? 'left_side' : 'right_side'

      scanImages.push({
        id: `scan-${angle}-${Date.now()}`,
        url,
        file,
        slotKey: slotKey as any,
        angleType: angle,
        width,
        height,
        group: null,
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
    // Validate images before proceeding
    try {
      validateImageSet(gridImages)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Invalid images')
      return
    }

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

      if (data.irregular_points_present) apiFormData.append('irregular_points_present', data.irregular_points_present)
      if (data.non_typical_traits_present) apiFormData.append('non_typical_traits_present', data.non_typical_traits_present)
      if (data.estimated_irregular_points_count !== undefined) {
        apiFormData.append('estimated_irregular_points_count', String(data.estimated_irregular_points_count))
      }
      if (data.abnormal_point_notes) apiFormData.append('abnormal_point_notes', data.abnormal_point_notes)
      if (data.abnormal_point_tags?.length) {
        apiFormData.append('abnormal_point_tags', JSON.stringify(data.abnormal_point_tags))
      }

      if (userId) apiFormData.append('user_id', userId)

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

      if (imageDiagnostics.length > 0) {
        apiFormData.append('image_diagnostics', JSON.stringify(imageDiagnostics))
      }
      if (imageDiagnosticsSummary) {
        apiFormData.append('image_diagnostics_summary', JSON.stringify(imageDiagnosticsSummary))
      }

      for (let index = 0; index < images.length; index++) {
        const img = images[index]
        try {
          const source = img.file || img.url
          const processed = await preprocessImage(source, {
            maxDimension: 1200,
            quality: 0.7,
          })
          apiFormData.append(`image_data_${index}`, processed.dataUrl)
          apiFormData.append(`angle_${index}`, img.angleType)
        } catch (preprocessError) {
          console.error(`Failed to preprocess image ${index}:`, preprocessError)
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

  // ── Analyzing state ─────────────────────────────────────────────────────────
  if (isAnalyzing) {
    return (
      <div className="max-w-2xl mx-auto px-4 pt-6">
        <div className="rounded-2xl border border-border/60 bg-card p-10 flex flex-col items-center justify-center text-center gap-5">
          <div className="relative">
            <div className="h-16 w-16 rounded-full border-2 border-primary/20 flex items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          </div>
          <div className="space-y-1.5">
            <h3 className="text-base font-semibold">Analyzing Your Buck</h3>
            <p className="text-sm text-muted-foreground">
              Detecting landmarks and calculating measurements...
            </p>
          </div>
        </div>
      </div>
    )
  }

  // ── Main flow ───────────────────────────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto pb-32 space-y-3">

      {/* ── 1. Mode selector ────────────────────────────────────────────── */}
      <Section>
        <div
          className="flex gap-1 p-1 rounded"
          style={{
            background: '#131110',
            border: '1px solid var(--bronze-dark)',
            boxShadow: 'inset 0 2px 5px rgba(0,0,0,0.55), inset 0 -1px 0 rgba(212,168,75,0.06)',
          }}
        >
          <ModeTab
            active={inputMode === 'smart-scan'}
            onClick={() => setInputMode('smart-scan')}
            icon={<Camera className="h-3.5 w-3.5" />}
            label="Smart Scan"
            badge="Best"
          />
          <ModeTab
            active={inputMode === 'guided-upload'}
            onClick={() => setInputMode('guided-upload')}
            icon={<Upload className="h-3.5 w-3.5" />}
            label="Guided Upload"
          />
        </div>
      </Section>

      {/* ── 2. Photo upload / scan ───────────────────────────────────────── */}
      <Section label={inputMode === 'smart-scan' ? 'Capture' : 'Add Photos'}>
        {inputMode === 'guided-upload' && (
          <GuidedUploadPanel onChange={handleGridChange} initialImages={gridImages} />
        )}
        {inputMode === 'smart-scan' && (
          <ScanModePanel
            onFilesReady={handleScanFilesReady}
            onFallbackToUpload={() => setInputMode('guided-upload')}
          />
        )}
      </Section>

      {/* ── 3. Capture quality feedback (guided upload mode only) ──────── */}
      {inputMode === 'guided-upload' && gridImages.length > 0 && captureQuality && (
        <Section label="Coverage">
          <div className="space-y-3">
            {/* Coverage meter */}
            <div className="flex items-center gap-3">
              {[
                { label: 'Front', ok: captureQuality.coverage.hasFront },
                { label: 'Left',  ok: captureQuality.coverage.hasLeft  },
                { label: 'Right', ok: captureQuality.coverage.hasRight },
              ].map(({ label, ok }) => (
                <div key={label} className="flex-1 flex flex-col items-center gap-1.5">
                  <div className={cn(
                    'w-full h-1.5 rounded-full',
                    ok ? 'bg-primary' : 'bg-border'
                  )} />
                  <div className="flex items-center gap-1">
                    <CheckCircle2 className={cn(
                      'h-3 w-3',
                      ok ? 'text-primary' : 'text-muted-foreground/40'
                    )} />
                    <span className={cn(
                      'text-[11px] font-medium',
                      ok ? 'text-foreground' : 'text-muted-foreground'
                    )}>
                      {label}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* Overall coverage label */}
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Coverage: <span className="text-foreground font-medium">{captureQuality.coverage.coverageLabel}</span></span>
              <span>{gridImages.length} photo{gridImages.length !== 1 ? 's' : ''}</span>
            </div>

            {/* Weak coverage warning */}
            {captureQuality.recommendation === 'needs_better_photos' && (
              <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/25 bg-amber-500/8 px-3 py-2.5">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Weak angle coverage — add a front or side view for better accuracy.
                </p>
              </div>
            )}
          </div>

          {/* Intake quality */}
          {intakeQuality && (
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
        </Section>
      )}

      {/* ── 5. Editable carousel ────────────────────────────────────────── */}
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

      {/* ── 6. Scoring options (collapsible) ────────────────────────────── */}
      <div
        className="rounded overflow-hidden"
        style={{
          border: '1px solid var(--bronze-dark)',
          background: 'linear-gradient(180deg, #1e1b18 0%, #1a1714 100%)',
          boxShadow: '0 1px 0 rgba(212,168,75,0.07), 0 4px 16px rgba(0,0,0,0.35)',
        }}
      >
        <button
          type="button"
          onClick={() => setDetailsOpen(v => !v)}
          className="w-full flex items-center justify-between px-5 py-4 text-left touch-manipulation"
          aria-expanded={detailsOpen}
        >
          <div>
            <span
              className="text-[10px] font-black tracking-[0.22em] uppercase"
              style={{ color: 'var(--bronze-light)' }}
            >
              Scoring Options
            </span>
            {!detailsOpen && (
              <p className="text-[11px] font-mono text-muted-foreground mt-0.5">
                State, rack type, image context
              </p>
            )}
          </div>
          {detailsOpen
            ? <ChevronUp className="h-4 w-4" style={{ color: 'var(--bronze-mid)' }} />
            : <ChevronDown className="h-4 w-4" style={{ color: 'var(--bronze-mid)' }} />
          }
        </button>

        {detailsOpen && (
          <div
            className="px-5 pb-5"
            style={{ borderTop: '1px solid var(--bronze-dark)' }}
          >
            <ScoringForm
              ref={scoringFormRef}
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
          </div>
        )}
      </div>

      {/* ── 7. Sticky bottom CTA ────────────────────────────────────────── */}
      <div
        className="fixed bottom-0 inset-x-0 z-40 md:z-40"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div
          className="border-t"
          style={{
            background: 'linear-gradient(0deg, #1c1814 0%, #161412 100%)',
            borderColor: 'var(--bronze-dark)',
            boxShadow: '0 -1px 0 rgba(212,168,75,0.08), 0 -8px 24px rgba(0,0,0,0.55)',
          }}
        >
          {/* On mobile add space for bottom nav (56px) */}
          <div className="max-w-2xl mx-auto px-4 py-3 md:pb-3 pb-[4.75rem]">
            <button
              type="button"
              disabled={!canSubmit || isAnalyzing}
              onClick={() => {
                if (detailsOpen) {
                  scoringFormRef.current?.triggerSubmit()
                } else {
                  handleAnalyze({
                    state: '',
                    rack_type: 'typical',
                    capture_device: 'unknown',
                    ears_fully_visible: true,
                    precision_mode_enabled: false,
                    reference_type: 'none',
                    reference_notes: '',
                    abnormal_point_tags: [],
                  } as ScoringFormData)
                }
              }}
              className="w-full flex items-center justify-center gap-2.5 min-h-[52px] rounded text-sm font-black tracking-widest uppercase transition-all duration-150 touch-manipulation active:scale-[0.98]"
              style={canSubmit && !isAnalyzing ? {
                background: 'linear-gradient(180deg, var(--bronze-light) 0%, var(--bronze-mid) 55%, var(--bronze-dark) 100%)',
                color: '#161412',
                boxShadow: '0 1px 0 rgba(255,230,150,0.22) inset, 0 -1px 0 rgba(0,0,0,0.35) inset, 0 3px 14px rgba(0,0,0,0.55)',
              } : {
                background: '#252118',
                color: 'var(--muted-foreground)',
                cursor: 'not-allowed',
                boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.40)',
              }}
            >
              {isAnalyzing ? (
                <><Loader2 className="h-4 w-4 animate-spin" />Analyzing...</>
              ) : (
                <>
                  <svg viewBox="0 0 16 16" fill="none" className="h-4 w-4" aria-hidden>
                    <path d="M8 13 L6.5 9 L4 7.5 L3 5 L4.5 3 L6 5 L6.5 2.5 L5.5 1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M8 13 L9.5 9 L12 7.5 L13 5 L11.5 3 L10 5 L9.5 2.5 L10.5 1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  AI Score
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
            {!canSubmit && gridImages.length === 0 && (
              <p className="text-center text-[11px] font-mono text-muted-foreground mt-2">
                Add at least one photo to continue
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Section wrapper ─────────────────────────────────────────────────────────

function Section({
  label,
  sublabel,
  children,
}: {
  label?: string
  sublabel?: string
  children: React.ReactNode
}) {
  return (
    <div
      className="rounded overflow-hidden"
      style={{
        border: '1px solid var(--bronze-dark)',
        background: 'linear-gradient(180deg, #1e1b18 0%, #1a1714 100%)',
        boxShadow: '0 1px 0 rgba(212,168,75,0.07), 0 4px 16px rgba(0,0,0,0.35)',
      }}
    >
      {(label || sublabel) && (
        <div
          className="px-5 pt-4 pb-3"
          style={{ borderBottom: '1px solid var(--bronze-dark)' }}
        >
          {label && (
            <h2
              className="text-[10px] font-black tracking-[0.22em] uppercase"
              style={{ color: 'var(--bronze-light)' }}
            >
              {label}
            </h2>
          )}
          {sublabel && (
            <p className="text-[11px] font-mono text-muted-foreground mt-0.5">{sublabel}</p>
          )}
        </div>
      )}
      <div className={cn('px-4 pb-4', !label && !sublabel && 'pt-4')}>
        {children}
      </div>
    </div>
  )
}

// ─── Mode tab ────────────────────────────────────────────────────────────────

function ModeTab({
  active,
  onClick,
  icon,
  label,
  badge,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
  badge?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded text-xs font-black tracking-widest uppercase transition-all duration-150 touch-manipulation"
      style={active ? {
        background: 'linear-gradient(180deg, var(--bronze-light) 0%, var(--bronze-mid) 55%, var(--bronze-dark) 100%)',
        color: '#161412',
        boxShadow: '0 1px 0 rgba(255,230,150,0.22) inset, 0 -1px 0 rgba(0,0,0,0.35) inset, 0 2px 8px rgba(0,0,0,0.45)',
      } : {
        color: 'var(--muted-foreground)',
      }}
    >
      {icon}
      {label}
      {badge && (
        <span
          className="text-[9px] px-1.5 py-0.5 rounded font-bold leading-none tracking-widest"
          style={active
            ? { background: 'rgba(0,0,0,0.20)', color: '#161412' }
            : { background: 'rgba(160,120,40,0.15)', color: 'var(--bronze-mid)' }
          }
        >
          {badge}
        </span>
      )}
    </button>
  )
}
