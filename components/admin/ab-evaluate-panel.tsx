'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { FlaskConical, Play, Loader2, CheckCircle, AlertTriangle, XCircle } from 'lucide-react'
import type { ScoringVariant, BenchmarkPack } from '@/lib/types'
import type { AbEvaluationResult, AbRecommendation } from '@/lib/sandbox/ab-runner'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

const RECOMMENDATION_META: Record<
  AbRecommendation,
  { label: string; className: string; Icon: typeof CheckCircle }
> = {
  promote: {
    label: 'Promote',
    className: 'bg-green-500/10 text-green-600 border-green-500/30',
    Icon: CheckCircle,
  },
  review: {
    label: 'Needs Review',
    className: 'bg-amber-500/10 text-amber-600 border-amber-500/30',
    Icon: AlertTriangle,
  },
  reject: {
    label: 'Reject',
    className: 'bg-red-500/10 text-red-600 border-red-500/30',
    Icon: XCircle,
  },
}

/**
 * Self-contained A/B auto-evaluation: pick a candidate variant + benchmark pack,
 * run candidate vs production against the pack, and surface a promote/review/reject
 * recommendation. Promotion itself stays a deliberate action in the Variants tab.
 */
export function AbEvaluatePanel() {
  const { data: variantsData } = useSWR<{ variants: ScoringVariant[] }>(
    '/api/admin/sandbox/variants',
    fetcher
  )
  const { data: packsData } = useSWR<{ data: BenchmarkPack[] }>(
    '/api/admin/benchmarks/packs?limit=100',
    fetcher
  )

  const candidateVariants = (variantsData?.variants ?? []).filter(
    (v) => v.is_candidate && !v.is_archived
  )
  const packs = packsData?.data ?? []

  const [candidateId, setCandidateId] = useState('')
  const [packId, setPackId] = useState('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<AbEvaluationResult | null>(null)

  const handleRun = async () => {
    setRunning(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch('/api/admin/sandbox/ab-evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidateVariantId: candidateId, benchmarkPackId: packId }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) {
        setError(json.error || 'Failed to run A/B evaluation')
        return
      }
      setResult(json.data as AbEvaluationResult)
    } catch {
      setError('Network error running A/B evaluation')
    } finally {
      setRunning(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FlaskConical className="h-5 w-5" />
          A/B Auto-Evaluation
        </CardTitle>
        <CardDescription>
          Score a candidate variant and the current production variant against the
          same gold-standard pack, then evaluate the promotion gates. Recommends —
          never promotes automatically.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Candidate Variant</Label>
            <Select value={candidateId} onValueChange={setCandidateId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a candidate variant" />
              </SelectTrigger>
              <SelectContent>
                {candidateVariants.length === 0 && (
                  <SelectItem value="__none" disabled>
                    No candidate variants — mark one in the Variants tab
                  </SelectItem>
                )}
                {candidateVariants.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.name} ({v.version_tag})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Benchmark Pack</Label>
            <Select value={packId} onValueChange={setPackId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a benchmark pack" />
              </SelectTrigger>
              <SelectContent>
                {packs.length === 0 && (
                  <SelectItem value="__none" disabled>
                    No benchmark packs available
                  </SelectItem>
                )}
                {packs.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} ({p.example_count} examples)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Button
          onClick={handleRun}
          disabled={running || !candidateId || !packId}
          size="lg"
        >
          {running ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Running A/B (two scoring passes)…
            </>
          ) : (
            <>
              <Play className="h-4 w-4 mr-2" />
              Run A/B Evaluation
            </>
          )}
        </Button>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {result && (
          <div className="rounded-lg border p-4 space-y-3">
            <div className="flex items-center gap-3">
              {(() => {
                const meta = RECOMMENDATION_META[result.recommendation]
                const Icon = meta.Icon
                return (
                  <Badge variant="outline" className={`text-sm gap-1.5 ${meta.className}`}>
                    <Icon className="h-4 w-4" />
                    {meta.label}
                  </Badge>
                )
              })()}
              <span className="text-sm text-muted-foreground">{result.statusReason}</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Hard Fails</p>
                <p className="font-semibold">{result.hardFailCount}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Warnings</p>
                <p className="font-semibold">{result.softWarningCount}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Gate Status</p>
                <p className="font-semibold">{result.gateStatus}</p>
              </div>
            </div>
            <a
              href={`/admin/sandbox?tab=comparisons`}
              className="text-sm text-primary hover:underline"
            >
              View full comparison →
            </a>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
