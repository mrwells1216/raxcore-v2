'use client'

import { useState, useCallback } from 'react'
import { Camera, Upload, ArrowLeft, ArrowRight, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Progress } from '@/components/ui/progress'
import { CameraCapture } from './camera-capture'
import { ImageUploader } from './image-uploader'
import { ScoringForm } from './scoring-form'
import { ImagePreviewGrid } from './image-preview-grid'
import { ImageGuidance } from './image-guidance'
import { IntakeQualityDisplay } from './intake-quality-display'
import { computeIntakeQuality, getBestNextPhoto, type IntakeQualityAssessment } from '@/lib/scoring/intake-quality'
import { preprocessImage } from '@/lib/scoring/image-preprocessor'
import type { ScoringResult, ScoringFormData, AngleType, IntakeQualitySummary } from '@/lib/types'
import { toast } from 'sonner'

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

const STEPS = [
  { id: 'capture', title: 'Add Photos', description: 'Capture or upload images' },
  { id: 'details', title: 'Buck Details', description: 'State and rack type' },
  { id: 'analyze', title: 'Analyze', description: 'Get your score' },
]

export function ScoringWizard({ initialMode, userId, onComplete }: ScoringWizardProps) {
  const [mode, setMode] = useState<'camera' | 'upload'>(initialMode)
  const [step, setStep] = useState(0)
  const [images, setImages] = useState<CapturedImage[]>([])
  const [formData, setFormData] = useState<ScoringFormData | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [intakeQuality, setIntakeQuality] = useState<IntakeQualityAssessment | null>(null)
  const [showQualityWarning, setShowQualityWarning] = useState(false)

  // Compute intake quality whenever images change
  const updateIntakeQuality = useCallback((currentImages: CapturedImage[], earsVisible?: boolean, sourceType?: string) => {
    if (currentImages.length === 0) {
      setIntakeQuality(null)
      return
    }
    
    const assessment = computeIntakeQuality({
      images: currentImages.map(img => ({
        angleType: img.angleType,
        width: img.width,
        height: img.height,
      })),
      earsFullyVisible: earsVisible,
      sourceType: sourceType as any,
    })
    
    setIntakeQuality(assessment)
    
    // Show warning if quality is poor and user tries to proceed
    if (assessment.tier === 'poor' && currentImages.length >= 1) {
      setShowQualityWarning(true)
    }
  }, [])

  const progress = ((step + 1) / STEPS.length) * 100

  const handleImageCapture = useCallback((image: CapturedImage) => {
    setImages(prev => {
      const newImages = [...prev, image]
      updateIntakeQuality(newImages)
      return newImages
    })
    toast.success(`${image.angleType} image added`)
  }, [updateIntakeQuality])

  const handleImagesUpload = useCallback((newImages: CapturedImage[]) => {
    setImages(prev => {
      const updated = [...prev, ...newImages]
      updateIntakeQuality(updated)
      return updated
    })
    toast.success(`${newImages.length} image(s) added`)
  }, [updateIntakeQuality])

  const handleRemoveImage = useCallback((id: string) => {
    setImages(prev => {
      const updated = prev.filter(img => img.id !== id)
      updateIntakeQuality(updated)
      return updated
    })
  }, [updateIntakeQuality])

  const handleFormSubmit = (data: ScoringFormData) => {
    setFormData(data)
    handleAnalyze(data)
  }

  const handleAnalyze = async (data: ScoringFormData) => {
    // Re-compute intake quality with form data
    const finalQuality = computeIntakeQuality({
      images: images.map(img => ({
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
    setStep(2)

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
      setStep(1)
    } finally {
      setIsAnalyzing(false)
    }
  }

  const canProceedToDetails = images.length >= 1 && (intakeQuality?.canProceed ?? true)
  const bestNextPhoto = intakeQuality ? getBestNextPhoto(intakeQuality) : null

  return (
    <div className="max-w-2xl mx-auto">
      {/* Progress */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium">
            Step {step + 1} of {STEPS.length}: {STEPS[step].title}
          </span>
          <span className="text-sm text-muted-foreground">
            {images.length} image{images.length !== 1 ? 's' : ''}
          </span>
        </div>
        <Progress value={progress} className="h-2" />
      </div>

      {/* Step Content */}
      {step === 0 && (
        <Card>
          <CardHeader className="pb-4">
            <CardTitle>Add Buck Photos</CardTitle>
            <CardDescription>
              Multiple angles with visible ears provide the most accurate score
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Tabs value={mode} onValueChange={(v) => setMode(v as 'camera' | 'upload')}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="camera" className="gap-2">
                  <Camera className="h-4 w-4" />
                  Camera
                </TabsTrigger>
                <TabsTrigger value="upload" className="gap-2">
                  <Upload className="h-4 w-4" />
                  Upload
                </TabsTrigger>
              </TabsList>
              
              <TabsContent value="camera" className="mt-4">
                <CameraCapture onCapture={handleImageCapture} />
              </TabsContent>
              
              <TabsContent value="upload" className="mt-4">
                <ImageUploader onUpload={handleImagesUpload} />
              </TabsContent>
            </Tabs>

            {/* Image Guidance - show when no images */}
            {images.length === 0 && (
              <ImageGuidance 
                capturedAngles={[]}
                showTips={true}
                compact={false}
              />
            )}

            {/* Preview Grid */}
            {images.length > 0 && (
              <ImagePreviewGrid 
                images={images} 
                onRemove={handleRemoveImage}
              />
            )}

            {/* Intake Quality Assessment - show when images exist */}
            {intakeQuality && images.length > 0 && (
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
                showRecommendations={true}
                compact={true}
                onAddPhoto={(angle) => {
                  // Switch to camera mode with suggested angle
                  setMode('camera')
                  toast.info(angle ? `Add a ${angle} angle photo` : 'Add another photo')
                }}
              />
            )}

            {/* Best Next Photo Suggestion - prominent when quality is fair/poor */}
            {bestNextPhoto && (intakeQuality?.tier === 'fair' || intakeQuality?.tier === 'poor') && (
              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
                <div className="flex items-center gap-2 text-amber-700 dark:text-amber-300">
                  <Camera className="h-4 w-4" />
                  <span className="text-sm font-medium">{bestNextPhoto.message}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1 ml-6">
                  {bestNextPhoto.reason}
                </p>
              </div>
            )}

            {/* Navigation */}
            <div className="flex justify-end pt-4 border-t border-border">
              <Button 
                onClick={() => setStep(1)} 
                disabled={!canProceedToDetails}
                className="min-h-[48px] gap-2"
              >
                Continue
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 1 && (
        <Card>
          <CardHeader className="pb-4">
            <CardTitle>Buck Details</CardTitle>
            <CardDescription>
              Provide information to improve accuracy
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScoringForm 
              onSubmit={handleFormSubmit}
              onBack={() => setStep(0)}
              isSubmitting={isAnalyzing}
            />
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <CardContent className="py-16">
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
      )}
    </div>
  )
}
