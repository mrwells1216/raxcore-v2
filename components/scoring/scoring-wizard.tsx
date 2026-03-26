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
import type { ScoringResult, ScoringFormData, AngleType } from '@/lib/types'
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
  onComplete: (result: ScoringResult, formData: ScoringFormData) => void
}

const STEPS = [
  { id: 'capture', title: 'Add Photos', description: 'Capture or upload images' },
  { id: 'details', title: 'Buck Details', description: 'State and rack type' },
  { id: 'analyze', title: 'Analyze', description: 'Get your score' },
]

export function ScoringWizard({ initialMode, onComplete }: ScoringWizardProps) {
  const [mode, setMode] = useState<'camera' | 'upload'>(initialMode)
  const [step, setStep] = useState(0)
  const [images, setImages] = useState<CapturedImage[]>([])
  const [formData, setFormData] = useState<ScoringFormData | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)

  const progress = ((step + 1) / STEPS.length) * 100

  const handleImageCapture = useCallback((image: CapturedImage) => {
    setImages(prev => [...prev, image])
    toast.success(`${image.angleType} image added`)
  }, [])

  const handleImagesUpload = useCallback((newImages: CapturedImage[]) => {
    setImages(prev => [...prev, ...newImages])
    toast.success(`${newImages.length} image(s) added`)
  }, [])

  const handleRemoveImage = useCallback((id: string) => {
    setImages(prev => prev.filter(img => img.id !== id))
  }, [])

  const handleFormSubmit = (data: ScoringFormData) => {
    setFormData(data)
    handleAnalyze(data)
  }

  const handleAnalyze = async (data: ScoringFormData) => {
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

      // Add images
      images.forEach((img, index) => {
        if (img.file) {
          apiFormData.append(`image_${index}`, img.file)
        } else {
          apiFormData.append(`image_url_${index}`, img.url)
        }
        apiFormData.append(`angle_${index}`, img.angleType)
      })

      const response = await fetch('/api/score', {
        method: 'POST',
        body: apiFormData,
      })

      if (!response.ok) {
        throw new Error('Scoring failed')
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

  const canProceedToDetails = images.length >= 1

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

            {/* Image Guidance */}
            <ImageGuidance 
              capturedAngles={images.map(img => img.angleType)}
              showTips={images.length === 0}
              compact={images.length > 0}
            />

            {/* Preview Grid */}
            {images.length > 0 && (
              <ImagePreviewGrid 
                images={images} 
                onRemove={handleRemoveImage}
              />
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
