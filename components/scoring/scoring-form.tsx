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
import { RACK_TYPES, HARVEST_METHODS, SOURCE_TYPES, CAPTURE_DEVICES, ABNORMAL_POINT_TAGS, YES_NO_UNSURE_OPTIONS } from '@/lib/constants'
import type { AbnormalPointTag, PreScoringMeasurements } from '@/lib/types'
import type { ScoringFormData } from '@/lib/types'
import { PointCountSlider } from './point-count-slider'
import { PreScoringMeasurementsPanel } from './pre-scoring-measurements'
import { buildReferenceModeSummary } from '@/lib/scoring/reference-mode'
import { buildRingReferenceInput, ringSizeToInnerDiameterInches, normalizeRingSizeUS } from '@/lib/scoring/ring-reference'
import { buildHatReferenceInput, HAT_DIMENSIONS } from '@/lib/scoring/hat-reference'
import type { HatType } from '@/lib/scoring/reference-object-types'
import { computeImageDiagnosticsFromFile, summarizeDiagnostics, type ImageDiagnostics, type ImageDiagnosticsSummary } from '@/lib/scoring/image-diagnostics'
import { cn } from '@/lib/utils'
import { useState, useRef, useImperativeHandle, forwardRef } from 'react'

export interface ScoringFormHandle {
  triggerSubmit: () => void
}

const formSchema = z.object({
  state: z.string().optional().nullable(),
  reference_object_type: z.enum(['none', 'wedding_ring', 'hat']).optional().default('none'),
  reference_object_ring_size: z.coerce.number().min(3).max(16).optional().nullable(),
  reference_object_hat_type: z.enum([
    'baseball_cap', 'baseball_cap_backwards', 'beanie',
    'skull_cap', 'stetson', 'wide_brim',
  ]).optional().nullable(),
  rack_type: z.enum(['typical', 'non-typical'], { required_error: 'Rack type is required' }),
  harvest_method: z.enum(['bow', 'rifle', 'muzzleloader', 'crossbow', 'other']).optional(),
  source_type: z.enum(['live_deer', 'mounted_photo', 'european_mount', 'trail_cam', 'harvest_photo', 'other']).optional(),
  capture_device: z.enum(['iphone', 'android', 'digital_camera', 'photo_of_photo', 'vintage_photo', 'unknown']).optional(),
  ears_fully_visible: z.boolean().optional(),
  harvest_year: z.coerce.number().min(1900).max(new Date().getFullYear()).optional(),
  total_points: z.coerce.number().min(4).max(30).optional().nullable(),
  main_frame_points: z.coerce.number().min(6).max(16).optional().nullable(),
  notes: z.string().optional(),
  // Phase 54: Abnormal/Irregular Points
  irregular_points_present: z.enum(['yes', 'no', 'unsure']).optional(),
  non_typical_traits_present: z.enum(['yes', 'no', 'unsure']).optional(),
  estimated_irregular_points_count: z.coerce.number().min(0).max(50).optional(),
  abnormal_point_notes: z.string().max(500).optional(),
  abnormal_point_tags: z.array(z.enum(['drop_tine', 'sticker_point', 'split_tine', 'extra_abnormal_growth', 'palmation_like_growth', 'kicker_point', 'inline_point', 'unknown_abnormality'])).optional(),
  // Precision mode: reference object / scale marker
  precision_mode_enabled: z.boolean().optional().default(false),
  reference_type: z.enum([
    'none',
    'ruler',
    'credit_card',
    'coin',
    'aruco_marker',
    'other_known_object',
    'wedding_ring',
    'hat',
  ]).optional().default('none'),
  reference_ring_size_us: z.coerce.number().min(3).max(16).optional().nullable(),
  reference_hat_type: z.enum([
    'baseball_cap',
    'baseball_cap_backwards',
    'beanie',
    'skull_cap',
    'stetson',
    'wide_brim',
  ]).optional().nullable(),
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
  const [preScoringMeasurements, setPreScoringMeasurements] = useState<PreScoringMeasurements>({})
  const form = useForm<ScoringFormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      state: null,
      reference_object_type: 'none',
      reference_object_ring_size: null,
      reference_object_hat_type: null,
      rack_type: 'typical',
      harvest_method: undefined,
      source_type: undefined,
      capture_device: 'unknown',
      ears_fully_visible: true,
      harvest_year: undefined,
      total_points: null,
      main_frame_points: null,
      notes: '',
      irregular_points_present: undefined,
      non_typical_traits_present: undefined,
      estimated_irregular_points_count: undefined,
      abnormal_point_notes: '',
      abnormal_point_tags: [],
      precision_mode_enabled: false,
      reference_type: 'none',
      reference_ring_size_us: null,
      reference_hat_type: null,
      reference_notes: '',
      reference_size_value: undefined,
      reference_size_unit: 'in',
      reference_placement: 'unknown',
    },
  })
  
  const watchRackType = form.watch('rack_type')
  const watchIrregularPoints = form.watch('irregular_points_present')
  const watchReferenceObjectType = form.watch('reference_object_type')
  const watchRingSize = form.watch('reference_object_ring_size')
  const watchHatType = form.watch('reference_object_hat_type') as HatType | null | undefined
  const ringDiameter = watchRingSize != null ? ringSizeToInnerDiameterInches(normalizeRingSizeUS(watchRingSize) ?? -1) : null
  
  const watchPrecisionModeEnabled = form.watch('precision_mode_enabled')
  const watchReferenceType = form.watch('reference_type')
  const watchPrecisionRingSizeUS = form.watch('reference_ring_size_us')
  const watchPrecisionHatType = form.watch('reference_hat_type')
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

  // wedding_ring and hat have their own sub-forms; map to 'none' for the standard summary
  const precisionRefType = (watchReferenceType === 'wedding_ring' || watchReferenceType === 'hat')
    ? 'none'
    : watchReferenceType
  const referenceModeSummary = buildReferenceModeSummary({
    precisionModeEnabled: watchPrecisionModeEnabled,
    referenceType: precisionRefType,
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

  const handleInternalSubmit = (data: ScoringFormData) => {
    const refType = data.reference_object_type ?? 'none'
    const ringPresent = refType === 'wedding_ring'
    const hatPresent = refType === 'hat'
    const ringInput = buildRingReferenceInput({
      present: ringPresent,
      ringSizeUS: data.reference_object_ring_size ?? null,
    })
    const hatInput = buildHatReferenceInput({
      present: hatPresent,
      hatType: data.reference_object_hat_type ?? null,
    })
    const enrichedData: ScoringFormData = {
      ...data,
      reference_object: {
        type: refType,
        ring: ringPresent ? {
          present: ringInput.present,
          ringSizeUS: ringInput.ringSizeUS,
          innerDiameterInches: ringInput.innerDiameterInches,
          confidence: ringInput.confidence === 'manual_confirmed' ? 'estimated' : ringInput.confidence,
        } : null,
        hat: hatPresent ? {
          present: hatInput.present,
          hatType: hatInput.hatType,
          brimWidthInches: hatInput.brimWidthInches,
          crownHeightInches: hatInput.crownHeightInches,
          confidence: hatInput.confidence === 'manual_confirmed' ? 'estimated' : hatInput.confidence,
        } : null,
      },
    }
    const nonNullPreScoring = Object.fromEntries(
      Object.entries(preScoringMeasurements).filter(([, v]) => v != null)
    ) as PreScoringMeasurements
    onSubmit({
      ...enrichedData,
      pre_scoring_measurements: Object.keys(nonNullPreScoring).length > 0 ? nonNullPreScoring : null,
    })
  }

  return (
    <Form {...form}>
      <form id="scoring-details-form" onSubmit={form.handleSubmit(handleInternalSubmit)} className="space-y-5 pt-4">
        {/* Section: Rack Information */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">Rack Information</h3>
          </div>
          <div className="space-y-4">
            <FormField
              control={form.control}
              name="total_points"
              render={({ field }) => (
                <FormItem className="space-y-0">
                  <FormControl>
                    <PointCountSlider
                      label="Total Points (optional)"
                      value={field.value ?? null}
                      min={4}
                      max={30}
                      displayValue={(v) => `${v} points total`}
                      helperText="All scoreable points on both antlers — helps AI identify tine structure"
                      onChange={(val) => {
                        field.onChange(val)
                        const mf = form.getValues('main_frame_points')
                        if (val != null && mf != null && mf > val) {
                          form.setValue('main_frame_points', val)
                        }
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="main_frame_points"
              render={({ field }) => {
                const total = form.watch('total_points')
                if (total == null || total < 6) return <></>
                return (
                  <FormItem className="space-y-0">
                    <FormControl>
                      <PointCountSlider
                        label="Main Frame Points (optional)"
                        value={field.value ?? null}
                        min={6}
                        max={Math.min(16, total)}
                        displayValue={(v) => `${v}-point main frame`}
                        helperText="Typical tines only, excluding abnormal points"
                        onChange={(val) => {
                          field.onChange(val)
                          if (val != null && total != null && val > total) {
                            form.setValue('total_points', val)
                          }
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )
              }}
            />
          </div>

          <FormField
            control={form.control}
            name="rack_type"
            render={({ field }) => (
              <FormItem className="space-y-1">
                <FormLabel className="text-xs">Rack Type *</FormLabel>
                <FormControl>
                  <div className="flex gap-1 p-0.5 bg-secondary/40 rounded-lg border border-border/40">
                    {RACK_TYPES.map((type) => (
                      <button
                        key={type.value}
                        type="button"
                        onClick={() => field.onChange(type.value)}
                        className={cn(
                          'flex-1 py-2 rounded-md text-xs font-medium transition-all touch-manipulation',
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
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <Separator className="my-3" />

        {/* Section: Image Context */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Camera className="h-3.5 w-3.5 text-muted-foreground" />
            <h3 className="text-xs font-semibold text-foreground uppercase tracking-wide">Image Context</h3>
          </div>

          {/* Photo source — compact 2-col chip grid */}
          <FormField
            control={form.control}
            name="source_type"
            render={({ field }) => (
              <FormItem className="space-y-1">
                <FormLabel className="text-xs">Photo Source</FormLabel>
                <FormControl>
                  <div className="grid grid-cols-2 gap-1.5">
                    {SOURCE_TYPES.map((source) => (
                      <button
                        key={source.value}
                        type="button"
                        onClick={() => field.onChange(field.value === source.value ? undefined : source.value)}
                        className={cn(
                          'px-2 py-1.5 rounded-lg text-xs font-medium border transition-all touch-manipulation',
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

          {/* Capture device + Ears visible in 2-col */}
          <div className="grid grid-cols-2 gap-2">
            <FormField
              control={form.control}
              name="capture_device"
              render={({ field }) => (
                <FormItem className="space-y-1">
                  <FormLabel className="text-xs">Device</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value ?? ""}>
                    <FormControl>
                      <SelectTrigger className="h-10 text-sm"><SelectValue placeholder="Camera" /></SelectTrigger>
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
                <FormItem className="space-y-1">
                  <FormLabel className="text-xs">Ears Visible?</FormLabel>
                  <FormControl>
                    <div className="flex items-center gap-2 h-10 px-3 rounded-md border border-border bg-secondary/30">
                      <Eye className="h-3.5 w-3.5 text-primary shrink-0" />
                      <span className="text-xs text-muted-foreground flex-1">Scale ref</span>
                      <Switch checked={field.value} onCheckedChange={field.onChange} className="scale-90" />
                    </div>
                  </FormControl>
                </FormItem>
              )}
            />
          </div>
        </div>

        <Separator className="my-3" />

        {/* Section: Optional Details */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
            <h3 className="text-xs font-semibold text-foreground uppercase tracking-wide">Optional</h3>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <FormField
              control={form.control}
              name="harvest_method"
              render={({ field }) => (
                <FormItem className="space-y-1">
                  <FormLabel className="text-xs">Method</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value ?? ""}>
                    <FormControl>
                      <SelectTrigger className="h-10 text-sm"><SelectValue placeholder="Harvest" /></SelectTrigger>
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
                <FormItem className="space-y-1">
                  <FormLabel className="text-xs">Year</FormLabel>
                  <FormControl>
                    <Input 
                      type="number" 
                      min={1900} 
                      max={new Date().getFullYear()} 
                      placeholder="2024" 
                      value={field.value ?? ''} 
                      onChange={(e) => field.onChange(e.target.value === '' ? undefined : Number(e.target.value))} 
                      className="h-10 text-sm" 
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
              <FormItem className="space-y-1">
                <FormLabel className="text-xs">Notes</FormLabel>
                <FormControl>
                  <Textarea 
                    placeholder="Unusual features, quality issues..." 
                    className="min-h-[60px] resize-none text-sm" 
                    {...field} 
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <Separator className="my-3" />

        {/* Section: Reference Object */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Ruler className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">Reference Object</h3>
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium">What reference object is visible in the photo?</label>
              <div className="flex flex-wrap gap-2 mt-2">
                {([
                  ['none', 'No reference visible'],
                  ['wedding_ring', 'Wedding band or ring'],
                  ['hat', 'Hat'],
                ] as const).map(([val, label]) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => form.setValue('reference_object_type', val, { shouldDirty: true })}
                    className={cn(
                      'px-3 py-2 rounded-xl text-sm font-medium border transition-all touch-manipulation min-h-[40px]',
                      watchReferenceObjectType === val
                        ? 'bg-primary/15 text-primary border-primary/30'
                        : 'bg-card text-muted-foreground border-border hover:text-foreground hover:border-border/80'
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              A reference object can help estimate scale when no ruler or tape is visible. Best results come from the object clearly visible near the antler.
            </p>
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Reference objects are estimated calibration aids only. A ruler or tape measure is still more reliable.
            </p>

            {watchReferenceObjectType === 'wedding_ring' && (
              <div className="space-y-2 pt-1">
                <label className="text-sm font-medium">US Ring Size</label>
                <Input
                  type="number"
                  step={0.5}
                  min={3}
                  max={16}
                  placeholder="e.g. 8, 9.5, 10"
                  className="min-h-[48px]"
                  value={watchRingSize ?? ''}
                  onChange={(e) => {
                    const val = e.target.value === '' ? null : Number(e.target.value)
                    form.setValue('reference_object_ring_size', val, { shouldDirty: true })
                  }}
                />
                <p className="text-xs text-muted-foreground">Whole and half sizes supported (3–16)</p>
                {watchRingSize != null && watchRingSize !== 0 && (normalizeRingSizeUS(watchRingSize) === null) && (
                  <p className="text-xs text-destructive">Enter a US ring size between 3 and 16 (e.g. 8 or 9.5)</p>
                )}
                {ringDiameter !== null && (
                  <p className="text-xs text-muted-foreground font-medium">≈ {ringDiameter} in inner diameter</p>
                )}
              </div>
            )}

            {watchReferenceObjectType === 'hat' && (
              <div className="space-y-2 pt-1">
                <label className="text-sm font-medium">Hat type</label>
                <div className="grid grid-cols-2 gap-2">
                  {(Object.entries(HAT_DIMENSIONS) as Array<[HatType, typeof HAT_DIMENSIONS[HatType]]>).map(([val, info]) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => form.setValue('reference_object_hat_type', val, { shouldDirty: true })}
                      className={cn(
                        'px-3 py-2 rounded-xl text-sm font-medium border transition-all touch-manipulation min-h-[40px] text-left',
                        watchHatType === val
                          ? 'bg-primary/15 text-primary border-primary/30'
                          : 'bg-card text-muted-foreground border-border hover:text-foreground hover:border-border/80'
                      )}
                    >
                      {info.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Hat brim width is used as a scale reference. Backwards baseball caps, beanies, and skull caps have no visible brim — these are lower confidence because only the crown dome is usable.
                </p>
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Hat reference is an estimated calibration aid. Brim width varies between manufacturers. A ruler or tape measure is still more reliable.
                </p>
                {watchHatType && HAT_DIMENSIONS[watchHatType] && (
                  <p className="text-xs text-muted-foreground font-medium">
                    {HAT_DIMENSIONS[watchHatType].brim != null
                      ? `Brim ≈ ${HAT_DIMENSIONS[watchHatType].brim}" wide`
                      : `Crown ≈ ${HAT_DIMENSIONS[watchHatType].crown}" tall (less reliable than brim references)`}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        <Separator />

        {/* Section: Irregular/Abnormal Points (Phase 54) */}
        <Collapsible defaultOpen={watchRackType === 'non-typical'}>
          <div className="space-y-2">
            <CollapsibleTrigger className="flex items-center gap-2 w-full text-left group">
              <AlertCircle className="h-3.5 w-3.5 text-amber-500" />
              <h3 className="text-xs font-semibold text-foreground uppercase tracking-wide">Irregular Points</h3>
              <svg className="ml-auto h-3.5 w-3.5 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </CollapsibleTrigger>
            
            <CollapsibleContent className="space-y-2 pt-1">
              <div className="grid grid-cols-2 gap-2">
                <FormField
                  control={form.control}
                  name="irregular_points_present"
                  render={({ field }) => (
                    <FormItem className="space-y-1">
                      <FormLabel className="text-xs">Irregular?</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value ?? ""}>
                        <FormControl>
                          <SelectTrigger className="h-10 text-sm">
                            <SelectValue placeholder="Y/N/?" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {YES_NO_UNSURE_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="non_typical_traits_present"
                  render={({ field }) => (
                    <FormItem className="space-y-1">
                      <FormLabel className="text-xs">Non-Typical?</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value ?? ""}>
                        <FormControl>
                          <SelectTrigger className="h-10 text-sm">
                            <SelectValue placeholder="Y/N/?" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {YES_NO_UNSURE_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {(watchIrregularPoints === 'yes' || watchIrregularPoints === 'unsure') && (
                <div className="space-y-2">
                  <FormField
                    control={form.control}
                    name="estimated_irregular_points_count"
                    render={({ field }) => (
                      <FormItem className="space-y-1">
                        <FormLabel className="text-xs">Est. Count</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min={0}
                            max={50}
                            placeholder="3"
                            value={field.value ?? ''}
                            onChange={(e) => field.onChange(e.target.value === '' ? undefined : Number(e.target.value))}
                            className="h-10 text-sm"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="abnormal_point_tags"
                    render={({ field }) => (
                      <FormItem className="space-y-1">
                        <FormLabel className="text-xs">Type (multi)</FormLabel>
                        <div className="grid grid-cols-2 gap-1">
                          {ABNORMAL_POINT_TAGS.map((tag) => (
                            <label
                              key={tag.value}
                              className="flex items-center gap-1.5 px-2 py-1.5 rounded border border-border hover:bg-secondary/50 cursor-pointer transition-colors text-xs"
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
                                className="h-3.5 w-3.5"
                              />
                              <span className="font-medium truncate">{tag.label}</span>
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
                      <FormItem className="space-y-1">
                        <FormLabel className="text-xs">Notes</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="Drop tine on left G2..."
                            className="min-h-[50px] resize-none text-sm"
                            maxLength={500}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              )}
            </CollapsibleContent>
          </div>
        </Collapsible>

        {/* Precision Mode */}
        <div className="rounded-lg border border-border/60 bg-card p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Ruler className="h-3.5 w-3.5 text-muted-foreground" />
              <h3 className="text-xs font-semibold text-foreground uppercase tracking-wide">Precision</h3>
            </div>
            <Switch
              checked={!!watchPrecisionModeEnabled}
              onCheckedChange={(checked) => form.setValue('precision_mode_enabled', checked, { shouldDirty: true })}
              className="scale-90"
            />
          </div>

          {watchPrecisionModeEnabled && (
            <div className="space-y-2 pt-1 border-t border-border/40">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Type</label>
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
                    <SelectTrigger className="h-10 text-sm">
                      <SelectValue placeholder="Type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="ruler">Ruler</SelectItem>
                      <SelectItem value="credit_card">Card</SelectItem>
                      <SelectItem value="coin">Coin</SelectItem>
                      <SelectItem value="aruco_marker">Marker</SelectItem>
                      <SelectItem value="other_known_object">Other</SelectItem>
                      <SelectItem value="wedding_ring">Wedding band / ring</SelectItem>
                      <SelectItem value="hat">Hat (cap, beanie, Stetson)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {shouldShowReferenceSize && (
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">{referenceSizeLabel}</label>
                    <div className="flex gap-1">
                      <Input
                        type="number"
                        min="0.1"
                        step="0.01"
                        inputMode="decimal"
                        className="h-10 text-sm flex-1"
                        value={watchReferenceSizeValue ?? ''}
                        onChange={(e) => {
                          const value = e.target.value ? Number(e.target.value) : undefined
                          form.setValue('reference_size_value', value, { shouldDirty: true })
                        }}
                      />
                      <Select
                        value={watchReferenceSizeUnit ?? 'in'}
                        onValueChange={(value) => form.setValue('reference_size_unit', value as any, { shouldDirty: true })}
                      >
                        <SelectTrigger className="h-10 w-14 text-sm">
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
              </div>

              {/* Ring size — only when wedding_ring selected in precision mode */}
              {watchReferenceType === 'wedding_ring' && (
                <div className="space-y-2 p-3 rounded-lg"
                  style={{ background: 'rgba(107,93,82,0.06)', border: '1px solid rgba(107,93,82,0.15)' }}>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">US Ring Size</label>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      Whole and half sizes (3–16). Inner diameter used as scale reference.
                    </p>
                  </div>
                  <Input
                    type="number"
                    min="3"
                    max="16"
                    step="0.5"
                    inputMode="decimal"
                    placeholder="e.g. 8, 9.5, 10"
                    className="min-h-[48px]"
                    value={watchPrecisionRingSizeUS ?? ''}
                    onChange={(e) => {
                      const raw = e.target.value ? Number(e.target.value) : null
                      form.setValue('reference_ring_size_us', raw, { shouldDirty: true })
                    }}
                  />
                  {watchPrecisionRingSizeUS != null && watchPrecisionRingSizeUS >= 3 && watchPrecisionRingSizeUS <= 16 && (
                    <p className="text-[10px]" style={{ color: 'rgba(251,191,36,0.7)' }}>
                      ≈ {ringSizeToInnerDiameterInches(normalizeRingSizeUS(watchPrecisionRingSizeUS) ?? -1) ?? '—'}" inner diameter
                    </p>
                  )}
                  <p className="text-[10px]" style={{ color: 'rgba(139,90,43,0.75)' }}>
                    Estimated reference only. A ruler or tape measure is more reliable.
                  </p>
                </div>
              )}

              {/* Hat type — only when hat selected in precision mode */}
              {watchReferenceType === 'hat' && (
                <div className="space-y-2 p-3 rounded-lg"
                  style={{ background: 'rgba(107,93,82,0.06)', border: '1px solid rgba(107,93,82,0.15)' }}>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Hat Type</label>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      Hat brim width is used as a scale reference when clearly visible.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(Object.entries(HAT_DIMENSIONS) as Array<[HatType, typeof HAT_DIMENSIONS[HatType]]>).map(([val, info]) => {
                      const isSelected = watchPrecisionHatType === val
                      return (
                        <button
                          key={val}
                          type="button"
                          onClick={() => form.setValue('reference_hat_type', isSelected ? null : val, { shouldDirty: true })}
                          className="flex flex-col items-start gap-0.5 px-3 py-2 rounded-xl border transition-all touch-manipulation text-left"
                          style={{
                            background: isSelected ? 'rgba(139,90,43,0.12)' : 'transparent',
                            border:     isSelected ? '1px solid rgba(139,90,43,0.35)' : '1px solid rgba(107,93,82,0.25)',
                            color:      isSelected ? 'rgba(210,170,110,0.95)' : 'rgba(180,163,145,0.7)',
                          }}
                        >
                          <span className="text-xs font-medium">{info.label}</span>
                          {info.brim != null
                            ? <span className="text-[9px] opacity-70">Brim ≈ {info.brim}"</span>
                            : <span className="text-[9px] opacity-70">Crown only</span>
                          }
                        </button>
                      )
                    })}
                  </div>
                  <p className="text-[10px]" style={{ color: 'rgba(139,90,43,0.75)' }}>
                    Estimated reference only. Brim widths vary by manufacturer (±0.25").
                  </p>
                </div>
              )}

              {watchReferenceType === 'aruco_marker' && (
                <Button asChild variant="outline" size="sm" className="w-full h-8 text-xs">
                  <a href="/precision-marker" target="_blank" rel="noreferrer">
                    <Printer className="h-3.5 w-3.5" />
                    Print marker
                  </a>
                </Button>
              )}

              {referenceModeSummary.referencePresent && (
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Placement</label>
                  <Select
                    value={watchReferencePlacement ?? 'unknown'}
                    onValueChange={(value) => form.setValue('reference_placement', value as any, { shouldDirty: true })}
                  >
                    <SelectTrigger className="h-10 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="same_depth_plane">Same plane</SelectItem>
                      <SelectItem value="near_antler_plane">Near rack</SelectItem>
                      <SelectItem value="in_front_or_behind">Front/back</SelectItem>
                      <SelectItem value="unknown">Unknown</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Reference notes */}
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Notes</label>
                <Textarea
                  placeholder="Card beside left beam..."
                  className="min-h-[40px] resize-none text-sm"
                  value={watchReferenceNotes ?? ''}
                  onChange={(e) => form.setValue('reference_notes', e.target.value, { shouldDirty: true })}
                />
              </div>

              {/* Status indicator */}
              {referenceModeSummary.referencePresent && (
                <div className="flex items-center gap-1.5 text-xs text-primary">
                  <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                  <span className="font-medium">{referenceModeSummary.referenceType}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Known Measurements */}
        <PreScoringMeasurementsPanel
          value={preScoringMeasurements}
          onChange={setPreScoringMeasurements}
        />

        {/* Image Diagnostics Summary */}
        {imageDiagnosticsSummary && (
          <div className="rounded-lg border px-3 py-2 space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Quality</span>
              <span className="font-medium">{imageDiagnosticsSummary.overall}</span>
            </div>
            {imageDiagnosticsSummary.poorCount > 0 && (
              <p className="text-[11px] text-red-600">{imageDiagnosticsSummary.poorCount} image(s) may reduce accuracy</p>
            )}
            {imageDiagnosticsSummary.okCount > 0 && imageDiagnosticsSummary.poorCount === 0 && (
              <p className="text-[11px] text-amber-600">{imageDiagnosticsSummary.okCount} image(s) with reduced detail</p>
            )}
          </div>
        )}

        {(!hideBackButton || !hideSubmitButton) && (
          <div className="flex gap-2 pt-3 border-t border-border">
            {!hideBackButton && (
              <Button type="button" variant="outline" onClick={onBack} className="h-10 gap-1.5 text-sm" disabled={isSubmitting}>
                <ArrowLeft className="h-3.5 w-3.5" />Back
              </Button>
            )}
            {!hideSubmitButton && (
              <Button type="submit" className="flex-1 h-10 gap-1.5 text-sm" disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Analyzing...
                  </>
                ) : (
                  <>
                    Analyze Buck
                    <ArrowRight className="h-3.5 w-3.5" />
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
