'use client'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ArrowLeft, ArrowRight, Loader2, MapPin, Camera, Eye, Calendar, AlertCircle, Printer, Ruler } from 'lucide-react'
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
import { buildReferenceModeSummary } from '@/lib/scoring/reference-mode'
import { computeImageDiagnosticsFromFile, summarizeDiagnostics, type ImageDiagnostics, type ImageDiagnosticsSummary } from '@/lib/scoring/image-diagnostics'
import { cn } from '@/lib/utils'
import { useState, useRef, useImperativeHandle, forwardRef } from 'react'

export interface ScoringFormHandle {
  triggerSubmit: () => void
}

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
  // Precision mode: reference object / scale marker
  precision_mode_enabled: z.boolean().optional().default(false),
  reference_type: z.enum(['none', 'ruler', 'credit_card', 'coin', 'aruco_marker', 'other_known_object']).optional().default('none'),
  reference_notes: z.string().optional().default(''),
  reference_size_value: z.coerce.number().min(0.1).max(200).optional(),
  reference_size_unit: z.enum(['in', 'cm', 'mm']).optional().default('in'),
  reference_placement: z.enum(['same_depth_plane', 'near_antler_plane', 'in_front_or_behind', 'unknown']).optional().default('unknown'),
})

interface ScoringFormProps {
  onSubmit: (data: ScoringFormData) => void
  onBack: () => void
  isSubmitting: boolean
  onImageDiagnosticsComputed?: (diagnostics: ImageDiagnostics[], summary: ImageDiagnosticsSummary | null) => void
  hideBackButton?: boolean
  hideSubmitButton?: boolean
}

export const ScoringForm = forwardRef<ScoringFormHandle, ScoringFormProps>(function ScoringForm(
  { onSubmit, onBack, isSubmitting, onImageDiagnosticsComputed, hideBackButton, hideSubmitButton },
  ref
) {
  const submitBtnRef = useRef<HTMLButtonElement>(null)
  const [imageDiagnostics, setImageDiagnostics] = useState<ImageDiagnostics[]>([])
  const [imageDiagnosticsSummary, setImageDiagnosticsSummary] = useState<ImageDiagnosticsSummary | null>(null)
  const form = useForm<ScoringFormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      state: '',
      rack_type: 'typical',
      harvest_method: undefined,
      source_type: undefined,
      capture_device: 'unknown',
      ears_fully_visible: true,
      harvest_year: undefined,
      main_frame_points: undefined,
      notes: '',
      irregular_points_present: undefined,
      non_typical_traits_present: undefined,
      estimated_irregular_points_count: undefined,
      abnormal_point_notes: '',
      abnormal_point_tags: [],
      precision_mode_enabled: false,
      reference_type: 'none',
      reference_notes: '',
      reference_size_value: undefined,
      reference_size_unit: 'in',
      reference_placement: 'unknown',
    },
  })
  
  const watchRackType = form.watch('rack_type')
  const watchIrregularPoints = form.watch('irregular_points_present')
  
  const watchPrecisionModeEnabled = form.watch('precision_mode_enabled')
  const watchReferenceType = form.watch('reference_type')
  const watchReferenceNotes = form.watch('reference_notes')
  const watchReferenceSizeValue = form.watch('reference_size_value')
  const watchReferenceSizeUnit = form.watch('reference_size_unit')
  const watchReferencePlacement = form.watch('reference_placement')
  const shouldShowReferenceSize =
    watchReferenceType === 'aruco_marker' ||
    watchReferenceType === 'ruler' ||
    watchReferenceType === 'other_known_object'
  const referenceSizeLabel =
    watchReferenceType === 'ruler'
      ? 'Readable Span'
      : watchReferenceType === 'other_known_object'
        ? 'Known Object Span'
        : 'Marker Edge'

  const referenceModeSummary = buildReferenceModeSummary({
    precisionModeEnabled: watchPrecisionModeEnabled,
    referenceType: watchReferenceType,
    referenceNotes: watchReferenceNotes,
    referenceSizeValue: watchReferenceSizeValue,
    referenceSizeUnit: watchReferenceSizeUnit,
    referencePlacement: watchReferencePlacement,
  })

  useImperativeHandle(ref, () => ({
    triggerSubmit: () => submitBtnRef.current?.click(),
  }))

  const handleComputeImageDiagnostics = async (files: File[]) => {
    try {
      const diagnostics = await Promise.all(
        files.map((file, i) => computeImageDiagnosticsFromFile(file, i))
      )
      const summary = summarizeDiagnostics(diagnostics)
      setImageDiagnostics(diagnostics)
      setImageDiagnosticsSummary(summary)
      onImageDiagnosticsComputed?.(diagnostics, summary)
    } catch (err) {
      console.error('[scoring-form] failed to compute image diagnostics', err)
    }
  }

  return (
    <Form {...form}>
      <form id="scoring-details-form" onSubmit={form.handleSubmit(onSubmit)} className="space-y-5 pt-4">
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
                  <Select onValueChange={field.onChange} value={field.value ?? ""}>
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
                  <FormControl>
                    <div className="flex gap-1.5 p-1 bg-secondary/40 rounded-xl border border-border/40">
                      {RACK_TYPES.map((type) => (
                        <button
                          key={type.value}
                          type="button"
                          onClick={() => field.onChange(type.value)}
                          className={cn(
                            'flex-1 py-2.5 rounded-lg text-sm font-medium transition-all touch-manipulation',
                            field.value === type.value
                              ? 'bg-card text-foreground shadow-sm border border-border/50'
                              : 'text-muted-foreground hover:text-foreground'
                          )}
                        >
                          {type.label}
                        </button>
                      ))}
                    </div>
                  </FormControl>
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
                <Select onValueChange={(value) => field.onChange(Number(value))} value={field.value ? String(field.value) : ""}>
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

          {/* Photo source — chip group */}
          <FormField
            control={form.control}
            name="source_type"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Photo Source</FormLabel>
                <FormControl>
                  <div className="flex flex-wrap gap-2">
                    {SOURCE_TYPES.map((source) => (
                      <button
                        key={source.value}
                        type="button"
                        onClick={() => field.onChange(field.value === source.value ? undefined : source.value)}
                        className={cn(
                          'px-3 py-2 rounded-xl text-sm font-medium border transition-all touch-manipulation min-h-[40px]',
                          field.value === source.value
                            ? 'bg-primary/15 text-primary border-primary/30'
                            : 'bg-card text-muted-foreground border-border hover:text-foreground hover:border-border/80'
                        )}
                      >
                        {source.label}
                      </button>
                    ))}
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Capture device — kept as select */}
          <FormField
            control={form.control}
            name="capture_device"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Capture Device</FormLabel>
                <Select onValueChange={field.onChange} value={field.value ?? ""}>
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
                  <Select onValueChange={field.onChange} value={field.value ?? ""}>
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
                      <Select onValueChange={field.onChange} value={field.value ?? ""}>
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
                      <Select onValueChange={field.onChange} value={field.value ?? ""}>
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

        {/* Precision Mode */}
        <div className="rounded-xl border border-border/60 bg-card p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <h3 className="text-sm font-semibold text-foreground">Precision Mode</h3>
              <p className="text-xs text-muted-foreground">
                Include a known-size reference so the score can rescale the rack when that object is clearly visible
              </p>
            </div>
            <Switch
              checked={!!watchPrecisionModeEnabled}
              onCheckedChange={(checked) => form.setValue('precision_mode_enabled', checked, { shouldDirty: true })}
            />
          </div>

          {watchPrecisionModeEnabled && (
            <div className="space-y-4 pt-2 border-t border-border/40">
              {/* Reference type selector */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">Reference Type</label>
                <Select
                  value={watchReferenceType ?? 'none'}
                  onValueChange={(value) => {
                    form.setValue('reference_type', value as any, { shouldDirty: true })
                    if (value === 'aruco_marker' && !form.getValues('reference_size_value')) {
                      form.setValue('reference_size_value', 2, { shouldDirty: true })
                      form.setValue('reference_size_unit', 'in', { shouldDirty: true })
                    }
                  }}
                >
                  <SelectTrigger className="min-h-[48px]">
                    <SelectValue placeholder="Select reference type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None selected</SelectItem>
                    <SelectItem value="ruler">Ruler / tape measure</SelectItem>
                    <SelectItem value="credit_card">Credit card</SelectItem>
                    <SelectItem value="coin">Coin</SelectItem>
                    <SelectItem value="aruco_marker">Printed marker</SelectItem>
                    <SelectItem value="other_known_object">Other known-size object</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {shouldShowReferenceSize && (
                <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-3">
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground">{referenceSizeLabel}</label>
                    <div className="relative">
                      <Ruler className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        type="number"
                        min="0.1"
                        step="0.01"
                        inputMode="decimal"
                        className="min-h-[48px] pl-9"
                        value={watchReferenceSizeValue ?? ''}
                        onChange={(e) => {
                          const value = e.target.value ? Number(e.target.value) : undefined
                          form.setValue('reference_size_value', value, { shouldDirty: true })
                        }}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground">Unit</label>
                    <Select
                      value={watchReferenceSizeUnit ?? 'in'}
                      onValueChange={(value) => form.setValue('reference_size_unit', value as any, { shouldDirty: true })}
                    >
                      <SelectTrigger className="min-h-[48px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="in">in</SelectItem>
                        <SelectItem value="cm">cm</SelectItem>
                        <SelectItem value="mm">mm</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}

              {watchReferenceType === 'aruco_marker' && (
                <Button asChild variant="outline" size="sm" className="w-full">
                  <a href="/precision-marker" target="_blank" rel="noreferrer">
                    <Printer className="h-4 w-4" />
                    Print marker
                  </a>
                </Button>
              )}

              {referenceModeSummary.referencePresent && (
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground">Reference Placement</label>
                  <Select
                    value={watchReferencePlacement ?? 'unknown'}
                    onValueChange={(value) => form.setValue('reference_placement', value as any, { shouldDirty: true })}
                  >
                    <SelectTrigger className="min-h-[48px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="same_depth_plane">Same depth plane as rack</SelectItem>
                      <SelectItem value="near_antler_plane">Near the rack plane</SelectItem>
                      <SelectItem value="in_front_or_behind">In front of / behind rack</SelectItem>
                      <SelectItem value="unknown">Unknown</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Reference notes */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">Notes (optional)</label>
                <Textarea
                  placeholder="Example: standard credit card beside left beam, or printed marker edge = 2.0 inches"
                  className="min-h-[60px] resize-none"
                  value={watchReferenceNotes ?? ''}
                  onChange={(e) => form.setValue('reference_notes', e.target.value, { shouldDirty: true })}
                />
              </div>

              {/* Status indicator */}
              <div className={cn(
                'rounded-xl border px-3 py-2.5 text-xs',
                referenceModeSummary.referencePresent
                  ? 'border-primary/25 bg-primary/5 text-foreground'
                  : 'border-border/40 bg-secondary/30 text-muted-foreground'
              )}>
                {referenceModeSummary.referencePresent ? (
                  <div className="flex items-start gap-2">
                    <div className="h-4 w-4 rounded-full bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                      <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                    </div>
                    <div>
                      <span className="font-medium">Reference: {referenceModeSummary.referenceType}</span>
                      {referenceModeSummary.supportsScaleCalibration && (
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          Included in scale-aware scoring when the object and size are clear
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  <span>Select a reference type above</span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Image Diagnostics Summary */}
        {imageDiagnosticsSummary && (
          <div className="rounded-lg border px-4 py-3 space-y-2">
            <div className="text-sm font-medium">Image quality analysis</div>
            <div className="text-xs">
              Overall: <span className="font-semibold">{imageDiagnosticsSummary.overall}</span>
            </div>
            
            {imageDiagnosticsSummary.poorCount > 0 && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {imageDiagnosticsSummary.poorCount} image{imageDiagnosticsSummary.poorCount === 1 ? '' : 's'} may reduce accuracy (blurry, dark, or bright).
              </div>
            )}

            {imageDiagnosticsSummary.okCount > 0 && imageDiagnosticsSummary.poorCount === 0 && (
              <div className="rounded-md border border-yellow-200 bg-yellow-50 px-3 py-2 text-xs text-yellow-700">
                {imageDiagnosticsSummary.okCount} image{imageDiagnosticsSummary.okCount === 1 ? '' : 's'} has reduced detail.
              </div>
            )}
          </div>
        )}

        {(!hideBackButton || !hideSubmitButton) && (
          <div className="flex gap-3 pt-4 border-t border-border">
            {!hideBackButton && (
              <Button type="button" variant="outline" onClick={onBack} className="min-h-[48px] gap-2" disabled={isSubmitting}>
                <ArrowLeft className="h-4 w-4" />Back
              </Button>
            )}
            {!hideSubmitButton && (
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
            )}
          </div>
        )}
        {/* Hidden submit button — triggered programmatically via ref */}
        <button ref={submitBtnRef} type="submit" className="sr-only" aria-hidden tabIndex={-1} />
      </form>
    </Form>
  )
})
