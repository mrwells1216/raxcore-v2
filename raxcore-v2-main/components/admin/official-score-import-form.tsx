'use client'

import { useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { 
  Upload, 
  X, 
  FileJson, 
  Image as ImageIcon, 
  CheckCircle2, 
  AlertCircle,
  Loader2 
} from 'lucide-react'

type ScoringSystem = 'BC' | 'PY' | 'SCI' | 'other'
type ImageType = 'live' | 'mounted' | 'side_left' | 'side_right' | 'front' | 'detail' | 'other'

interface UploadedImage {
  file: File
  preview: string
  type: ImageType
}

interface SubmitStatus {
  state: 'idle' | 'uploading' | 'success' | 'error'
  message?: string
}

// BC/PY official score sheet fields
const SCORE_FIELDS = [
  { key: 'main_beam_left', label: 'Main Beam (L)', section: 'beams' },
  { key: 'main_beam_right', label: 'Main Beam (R)', section: 'beams' },
  { key: 'inside_spread', label: 'Inside Spread', section: 'spread' },
  { key: 'g1_left', label: 'G1 (L)', section: 'tines' },
  { key: 'g1_right', label: 'G1 (R)', section: 'tines' },
  { key: 'g2_left', label: 'G2 (L)', section: 'tines' },
  { key: 'g2_right', label: 'G2 (R)', section: 'tines' },
  { key: 'g3_left', label: 'G3 (L)', section: 'tines' },
  { key: 'g3_right', label: 'G3 (R)', section: 'tines' },
  { key: 'g4_left', label: 'G4 (L)', section: 'tines' },
  { key: 'g4_right', label: 'G4 (R)', section: 'tines' },
  { key: 'g5_left', label: 'G5 (L)', section: 'tines' },
  { key: 'g5_right', label: 'G5 (R)', section: 'tines' },
  { key: 'h1_left', label: 'H1 (L)', section: 'circumferences' },
  { key: 'h1_right', label: 'H1 (R)', section: 'circumferences' },
  { key: 'h2_left', label: 'H2 (L)', section: 'circumferences' },
  { key: 'h2_right', label: 'H2 (R)', section: 'circumferences' },
  { key: 'h3_left', label: 'H3 (L)', section: 'circumferences' },
  { key: 'h3_right', label: 'H3 (R)', section: 'circumferences' },
  { key: 'h4_left', label: 'H4 (L)', section: 'circumferences' },
  { key: 'h4_right', label: 'H4 (R)', section: 'circumferences' },
  { key: 'gross_score', label: 'Gross Score', section: 'totals' },
  { key: 'net_score', label: 'Net Score', section: 'totals' },
  { key: 'deductions', label: 'Deductions', section: 'totals' },
  { key: 'abnormal_points', label: 'Abnormal Points', section: 'totals' },
] as const

export function OfficialScoreImportForm() {
  const router = useRouter()
  const supabase = createClient()
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Form state
  const [scoringSystem, setScoringSystem] = useState<ScoringSystem>('BC')
  const [inputMode, setInputMode] = useState<'fields' | 'json'>('fields')
  const [scoreJson, setScoreJson] = useState('{}')
  const [scoreFields, setScoreFields] = useState<Record<string, string>>({})
  const [images, setImages] = useState<UploadedImage[]>([])
  const [notes, setNotes] = useState('')
  const [submitStatus, setSubmitStatus] = useState<SubmitStatus>({ state: 'idle' })

  // Handle field changes
  const handleFieldChange = useCallback((key: string, value: string) => {
    setScoreFields(prev => ({ ...prev, [key]: value }))
  }, [])

  // Handle image selection
  const handleImageSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return

    const newImages: UploadedImage[] = []
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      if (!file.type.startsWith('image/')) continue
      
      newImages.push({
        file,
        preview: URL.createObjectURL(file),
        type: 'other',
      })
    }

    setImages(prev => [...prev, ...newImages])
    
    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }, [])

  // Update image type
  const updateImageType = useCallback((index: number, type: ImageType) => {
    setImages(prev => prev.map((img, i) => 
      i === index ? { ...img, type } : img
    ))
  }, [])

  // Remove image
  const removeImage = useCallback((index: number) => {
    setImages(prev => {
      const updated = [...prev]
      URL.revokeObjectURL(updated[index].preview)
      updated.splice(index, 1)
      return updated
    })
  }, [])

  // Build score data from fields or JSON
  const buildScoreData = useCallback(() => {
    if (inputMode === 'json') {
      try {
        return JSON.parse(scoreJson)
      } catch {
        throw new Error('Invalid JSON format')
      }
    }

    // Convert field values to numbers
    const data: Record<string, number | null> = {}
    for (const [key, value] of Object.entries(scoreFields)) {
      if (value.trim() === '') {
        data[key] = null
      } else {
        const num = parseFloat(value)
        if (isNaN(num)) {
          throw new Error(`Invalid number for ${key}: ${value}`)
        }
        data[key] = num
      }
    }
    return data
  }, [inputMode, scoreJson, scoreFields])

  // Submit form
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitStatus({ state: 'uploading', message: 'Validating data...' })

    try {
      // Build score data
      let scoreData: Record<string, unknown>
      try {
        scoreData = buildScoreData()
      } catch (err) {
        setSubmitStatus({ 
          state: 'error', 
          message: err instanceof Error ? err.message : 'Invalid score data' 
        })
        return
      }

      // Get current user
      const { data: { user } } = await supabase.auth.getUser()

      // Insert official score sheet
      setSubmitStatus({ state: 'uploading', message: 'Creating score sheet record...' })
      const { data: sheet, error: sheetError } = await supabase
        .from('official_score_sheets')
        .insert({
          user_id: user?.id ?? null,
          scoring_system: scoringSystem,
          score_data: scoreData,
        })
        .select('id')
        .single()

      if (sheetError) {
        throw new Error(`Failed to create score sheet: ${sheetError.message}`)
      }

      const sheetId = sheet.id

      // Upload images
      if (images.length > 0) {
        setSubmitStatus({ state: 'uploading', message: `Uploading ${images.length} images...` })
        
        for (let i = 0; i < images.length; i++) {
          const img = images[i]
          const fileExt = img.file.name.split('.').pop() ?? 'jpg'
          const fileName = `${sheetId}/${Date.now()}_${i}.${fileExt}`

          // Upload to storage
          const { error: uploadError } = await supabase
            .storage
            .from('training-images')
            .upload(fileName, img.file)

          if (uploadError) {
            console.error(`[v0] Failed to upload image ${i}:`, uploadError)
            continue
          }

          // Get public URL
          const { data: urlData } = supabase
            .storage
            .from('training-images')
            .getPublicUrl(fileName)

          // Insert image record
          await supabase
            .from('official_score_images')
            .insert({
              sheet_id: sheetId,
              image_url: urlData.publicUrl,
              image_type: img.type,
            })
        }
      }

      setSubmitStatus({ state: 'success', message: 'Training data saved successfully!' })
      
      // Reset form after short delay
      setTimeout(() => {
        setScoreFields({})
        setScoreJson('{}')
        setImages([])
        setNotes('')
        setSubmitStatus({ state: 'idle' })
        router.refresh()
      }, 2000)

    } catch (err) {
      console.error('[v0] Submit error:', err)
      setSubmitStatus({ 
        state: 'error', 
        message: err instanceof Error ? err.message : 'An unexpected error occurred' 
      })
    }
  }

  // Group fields by section
  const fieldsBySection = SCORE_FIELDS.reduce((acc, field) => {
    if (!acc[field.section]) acc[field.section] = []
    acc[field.section].push(field)
    return acc
  }, {} as Record<string, typeof SCORE_FIELDS[number][]>)

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Scoring System */}
      <div className="space-y-2">
        <Label>Scoring System</Label>
        <Select value={scoringSystem} onValueChange={(v) => setScoringSystem(v as ScoringSystem)}>
          <SelectTrigger className="min-h-[48px]">
            <SelectValue placeholder="Select scoring system" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="BC">Boone &amp; Crockett</SelectItem>
            <SelectItem value="PY">Pope &amp; Young</SelectItem>
            <SelectItem value="SCI">Safari Club International</SelectItem>
            <SelectItem value="other">Other</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Input Mode Toggle */}
      <div className="flex gap-2">
        <Button
          type="button"
          variant={inputMode === 'fields' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setInputMode('fields')}
          className="min-h-[44px]"
        >
          Field Entry
        </Button>
        <Button
          type="button"
          variant={inputMode === 'json' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setInputMode('json')}
          className="min-h-[44px]"
        >
          <FileJson className="h-4 w-4 mr-2" />
          JSON Paste
        </Button>
      </div>

      {/* Score Data Input */}
      {inputMode === 'json' ? (
        <div className="space-y-2">
          <Label>Official Score JSON</Label>
          <Textarea
            value={scoreJson}
            onChange={(e) => setScoreJson(e.target.value)}
            placeholder='{"main_beam_left": 25.5, "main_beam_right": 26.0, ...}'
            className="min-h-[200px] font-mono text-sm"
          />
          <p className="text-xs text-muted-foreground">
            Paste the complete score sheet data as JSON
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Beams */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Main Beams</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3">
                {fieldsBySection.beams?.map(field => (
                  <div key={field.key} className="space-y-1">
                    <Label className="text-xs text-muted-foreground">{field.label}</Label>
                    <Input
                      type="number"
                      step="0.125"
                      placeholder="0.000"
                      value={scoreFields[field.key] ?? ''}
                      onChange={(e) => handleFieldChange(field.key, e.target.value)}
                      className="min-h-[44px]"
                    />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Spread */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Inside Spread</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3">
                {fieldsBySection.spread?.map(field => (
                  <div key={field.key} className="space-y-1">
                    <Label className="text-xs text-muted-foreground">{field.label}</Label>
                    <Input
                      type="number"
                      step="0.125"
                      placeholder="0.000"
                      value={scoreFields[field.key] ?? ''}
                      onChange={(e) => handleFieldChange(field.key, e.target.value)}
                      className="min-h-[44px]"
                    />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Tines */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Tine Lengths (G1-G5)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3">
                {fieldsBySection.tines?.map(field => (
                  <div key={field.key} className="space-y-1">
                    <Label className="text-xs text-muted-foreground">{field.label}</Label>
                    <Input
                      type="number"
                      step="0.125"
                      placeholder="0.000"
                      value={scoreFields[field.key] ?? ''}
                      onChange={(e) => handleFieldChange(field.key, e.target.value)}
                      className="min-h-[44px]"
                    />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Circumferences */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Circumferences (H1-H4)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3">
                {fieldsBySection.circumferences?.map(field => (
                  <div key={field.key} className="space-y-1">
                    <Label className="text-xs text-muted-foreground">{field.label}</Label>
                    <Input
                      type="number"
                      step="0.125"
                      placeholder="0.000"
                      value={scoreFields[field.key] ?? ''}
                      onChange={(e) => handleFieldChange(field.key, e.target.value)}
                      className="min-h-[44px]"
                    />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Totals */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Score Totals</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3">
                {fieldsBySection.totals?.map(field => (
                  <div key={field.key} className="space-y-1">
                    <Label className="text-xs text-muted-foreground">{field.label}</Label>
                    <Input
                      type="number"
                      step="0.125"
                      placeholder="0.000"
                      value={scoreFields[field.key] ?? ''}
                      onChange={(e) => handleFieldChange(field.key, e.target.value)}
                      className="min-h-[44px]"
                    />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Image Upload */}
      <div className="space-y-3">
        <Label>Upload Images</Label>
        <div
          className={cn(
            'border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors',
            'hover:border-primary/50 hover:bg-primary/5'
          )}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Click to upload or drag &amp; drop images
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            PNG, JPG, HEIC up to 20MB each
          </p>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*"
            onChange={handleImageSelect}
            className="hidden"
          />
        </div>

        {/* Image Previews */}
        {images.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {images.map((img, index) => (
              <div key={index} className="relative group">
                <div className="aspect-square rounded-lg overflow-hidden border bg-muted">
                  <img 
                    src={img.preview} 
                    alt={`Upload ${index + 1}`}
                    className="w-full h-full object-cover"
                  />
                </div>
                <Button
                  type="button"
                  variant="destructive"
                  size="icon"
                  className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => removeImage(index)}
                >
                  <X className="h-3 w-3" />
                </Button>
                <Select
                  value={img.type}
                  onValueChange={(v) => updateImageType(index, v as ImageType)}
                >
                  <SelectTrigger className="mt-1 h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="front">Front View</SelectItem>
                    <SelectItem value="side_left">Side (Left)</SelectItem>
                    <SelectItem value="side_right">Side (Right)</SelectItem>
                    <SelectItem value="mounted">Mounted</SelectItem>
                    <SelectItem value="live">Live Deer</SelectItem>
                    <SelectItem value="detail">Detail</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Notes */}
      <div className="space-y-2">
        <Label>Notes (optional)</Label>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Any additional notes about this score sheet..."
          className="min-h-[80px]"
        />
      </div>

      {/* Submit Status */}
      {submitStatus.state !== 'idle' && (
        <div className={cn(
          'rounded-lg p-4 flex items-center gap-3',
          submitStatus.state === 'uploading' && 'bg-blue-50 text-blue-800 border border-blue-200',
          submitStatus.state === 'success' && 'bg-green-50 text-green-800 border border-green-200',
          submitStatus.state === 'error' && 'bg-red-50 text-red-800 border border-red-200'
        )}>
          {submitStatus.state === 'uploading' && <Loader2 className="h-5 w-5 animate-spin" />}
          {submitStatus.state === 'success' && <CheckCircle2 className="h-5 w-5" />}
          {submitStatus.state === 'error' && <AlertCircle className="h-5 w-5" />}
          <span className="text-sm font-medium">{submitStatus.message}</span>
        </div>
      )}

      {/* Submit Button */}
      <Button
        type="submit"
        className="w-full min-h-[48px]"
        disabled={submitStatus.state === 'uploading'}
      >
        {submitStatus.state === 'uploading' ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Uploading...
          </>
        ) : (
          'Submit Training Data'
        )}
      </Button>
    </form>
  )
}
