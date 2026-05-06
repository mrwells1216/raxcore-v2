'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import {
  buildEmptyOfficialEntry,
  defaultOfficialTines,
  defaultOfficialCircumferences,
  type OfficialScoreEntry,
  type BenchmarkComparison,
} from '@/lib/scoring/official-score'

// ── Types from API response ───────────────────────────────────────────────────

interface LoadResponse {
  buckId: string
  groundTruth: Record<string, unknown> | null
  predictionId: string | null
  aiGross: number | null
  aiNet: number | null
  graphSource: string | null
  graphVersion: number | null
  hasOfficialScore: boolean
}

// ── helpers ───────────────────────────────────────────────────────────────────

function numInput(
  value: number | null,
  onChange: (v: number | null) => void,
  label: string,
  id: string,
) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">{label}</Label>
      <Input
        id={id}
        type="number"
        step="0.1"
        min="0"
        placeholder="—"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        className="h-8 text-sm w-28"
      />
    </div>
  )
}

function errorBadge(val: number | null) {
  if (val == null) return <span className="text-muted-foreground">—</span>
  const color = val <= 1 ? 'text-green-500' : val <= 3 ? 'text-yellow-500' : 'text-red-500'
  return <span className={color}>{val.toFixed(1)}"</span>
}

function nullableCell(val: number | null) {
  return val != null ? `${val.toFixed(1)}"` : '—'
}

// ── Component ─────────────────────────────────────────────────────────────────

function OfficialScoreClient() {
  const searchParams = useSearchParams()
  const buckId = searchParams.get('buck_id') ?? searchParams.get('buckId') ?? ''

  const [buckInput, setBuckInput] = useState(buckId)
  const [loadedBuckId, setLoadedBuckId] = useState<string | null>(null)
  const [loadData, setLoadData] = useState<LoadResponse | null>(null)
  const [entry, setEntry] = useState<OfficialScoreEntry>(buildEmptyOfficialEntry())
  const [comparison, setComparison] = useState<BenchmarkComparison | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  const load = useCallback(async (id: string) => {
    if (!id.trim()) return
    setIsLoading(true)
    setComparison(null)
    try {
      const res = await fetch(`/api/admin/official-score?buck_id=${encodeURIComponent(id.trim())}`)
      const data = (await res.json()) as LoadResponse
      if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Load failed')
      setLoadData(data)
      setLoadedBuckId(id.trim())

      // Pre-fill form from existing ground truth if present
      if (data.hasOfficialScore && data.groundTruth) {
        const gt = data.groundTruth as Record<string, number | string | null>
        const prefill: OfficialScoreEntry = {
          ...buildEmptyOfficialEntry(),
          mainBeamLeft: (gt.main_beam_left as number | null) ?? null,
          mainBeamRight: (gt.main_beam_right as number | null) ?? null,
          insideSpread: (gt.inside_spread as number | null) ?? null,
          grossScore: (gt.official_score as number | null) ?? null,
          netScore: null,
          deductions: null,
          notes: (gt.scorer_notes as string | null) ?? null,
          tines: defaultOfficialTines().map((t) => {
            const key = `${t.label.toLowerCase()}_${t.side}`
            return { ...t, value: (gt[key] as number | null) ?? null }
          }),
          circumferences: defaultOfficialCircumferences().map((c) => {
            const key = `${c.label.toLowerCase()}_${c.side}`
            return { ...c, value: (gt[key] as number | null) ?? null }
          }),
        }
        setEntry(prefill)
      } else {
        setEntry(buildEmptyOfficialEntry())
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load buck data')
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Auto-load on mount if buck_id is in the URL
  useEffect(() => {
    if (buckId) {
      void load(buckId)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSave = async () => {
    if (!loadedBuckId) { toast.error('Load a buck first'); return }
    setIsSaving(true)
    try {
      const res = await fetch('/api/admin/official-score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ buck_id: loadedBuckId, entry }),
      })
      const data = await res.json() as { success?: boolean; comparison?: BenchmarkComparison; error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Save failed')
      setComparison(data.comparison ?? null)
      toast.success('Official score saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setIsSaving(false)
    }
  }

  const setTineValue = (idx: number, value: number | null) => {
    setEntry((prev) => {
      const tines = [...prev.tines]
      tines[idx] = { ...tines[idx], value }
      return { ...prev, tines }
    })
  }

  const setCircValue = (idx: number, value: number | null) => {
    setEntry((prev) => {
      const circumferences = [...prev.circumferences]
      circumferences[idx] = { ...circumferences[idx], value }
      return { ...prev, circumferences }
    })
  }

  return (
    <div className="p-4 lg:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Official Score Entry</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Enter official B&amp;C / P&amp;Y score data for a buck. Compares AI, graph-native, and corrected scores against the official sheet.
        </p>
      </div>

      {/* Buck picker */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Load Buck</CardTitle>
        </CardHeader>
        <CardContent className="flex items-end gap-3">
          <div className="flex flex-col gap-1 flex-1 max-w-xs">
            <Label htmlFor="buck-id" className="text-xs text-muted-foreground">Buck ID</Label>
            <Input
              id="buck-id"
              value={buckInput}
              onChange={(e) => setBuckInput(e.target.value)}
              placeholder="uuid"
              className="h-9 text-sm font-mono"
            />
          </div>
          <Button
            onClick={() => load(buckInput)}
            disabled={isLoading || !buckInput.trim()}
            size="sm"
          >
            {isLoading ? 'Loading…' : 'Load'}
          </Button>
          {loadData && (
            <div className="text-xs text-muted-foreground space-y-0.5">
              {loadData.hasOfficialScore && <Badge variant="secondary">Existing score</Badge>}
              {loadData.aiGross != null && (
                <p>AI gross: <span className="font-mono">{loadData.aiGross.toFixed(1)}&quot;</span></p>
              )}
              {loadData.graphSource && (
                <p>Graph: <span className="font-mono">{loadData.graphSource} v{loadData.graphVersion}</span></p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {loadedBuckId && (
        <div className="grid lg:grid-cols-2 gap-6">
          {/* Score entry form */}
          <div className="space-y-4">
            {/* System + type */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Scoring System</CardTitle>
              </CardHeader>
              <CardContent className="flex gap-4 flex-wrap">
                {(['boone_and_crockett', 'pope_and_young'] as const).map((sys) => (
                  <button
                    key={sys}
                    type="button"
                    onClick={() => setEntry((p) => ({ ...p, scoringSystem: sys }))}
                    className={`px-3 py-1.5 rounded-md border text-sm transition-colors ${
                      entry.scoringSystem === sys
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'border-border hover:bg-muted'
                    }`}
                  >
                    {sys === 'boone_and_crockett' ? 'Boone & Crockett' : 'Pope & Young'}
                  </button>
                ))}
                {(['typical', 'non_typical'] as const).map((rt) => (
                  <button
                    key={rt}
                    type="button"
                    onClick={() => setEntry((p) => ({ ...p, rackType: rt }))}
                    className={`px-3 py-1.5 rounded-md border text-sm transition-colors ${
                      entry.rackType === rt
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'border-border hover:bg-muted'
                    }`}
                  >
                    {rt === 'typical' ? 'Typical' : 'Non-Typical'}
                  </button>
                ))}
              </CardContent>
            </Card>

            {/* Main measurements */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Main Measurements</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-4">
                {numInput(entry.mainBeamLeft, (v) => setEntry((p) => ({ ...p, mainBeamLeft: v })), 'Left Beam', 'mbl')}
                {numInput(entry.mainBeamRight, (v) => setEntry((p) => ({ ...p, mainBeamRight: v })), 'Right Beam', 'mbr')}
                {numInput(entry.insideSpread, (v) => setEntry((p) => ({ ...p, insideSpread: v })), 'Inside Spread', 'is')}
              </CardContent>
            </Card>

            {/* Tines */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Tines</CardTitle>
                <CardDescription className="text-xs">G1 – G4, left and right</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                  {entry.tines.map((t, idx) => (
                    numInput(
                      t.value,
                      (v) => setTineValue(idx, v),
                      `${t.label} ${t.side.charAt(0).toUpperCase() + t.side.slice(1)}`,
                      `tine-${idx}`,
                    )
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Circumferences */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Circumferences</CardTitle>
                <CardDescription className="text-xs">H1 – H4, left and right</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                  {entry.circumferences.map((c, idx) => (
                    numInput(
                      c.value,
                      (v) => setCircValue(idx, v),
                      `${c.label} ${c.side.charAt(0).toUpperCase() + c.side.slice(1)}`,
                      `circ-${idx}`,
                    )
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Totals */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Final Scores</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-3 gap-4">
                {numInput(entry.grossScore, (v) => setEntry((p) => ({ ...p, grossScore: v })), 'Gross', 'gross')}
                {numInput(entry.deductions, (v) => setEntry((p) => ({ ...p, deductions: v })), 'Deductions', 'ded')}
                {numInput(entry.netScore, (v) => setEntry((p) => ({ ...p, netScore: v })), 'Net', 'net')}
              </CardContent>
            </Card>

            {/* Notes */}
            <div className="flex flex-col gap-1">
              <Label htmlFor="notes" className="text-xs text-muted-foreground">Notes</Label>
              <textarea
                id="notes"
                rows={2}
                value={entry.notes ?? ''}
                onChange={(e) => setEntry((p) => ({ ...p, notes: e.target.value || null }))}
                className="w-full rounded-md border bg-input px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring"
                placeholder="Scorer notes…"
              />
            </div>

            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? 'Saving…' : 'Save Official Score'}
            </Button>
          </div>

          {/* Comparison table */}
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Score Comparison</CardTitle>
                <CardDescription className="text-xs">
                  Saved after clicking &quot;Save Official Score&quot;. Error = |graph − official|.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {comparison == null ? (
                  <p className="text-sm text-muted-foreground">No comparison yet. Save the official score to generate.</p>
                ) : (
                  <div className="space-y-4">
                    {/* Summary row */}
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div className="rounded-md border px-3 py-2 space-y-1">
                        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Gross</p>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Official</span>
                          <span className="font-mono">{nullableCell(comparison.officialGross)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">AI</span>
                          <span className="font-mono">{nullableCell(comparison.aiGross)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Graph</span>
                          <span className="font-mono">{nullableCell(comparison.graphGross)}</span>
                        </div>
                        <div className="flex justify-between border-t pt-1 font-medium">
                          <span>Error</span>
                          {errorBadge(comparison.grossError)}
                        </div>
                      </div>
                      <div className="rounded-md border px-3 py-2 space-y-1">
                        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Net</p>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Official</span>
                          <span className="font-mono">{nullableCell(comparison.officialNet)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">AI</span>
                          <span className="font-mono">{nullableCell(comparison.aiNet)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Graph</span>
                          <span className="font-mono">{nullableCell(comparison.graphNet)}</span>
                        </div>
                        <div className="flex justify-between border-t pt-1 font-medium">
                          <span>Error</span>
                          {errorBadge(comparison.netError)}
                        </div>
                      </div>
                    </div>

                    {/* Per-measurement table */}
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs border-collapse">
                        <thead>
                          <tr className="border-b text-muted-foreground">
                            <th className="text-left py-1.5 pr-3 font-medium">Measurement</th>
                            <th className="text-right py-1.5 px-2 font-medium">Official</th>
                            <th className="text-right py-1.5 px-2 font-medium">Graph</th>
                            <th className="text-right py-1.5 px-2 font-medium">Corrected</th>
                            <th className="text-right py-1.5 pl-2 font-medium">Error</th>
                          </tr>
                        </thead>
                        <tbody>
                          {comparison.measurementErrors.map((row) => (
                            <tr key={row.id} className="border-b border-border/40 hover:bg-muted/30">
                              <td className="py-1.5 pr-3 font-medium">{row.label}</td>
                              <td className="text-right px-2 font-mono">{nullableCell(row.officialValue)}</td>
                              <td className="text-right px-2 font-mono">{nullableCell(row.graphValue)}</td>
                              <td className="text-right px-2 font-mono">{nullableCell(row.correctedValue)}</td>
                              <td className="text-right pl-2">{errorBadge(row.absError)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}

export default function OfficialScorePage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading official score...</div>}>
      <OfficialScoreClient />
    </Suspense>
  )
}
