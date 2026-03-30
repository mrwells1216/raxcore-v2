/**
 * Phase 53: Admin - Training Pack Detail
 *
 * Shows pack details including:
 * - Overview with stats and configuration
 * - Items with supervision artifacts
 * - Auxiliary labels with distribution
 * - Export options and history
 */

import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Progress } from '@/components/ui/progress'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Package,
  Database,
  Tag,
  Download,
  ArrowLeft,
  Layers,
  GitBranch,
  CheckCircle2,
  Clock,
  Archive,
  FileJson,
  FileSpreadsheet,
  RefreshCw,
  AlertCircle,
  Zap,
  Settings,
} from 'lucide-react'
import Link from 'next/link'
import { getTrainingPackWithStats, getTrainingPackItems } from '@/lib/training-packs/service'
import { getLabelsForPack } from '@/lib/auxiliary-labels/service'
import { getExportHistory } from '@/lib/training-packs/manifest'
import type { 
  TrainingPackType, 
  TrainingPackStatus, 
  TrainingPackItem, 
  AuxiliaryLabel,
  TrainingPackExport,
  TrainingSplitType,
} from '@/lib/types'
import { GeneratePackButton } from '@/components/admin/generate-pack-button'
import { ExportPackButton } from '@/components/admin/export-pack-button'

// ============================================================================
// HELPERS
// ============================================================================

function PackTypeBadge({ type }: { type: TrainingPackType }) {
  const config: Record<TrainingPackType, { label: string; className: string }> = {
    baseline_supervision_pack: { label: 'Baseline', className: 'text-blue-400 border-blue-400/30 bg-blue-400/10' },
    reverse_pass_pack: { label: 'Reverse Pass', className: 'text-purple-400 border-purple-400/30 bg-purple-400/10' },
    structural_solver_pack: { label: 'Structural', className: 'text-indigo-400 border-indigo-400/30 bg-indigo-400/10' },
    hard_case_pack: { label: 'Hard Case', className: 'text-orange-400 border-orange-400/30 bg-orange-400/10' },
    confidence_failure_pack: { label: 'Confidence', className: 'text-yellow-400 border-yellow-400/30 bg-yellow-400/10' },
    segment_specific_pack: { label: 'Segment', className: 'text-teal-400 border-teal-400/30 bg-teal-400/10' },
    candidate_finetune_pack: { label: 'Candidate', className: 'text-pink-400 border-pink-400/30 bg-pink-400/10' },
    benchmark_holdout_pack: { label: 'Holdout', className: 'text-gray-400 border-gray-400/30 bg-gray-400/10' },
  }
  const { label, className } = config[type] || { label: type, className: '' }
  return <Badge variant="outline" className={className}>{label}</Badge>
}

function PackStatusBadge({ status }: { status: TrainingPackStatus }) {
  const config: Record<TrainingPackStatus, { label: string; className: string; icon: React.ReactNode }> = {
    draft: { label: 'Draft', className: 'text-gray-400 border-gray-400/30 bg-gray-400/10', icon: <Clock className="h-3 w-3" /> },
    ready: { label: 'Ready', className: 'text-green-400 border-green-400/30 bg-green-400/10', icon: <CheckCircle2 className="h-3 w-3" /> },
    exported: { label: 'Exported', className: 'text-blue-400 border-blue-400/30 bg-blue-400/10', icon: <Download className="h-3 w-3" /> },
    archived: { label: 'Archived', className: 'text-yellow-400 border-yellow-400/30 bg-yellow-400/10', icon: <Archive className="h-3 w-3" /> },
  }
  const { label, className, icon } = config[status]
  return (
    <Badge variant="outline" className={`flex items-center gap-1 ${className}`}>
      {icon}
      {label}
    </Badge>
  )
}

function SplitBadge({ split }: { split: TrainingSplitType }) {
  const config: Record<TrainingSplitType, { label: string; className: string }> = {
    train: { label: 'Train', className: 'text-green-400 border-green-400/30 bg-green-400/10' },
    validation: { label: 'Val', className: 'text-blue-400 border-blue-400/30 bg-blue-400/10' },
    test: { label: 'Test', className: 'text-purple-400 border-purple-400/30 bg-purple-400/10' },
    benchmark_holdout: { label: 'Holdout', className: 'text-orange-400 border-orange-400/30 bg-orange-400/10' },
  }
  const { label, className } = config[split]
  return <Badge variant="outline" className={`text-xs ${className}`}>{label}</Badge>
}

function StatBox({ label, value, subValue }: { label: string; value: number | string; subValue?: string }) {
  return (
    <div className="text-center p-4 rounded-lg bg-muted/50">
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
      {subValue && <p className="text-xs text-muted-foreground mt-0.5">{subValue}</p>}
    </div>
  )
}

// ============================================================================
// PAGE
// ============================================================================

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function TrainingPackDetailPage({ params }: PageProps) {
  const resolvedParams = await params
  const supabase = await createClient()

  // Check auth
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    redirect('/login')
  }

  // Fetch pack with stats
  const pack = await getTrainingPackWithStats(resolvedParams.id)
  if (!pack) {
    notFound()
  }

  // Fetch items (limited for display)
  let items: TrainingPackItem[] = []
  try {
    items = await getTrainingPackItems(resolvedParams.id, { limit: 100 })
  } catch (error) {
    console.error('Failed to fetch items:', error)
  }

  // Fetch labels
  let labels: AuxiliaryLabel[] = []
  try {
    labels = await getLabelsForPack(resolvedParams.id, { limit: 500 })
  } catch (error) {
    console.error('Failed to fetch labels:', error)
  }

  // Fetch export history
  let exports: TrainingPackExport[] = []
  try {
    exports = await getExportHistory(resolvedParams.id)
  } catch (error) {
    console.error('Failed to fetch exports:', error)
  }

  // Calculate label distribution
  const labelDist = labels.reduce((acc, l) => {
    acc[l.auxiliary_label_type] = (acc[l.auxiliary_label_type] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  const confirmedLabels = labels.filter(l => l.status === 'confirmed').length
  const pendingLabels = labels.filter(l => l.status === 'pending').length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Link href="/admin/training-packs">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="h-4 w-4 mr-1" />
                Back
              </Button>
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{pack.name}</h1>
            <PackTypeBadge type={pack.pack_type} />
            <PackStatusBadge status={pack.status} />
          </div>
          {pack.description && (
            <p className="text-muted-foreground mt-1">{pack.description}</p>
          )}
        </div>
        <div className="flex gap-2">
          {pack.status === 'draft' && (
            <GeneratePackButton packId={pack.id} />
          )}
          {(pack.status === 'ready' || pack.status === 'exported') && (
            <ExportPackButton packId={pack.id} packName={pack.name} />
          )}
        </div>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        <StatBox label="Total Items" value={pack.item_count.toLocaleString()} />
        <StatBox label="Train" value={pack.train_count.toLocaleString()} />
        <StatBox label="Validation" value={pack.validation_count.toLocaleString()} />
        <StatBox label="Test" value={pack.test_count.toLocaleString()} />
        <StatBox label="Holdout" value={pack.holdout_count.toLocaleString()} />
        <StatBox 
          label="Labels" 
          value={labels.length.toLocaleString()} 
          subValue={`${confirmedLabels} confirmed`}
        />
      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="items">Items ({pack.item_count})</TabsTrigger>
          <TabsTrigger value="labels">Labels ({labels.length})</TabsTrigger>
          <TabsTrigger value="exports">Exports ({exports.length})</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Configuration */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Settings className="h-4 w-4" />
                  Configuration
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Split Seed</span>
                  <span className="font-mono">{pack.split_seed ?? 'Not set'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Train Ratio</span>
                  <span>{(pack.split_config_json.train * 100).toFixed(0)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Validation Ratio</span>
                  <span>{(pack.split_config_json.validation * 100).toFixed(0)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Test Ratio</span>
                  <span>{(pack.split_config_json.test * 100).toFixed(0)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Holdout Ratio</span>
                  <span>{(pack.split_config_json.benchmark_holdout * 100).toFixed(0)}%</span>
                </div>
                {pack.variant_id && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Linked Variant</span>
                    <Link 
                      href={`/admin/sandbox/variants/${pack.variant_id}`}
                      className="text-blue-400 hover:underline"
                    >
                      View
                    </Link>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Artifact Coverage */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Layers className="h-4 w-4" />
                  Artifact Coverage
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span>With Supervision</span>
                    <span>{pack.stats.items_with_supervision} / {pack.item_count}</span>
                  </div>
                  <Progress value={pack.item_count > 0 ? (pack.stats.items_with_supervision / pack.item_count) * 100 : 0} />
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span>With Reverse Run</span>
                    <span>{pack.stats.items_with_reverse} / {pack.item_count}</span>
                  </div>
                  <Progress value={pack.item_count > 0 ? (pack.stats.items_with_reverse / pack.item_count) * 100 : 0} />
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span>With Structural Run</span>
                    <span>{pack.stats.items_with_structural} / {pack.item_count}</span>
                  </div>
                  <Progress value={pack.item_count > 0 ? (pack.stats.items_with_structural / pack.item_count) * 100 : 0} />
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span>Hard-Case Pattern</span>
                    <span>{pack.stats.items_with_hard_case} / {pack.item_count}</span>
                  </div>
                  <Progress value={pack.item_count > 0 ? (pack.stats.items_with_hard_case / pack.item_count) * 100 : 0} />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Label Distribution */}
          {Object.keys(labelDist).length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Tag className="h-4 w-4" />
                  Label Distribution
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(labelDist)
                    .sort(([, a], [, b]) => b - a)
                    .map(([label, count]) => (
                      <Badge key={label} variant="secondary" className="text-xs">
                        {label.replace('likely_', '').replace(/_/g, ' ')}: {count}
                      </Badge>
                    ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Items Tab */}
        <TabsContent value="items">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Pack Items</CardTitle>
              <CardDescription>
                Predictions included in this pack with their supervision artifacts
              </CardDescription>
            </CardHeader>
            <CardContent>
              {items.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <AlertCircle className="h-8 w-8 mx-auto mb-2" />
                  <p>No items in this pack yet</p>
                  <p className="text-xs mt-1">Run pack generation to populate items</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Prediction</TableHead>
                      <TableHead>Split</TableHead>
                      <TableHead>Supervision</TableHead>
                      <TableHead>Reverse</TableHead>
                      <TableHead>Structural</TableHead>
                      <TableHead className="text-right">Confidence</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>
                          <Link 
                            href={`/admin/predictions/${item.prediction_id}`}
                            className="font-mono text-xs hover:underline"
                          >
                            {item.prediction_id.slice(0, 8)}...
                          </Link>
                        </TableCell>
                        <TableCell>
                          <SplitBadge split={item.split_assignment} />
                        </TableCell>
                        <TableCell>
                          {item.supervision_event_ids.length > 0 ? (
                            <Badge variant="outline" className="text-xs">
                              {item.supervision_event_ids.length} events
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {item.reverse_run_id ? (
                            <CheckCircle2 className="h-4 w-4 text-green-400" />
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {item.structural_hypothesis_run_id ? (
                            <CheckCircle2 className="h-4 w-4 text-green-400" />
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {item.confidence_score?.toFixed(2) ?? '-'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              {pack.item_count > 100 && (
                <p className="text-xs text-muted-foreground text-center mt-4">
                  Showing first 100 of {pack.item_count} items
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Labels Tab */}
        <TabsContent value="labels">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Auxiliary Labels</CardTitle>
              <CardDescription>
                Machine-readable labels inferred from supervision artifacts
              </CardDescription>
            </CardHeader>
            <CardContent>
              {labels.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Tag className="h-8 w-8 mx-auto mb-2" />
                  <p>No labels generated yet</p>
                  <p className="text-xs mt-1">Run pack generation to create labels</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Label Type</TableHead>
                      <TableHead>Confidence</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {labels.slice(0, 100).map((label) => (
                      <TableRow key={label.id}>
                        <TableCell className="font-medium text-sm">
                          {label.auxiliary_label_type.replace('likely_', '').replace(/_/g, ' ')}
                        </TableCell>
                        <TableCell>
                          <Progress value={label.confidence * 100} className="w-20 h-2" />
                          <span className="text-xs text-muted-foreground ml-2">
                            {(label.confidence * 100).toFixed(0)}%
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {label.source}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge 
                            variant="outline" 
                            className={
                              label.status === 'confirmed' 
                                ? 'text-green-400 border-green-400/30' 
                                : label.status === 'rejected'
                                ? 'text-red-400 border-red-400/30'
                                : 'text-yellow-400 border-yellow-400/30'
                            }
                          >
                            {label.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              {labels.length > 100 && (
                <p className="text-xs text-muted-foreground text-center mt-4">
                  Showing first 100 of {labels.length} labels
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Exports Tab */}
        <TabsContent value="exports">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base">Export History</CardTitle>
                <CardDescription>
                  Previous exports of this training pack
                </CardDescription>
              </div>
              <ExportPackButton packId={pack.id} packName={pack.name} />
            </CardHeader>
            <CardContent>
              {exports.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Download className="h-8 w-8 mx-auto mb-2" />
                  <p>No exports yet</p>
                  <p className="text-xs mt-1">Export this pack to create a manifest</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Format</TableHead>
                      <TableHead>Scope</TableHead>
                      <TableHead className="text-right">Items</TableHead>
                      <TableHead className="text-right">Labels</TableHead>
                      <TableHead>Download</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {exports.map((exp) => (
                      <TableRow key={exp.id}>
                        <TableCell className="text-sm">
                          {new Date(exp.exported_at).toLocaleString()}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {exp.format === 'json' ? (
                              <><FileJson className="h-3 w-3 mr-1" /> JSON</>
                            ) : (
                              <><FileSpreadsheet className="h-3 w-3 mr-1" /> CSV</>
                            )}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm capitalize">
                          {exp.scope}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {exp.exported_item_count.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {exp.exported_label_count.toLocaleString()}
                        </TableCell>
                        <TableCell>
                          {exp.manifest_blob_url ? (
                            <a 
                              href={exp.manifest_blob_url} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="text-blue-400 hover:underline text-sm"
                            >
                              Download
                            </a>
                          ) : (
                            <span className="text-xs text-muted-foreground">-</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
