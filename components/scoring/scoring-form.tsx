'use client'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ArrowLeft, ArrowRight, Loader2, MapPin, Camera, Eye, Calendar, Antlers, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Checkbox } from '@/components/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { US_STATES, RACK_TYPES, HARVEST_METHODS, SOURCE_TYPES, CAPTURE_DEVICES, MAIN_FRAME_OPTIONS, ABNORMAL_POINT_TAGS, YES_NO_UNSURE_OPTIONS } from '@/lib/constants'
import type { AbnormalPointTag } from '@/lib/types'
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
  // Phase 54: Abnormal/Irregular Points
  irregular_points_present: z.enum(['yes', 'no', 'unsure']).optional(),
  non_typical_traits_present: z.enum(['yes', 'no', 'unsure']).optional(),
  estimated_irregular_points_count: z.coerce.number().min(0).max(50).optional(),
  abnormal_point_notes: z.string().max(500).optional(),
  abnormal_point_tags: z.array(z.enum(['drop_tine', 'sticker_point', 'split_tine', 'extra_abnormal_growth', 'palmation_like_growth', 'kicker_point', 'inline_point', 'unknown_abnormality'])).optional(),
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
      abnormal_point_tags: [],
    },
  })
  
  const watchRackType = form.watch('rack_type')
  const watchIrregularPoints = form.watch('irregular_points_present')

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

        <Separator />

        {/* Section: Irregular/Abnormal Points (Phase 54) */}
        <Collapsible defaultOpen={watchRackType === 'non-typical'}>
          <div className="space-y-4">
            <CollapsibleTrigger className="flex items-center gap-2 w-full text-left group">
              <AlertCircle className="h-4 w-4 text-amber-500" />
              <h3 className="text-sm font-semibold text-foreground">Irregular / Abnormal Points</h3>
              <span className="text-xs text-muted-foreground">(optional - helps improve scoring)</span>
              <svg className="ml-auto h-4 w-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </CollapsibleTrigger>
            
            <CollapsibleContent className="space-y-4">
              <p className="text-xs text-muted-foreground">
                Help us capture non-typical features. This data improves future scoring accuracy for irregular racks.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="irregular_points_present"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Irregular Points Present?</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger className="min-h-[48px]">
                            <SelectValue placeholder="Yes / No / Unsure" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {YES_NO_UNSURE_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormDescription>Points not on the main frame</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="non_typical_traits_present"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Non-Typical Traits?</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger className="min-h-[48px]">
                            <SelectValue placeholder="Yes / No / Unsure" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {YES_NO_UNSURE_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormDescription>Unusual rack characteristics</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {(watchIrregularPoints === 'yes' || watchIrregularPoints === 'unsure') && (
                <>
                  <FormField
                    control={form.control}
                    name="estimated_irregular_points_count"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Estimated Abnormal Point Count</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min={0}
                            max={50}
                            placeholder="e.g. 3"
                            value={field.value ?? ''}
                            onChange={(e) => field.onChange(e.target.value === '' ? undefined : Number(e.target.value))}
                            className="min-h-[48px]"
                          />
                        </FormControl>
                        <FormDescription>Rough estimate is fine</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="abnormal_point_tags"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Abnormality Types (select all that apply)</FormLabel>
                        <div className="grid grid-cols-2 gap-2">
                          {ABNORMAL_POINT_TAGS.map((tag) => (
                            <label
                              key={tag.value}
                              className="flex items-start gap-2 p-2 rounded-md border border-border hover:bg-secondary/50 cursor-pointer transition-colors"
                            >
                              <Checkbox
                                checked={field.value?.includes(tag.value as AbnormalPointTag)}
                                onCheckedChange={(checked) => {
                                  const current = field.value || []
                                  if (checked) {
                                    field.onChange([...current, tag.value])
                                  } else {
                                    field.onChange(current.filter((v) => v !== tag.value))
                                  }
                                }}
                                className="mt-0.5"
                              />
                              <div className="flex-1 min-w-0">
                                <span className="text-sm font-medium">{tag.label}</span>
                                <p className="text-xs text-muted-foreground line-clamp-2">{tag.description}</p>
                              </div>
                            </label>
                          ))}
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="abnormal_point_notes"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Abnormal Point Notes</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="Describe any abnormal features: e.g., 'Drop tine on left G2, about 4 inches...'"
                            className="min-h-[60px] resize-none"
                            maxLength={500}
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>{(field.value?.length || 0)}/500 characters</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </>
              )}
            </CollapsibleContent>
          </div>
        </Collapsible>

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
