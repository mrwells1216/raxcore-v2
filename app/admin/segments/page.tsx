/**
 * Phase 41: Admin — Segmented Calibration Panel
 *
 * Displays all calibration segments in a tree (Global → L1 Primary → L2 Overlays),
 * shows gate status, current calibration values per measurement type, and recent
 * performance metrics. Provides inline editing of activation_weight and
 * multiplier/bias/confidence_adjustment per measurement.
 */

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
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
  Layers,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  TrendingDown,
  TrendingUp,
  Minus,
} from 'lucide-react'
import { SegmentEditForm } from '@/components/admin/segment-edit-form'
import { SegmentToggle } from '@/components/admin/segment-toggle'

// ============================================================================
// DATA FETCHING
// ============================================================================

const GATE_MIN_SAMPLES = 30
const GATE_MIN_STABILITY = 0.55

async function getSegmentsData() {
  const supabase = await createClient()

  const [segRes, valRes, metricsRes] = await Promise.all([
    supabase
      .from('calibration_segments')
      .select('*')
      .order('level', { ascending: true })
      .order('name', { ascending: true }),
    supabase
      .from('calibration_values')
      .select('*'),
    supabase
      .from('segment_metrics')
      .select('*')
      .order('evaluated_at', { ascending: false })
      .limit(200),
  ])

  const segments = segRes.data ?? []
  const values = valRes.data ?? []
  const metrics = metricsRes.data ?? []

  // Latest metric per segment
  const latestMetric = new Map<string, typeof metrics[0]>()
  for (const m of metrics) {
    if (!latestMetric.has(m.segment_id)) latestMetric.set(m.segment_id, m)
  }

  // Values grouped by segment
  const valuesBySegment = new Map<string, typeof values>()
  for (const v of values) {
    const existing = valuesBySegment.get(v.segment_id) ?? []
    existing.push(v)
    valuesBySegment.set(v.segment_id, existing)
  }

  return { segments, valuesBySegment, latestMetric }
}

// ============================================================================
// HELPERS
// ============================================================================

type GateStatus = 'pass' | 'low_samples' | 'low_stability' | 'disabled' | 'global'

function getGateStatus(seg: {
  level: number
  enabled: boolean
  sample_size: number
  stability_score: number
}): GateStatus {
  if (!seg.enabled) return 'disabled'
  if (seg.level === 0) return 'global'
  if (seg.sample_size < GATE_MIN_SAMPLES) return 'low_samples'
  if (seg.stability_score < GATE_MIN_STABILITY) return 'low_stability'
  return 'pass'
}

function GateStatusBadge({ status }: { status: GateStatus }) {
  if (status === 'pass') return (
    <Badge variant="outline" className="gap-1 text-green-400 border-green-400/30 bg-green-400/10">
      <CheckCircle2 className="h-3 w-3" /> Active
    </Badge>
  )
  if (status === 'global') return (
    <Badge variant="outline" className="gap-1 text-sky-400 border-sky-400/30 bg-sky-400/10">
      <Layers className="h-3 w-3" /> Global
    </Badge>
  )
  if (status === 'low_samples') return (
    <Badge variant="outline" className="gap-1 text-yellow-400 border-yellow-400/30 bg-yellow-400/10">
      <AlertTriangle className="h-3 w-3" /> Low Data
    </Badge>
  )
  if (status === 'low_stability') return (
    <Badge variant="outline" className="gap-1 text-orange-400 border-orange-400/30 bg-orange-400/10">
      <AlertTriangle className="h-3 w-3" /> Unstable
    </Badge>
  )
  return (
    <Badge variant="outline" className="gap-1 text-muted-foreground border-muted-foreground/30">
      <XCircle className="h-3 w-3" /> Disabled
    </Badge>
  )
}

function DeltaCell({ value, decimals = 3 }: { value: number | null; decimals?: number }) {
  if (value === null || value === undefined) return <span className="text-muted-foreground">—</span>
  const fmt = value.toFixed(decimals)
  if (Math.abs(value) < 0.001) return <span className="text-muted-foreground text-xs">{fmt}</span>
  return (
    <span className={`flex items-center gap-0.5 text-xs font-mono ${value > 0 ? 'text-green-400' : 'text-red-400'}`}>
      {value > 0 ? <TrendingUp className="h-3 w-3" /> : value < 0 ? <TrendingDown className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
      {fmt}
    </span>
  )
}

const MEASUREMENT_TYPES = ['spread', 'beam', 'tine', 'mass', 'deduction'] as const
function levelLabel(level: number): string {
  const labels: Record<number, string> = {
    0: 'Global',
    1: 'Primary',
    2: 'Overlay',
    3: 'State / Specific',
  }
  return labels[level] ?? `Level ${level}`
}

// ============================================================================
// PAGE
// ============================================================================

export default async function SegmentsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { segments, valuesBySegment, latestMetric } = await getSegmentsData()

  // PATCH D: no longer clamp to max level 2 — support all levels present in DB
  const byLevel: Record<number, typeof segments> = {}
  for (const seg of segments) {
    byLevel[seg.level] ??= []
    byLevel[seg.level].push(seg)
  }
  // Sorted unique level list
  const levels = Object.keys(byLevel).map(Number).sort((a, b) => a - b)

  const activeCount = segments.filter(s => getGateStatus(s) === 'pass').length
  const gatedCount = segments.filter(s => {
    const st = getGateStatus(s)
    return st === 'low_samples' || st === 'low_stability'
  }).length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Segmented Calibration</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Phase 41 — Per-segment multipliers, biases, and confidence adjustments applied during scoring.
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-muted-foreground">{segments.length} segments</span>
          <Badge variant="outline" className="text-green-400 border-green-400/30 bg-green-400/10">{activeCount} active</Badge>
          {gatedCount > 0 && (
            <Badge variant="outline" className="text-yellow-400 border-yellow-400/30 bg-yellow-400/10">{gatedCount} gated</Badge>
          )}
        </div>
      </div>

      {/* Pipeline note */}
      <Card className="border-dashed border-muted-foreground/20 bg-muted/20">
        <CardContent className="py-3 px-4">
          <p className="text-xs text-muted-foreground leading-relaxed">
            <strong className="text-foreground">Pipeline position:</strong> Stage 5.5 — Applied after Phase 21 measurement-level correction and before Phase 10 learning correction.
            Each prediction resolves its matching segments, gates by sample-size &amp; stability, then blends their multipliers/biases into a single correction.
            The global segment is always active and provides identity values (multiplier=1, bias=0) as the fallback.
          </p>
        </CardContent>
      </Card>

      {/* Level groups — PATCH D: render all levels present, not just 0–2 */}
      {levels.map(level => {
        const segs = byLevel[level] ?? []
        if (segs.length === 0) return null
        return (
          <div key={level} className="space-y-3">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Level {level} — {levelLabel(level)}
              </h2>
              <Separator className="flex-1" />
            </div>

            <div className="space-y-3">
              {segs.map(seg => {
                const gateStatus = getGateStatus(seg)
                const calValues = valuesBySegment.get(seg.id) ?? []
                const metric = latestMetric.get(seg.id)
                const isIdentity = calValues.every(v => v.multiplier === 1.0 && v.bias === 0.0 && v.confidence_adjustment === 0.0)
                // PATCH D: resolve parent name for breadcrumb display
                const parentSeg = seg.parent_id ? segments.find(s => s.id === seg.parent_id) : null

                return (
                  <Card key={seg.id} className={`${!seg.enabled ? 'opacity-50' : ''}`}>
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            {parentSeg && (
                              <span className="text-xs text-muted-foreground font-mono">
                                {parentSeg.name} /
                              </span>
                            )}
                            <CardTitle className="text-base font-semibold">{seg.name}</CardTitle>
                            <GateStatusBadge status={gateStatus} />
                            {isIdentity && gateStatus !== 'global' && (
                              <Badge variant="outline" className="text-muted-foreground text-xs border-muted-foreground/20">identity</Badge>
                            )}
                          </div>
                          {seg.description && (
                            <p className="text-xs text-muted-foreground">{seg.description}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <SegmentToggle segmentId={seg.id} enabled={seg.enabled} />
                        </div>
                      </div>

                      {/* Gate stats row */}
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1">
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <span>Samples:</span>
                          <span className={`font-mono font-medium ${seg.sample_size < GATE_MIN_SAMPLES ? 'text-yellow-400' : 'text-foreground'}`}>
                            {seg.sample_size}
                            {seg.level > 0 && <span className="text-muted-foreground">/{GATE_MIN_SAMPLES}</span>}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <span>Stability:</span>
                          <span className={`font-mono font-medium ${seg.stability_score < GATE_MIN_STABILITY ? 'text-yellow-400' : 'text-foreground'}`}>
                            {seg.stability_score.toFixed(2)}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <span>Weight:</span>
                          <span className="font-mono font-medium text-foreground">{seg.activation_weight.toFixed(2)}</span>
                        </div>
                        {metric && (
                          <>
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                              <span>Avg gross error:</span>
                              <DeltaCell value={metric.avg_gross_error} decimals={2} />
                            </div>
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                              <span>MAE:</span>
                              <span className="font-mono font-medium text-foreground">{metric.avg_abs_gross_error?.toFixed(1) ?? '—'}"</span>
                            </div>
                            {metric.regression_flagged && (
                              <Badge variant="destructive" className="text-xs">Regression</Badge>
                            )}
                          </>
                        )}
                      </div>
                    </CardHeader>

                    <CardContent className="pt-0">
                      {/* Calibration values table */}
                      {calValues.length > 0 ? (
                        <div className="rounded-md border border-border/40 overflow-hidden">
                          <Table>
                            <TableHeader>
                              <TableRow className="bg-muted/20 hover:bg-muted/20">
                                <TableHead className="w-32 text-xs">Measurement</TableHead>
                                <TableHead className="text-xs text-right">Multiplier</TableHead>
                                <TableHead className="text-xs text-right">Bias (")</TableHead>
                                <TableHead className="text-xs text-right">Conf. Adj.</TableHead>
                                <TableHead className="w-40 text-xs text-right">Actions</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {MEASUREMENT_TYPES.map(mt => {
                                const val = calValues.find(v => v.measurement_type === mt)
                                const isModified = val && (val.multiplier !== 1.0 || val.bias !== 0.0 || val.confidence_adjustment !== 0.0)
                                return (
                                  <TableRow key={mt} className={isModified ? 'bg-primary/5' : ''}>
                                    <TableCell className="py-2">
                                      <span className="text-xs font-medium capitalize">{mt}</span>
                                    </TableCell>
                                    <TableCell className="text-right py-2">
                                      <span className={`text-xs font-mono ${val && val.multiplier !== 1.0 ? 'text-primary font-semibold' : 'text-muted-foreground'}`}>
                                        {val ? val.multiplier.toFixed(4) : '1.0000'}
                                      </span>
                                    </TableCell>
                                    <TableCell className="text-right py-2">
                                      {val ? <DeltaCell value={val.bias} decimals={2} /> : <span className="text-muted-foreground text-xs">0.00</span>}
                                    </TableCell>
                                    <TableCell className="text-right py-2">
                                      {val ? <DeltaCell value={val.confidence_adjustment} decimals={1} /> : <span className="text-muted-foreground text-xs">0.0</span>}
                                    </TableCell>
                                    <TableCell className="text-right py-2">
                                      <SegmentEditForm
                                        segmentId={seg.id}
                                        measurementType={mt}
                                        currentMultiplier={val?.multiplier ?? 1.0}
                                        currentBias={val?.bias ?? 0.0}
                                        currentConfAdj={val?.confidence_adjustment ?? 0.0}
                                        disabled={gateStatus === 'disabled'}
                                      />
                                    </TableCell>
                                  </TableRow>
                                )
                              })}
                            </TableBody>
                          </Table>
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">No calibration values — identity defaults will be used.</p>
                      )}

                      {/* Conditions display */}
                      {Object.keys(seg.conditions).length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {Object.entries(seg.conditions).map(([k, v]) => (
                            <Badge key={k} variant="secondary" className="text-xs font-mono">
                              {k}: {Array.isArray(v) ? v.join(' | ') : String(v)}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
