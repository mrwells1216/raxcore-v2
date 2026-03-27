'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { FlaskConical, GitCompare, Filter, Plus, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import type { BulkValidationFilters, RackType, SourceType, CaptureDevice, CalibrationProfile } from '@/lib/types'
import type { ModelVersionRecord } from '@/lib/storage/service'

interface CreateBulkRunProps {
  modelVersions: ModelVersionRecord[]
  calibrationProfiles?: CalibrationProfile[]
}

const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
]

const RACK_TYPES: RackType[] = ['typical', 'non-typical']
const SOURCE_TYPES: SourceType[] = ['live_deer', 'mounted_photo', 'european_mount', 'trail_cam', 'harvest_photo', 'other']
const CAPTURE_DEVICES: CaptureDevice[] = ['iphone', 'android', 'digital_camera', 'photo_of_photo', 'vintage_photo', 'unknown']

export function CreateBulkRun({ modelVersions, calibrationProfiles = [] }: CreateBulkRunProps) {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Form state
  const [runName, setRunName] = useState('')
  const [runType, setRunType] = useState<'single_model' | 'model_comparison'>('single_model')
  const [primaryModelVersionId, setPrimaryModelVersionId] = useState<string>('')
  const [comparisonModelVersionIds, setComparisonModelVersionIds] = useState<string[]>([])
  const [primaryCalibrationProfileId, setPrimaryCalibrationProfileId] = useState<string>('')
  const [comparisonCalibrationProfileIds, setComparisonCalibrationProfileIds] = useState<string[]>([])

  // Filters
  const [filters, setFilters] = useState<BulkValidationFilters>({
    verifiedOnly: true,
  })

  // Filter toggles
  const [useStateFilter, setUseStateFilter] = useState(false)
  const [useRackTypeFilter, setUseRackTypeFilter] = useState(false)
  const [useSourceTypeFilter, setUseSourceTypeFilter] = useState(false)
  const [useCaptureDeviceFilter, setUseCaptureDeviceFilter] = useState(false)
  const [useScoreRangeFilter, setUseScoreRangeFilter] = useState(false)
  const [useImageCountFilter, setUseImageCountFilter] = useState(false)
  const [useSampleSize, setUseSampleSize] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!runName.trim()) {
      toast.error('Run name is required')
      return
    }

    if (runType === 'model_comparison' && comparisonModelVersionIds.length === 0) {
      toast.error('Select at least one model to compare against')
      return
    }

    setIsSubmitting(true)

    try {
      // Build filters object only with active filters
      const activeFilters: BulkValidationFilters = {
        verifiedOnly: filters.verifiedOnly,
      }

      if (useStateFilter && filters.states?.length) {
        activeFilters.states = filters.states
      }
      if (useRackTypeFilter && filters.rackTypes?.length) {
        activeFilters.rackTypes = filters.rackTypes
      }
      if (useSourceTypeFilter && filters.sourceTypes?.length) {
        activeFilters.sourceTypes = filters.sourceTypes
      }
      if (useCaptureDeviceFilter && filters.captureDevices?.length) {
        activeFilters.captureDevices = filters.captureDevices
      }
      if (useScoreRangeFilter) {
        if (filters.scoreRangeMin != null) activeFilters.scoreRangeMin = filters.scoreRangeMin
        if (filters.scoreRangeMax != null) activeFilters.scoreRangeMax = filters.scoreRangeMax
      }
      if (useImageCountFilter) {
        if (filters.minImageCount != null) activeFilters.minImageCount = filters.minImageCount
        if (filters.maxImageCount != null) activeFilters.maxImageCount = filters.maxImageCount
      }
      if (useSampleSize && filters.sampleSize) {
        activeFilters.sampleSize = filters.sampleSize
      }

      const res = await fetch('/api/admin/bulk-validation/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runName: runName.trim(),
          runType,
          primaryModelVersionId: primaryModelVersionId || null,
          comparisonModelVersionIds: runType === 'model_comparison' ? comparisonModelVersionIds : [],
          primaryCalibrationProfileId: primaryCalibrationProfileId || null,
          comparisonCalibrationProfileIds: runType === 'model_comparison' ? comparisonCalibrationProfileIds : [],
          filters: activeFilters,
        }),
      })

      const data = await res.json()

      if (data.success) {
        toast.success(`Run created with ${data.eligibleExamples} eligible examples`)
        router.push(`/admin/bulk-validation/${data.data.id}`)
      } else {
        toast.error(data.error || 'Failed to create run')
      }
    } catch (err) {
      toast.error('Failed to create run')
    } finally {
      setIsSubmitting(false)
    }
  }

  const toggleComparisonModel = (modelId: string) => {
    setComparisonModelVersionIds((prev) =>
      prev.includes(modelId) ? prev.filter((id) => id !== modelId) : [...prev, modelId]
    )
  }

  const toggleState = (state: string) => {
    const current = filters.states || []
    setFilters({
      ...filters,
      states: current.includes(state) ? current.filter((s) => s !== state) : [...current, state],
    })
  }

  const toggleRackType = (rackType: RackType) => {
    const current = filters.rackTypes || []
    setFilters({
      ...filters,
      rackTypes: current.includes(rackType) ? current.filter((r) => r !== rackType) : [...current, rackType],
    })
  }

  const toggleSourceType = (sourceType: SourceType) => {
    const current = filters.sourceTypes || []
    setFilters({
      ...filters,
      sourceTypes: current.includes(sourceType) ? current.filter((s) => s !== sourceType) : [...current, sourceType],
    })
  }

  const toggleCaptureDevice = (device: CaptureDevice) => {
    const current = filters.captureDevices || []
    setFilters({
      ...filters,
      captureDevices: current.includes(device) ? current.filter((d) => d !== device) : [...current, device],
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Plus className="h-5 w-5" />
          Create Bulk Validation Run
        </CardTitle>
        <CardDescription>
          Run known-score examples through the scoring pipeline and measure accuracy.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Basic Info */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="runName">Run Name</Label>
              <Input
                id="runName"
                placeholder="e.g., January 2026 Accuracy Test"
                value={runName}
                onChange={(e) => setRunName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Run Type</Label>
              <div className="flex gap-4">
                <Button
                  type="button"
                  variant={runType === 'single_model' ? 'default' : 'outline'}
                  className="flex-1 gap-2"
                  onClick={() => setRunType('single_model')}
                >
                  <FlaskConical className="h-4 w-4" />
                  Single Model Test
                </Button>
                <Button
                  type="button"
                  variant={runType === 'model_comparison' ? 'default' : 'outline'}
                  className="flex-1 gap-2"
                  onClick={() => setRunType('model_comparison')}
                >
                  <GitCompare className="h-4 w-4" />
                  Model Comparison
                </Button>
              </div>
            </div>
          </div>

          <Separator />

          {/* Model Selection */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Primary Model</Label>
              <Select
                value={primaryModelVersionId}
                onValueChange={setPrimaryModelVersionId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Current Active Model" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Current Active Model</SelectItem>
                  {modelVersions.map((model) => (
                    <SelectItem key={model.id} value={model.id}>
                      {model.version_name}
                      {model.is_active && (
                        <Badge variant="secondary" className="ml-2">
                          Active
                        </Badge>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {runType === 'model_comparison' && (
              <div className="space-y-2">
                <Label>Compare Against</Label>
                <div className="flex flex-wrap gap-2">
                  {modelVersions.map((model) => (
                    <Badge
                      key={model.id}
                      variant={comparisonModelVersionIds.includes(model.id) ? 'default' : 'outline'}
                      className="cursor-pointer"
                      onClick={() => toggleComparisonModel(model.id)}
                    >
                      {model.version_name}
                      {comparisonModelVersionIds.includes(model.id) && (
                        <X className="h-3 w-3 ml-1" />
                      )}
                    </Badge>
                  ))}
                </div>
                {comparisonModelVersionIds.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    Select one or more model versions to compare against
                  </p>
                )}
              </div>
            )}
          </div>

          <Separator />

          {/* Filters */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4" />
              <Label className="text-base">Filters</Label>
            </div>

            <div className="flex items-center justify-between">
              <Label htmlFor="verifiedOnly" className="cursor-pointer">
                Verified examples only
              </Label>
              <Switch
                id="verifiedOnly"
                checked={filters.verifiedOnly}
                onCheckedChange={(checked) => setFilters({ ...filters, verifiedOnly: checked })}
              />
            </div>

            <Accordion type="multiple" className="w-full">
              {/* State Filter */}
              <AccordionItem value="states">
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={useStateFilter}
                      onCheckedChange={(checked) => setUseStateFilter(checked === true)}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <span>Filter by State</span>
                    {useStateFilter && filters.states?.length ? (
                      <Badge variant="secondary">{filters.states.length} selected</Badge>
                    ) : null}
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="flex flex-wrap gap-1 pt-2">
                    {US_STATES.map((state) => (
                      <Badge
                        key={state}
                        variant={filters.states?.includes(state) ? 'default' : 'outline'}
                        className="cursor-pointer text-xs"
                        onClick={() => toggleState(state)}
                      >
                        {state}
                      </Badge>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>

              {/* Rack Type Filter */}
              <AccordionItem value="rackTypes">
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={useRackTypeFilter}
                      onCheckedChange={(checked) => setUseRackTypeFilter(checked === true)}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <span>Filter by Rack Type</span>
                    {useRackTypeFilter && filters.rackTypes?.length ? (
                      <Badge variant="secondary">{filters.rackTypes.length} selected</Badge>
                    ) : null}
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="flex flex-wrap gap-2 pt-2">
                    {RACK_TYPES.map((type) => (
                      <Badge
                        key={type}
                        variant={filters.rackTypes?.includes(type) ? 'default' : 'outline'}
                        className="cursor-pointer capitalize"
                        onClick={() => toggleRackType(type)}
                      >
                        {type.replace('_', ' ')}
                      </Badge>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>

              {/* Source Type Filter */}
              <AccordionItem value="sourceTypes">
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={useSourceTypeFilter}
                      onCheckedChange={(checked) => setUseSourceTypeFilter(checked === true)}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <span>Filter by Source Type</span>
                    {useSourceTypeFilter && filters.sourceTypes?.length ? (
                      <Badge variant="secondary">{filters.sourceTypes.length} selected</Badge>
                    ) : null}
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="flex flex-wrap gap-2 pt-2">
                    {SOURCE_TYPES.map((type) => (
                      <Badge
                        key={type}
                        variant={filters.sourceTypes?.includes(type) ? 'default' : 'outline'}
                        className="cursor-pointer capitalize"
                        onClick={() => toggleSourceType(type)}
                      >
                        {type.replace(/_/g, ' ')}
                      </Badge>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>

              {/* Capture Device Filter */}
              <AccordionItem value="captureDevices">
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={useCaptureDeviceFilter}
                      onCheckedChange={(checked) => setUseCaptureDeviceFilter(checked === true)}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <span>Filter by Capture Device</span>
                    {useCaptureDeviceFilter && filters.captureDevices?.length ? (
                      <Badge variant="secondary">{filters.captureDevices.length} selected</Badge>
                    ) : null}
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="flex flex-wrap gap-2 pt-2">
                    {CAPTURE_DEVICES.map((device) => (
                      <Badge
                        key={device}
                        variant={filters.captureDevices?.includes(device) ? 'default' : 'outline'}
                        className="cursor-pointer capitalize"
                        onClick={() => toggleCaptureDevice(device)}
                      >
                        {device.replace(/_/g, ' ')}
                      </Badge>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>

              {/* Score Range Filter */}
              <AccordionItem value="scoreRange">
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={useScoreRangeFilter}
                      onCheckedChange={(checked) => setUseScoreRangeFilter(checked === true)}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <span>Filter by Score Range</span>
                    {useScoreRangeFilter && (filters.scoreRangeMin != null || filters.scoreRangeMax != null) ? (
                      <Badge variant="secondary">
                        {filters.scoreRangeMin || 0}&quot; - {filters.scoreRangeMax || '∞'}&quot;
                      </Badge>
                    ) : null}
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="flex gap-4 pt-2">
                    <div className="flex-1 space-y-1">
                      <Label htmlFor="scoreMin" className="text-xs">Min Score</Label>
                      <Input
                        id="scoreMin"
                        type="number"
                        placeholder="0"
                        value={filters.scoreRangeMin || ''}
                        onChange={(e) => setFilters({ ...filters, scoreRangeMin: e.target.value ? Number(e.target.value) : undefined })}
                      />
                    </div>
                    <div className="flex-1 space-y-1">
                      <Label htmlFor="scoreMax" className="text-xs">Max Score</Label>
                      <Input
                        id="scoreMax"
                        type="number"
                        placeholder="No limit"
                        value={filters.scoreRangeMax || ''}
                        onChange={(e) => setFilters({ ...filters, scoreRangeMax: e.target.value ? Number(e.target.value) : undefined })}
                      />
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>

              {/* Image Count Filter */}
              <AccordionItem value="imageCount">
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={useImageCountFilter}
                      onCheckedChange={(checked) => setUseImageCountFilter(checked === true)}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <span>Filter by Image Count</span>
                    {useImageCountFilter && (filters.minImageCount != null || filters.maxImageCount != null) ? (
                      <Badge variant="secondary">
                        {filters.minImageCount || 1} - {filters.maxImageCount || '∞'}
                      </Badge>
                    ) : null}
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="flex gap-4 pt-2">
                    <div className="flex-1 space-y-1">
                      <Label htmlFor="minImages" className="text-xs">Min Images</Label>
                      <Input
                        id="minImages"
                        type="number"
                        min={1}
                        placeholder="1"
                        value={filters.minImageCount || ''}
                        onChange={(e) => setFilters({ ...filters, minImageCount: e.target.value ? Number(e.target.value) : undefined })}
                      />
                    </div>
                    <div className="flex-1 space-y-1">
                      <Label htmlFor="maxImages" className="text-xs">Max Images</Label>
                      <Input
                        id="maxImages"
                        type="number"
                        min={1}
                        placeholder="No limit"
                        value={filters.maxImageCount || ''}
                        onChange={(e) => setFilters({ ...filters, maxImageCount: e.target.value ? Number(e.target.value) : undefined })}
                      />
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>

              {/* Sample Size */}
              <AccordionItem value="sampleSize">
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={useSampleSize}
                      onCheckedChange={(checked) => setUseSampleSize(checked === true)}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <span>Limit Sample Size</span>
                    {useSampleSize && filters.sampleSize ? (
                      <Badge variant="secondary">{filters.sampleSize} examples</Badge>
                    ) : null}
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-1 pt-2">
                    <Label htmlFor="sampleSize" className="text-xs">Max Examples</Label>
                    <Input
                      id="sampleSize"
                      type="number"
                      min={1}
                      placeholder="All eligible examples"
                      value={filters.sampleSize || ''}
                      onChange={(e) => setFilters({ ...filters, sampleSize: e.target.value ? Number(e.target.value) : undefined })}
                    />
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>

          <Separator />

          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Creating Run...
              </>
            ) : (
              <>
                <Plus className="h-4 w-4 mr-2" />
                Create Bulk Validation Run
              </>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
