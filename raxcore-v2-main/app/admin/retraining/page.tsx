export const dynamic = 'force-dynamic'

/**
 * Phase 43: Admin — Retraining Readiness & Export Packs
 *
 * Dashboard showing:
 * - Retraining readiness score and data gaps
 * - Export pack management (create, view, compute examples)
 * - Training example counts and coverage
 */

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
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
  Database,
  Package,
  AlertTriangle,
  CheckCircle2,
  Clock,
  TrendingUp,
  FileJson,
  Play,
  Archive,
  Plus,
} from 'lucide-react'
import Link from 'next/link'
import {
  getLatestRetrainingReadiness,
  getExportPacks,
  getTrainingExamples,
} from '@/lib/retraining/service'
import type { GapSeverity, ReadinessTier, ExportPack } from '@/lib/types'
import { CreateExportPackButton } from '@/components/admin/create-export-pack-button'
import { ComputeExportPackButton } from '@/components/admin/compute-export-pack-button'
import { RefreshReadinessButton } from '@/components/admin/refresh-readiness-button'

// ============================================================================
// HELPERS
// ============================================================================

function ReadinessBadge({ tier }: { tier: ReadinessTier }) {
  const config: Record<ReadinessTier, { label: string; className: string }> = {
    ready: { label: 'Ready', className: 'text-green-400 border-green-400/30 bg-green-400/10' },
    nearly_ready: { label: 'Nearly Ready', className: 'text-sky-400 border-sky-400/30 bg-sky-400/10' },
    needs_work: { label: 'Needs Work', className: 'text-yellow-400 border-yellow-400/30 bg-yellow-400/10' },
    insufficient: { label: 'Insufficient', className: 'text-red-400 border-red-400/30 bg-red-400/10' },
  }
  const { label, className } = config[tier]
  return <Badge variant="outline" className={className}>{label}</Badge>
}

function GapSeverityBadge({ severity }: { severity: GapSeverity }) {
  const config: Record<GapSeverity, { label: string; className: string }> = {
    none: { label: 'OK', className: 'text-green-400 border-green-400/30 bg-green-400/10' },
    low: { label: 'Low', className: 'text-sky-400 border-sky-400/30 bg-sky-400/10' },
    medium: { label: 'Medium', className: 'text-yellow-400 border-yellow-400/30 bg-yellow-400/10' },
    high: { label: 'High', className: 'text-orange-400 border-orange-400/30 bg-orange-400/10' },
    critical: { label: 'Critical', className: 'text-red-400 border-red-400/30 bg-red-400/10' },
  }
  const { label, className } = config[severity]
  return <Badge variant="outline" className={`text-xs ${className}`}>{label}</Badge>
}

function StatCard({ 
  title, 
  value, 
  subtitle, 
  icon: Icon 
}: { 
  title: string
  value: string | number
  subtitle?: string
  icon: React.ComponentType<{ className?: string }>
}) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-muted">
            <Icon className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <p className="text-2xl font-semibold">{value}</p>
            <p className="text-sm text-muted-foreground">{title}</p>
            {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ============================================================================
// PAGE
// ============================================================================

export default async function RetrainingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Fetch data in parallel
  const [readiness, exportPacks, examplesResult] = await Promise.all([
    getLatestRetrainingReadiness(),
    getExportPacks(),
    getTrainingExamples({ limit: 1 }), // Just to get total count
  ])

  const totalExamples = examplesResult.total

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Retraining Readiness</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Phase 43 — Dataset health, export packs, and model evaluation harness.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <RefreshReadinessButton />
          <CreateExportPackButton />
        </div>
      </div>

      {/* Readiness Overview */}
      {readiness && (
        <Card className="border-primary/20">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <CardTitle className="text-lg">Dataset Readiness</CardTitle>
                <ReadinessBadge tier={readiness.readiness_tier} />
              </div>
              <span className="text-xs text-muted-foreground">
                Last computed: {new Date(readiness.computed_at).toLocaleString()}
              </span>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Progress bar */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Readiness Score</span>
                <span className="font-semibold">{readiness.readiness_score.toFixed(1)}%</span>
              </div>
              <Progress value={readiness.readiness_score} className="h-2" />
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard
                title="Total Examples"
                value={readiness.total_examples.toLocaleString()}
                icon={Database}
              />
              <StatCard
                title="High Quality"
                value={readiness.high_quality_examples.toLocaleString()}
                subtitle={`${((readiness.high_quality_examples / Math.max(readiness.total_examples, 1)) * 100).toFixed(0)}% of total`}
                icon={CheckCircle2}
              />
              <StatCard
                title="With Images"
                value={readiness.examples_with_images.toLocaleString()}
                subtitle={`${((readiness.examples_with_images / Math.max(readiness.total_examples, 1)) * 100).toFixed(0)}% coverage`}
                icon={FileJson}
              />
              <StatCard
                title="Gap Severity"
                value={readiness.gap_severity}
                icon={AlertTriangle}
              />
            </div>

            {/* Data Gaps */}
            {readiness.data_gaps.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-medium">Data Gaps</h3>
                <div className="rounded-md border border-border/40 overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/20 hover:bg-muted/20">
                        <TableHead className="text-xs">Category</TableHead>
                        <TableHead className="text-xs">Value</TableHead>
                        <TableHead className="text-xs text-right">Current</TableHead>
                        <TableHead className="text-xs text-right">Target</TableHead>
                        <TableHead className="text-xs">Severity</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {readiness.data_gaps.slice(0, 5).map((gap, i) => (
                        <TableRow key={i}>
                          <TableCell className="py-2 text-xs capitalize">{gap.category.replace('_', ' ')}</TableCell>
                          <TableCell className="py-2 text-xs font-mono">{gap.value}</TableCell>
                          <TableCell className="py-2 text-xs text-right">{gap.current_count}</TableCell>
                          <TableCell className="py-2 text-xs text-right">{gap.target_count}</TableCell>
                          <TableCell className="py-2"><GapSeverityBadge severity={gap.severity} /></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            {/* Recommendations */}
            {readiness.recommendations.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-medium">Recommendations</h3>
                <ul className="space-y-1">
                  {readiness.recommendations.map((rec, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                      <TrendingUp className="h-3 w-3 mt-0.5 shrink-0 text-primary" />
                      <span>{rec}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Coverage by State */}
      {readiness && Object.keys(readiness.coverage_by_state).length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Coverage by State</CardTitle>
            <CardDescription>Top states by training example count</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {Object.entries(readiness.coverage_by_state)
                .sort(([, a], [, b]) => b - a)
                .slice(0, 10)
                .map(([state, count]) => (
                  <div key={state} className="flex items-center justify-between p-2 rounded-md bg-muted/30">
                    <span className="text-sm font-medium">{state}</span>
                    <Badge variant="secondary" className="text-xs">{count}</Badge>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Separator />

      {/* Export Packs */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Export Packs</h2>
          <span className="text-sm text-muted-foreground">{exportPacks.length} packs</span>
        </div>

        {exportPacks.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-8 text-center">
              <Package className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground mb-4">
                No export packs created yet. Create a pack to define reusable dataset filters and splits.
              </p>
              <CreateExportPackButton />
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {exportPacks.map(pack => (
              <ExportPackCard key={pack.id} pack={pack} />
            ))}
          </div>
        )}
      </div>

      {/* Quick Links */}
      <Card className="border-dashed border-muted-foreground/20 bg-muted/10">
        <CardContent className="py-4">
          <div className="flex flex-wrap gap-4 text-sm">
            <Link href="/admin/retraining/models" className="text-primary hover:underline flex items-center gap-1">
              <Play className="h-4 w-4" /> Candidate Models
            </Link>
            <Link href="/admin/retraining/evaluations" className="text-primary hover:underline flex items-center gap-1">
              <TrendingUp className="h-4 w-4" /> Offline Evaluations
            </Link>
            <Link href="/admin/health" className="text-primary hover:underline flex items-center gap-1">
              <Database className="h-4 w-4" /> Dataset Health
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ============================================================================
// EXPORT PACK CARD
// ============================================================================

function ExportPackCard({ pack }: { pack: ExportPack }) {
  const filterCount = Object.values(pack.filters).filter(v => v !== undefined && v !== null && (!Array.isArray(v) || v.length > 0)).length
  
  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold">{pack.name}</h3>
              {pack.is_archived && (
                <Badge variant="outline" className="text-muted-foreground text-xs">
                  <Archive className="h-3 w-3 mr-1" /> Archived
                </Badge>
              )}
              {pack.targets_data_gap && (
                <Badge variant="secondary" className="text-xs">Gap: {pack.targets_data_gap}</Badge>
              )}
            </div>
            {pack.description && (
              <p className="text-sm text-muted-foreground">{pack.description}</p>
            )}
            <div className="flex flex-wrap items-center gap-3 pt-1 text-xs text-muted-foreground">
              <span>{pack.example_count} examples</span>
              <span>{filterCount} filter{filterCount !== 1 ? 's' : ''}</span>
              <span>
                Split: {(pack.split_config.train_ratio * 100).toFixed(0)}/{(pack.split_config.validation_ratio * 100).toFixed(0)}/{(pack.split_config.test_ratio * 100).toFixed(0)}
              </span>
              {pack.last_computed_at && (
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {new Date(pack.last_computed_at).toLocaleDateString()}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <ComputeExportPackButton packId={pack.id} />
            <Link href={`/admin/retraining/packs/${pack.id}`}>
              <Button variant="outline" size="sm">View</Button>
            </Link>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
