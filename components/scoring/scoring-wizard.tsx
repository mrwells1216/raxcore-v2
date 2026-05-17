'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { ArrowRight, Loader2, Camera, Upload, CheckCircle2, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ScoringForm, type ScoringFormHandle } from './scoring-form'
import { ScanValidationBanner } from './ScanValidationBanner'
import { IntakeQualityDisplay } from './intake-quality-display'
import { PhotoGridUploader, type GridImage } from './photo-grid-uploader'
import { GuidedUploadPanel } from './guided-upload-panel'
import { EditableImageCarousel } from './editable-image-carousel'
import { AntlerCropBox, type CropRegion } from './antler-crop-box'
import { ScanModePanel } from '@/components/scanning/scan-mode-panel'
import { computeIntakeQuality, type IntakeQualityAssessment } from '@/lib/scoring/intake-quality'
import { buildCaptureQualitySummary, type CaptureAngle } from '@/lib/scoring/capture-quality'
import { resolveImageRoles } from '@/lib/scoring/resolve-image-roles'
import { buildReferenceModeSummary } from '@/lib/scoring/reference-mode'
import { summarizeDiagnostics, type ImageDiagnostics, type ImageDiagnosticsSummary } from '@/lib/scoring/image-diagnostics'
import { preprocessImage } from '@/lib/scoring/image-preprocessor'
import { validateSubject, canProceedToScoring, mapScanAngleToSection } from '@/lib/capture/subject-validation'
import type { SubjectValidationResult } from '@/lib/capture/subject-validation'
import { detectionToScanFeedback } from '@/lib/detection/detection-to-scan-feedback'
import type { ScanFeedback } from '@/lib/detection/detection-to-scan-feedback'
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

export function ScoringWizard({ initialMode, userId, onComplete }: ScoringWizardProps) {
  const scoringFormRef = useRef<ScoringFormHandle>(null)
  const [inputMode, setInputMode] = useState<ScoreInputMode>(
    initialMode === 'upload' ? 'guided-upload' : 'smart-scan',
  )
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [gridImages, setGridImages] = useState<GridImage[]>([])
  const [selectedImageAngles, setSelectedImageAngles] = useState<(CaptureAngle | null)[]>([])
  const [formData, setFormData] = useState<ScoringFormData | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [intakeQuality, setIntakeQuality] = useState<IntakeQualityAssessment | null>(null)
  const [imageDiagnostics, setImageDiagnostics] = useState<ImageDiagnostics[]>([])
  const [imageDiagnosticsSummary, setImageDiagnosticsSummary] = useState<ImageDiagnosticsSummary | null>(null)
  const [captureValidation, setCaptureValidation] = useState<SubjectValidationResult | null>(null)
  const [scanFeedback, setScanFeedback] = useState<ScanFeedback | null>(null)
  const [isDetecting, setIsDetecting] = useState(false)
  const [bannerDismissed, setBannerDismissed] = useState(false)
  const [cropRegions, setCropRegions] = useState<Record<number, CropRegion | null>>({})
  const [cropSkipped, setCropSkipped] = useState<Record<number, boolean>>({})
  const detectDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  // Client-side subject validation — runs instantly on image set change
  const runCaptureValidation = useCallback((imgs: GridImage[], coverage: { hasFront: boolean; hasLeft: boolean; hasRight: boolean }) => {
    if (imgs.length === 0) { setCaptureValidation(null); return }
    const result = validateSubject({
      imageCount: imgs.length,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      declaredSections: imgs.map(img => mapScanAngleToSection(img.angleType as any)),
      isSmartScanMode: inputMode === 'smart-scan',
      coverageZones: {
        full_rack: coverage.hasFront,
        left_antler: coverage.hasLeft,
        right_antler: coverage.hasRight,
      },
    })
    setCaptureValidation(result)
    setBannerDismissed(false)
  }, [inputMode])

  // Async detection pre-check — debounced 800ms, non-blocking
  useEffect(() => {
    if (gridImages.length === 0) {
      setScanFeedback(null)
      setIsDetecting(false)
      return
    }

    if (detectDebounceRef.current) clearTimeout(detectDebounceRef.current)

    detectDebounceRef.current = setTimeout(async () => {
      setIsDetecting(true)
      try {
        const fd = new FormData()
        for (let i = 0; i < gridImages.length; i++) {
          const img = gridImages[i]
          // Only send data URLs (preprocessed); skip non-data-URL entries
          if (img.url.startsWith('data:')) {
            fd.append(`image_data_${i}`, img.url)
          } else if (img.file) {
            // Convert File to data URL for the detect endpoint
            const dataUrl = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader()
              reader.onload = () => resolve(reader.result as string)
              reader.onerror = reject
              reader.readAsDataURL(img.file!)
            })
            fd.append(`image_data_${i}`, dataUrl)
          }
        }

        const resp = await fetch('/api/detect', { method: 'POST', body: fd })
        if (!resp.ok) throw new Error('Detection request failed')
        const result = await resp.json()
        setScanFeedback(detectionToScanFeedback(result))
        setBannerDismissed(false)
      } catch {
        // Degrade silently — never block submit due to pre-check failure
        setScanFeedback(null)
      } finally {
        setIsDetecting(false)
      }
    }, 800)

    return () => {
      if (detectDebounceRef.current) clearTimeout(detectDebounceRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridImages])

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
      const cq = imgs.length > 0
        ? buildCaptureQualitySummary({
            images: imgs.map(img => ({ name: img.id })),
            selectedAngles: imgs.map(img => img.angleType as CaptureAngle),
          })
        : null
      runCaptureValidation(imgs, {
        hasFront: cq?.coverage.hasFront ?? false,
        hasLeft: cq?.coverage.hasLeft ?? false,
        hasRight: cq?.coverage.hasRight ?? false,
      })
    })
  }, [updateIntakeQuality, runCaptureValidation])

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
        id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `scan-${angle}-${Date.now()}-${i}`,
        url,
        file,
        slotKey: slotKey as any,
        angleType: angle as AngleType,
        width,
        height,
        group: null,
      })
    }

    setGridImages(scanImages)
    setSelectedImageAngles(angles.map(a => a as CaptureAngle))
    updateIntakeQuality(scanImages)
    const cq = buildCaptureQualitySummary({
      images: scanImages.map(img => ({ name: img.id })),
      selectedAngles: angles.map(a => a as CaptureAngle),
    })
    runCaptureValidation(scanImages, {
      hasFront: cq.coverage.hasFront,
      hasLeft: cq.coverage.hasLeft,
      hasRight: cq.coverage.hasRight,
    })
    setDetailsOpen(true)
  }, [updateIntakeQuality, runCaptureValidation])

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
      apiFormData.append('state', data.state ?? '')
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

      // Resolve capture angles: use explicit UI selection when available, fall
      // back to the image's own angleType, then fill any remaining unknowns
      // with unclaimed canonical roles (front → left → right).  This ensures
      // the capture-quality summary never sends [null, null, null] even when
      // the user has not explicitly labelled each photo.
      const resolvedCaptureAngles = resolveImageRoles(
        gridImages.map((img, index) => ({
          angleType: selectedImageAngles[index] ?? (img.angleType as CaptureAngle),
        })),
      ).map((entry) => entry.resolvedAngle as CaptureAngle)

      const captureQuality = buildCaptureQualitySummary({
        images: gridImages.map(img => ({ name: `Image ${img.id}` })),
        selectedAngles: resolvedCaptureAngles,
      })
      apiFormData.append('selected_image_angles', JSON.stringify(resolvedCaptureAngles))
      apiFormData.append('capture_quality_summary', JSON.stringify({
        coverage: captureQuality.coverage,
        recommendation: captureQuality.recommendation,
        recommendationReason: captureQuality.recommendationReason,
      }))

      if (data.precision_mode_enabled) {
        const precisionRefType = (data.reference_type === 'wedding_ring' || data.reference_type === 'hat')
          ? 'none' as const
          : data.reference_type
        const referenceModeSummary = buildReferenceModeSummary({
          precisionModeEnabled: data.precision_mode_enabled,
          referenceType: precisionRefType,
          referenceNotes: data.reference_notes,
          referenceSizeValue: data.reference_size_value,
          referenceSizeUnit: data.reference_size_unit,
          referencePlacement: data.reference_placement,
        })
        apiFormData.append('precision_mode_enabled', String(data.precision_mode_enabled))
        apiFormData.append('reference_type', data.reference_type ?? 'none')
        if (data.reference_notes) apiFormData.append('reference_notes', data.reference_notes)
        if (data.reference_size_value !== undefined) {
          apiFormData.append('reference_size_value', String(data.reference_size_value))
        }
        if (data.reference_size_unit) {
          apiFormData.append('reference_size_unit', data.reference_size_unit)
        }
        if (data.reference_placement) {
          apiFormData.append('reference_placement', data.reference_placement)
        }
        apiFormData.append('reference_mode_summary', JSON.stringify(referenceModeSummary))
        if (data.reference_ring_size_us != null) {
          apiFormData.append('reference_ring_size_us', String(data.reference_ring_size_us))
        }
        if (data.reference_hat_type) {
          apiFormData.append('reference_hat_type', data.reference_hat_type)
        }
      }

      if (imageDiagnostics.length > 0) {
        apiFormData.append('image_diagnostics', JSON.stringify(imageDiagnostics))
      }
      if (imageDiagnosticsSummary) {
        apiFormData.append('image_diagnostics_summary', JSON.stringify(imageDiagnosticsSummary))
      }

      // Ring reference (optional)
      if (data.reference_object) {
        apiFormData.append('reference_object', JSON.stringify(data.reference_object))
      }

      // Antler crop regions — null where the user skipped that image
      const cropRegionsPayload: Record<string, CropRegion | null> = {}
      for (let index = 0; index < images.length; index++) {
        const region = cropRegions[index]
        const skipped = cropSkipped[index]
        cropRegionsPayload[String(index)] = skipped || !region ? null : region
      }
      apiFormData.append('crop_regions', JSON.stringify(cropRegionsPayload))

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

  const canSubmit =
    gridImages.length >= 1 &&
    (intakeQuality?.canProceed ?? true) &&
    (captureValidation ? canProceedToScoring(captureValidation) : true)

  const displayCaptureAngles = gridImages.length > 0
    ? resolveImageRoles(
        gridImages.map((img, index) => ({
          angleType: selectedImageAngles[index] ?? (img.angleType as CaptureAngle),
        })),
      ).map((entry) => entry.resolvedAngle as CaptureAngle)
    : []

  const captureQuality = gridImages.length > 0
    ? buildCaptureQualitySummary({
        images: gridImages.map(img => ({ name: `Image ${img.id}` })),
        selectedAngles: displayCaptureAngles,
      })
    : null

  // ── Analyzing state ─────────────────────────────────────────────────────────
  if (isAnalyzing) {
    return (
      <div className="max-w-2xl mx-auto px-4 pt-6">
        <div 
          className="relative rounded-xl p-12 flex flex-col items-center justify-center text-center gap-6 overflow-hidden"
          style={{
            border: '1px solid var(--bronze-dark)',
            background: 'linear-gradient(180deg, rgba(28,24,20,0.98) 0%, rgba(22,20,18,1) 100%)',
            boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
          }}
        >
          {/* Scan line effect */}
          <div className="scan-effect absolute inset-0 overflow-hidden pointer-events-none" />
          
          {/* Spinner */}
          <div className="relative">
            <div 
              className="h-20 w-20 rounded-full flex items-center justify-center"
              style={{
                background: 'linear-gradient(145deg, var(--bronze-mid), var(--bronze-dark))',
                boxShadow: '0 4px 16px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,200,100,0.2)',
              }}
            >
              <Loader2 className="h-9 w-9 animate-spin" style={{ color: '#0d0a06' }} />
            </div>
          </div>
          
          <div className="space-y-2 relative z-10">
            <h3 
              className="text-lg font-bold tracking-wider"
              style={{ color: 'var(--bronze-light)' }}
            >
              Analyzing Your Buck
            </h3>
            <p className="text-sm text-muted-foreground">
              Detecting landmarks and calculating measurements...
            </p>
          </div>
          
          {/* Corner marks */}
          <div className="corner-marks absolute inset-0 pointer-events-none" />
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
            label="Guided Camera"
            badge="Manual"
          />
          <ModeTab
            active={inputMode === 'guided-upload'}
            onClick={() => setInputMode('guided-upload')}
            icon={<Upload className="h-3.5 w-3.5" />}
            label="Guided Upload"
          />
        </div>
      </Section>

      {/* ── 2. Photo upload / scan ──────���────────────────────────────────── */}
      <Section label={inputMode === 'smart-scan' ? 'Guided Camera Capture' : 'Add Photos'}>
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

      {/* ── 5a. Antler crop boxes (optional, per image) ─────────────────── */}
      {gridImages.length > 0 && (
        <Section label="Crop to Antlers (Optional)">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] font-mono text-muted-foreground">
                Tighten the amber box around each rack to give the AI 4–8× more detail.
                Each photo is independent — skip any you don&apos;t want to crop.
              </p>
              <button
                type="button"
                onClick={() => {
                  const skipAll: Record<number, boolean> = {}
                  for (let i = 0; i < gridImages.length; i++) skipAll[i] = true
                  setCropSkipped(skipAll)
                }}
                className="shrink-0 text-[10px] font-black tracking-widest uppercase text-muted-foreground hover:text-foreground"
              >
                Skip all crops
              </button>
            </div>

            <div className="space-y-4">
              {gridImages.map((img, index) => (
                <AntlerCropBox
                  key={img.id}
                  imageUrl={img.url}
                  region={cropRegions[index] ?? null}
                  skipped={!!cropSkipped[index]}
                  label={`Photo ${index + 1} — ${img.angleType}`}
                  onChange={(region) => {
                    setCropRegions(prev => ({ ...prev, [index]: region }))
                  }}
                  onSkip={() => {
                    setCropSkipped(prev => ({ ...prev, [index]: true }))
                  }}
                  onUnskip={() => {
                    setCropSkipped(prev => {
                      const next = { ...prev }
                      delete next[index]
                      return next
                    })
                  }}
                />
              ))}
            </div>
          </div>
        </Section>
      )}

      {/* ── 5b. Scan validation banner ──────────────────────────────────── */}
      {gridImages.length > 0 && !bannerDismissed && (
        <Section>
          <ScanValidationBanner
            validation={captureValidation}
            feedback={scanFeedback}
            checking={isDetecting && !scanFeedback}
            onDismiss={() => setBannerDismissed(true)}
          />
        </Section>
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
                    reference_size_value: undefined,
                    reference_size_unit: 'in',
                    reference_placement: 'unknown',
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
