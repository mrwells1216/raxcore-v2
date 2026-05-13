export const dynamic = 'force-dynamic'

/**
 * Phase 43: Admin — Candidate Models & Offline Evaluation Harness
 *
 * Manage candidate models and run offline evaluations against test sets.
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
  Cpu,
  TrendingUp,
  TrendingDown,
  Minus,
  CheckCircle2,
  XCircle,
  Clock,
  Play,
  Plus,
  Archive,
} from 'lucide-react'
import Link from 'next/link'
import { getCandidateModels, getExportPacks } from '@/lib/retraining/service'
import type { CandidateModelStatus, CandidateModel } from '@/lib/types'
import { CreateModelButton } from '@/components/admin/create-model-button'

// ============================================================================
// HELPERS
// ============================================================================

function StatusBadge({ status }: { status: CandidateModelStatus }) {
  const config: Record<CandidateModelStatus, { label: string; className: string; icon: React.ComponentType<{ className?: string }> }> = {
    pending: { label: 'Pending', className: 'text-yellow-400 border-yellow-400/30 bg-yellow-400/10', icon: Clock },
    evaluated: { label: 'Evaluated', className: 'text-sky-400 border-sky-400/30 bg-sky-400/10', icon: CheckCircle2 },
    promoted: { label: 'Promoted', className: 'text-green-400 border-green-400/30 bg-green-400/10', icon: TrendingUp },
    rejected: { label: 'Rejected', className: 'text-red-400 border-red-400/30 bg-red-400/10', icon: XCircle },
    archived: { label: 'Archived', className: 'text-muted-foreground border-muted-foreground/30', icon: Archive },
  }
  const { label, className, icon: Icon } = config[status]
  return (
    <Badge variant="outline" className={`gap-1 ${className}`}>
      <Icon className="h-3 w-3" />
      {label}
    </Badge>
  )
}

function DeltaIndicator({ value, suffix = '' }: { value: number | null; suffix?: string }) {
  if (value === null || value === undefined) return <span className="text-muted-foreground">—</span>
  
  const isPositive = value > 0
  const isNegative = value < 0
  const Icon = isPositive ? TrendingUp : isNegative ? TrendingDown : Minus
  const color = isNegative ? 'text-green-400' : isPositive ? 'text-red-400' : 'text-muted-foreground'
  
  return (
    <span className={`flex items-center gap-1 ${color}`}>
      <Icon className="h-3 w-3" />
      {Math.abs(value).toFixed(2)}{suffix}
    </span>
  )
}

// ============================================================================
// PAGE
// ============================================================================

export default async function ModelsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [models, exportPacks] = await Promise.all([
    getCandidateModels(),
    getExportPacks(),
  ])

  // Group models by status
  const pendingModels = models.filter(m => m.status === 'pending')
  const evaluatedModels = models.filter(m => m.status === 'evaluated')
  const promotedModels = models.filter(m => m.status === 'promoted')
  const otherModels = models.filter(m => m.status === 'rejected' || m.status === 'archived')

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Candidate Models</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Register and evaluate candidate models before promotion to production.
          </p>
        </div>
        <CreateModelButton exportPacks={exportPacks} />
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="py-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Total</span>
              <span className="text-xl font-semibold">{models.length}</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-yellow-400">Pending</span>
              <span className="text-xl font-semibold">{pendingModels.length}</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-sky-400">Evaluated</span>
              <span className="text-xl font-semibold">{evaluatedModels.length}</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-green-400">Promoted</span>
              <span className="text-xl font-semibold">{promotedModels.length}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Models list */}
      {models.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-8 text-center">
            <Cpu className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground mb-4">
              No candidate models registered yet. Add a model to begin offline evaluation.
            </p>
            <CreateModelButton exportPacks={exportPacks} />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {/* Pending */}
          {pendingModels.length > 0 && (
            <ModelSection title="Pending Evaluation" models={pendingModels} />
          )}
          
          {/* Evaluated */}
          {evaluatedModels.length > 0 && (
            <ModelSection title="Evaluated" models={evaluatedModels} />
          )}
          
          {/* Promoted */}
          {promotedModels.length > 0 && (
            <ModelSection title="Promoted to Production" models={promotedModels} />
          )}
          
          {/* Archived/Rejected */}
          {otherModels.length > 0 && (
            <ModelSection title="Archived / Rejected" models={otherModels} />
          )}
        </div>
      )}

      {/* Pipeline info */}
      <Card className="border-dashed border-muted-foreground/20 bg-muted/10">
        <CardContent className="py-4">
          <p className="text-xs text-muted-foreground">
            <strong className="text-foreground">Evaluation workflow:</strong> Register a candidate model with version and training notes.
            Run offline evaluations against validation/test splits from export packs.
            Compare MAE/RMSE against production baseline.
            Promote if metrics improve, or reject with documented reasoning.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

// ============================================================================
// MODEL SECTION
// ============================================================================

function ModelSection({ title, models }: { title: string; models: CandidateModel[] }) {
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">{title}</h2>
      <div className="rounded-md border border-border/40 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/20 hover:bg-muted/20">
              <TableHead className="text-xs">Model</TableHead>
              <TableHead className="text-xs">Version</TableHead>
              <TableHead className="text-xs">Status</TableHead>
              <TableHead className="text-xs text-right">MAE (Gross)</TableHead>
              <TableHead className="text-xs text-right">vs Production</TableHead>
              <TableHead className="text-xs">Created</TableHead>
              <TableHead className="text-xs text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {models.map(model => (
              <TableRow key={model.id}>
                <TableCell className="py-3">
                  <div>
                    <span className="font-medium">{model.name}</span>
                    {model.description && (
                      <p className="text-xs text-muted-foreground truncate max-w-[200px]">{model.description}</p>
                    )}
                  </div>
                </TableCell>
                <TableCell className="py-3">
                  <Badge variant="secondary" className="font-mono text-xs">{model.version}</Badge>
                </TableCell>
                <TableCell className="py-3">
                  <StatusBadge status={model.status} />
                </TableCell>
                <TableCell className="py-3 text-right font-mono text-sm">
                  {model.metrics_summary?.mae_gross?.toFixed(2) ?? '—'}
                </TableCell>
                <TableCell className="py-3 text-right">
                  <DeltaIndicator value={model.comparison_to_production?.delta ?? null} suffix='"' />
                </TableCell>
                <TableCell className="py-3 text-xs text-muted-foreground">
                  {new Date(model.created_at).toLocaleDateString()}
                </TableCell>
                <TableCell className="py-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <Link href={`/admin/retraining/models/${model.id}`}>
                      <Button variant="outline" size="sm">
                        {model.status === 'pending' ? (
                          <>
                            <Play className="h-3 w-3 mr-1" />
                            Evaluate
                          </>
                        ) : (
                          'View'
                        )}
                      </Button>
                    </Link>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
