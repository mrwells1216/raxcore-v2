/**
 * Phase 53: Admin - Training Pack Generation
 *
 * Dashboard showing:
 * - Training pack list with type, status, item counts
 * - Pack creation and generation workflow
 * - Export management and label distribution
 */

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
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
  Plus,
  ArrowRight,
  Layers,
  GitBranch,
  AlertCircle,
  CheckCircle2,
  Clock,
  Archive,
} from 'lucide-react'
import Link from 'next/link'
import { listTrainingPacks } from '@/lib/training-packs/service'
import type { TrainingPack, TrainingPackType, TrainingPackStatus } from '@/lib/types'
import { CreateTrainingPackButton } from '@/components/admin/create-training-pack-button'

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

export default async function TrainingPacksPage() {
  const supabase = await createClient()

  // Check auth
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    redirect('/login')
  }

  // Fetch training packs
  let packs: TrainingPack[] = []
  try {
    packs = await listTrainingPacks({ limit: 50 })
  } catch (error) {
    console.error('Failed to fetch training packs:', error)
  }

  // Calculate stats
  const totalPacks = packs.length
  const readyPacks = packs.filter(p => p.status === 'ready').length
  const totalItems = packs.reduce((sum, p) => sum + (p.item_count || 0), 0)
  const linkedVariants = packs.filter(p => p.variant_id).length

  // Group by type
  const packsByType = packs.reduce((acc, p) => {
    acc[p.pack_type] = (acc[p.pack_type] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Training Packs</h1>
          <p className="text-muted-foreground">
            Manage structured supervision exports for model training
          </p>
        </div>
        <CreateTrainingPackButton />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          title="Total Packs"
          value={totalPacks}
          icon={Package}
        />
        <StatCard
          title="Ready to Export"
          value={readyPacks}
          subtitle={`${totalPacks - readyPacks} in draft`}
          icon={CheckCircle2}
        />
        <StatCard
          title="Total Items"
          value={totalItems.toLocaleString()}
          icon={Database}
        />
        <StatCard
          title="Linked Variants"
          value={linkedVariants}
          icon={GitBranch}
        />
      </div>

      {/* Pack Type Distribution */}
      {Object.keys(packsByType).length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Pack Types</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {Object.entries(packsByType).map(([type, count]) => (
                <div key={type} className="flex items-center gap-2">
                  <PackTypeBadge type={type as TrainingPackType} />
                  <span className="text-sm text-muted-foreground">({count})</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Separator />

      {/* Packs Table */}
      <Card>
        <CardHeader>
          <CardTitle>Training Packs</CardTitle>
          <CardDescription>
            Click a pack to view details, items, and export options
          </CardDescription>
        </CardHeader>
        <CardContent>
          {packs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Package className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-1">No training packs yet</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Create your first training pack to start organizing supervision data
              </p>
              <CreateTrainingPackButton />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Items</TableHead>
                  <TableHead className="text-right">Train/Val/Test</TableHead>
                  <TableHead>Variant</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {packs.map((pack) => (
                  <TableRow key={pack.id}>
                    <TableCell>
                      <Link
                        href={`/admin/training-packs/${pack.id}`}
                        className="font-medium hover:underline"
                      >
                        {pack.name}
                      </Link>
                      {pack.description && (
                        <p className="text-xs text-muted-foreground truncate max-w-[200px]">
                          {pack.description}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      <PackTypeBadge type={pack.pack_type} />
                    </TableCell>
                    <TableCell>
                      <PackStatusBadge status={pack.status} />
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {pack.item_count.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {pack.train_count}/{pack.validation_count}/{pack.test_count}
                    </TableCell>
                    <TableCell>
                      {pack.variant_id ? (
                        <Link
                          href={`/admin/sandbox/variants/${pack.variant_id}`}
                          className="text-xs text-blue-400 hover:underline"
                        >
                          View
                        </Link>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(pack.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Link href={`/admin/training-packs/${pack.id}`}>
                        <Button variant="ghost" size="sm">
                          <ArrowRight className="h-4 w-4" />
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Quick Links */}
      <div className="flex gap-4 text-sm">
        <Link href="/admin/retraining" className="text-muted-foreground hover:text-foreground">
          Retraining Readiness
        </Link>
        <Link href="/admin/supervision" className="text-muted-foreground hover:text-foreground">
          Supervision Events
        </Link>
        <Link href="/admin/sandbox" className="text-muted-foreground hover:text-foreground">
          Variant Sandbox
        </Link>
      </div>
    </div>
  )
}
