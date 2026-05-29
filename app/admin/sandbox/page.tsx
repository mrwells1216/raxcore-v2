'use client'

import { useState, useEffect } from 'react'
import useSWR from 'swr'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import {
  FlaskConical,
  Play,
  CheckCircle,
  XCircle,
  AlertTriangle,
  ArrowUp,
  ArrowDown,
  Minus,
  RotateCcw,
  Eye,
  Settings,
  TrendingUp,
  Target,
  Layers,
  GitCompare,
} from 'lucide-react'
import type {
  ScoringVariantWithStats,
  EvaluationRun,
  VariantComparisonWithDetails,
  PromotionGateEvaluation,
} from '@/lib/types'
import { AbEvaluatePanel } from '@/components/admin/ab-evaluate-panel'

const fetcher = (url: string) => fetch(url).then(r => r.json())

export default function SandboxPage() {
  const [activeTab, setActiveTab] = useState('variants')
  const [selectedVariant, setSelectedVariant] = useState<string | null>(null)

  return (
    <div className="container py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <FlaskConical className="h-8 w-8" />
            Scoring Sandbox
          </h1>
          <p className="text-muted-foreground mt-1">
            Test and evaluate candidate scoring variants before promotion
          </p>
        </div>
        <CreateVariantDialog />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="variants" className="flex items-center gap-2">
            <Layers className="h-4 w-4" />
            Variants
          </TabsTrigger>
          <TabsTrigger value="evaluations" className="flex items-center gap-2">
            <Target className="h-4 w-4" />
            Evaluations
          </TabsTrigger>
          <TabsTrigger value="comparisons" className="flex items-center gap-2">
            <GitCompare className="h-4 w-4" />
            Comparisons
          </TabsTrigger>
          <TabsTrigger value="ab" className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4" />
            Auto A/B
          </TabsTrigger>
          <TabsTrigger value="shadow" className="flex items-center gap-2">
            <Eye className="h-4 w-4" />
            Shadow Scoring
          </TabsTrigger>
        </TabsList>

        <TabsContent value="variants" className="space-y-4">
          <VariantsTab
            selectedVariant={selectedVariant}
            onSelectVariant={setSelectedVariant}
          />
        </TabsContent>

        <TabsContent value="evaluations" className="space-y-4">
          <EvaluationsTab selectedVariant={selectedVariant} />
        </TabsContent>

        <TabsContent value="comparisons" className="space-y-4">
          <ComparisonsTab />
        </TabsContent>

        <TabsContent value="ab" className="space-y-4">
          <AbEvaluatePanel />
        </TabsContent>

        <TabsContent value="shadow" className="space-y-4">
          <ShadowScoringTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ============================================================================
// VARIANTS TAB
// ============================================================================

function VariantsTab({
  selectedVariant,
  onSelectVariant,
}: {
  selectedVariant: string | null
  onSelectVariant: (id: string | null) => void
}) {
  const { data, error, isLoading, mutate } = useSWR<{
    variants: ScoringVariantWithStats[]
    productionId: string | null
  }>('/api/admin/sandbox/variants', fetcher)

  if (isLoading) return <div className="text-center py-8">Loading variants...</div>
  if (error) return <div className="text-center py-8 text-destructive">Failed to load variants</div>

  const variants = data?.variants || []
  const productionId = data?.productionId

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <div className="md:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle>Scoring Variants</CardTitle>
            <CardDescription>
              All registered scoring variants (models, calibrations, pipelines)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Predictions</TableHead>
                  <TableHead>Evaluations</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {variants.map(variant => (
                  <TableRow
                    key={variant.id}
                    className={selectedVariant === variant.id ? 'bg-muted/50' : ''}
                    onClick={() => onSelectVariant(variant.id)}
                  >
                    <TableCell>
                      <div className="font-medium">{variant.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {variant.version_tag}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{variant.variant_type}</Badge>
                    </TableCell>
                    <TableCell>
                      {variant.is_production ? (
                        <Badge className="bg-green-500">Production</Badge>
                      ) : variant.is_candidate ? (
                        <Badge variant="secondary">Candidate</Badge>
                      ) : variant.is_archived ? (
                        <Badge variant="outline" className="text-muted-foreground">
                          Archived
                        </Badge>
                      ) : (
                        <Badge variant="outline">Draft</Badge>
                      )}
                    </TableCell>
                    <TableCell>{variant.prediction_count}</TableCell>
                    <TableCell>
                      {variant.completed_evaluation_count}/{variant.evaluation_run_count}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={e => {
                          e.stopPropagation()
                          onSelectVariant(variant.id)
                        }}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {variants.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      No variants found. Create one to get started.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <div>
        {selectedVariant ? (
          <VariantDetailCard
            variantId={selectedVariant}
            isProduction={selectedVariant === productionId}
            onMutate={() => mutate()}
          />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Variant Details</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground text-sm">
                Select a variant to view details and actions
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}

function VariantDetailCard({
  variantId,
  isProduction,
  onMutate,
}: {
  variantId: string
  isProduction: boolean
  onMutate: () => void
}) {
  const { data: variant, isLoading } = useSWR<ScoringVariantWithStats>(
    `/api/admin/sandbox/variants/${variantId}`,
    fetcher
  )
  const [isPromoting, setIsPromoting] = useState(false)
  const [isRollingBack, setIsRollingBack] = useState(false)

  if (isLoading || !variant) {
    return (
      <Card>
        <CardContent className="py-8 text-center">Loading...</CardContent>
      </Card>
    )
  }

  const handlePromote = async () => {
    if (!confirm('Are you sure you want to promote this variant to production?')) return
    setIsPromoting(true)
    try {
      await fetch(`/api/admin/sandbox/variants/${variantId}/promote`, { method: 'POST' })
      onMutate()
    } finally {
      setIsPromoting(false)
    }
  }

  const handleRollback = async () => {
    if (!confirm('Are you sure you want to rollback to this variant?')) return
    setIsRollingBack(true)
    try {
      await fetch(`/api/admin/sandbox/variants/${variantId}/rollback`, { method: 'POST' })
      onMutate()
    } finally {
      setIsRollingBack(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle>{variant.name}</CardTitle>
            <CardDescription>{variant.version_tag}</CardDescription>
          </div>
          {variant.is_production && (
            <Badge className="bg-green-500">Production</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-muted-foreground">Type</div>
            <div className="font-medium">{variant.variant_type}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Status</div>
            <div className="font-medium">
              {variant.is_production
                ? 'Production'
                : variant.is_candidate
                  ? 'Candidate'
                  : 'Draft'}
            </div>
          </div>
          {variant.model_version_name && (
            <div>
              <div className="text-muted-foreground">Model</div>
              <div className="font-medium">{variant.model_version_name}</div>
            </div>
          )}
          {variant.calibration_profile_name && (
            <div>
              <div className="text-muted-foreground">Calibration</div>
              <div className="font-medium">{variant.calibration_profile_name}</div>
            </div>
          )}
          <div>
            <div className="text-muted-foreground">Predictions</div>
            <div className="font-medium">{variant.prediction_count}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Shadow Predictions</div>
            <div className="font-medium">{variant.shadow_prediction_count}</div>
          </div>
        </div>

        {variant.notes && (
          <div className="text-sm">
            <div className="text-muted-foreground">Notes</div>
            <div>{variant.notes}</div>
          </div>
        )}

        <div className="flex flex-col gap-2 pt-4">
          {!variant.is_production && variant.is_candidate && (
            <Button onClick={handlePromote} disabled={isPromoting}>
              <ArrowUp className="h-4 w-4 mr-2" />
              Promote to Production
            </Button>
          )}
          {!variant.is_production && !variant.is_candidate && (
            <Button
              variant="secondary"
              onClick={async () => {
                await fetch(`/api/admin/sandbox/variants/${variantId}/candidate`, {
                  method: 'POST',
                })
                onMutate()
              }}
            >
              Mark as Candidate
            </Button>
          )}
          {!variant.is_production && (
            <Button
              variant="outline"
              onClick={handleRollback}
              disabled={isRollingBack}
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              Rollback to This
            </Button>
          )}
          <Button variant="outline" asChild>
            <a href={`/admin/sandbox/evaluate?variant=${variantId}`}>
              <Play className="h-4 w-4 mr-2" />
              Run Evaluation
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ============================================================================
// EVALUATIONS TAB
// ============================================================================

function EvaluationsTab({ selectedVariant }: { selectedVariant: string | null }) {
  const { data, error, isLoading } = useSWR<{ runs: EvaluationRun[] }>(
    selectedVariant
      ? `/api/admin/sandbox/evaluations?variant=${selectedVariant}`
      : '/api/admin/sandbox/evaluations',
    fetcher
  )

  if (isLoading) return <div className="text-center py-8">Loading evaluations...</div>
  if (error)
    return <div className="text-center py-8 text-destructive">Failed to load evaluations</div>

  const runs = data?.runs || []

  return (
    <Card>
      <CardHeader>
        <CardTitle>Evaluation Runs</CardTitle>
        <CardDescription>
          {selectedVariant
            ? 'Evaluation runs for selected variant'
            : 'All evaluation runs'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Variant</TableHead>
              <TableHead>Dataset</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Progress</TableHead>
              <TableHead>MAE</TableHead>
              <TableHead>P95</TableHead>
              <TableHead>Created</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map(run => (
              <TableRow key={run.id}>
                <TableCell className="font-mono text-xs">
                  {run.variant_id.slice(0, 8)}...
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{run.dataset_type}</Badge>
                </TableCell>
                <TableCell>
                  <StatusBadge status={run.status} />
                </TableCell>
                <TableCell>
                  {run.processed_examples}/{run.total_examples}
                </TableCell>
                <TableCell>
                  {run.metrics?.mae_gross?.toFixed(2) || '-'}
                </TableCell>
                <TableCell>
                  {run.metrics?.p95_error?.toFixed(2) || '-'}
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {new Date(run.created_at).toLocaleDateString()}
                </TableCell>
                <TableCell>
                  <Button variant="ghost" size="sm" asChild>
                    <a href={`/admin/sandbox/evaluations/${run.id}`}>
                      <Eye className="h-4 w-4" />
                    </a>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {runs.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground">
                  No evaluation runs found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

// ============================================================================
// COMPARISONS TAB
// ============================================================================

function ComparisonsTab() {
  const { data, error, isLoading } = useSWR<{ comparisons: VariantComparisonWithDetails[] }>(
    '/api/admin/sandbox/comparisons',
    fetcher
  )

  if (isLoading) return <div className="text-center py-8">Loading comparisons...</div>
  if (error)
    return <div className="text-center py-8 text-destructive">Failed to load comparisons</div>

  const comparisons = data?.comparisons || []

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Variant Comparisons</CardTitle>
          <CardDescription>
            Production vs. candidate comparison results with promotion gate evaluations
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Production</TableHead>
                <TableHead>Candidate</TableHead>
                <TableHead>MAE Change</TableHead>
                <TableHead>P95 Change</TableHead>
                <TableHead>Gate Status</TableHead>
                <TableHead>Signal</TableHead>
                <TableHead>Created</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {comparisons.map(comp => (
                <TableRow key={comp.id}>
                  <TableCell>
                    <div className="text-sm font-medium">{comp.production_variant_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {comp.production_version_tag}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm font-medium">{comp.candidate_variant_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {comp.candidate_version_tag}
                    </div>
                  </TableCell>
                  <TableCell>
                    <ImprovementIndicator
                      value={comp.mae_improvement}
                      unit='"'
                      invertColors
                    />
                  </TableCell>
                  <TableCell>
                    <ImprovementIndicator
                      value={comp.p95_improvement}
                      unit='"'
                      invertColors
                    />
                  </TableCell>
                  <TableCell>
                    <GateStatusBadge status={comp.gate_status} />
                  </TableCell>
                  <TableCell>
                    <PromotionSignalBadge signal={comp.promotion_signal} />
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {new Date(comp.created_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" asChild>
                      <a href={`/admin/sandbox/comparisons/${comp.id}`}>
                        <Eye className="h-4 w-4" />
                      </a>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {comparisons.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground">
                    No comparisons found. Run evaluations and create a comparison to see results.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

// ============================================================================
// SHADOW SCORING TAB
// ============================================================================

function ShadowScoringTab() {
  const { data, error, isLoading, mutate } = useSWR<{
    configs: Array<{
      id: string
      candidate_variant_id: string
      variant_name: string
      sampling_rate: number
      is_enabled: boolean
      shadow_count_today: number
      max_per_day: number | null
    }>
  }>('/api/admin/sandbox/shadow-configs', fetcher)

  if (isLoading) return <div className="text-center py-8">Loading shadow configs...</div>
  if (error)
    return <div className="text-center py-8 text-destructive">Failed to load shadow configs</div>

  const configs = data?.configs || []

  const toggleConfig = async (id: string, enabled: boolean) => {
    await fetch(`/api/admin/sandbox/shadow-configs/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_enabled: enabled }),
    })
    mutate()
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Shadow Scoring Configurations</CardTitle>
          <CardDescription>
            Configure which candidates run shadow scoring alongside production
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Variant</TableHead>
                <TableHead>Sampling</TableHead>
                <TableHead>Today</TableHead>
                <TableHead>Enabled</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {configs.map(config => (
                <TableRow key={config.id}>
                  <TableCell className="font-medium">{config.variant_name}</TableCell>
                  <TableCell>{(config.sampling_rate * 100).toFixed(0)}%</TableCell>
                  <TableCell>
                    {config.shadow_count_today}
                    {config.max_per_day && `/${config.max_per_day}`}
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={config.is_enabled}
                      onCheckedChange={checked => toggleConfig(config.id, checked)}
                    />
                  </TableCell>
                </TableRow>
              ))}
              {configs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    No shadow scoring configurations. Mark a variant as candidate and enable
                    shadow scoring.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Shadow Scoring Stats</CardTitle>
          <CardDescription>Recent shadow prediction activity</CardDescription>
        </CardHeader>
        <CardContent>
          <ShadowStatsCard />
        </CardContent>
      </Card>
    </div>
  )
}

function ShadowStatsCard() {
  const { data, isLoading } = useSWR<{
    totalToday: number
    totalWeek: number
    avgGrossDiff: number | null
    avgConfidenceDiff: number | null
  }>('/api/admin/sandbox/shadow-stats', fetcher)

  if (isLoading) return <div>Loading stats...</div>

  return (
    <div className="grid grid-cols-2 gap-4">
      <div>
        <div className="text-2xl font-bold">{data?.totalToday ?? 0}</div>
        <div className="text-sm text-muted-foreground">Shadow runs today</div>
      </div>
      <div>
        <div className="text-2xl font-bold">{data?.totalWeek ?? 0}</div>
        <div className="text-sm text-muted-foreground">Shadow runs this week</div>
      </div>
      <div>
        <div className="text-2xl font-bold">
          {data?.avgGrossDiff != null ? `${data.avgGrossDiff.toFixed(2)}"` : '-'}
        </div>
        <div className="text-sm text-muted-foreground">Avg gross diff</div>
      </div>
      <div>
        <div className="text-2xl font-bold">
          {data?.avgConfidenceDiff != null
            ? `${data.avgConfidenceDiff.toFixed(1)}%`
            : '-'}
        </div>
        <div className="text-sm text-muted-foreground">Avg confidence diff</div>
      </div>
    </div>
  )
}

// ============================================================================
// CREATE VARIANT DIALOG
// ============================================================================

function CreateVariantDialog() {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [versionTag, setVersionTag] = useState('')
  const [variantType, setVariantType] = useState('model')
  const [notes, setNotes] = useState('')
  const [isCreating, setIsCreating] = useState(false)

  const handleCreate = async () => {
    if (!name || !versionTag) return
    setIsCreating(true)
    try {
      await fetch('/api/admin/sandbox/variants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          version_tag: versionTag,
          variant_type: variantType,
          notes,
          is_candidate: true,
        }),
      })
      setOpen(false)
      setName('')
      setVersionTag('')
      setNotes('')
      // Trigger refresh
      window.location.reload()
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <FlaskConical className="h-4 w-4 mr-2" />
          New Variant
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Scoring Variant</DialogTitle>
          <DialogDescription>
            Create a new candidate variant for testing
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g., Improved Beam Detection v2"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="version">Version Tag</Label>
            <Input
              id="version"
              value={versionTag}
              onChange={e => setVersionTag(e.target.value)}
              placeholder="e.g., v2.1.0-beam-fix"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="type">Variant Type</Label>
            <Select value={variantType} onValueChange={setVariantType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="model">Model</SelectItem>
                <SelectItem value="calibration">Calibration</SelectItem>
                <SelectItem value="pipeline">Pipeline</SelectItem>
                <SelectItem value="hybrid">Hybrid</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Describe what this variant changes..."
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={isCreating || !name || !versionTag}>
            Create Variant
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ============================================================================
// HELPER COMPONENTS
// ============================================================================

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'completed':
      return (
        <Badge className="bg-green-500">
          <CheckCircle className="h-3 w-3 mr-1" />
          Completed
        </Badge>
      )
    case 'running':
      return (
        <Badge variant="secondary">
          <Play className="h-3 w-3 mr-1" />
          Running
        </Badge>
      )
    case 'failed':
      return (
        <Badge variant="destructive">
          <XCircle className="h-3 w-3 mr-1" />
          Failed
        </Badge>
      )
    case 'pending':
      return <Badge variant="outline">Pending</Badge>
    default:
      return <Badge variant="outline">{status}</Badge>
  }
}

function GateStatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-muted-foreground">-</span>
  
  switch (status) {
    case 'eligible':
      return (
        <Badge className="bg-green-500">
          <CheckCircle className="h-3 w-3 mr-1" />
          Eligible
        </Badge>
      )
    case 'needs_review':
      return (
        <Badge variant="secondary" className="bg-yellow-500 text-white">
          <AlertTriangle className="h-3 w-3 mr-1" />
          Review
        </Badge>
      )
    case 'rejected':
      return (
        <Badge variant="destructive">
          <XCircle className="h-3 w-3 mr-1" />
          Rejected
        </Badge>
      )
    default:
      return <Badge variant="outline">{status}</Badge>
  }
}

function PromotionSignalBadge({ signal }: { signal: string | null }) {
  if (!signal) return <span className="text-muted-foreground">-</span>

  switch (signal) {
    case 'strongly_recommend':
      return <Badge className="bg-green-600">Strong Recommend</Badge>
    case 'recommend':
      return <Badge className="bg-green-500">Recommend</Badge>
    case 'neutral':
      return <Badge variant="secondary">Neutral</Badge>
    case 'caution':
      return <Badge variant="secondary" className="bg-yellow-500 text-white">Caution</Badge>
    case 'do_not_promote':
      return <Badge variant="destructive">Do Not Promote</Badge>
    default:
      return <Badge variant="outline">{signal}</Badge>
  }
}

function ImprovementIndicator({
  value,
  unit = '',
  invertColors = false,
}: {
  value: number | null
  unit?: string
  invertColors?: boolean
}) {
  if (value === null) return <span className="text-muted-foreground">-</span>

  const isPositive = invertColors ? value > 0 : value < 0
  const isNegative = invertColors ? value < 0 : value > 0
  const displayValue = Math.abs(value).toFixed(2)

  return (
    <div
      className={`flex items-center gap-1 ${
        isPositive
          ? 'text-green-600'
          : isNegative
            ? 'text-red-600'
            : 'text-muted-foreground'
      }`}
    >
      {value > 0 ? (
        <ArrowUp className="h-3 w-3" />
      ) : value < 0 ? (
        <ArrowDown className="h-3 w-3" />
      ) : (
        <Minus className="h-3 w-3" />
      )}
      {displayValue}
      {unit}
    </div>
  )
}
