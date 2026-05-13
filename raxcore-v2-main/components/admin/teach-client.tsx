'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { US_STATES, RACK_TYPES, HARVEST_METHODS, SOURCE_TYPES, CAPTURE_DEVICES, SCORE_SOURCES, ANGLE_TYPES, MAIN_FRAME_OPTIONS } from '@/lib/constants'
import type { AngleType } from '@/lib/types'
import { toast } from 'sonner'

interface UploadedImage {
  id: string
  file: File
  preview: string
  dataUrl: string
  angle: AngleType
}

export function TeachClient() {
  const [images, setImages] = useState<UploadedImage[]>([])
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ 
    gross?: number | null
    net?: number | null
    confidence?: number | null
    trainingCreated?: boolean
    error?: number | null
  } | null>(null)
  const [form, setForm] = useState({
    state: 'WI',
    rack_type: 'typical',
    harvest_method: 'other',
    source_type: 'harvest_photo',
    capture_device: 'unknown',
    harvest_year: '',
    main_frame_points: '10',
    ears_fully_visible: true,
    nickname: '',
    location: '',
    harvest_date: '',
    official_score: '',
    main_beam_left: '',
    main_beam_right: '',
    inside_spread: '',
    points_left: '',
    points_right: '',
    scoring_method: 'official_scorer',
    scorer_notes: '',
    verify_now: true,
  })

  async function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  async function onFileChange(files: FileList | null) {
    if (!files) return
    const next: UploadedImage[] = []
    
    for (let i = 0; i < Math.min(files.length, 10); i++) {
      const file = files[i]
      const dataUrl = await fileToDataUrl(file)
      next.push({
        id: crypto.randomUUID(),
        file,
        preview: URL.createObjectURL(file),
        dataUrl,
        angle: (['front', 'left', 'right', 'back', 'other'][i] || 'other') as AngleType,
      })
    }
    
    setImages(next)
  }

  async function submit() {
    if (!images.length) {
      toast.error('Add at least one image')
      return
    }
    setLoading(true)
    setResult(null)
    
    try {
      const body = new FormData()
      
      // Add form fields
      body.append('state', form.state)
      body.append('rack_type', form.rack_type)
      body.append('harvest_method', form.harvest_method)
      body.append('source_type', form.source_type)
      body.append('capture_device', form.capture_device)
      body.append('ears_fully_visible', String(form.ears_fully_visible))
      body.append('verify_now', String(form.verify_now))
      
      if (form.harvest_year) body.append('harvest_year', form.harvest_year)
      if (form.main_frame_points) body.append('main_frame_points', form.main_frame_points)
      if (form.nickname) body.append('nickname', form.nickname)
      if (form.location) body.append('location', form.location)
      if (form.harvest_date) body.append('harvest_date', form.harvest_date)
      if (form.scorer_notes) body.append('scorer_notes', form.scorer_notes)
      
      // Ground truth fields
      if (form.official_score) body.append('official_score', form.official_score)
      if (form.main_beam_left) body.append('main_beam_left', form.main_beam_left)
      if (form.main_beam_right) body.append('main_beam_right', form.main_beam_right)
      if (form.inside_spread) body.append('inside_spread', form.inside_spread)
      if (form.points_left) body.append('points_left', form.points_left)
      if (form.points_right) body.append('points_right', form.points_right)
      if (form.scoring_method) body.append('scoring_method', form.scoring_method)
      
      // Add images as data URLs
      images.forEach((img, index) => {
        body.append(`image_data_${index}`, img.dataUrl)
        body.append(`angle_${index}`, img.angle)
      })

      const res = await fetch('/api/admin/teach', { method: 'POST', body })
      const json = await res.json()
      
      if (!res.ok) throw new Error(json.error || 'Failed to teach model')
      
      setResult({ 
        gross: json.prediction?.estimated_score, 
        net: json.prediction?.net_score, 
        confidence: json.prediction?.confidence_percent, 
        trainingCreated: json.trainingCreated,
        error: json.error
      })
      toast.success('Teaching example stored')
    } catch (error) {
      console.error(error)
      toast.error(error instanceof Error ? error.message : 'Failed to teach model')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6 p-4 lg:p-6">
      <div>
        <h1 className="text-2xl font-bold">AI Training Control</h1>
        <p className="text-muted-foreground">Feed the scorer one to ten images, let it score first, then lock in the real score and metadata.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>1. Upload Training Images</CardTitle>
          <CardDescription>Best results come from front + left + right, but one image is allowed.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input type="file" accept="image/*" multiple onChange={(e) => onFileChange(e.target.files)} />
          {images.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {images.map((img, index) => (
                <div key={img.id} className="space-y-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.preview} alt={`Upload ${index + 1}`} className="w-full aspect-square object-cover rounded-lg border" />
                  <Select value={img.angle} onValueChange={(value) => setImages((prev) => prev.map((item) => item.id === img.id ? { ...item, angle: value as AngleType } : item))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ANGLE_TYPES.map((angle) => <SelectItem key={angle.value} value={angle.value}>{angle.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Buck Information</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Nickname</Label>
            <Input value={form.nickname} onChange={(e) => setForm({ ...form, nickname: e.target.value })} placeholder="e.g. Big 8, Monster Buck" />
          </div>
          <div className="space-y-2">
            <Label>Location</Label>
            <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="e.g. Adams County, WI" />
          </div>
          <div className="space-y-2">
            <Label>State</Label>
            <Select value={form.state} onValueChange={(v) => setForm({ ...form, state: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{US_STATES.map((stateOption) => <SelectItem key={stateOption.value} value={stateOption.value}>{stateOption.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Rack Type</Label>
            <Select value={form.rack_type} onValueChange={(v) => setForm({ ...form, rack_type: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{RACK_TYPES.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Main Frame</Label>
            <Select value={form.main_frame_points} onValueChange={(v) => setForm({ ...form, main_frame_points: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{MAIN_FRAME_OPTIONS.map((item) => <SelectItem key={item} value={String(item)}>{item} point frame</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Harvest Date</Label>
            <Input type="date" value={form.harvest_date} onChange={(e) => setForm({ ...form, harvest_date: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>Photo Type</Label>
            <Select value={form.source_type} onValueChange={(v) => setForm({ ...form, source_type: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{SOURCE_TYPES.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Capture Device</Label>
            <Select value={form.capture_device} onValueChange={(v) => setForm({ ...form, capture_device: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{CAPTURE_DEVICES.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Harvest Method</Label>
            <Select value={form.harvest_method} onValueChange={(v) => setForm({ ...form, harvest_method: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{HARVEST_METHODS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3 mt-7">
            <div>
              <Label>Ears fully visible</Label>
              <p className="text-xs text-muted-foreground">Primary measurement anchor</p>
            </div>
            <Switch checked={form.ears_fully_visible} onCheckedChange={(v) => setForm({ ...form, ears_fully_visible: v })} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>3. Real Score Feedback</CardTitle>
          <CardDescription>Let AI score first, then store the official or measured answer so memory keeps improving.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Official/Actual Score</Label>
            <Input type="number" step="0.1" value={form.official_score} onChange={(e) => setForm({ ...form, official_score: e.target.value })} placeholder="e.g. 156.5" />
          </div>
          <div className="space-y-2">
            <Label>Score Source</Label>
            <Select value={form.scoring_method} onValueChange={(v) => setForm({ ...form, scoring_method: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{SCORE_SOURCES.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Main Beam Left</Label>
            <Input type="number" step="0.1" value={form.main_beam_left} onChange={(e) => setForm({ ...form, main_beam_left: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>Main Beam Right</Label>
            <Input type="number" step="0.1" value={form.main_beam_right} onChange={(e) => setForm({ ...form, main_beam_right: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>Inside Spread</Label>
            <Input type="number" step="0.1" value={form.inside_spread} onChange={(e) => setForm({ ...form, inside_spread: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>Points (Left/Right)</Label>
            <div className="flex gap-2">
              <Input type="number" value={form.points_left} onChange={(e) => setForm({ ...form, points_left: e.target.value })} placeholder="Left" />
              <Input type="number" value={form.points_right} onChange={(e) => setForm({ ...form, points_right: e.target.value })} placeholder="Right" />
            </div>
          </div>
          <div className="md:col-span-2 space-y-2">
            <Label>Notes</Label>
            <Textarea value={form.scorer_notes} onChange={(e) => setForm({ ...form, scorer_notes: e.target.value })} placeholder="Kickers, odd pose, score sheet comments, etc." />
          </div>
          <div className="md:col-span-2 flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label>Auto-verify for training</Label>
              <p className="text-xs text-muted-foreground">Use this for trusted examples you want to count immediately.</p>
            </div>
            <Switch checked={form.verify_now} onCheckedChange={(v) => setForm({ ...form, verify_now: v })} />
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={submit} disabled={loading} size="lg" className="min-h-[44px]">
          {loading ? 'Teaching...' : 'Score + Teach AI'}
        </Button>
        {result ? (
          <Badge variant="secondary" className="text-sm py-1.5">
            AI gross {result.gross?.toFixed(1)}&quot; 
            {result.error !== null && (
              <span className={result.error! > 0 ? 'text-red-500' : 'text-primary'}>
                {' '}({result.error! > 0 ? '+' : ''}{result.error?.toFixed(1)}&quot; error)
              </span>
            )}
          </Badge>
        ) : null}
        {result?.trainingCreated ? (
          <Badge className="bg-primary text-primary-foreground">Stored in training memory</Badge>
        ) : null}
      </div>
    </div>
  )
}
