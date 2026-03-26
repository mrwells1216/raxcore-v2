'use client'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ArrowLeft, ArrowRight, Loader2, MapPin, Camera, Eye, Calendar } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { US_STATES, RACK_TYPES, HARVEST_METHODS, SOURCE_TYPES, CAPTURE_DEVICES, MAIN_FRAME_OPTIONS } from '@/lib/constants'
import type { ScoringFormData } from '@/lib/types'

const formSchema = z.object({
  state: z.string().min(1, 'State is required'),
  rack_type: z.enum(['typical', 'non-typical'], { required_error: 'Rack type is required' }),
  harvest_method: z.enum(['bow', 'rifle', 'muzzleloader', 'crossbow', 'other']).optional(),
  source_type: z.enum(['live_deer', 'mounted_photo', 'european_mount', 'trail_cam', 'harvest_photo', 'other']).optional(),
  capture_device: z.enum(['iphone', 'android', 'digital_camera', 'photo_of_photo', 'vintage_photo', 'unknown']).optional(),
  ears_fully_visible: z.boolean().optional(),
  harvest_year: z.coerce.number().min(1900).max(new Date().getFullYear()).optional(),
  main_frame_points: z.coerce.number().min(1).max(30).optional(),
  notes: z.string().optional(),
})

interface ScoringFormProps {
  onSubmit: (data: ScoringFormData) => void
  onBack: () => void
  isSubmitting: boolean
}

export function ScoringForm({ onSubmit, onBack, isSubmitting }: ScoringFormProps) {
  const form = useForm<ScoringFormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      state: '',
      rack_type: 'typical',
      ears_fully_visible: true,
      capture_device: 'unknown',
    },
  })

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {/* Section: Required Info */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">Required Information</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="state"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>State *</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger className="min-h-[48px]"><SelectValue placeholder="Where was this buck?" /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {US_STATES.map((stateOption) => <SelectItem key={stateOption.value} value={stateOption.value}>{stateOption.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormDescription>Helps calibrate regional deer size</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="rack_type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Rack Type *</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger className="min-h-[48px]"><SelectValue placeholder="Typical or non-typical?" /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {RACK_TYPES.map((type) => <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormDescription>Affects scoring calculations</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={form.control}
            name="main_frame_points"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Main Frame Points</FormLabel>
                <Select onValueChange={(value) => field.onChange(Number(value))} defaultValue={field.value ? String(field.value) : undefined}>
                  <FormControl>
                    <SelectTrigger className="min-h-[48px]"><SelectValue placeholder="8-point, 10-point, 12-point..." /></SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {MAIN_FRAME_OPTIONS.map((value) => <SelectItem key={value} value={String(value)}>{value}-point main frame</SelectItem>)}
                  </SelectContent>
                </Select>
                <FormDescription>Helps AI identify the correct tine structure</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <Separator />

        {/* Section: Image Context */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Camera className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">Image Context</h3>
            <span className="text-xs text-muted-foreground">(improves accuracy)</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="source_type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Photo Source</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger className="min-h-[48px]"><SelectValue placeholder="What are these photos of?" /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {SOURCE_TYPES.map((source) => <SelectItem key={source.value} value={source.value}>{source.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="capture_device"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Capture Device</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger className="min-h-[48px]"><SelectValue placeholder="What took these photos?" /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {CAPTURE_DEVICES.map((device) => <SelectItem key={device.value} value={device.value}>{device.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={form.control}
            name="ears_fully_visible"
            render={({ field }) => (
              <FormItem className="flex items-center justify-between rounded-lg border border-border bg-secondary/30 p-4">
                <div className="flex items-start gap-3">
                  <Eye className="h-5 w-5 text-primary mt-0.5" />
                  <div className="space-y-0.5">
                    <FormLabel className="text-base font-medium">Ears Fully Visible</FormLabel>
                    <FormDescription>
                      This is the primary scaling reference. Turn off if ears are hidden or cropped.
                    </FormDescription>
                  </div>
                </div>
                <FormControl>
                  <Switch checked={field.value} onCheckedChange={field.onChange} className="min-h-[24px] min-w-[44px]" />
                </FormControl>
              </FormItem>
            )}
          />
        </div>

        <Separator />

        {/* Section: Optional Details */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">Optional Details</h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="harvest_method"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Harvest Method</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger className="min-h-[48px]"><SelectValue placeholder="How was it taken?" /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {HARVEST_METHODS.map((method) => <SelectItem key={method.value} value={method.value}>{method.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="harvest_year"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Year</FormLabel>
                  <FormControl>
                    <Input 
                      type="number" 
                      min={1900} 
                      max={new Date().getFullYear()} 
                      placeholder="e.g. 2024" 
                      value={field.value ?? ''} 
                      onChange={(e) => field.onChange(e.target.value === '' ? undefined : Number(e.target.value))} 
                      className="min-h-[48px]" 
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={form.control}
            name="notes"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Notes</FormLabel>
                <FormControl>
                  <Textarea 
                    placeholder="Anything special about this buck: unusual features, image quality issues, missing angles..." 
                    className="min-h-[80px] resize-none" 
                    {...field} 
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="flex gap-3 pt-4 border-t border-border">
          <Button type="button" variant="outline" onClick={onBack} className="min-h-[48px] gap-2" disabled={isSubmitting}>
            <ArrowLeft className="h-4 w-4" />Back
          </Button>
          <Button type="submit" className="flex-1 min-h-[48px] gap-2" disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                Analyze Buck
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </Button>
        </div>
      </form>
    </Form>
  )
}
