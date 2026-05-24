'use client'

import { useState } from 'react'
import Image from 'next/image'
import useSWR from 'swr'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Loader2 } from 'lucide-react'
import { FeaturesPanel } from './features-panel'
import { ClassroomResults, type ClassroomScoreResponse } from './classroom-results'
import type { ExperimentConfig } from '@/lib/scoring/experiment-config'

interface RecentBuck {
  buckId: string
  nickname: string | null
  state: string | null
  rackType: string
  predictionId: string | null
  predictedGross: number | null
  imageUrls: string[]
  thumbnail: string | null
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

const CATEGORIES: { key: string; label: string }[] = [
  { key: 'expected_higher', label: 'Expected a higher score' },
  { key: 'expected_lower', label: 'Expected a lower score' },
  { key: 'left_antler_error', label: 'Left antler error' },
  { key: 'right_antler_error', label: 'Right antler error' },
]

const TINES: { key: string; label: string }[] = [
  { key: 'main_beam', label: 'Main beam' },
  { key: 'g1', label: 'G1' },
  { key: 'g2', label: 'G2' },
  { key: 'g3', label: 'G3' },
  { key: 'g4', label: 'G4' },
  { key: 'dog_tine', label: 'Dog tine' },
  { key: 'irregular_point', label: 'Irregular pt' },
]

function angleForIndex(i: number): string {
  return i === 0 ? 'front' : i === 1 ? 'left' : i === 2 ? 'right' : 'unknown'
}

export function RaxrsFlow({ userId }: { userId: string | null }) {
  const { data, isLoading } = useSWR<{ bucks: RecentBuck[] }>('/api/classroom/recent', fetcher)
  const [selected, setSelected] = useState<RecentBuck | null>(null)
  const [categories, setCategories] = useState<Set<string>>(new Set())
  const [leftTines, setLeftTines] = useState<Set<string>>(new Set())
  const [rightTines, setRightTines] = useState<Set<string>>(new Set())
  const [config, setConfig] = useState<ExperimentConfig>({})
  const [isScoring, setIsScoring] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ClassroomScoreResponse | null>(null)

  const bucks = data?.bucks ?? []

  function toggle(set: Set<string>, key: string): Set<string> {
    const next = new Set(set)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  }

  function reset() {
    setSelected(null)
    setCategories(new Set())
    setLeftTines(new Set())
    setRightTines(new Set())
    setConfig({})
    setResult(null)
    setError(null)
  }

  async function runRescore() {
    if (!selected) return
    setIsScoring(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.append('rack_type', selected.rackType || 'typical')
      if (selected.state) fd.append('state', selected.state)
      if (userId) fd.append('user_id', userId)
      fd.append('experiment_config', JSON.stringify(config))
      fd.append('is_classroom_run', 'true')
      selected.imageUrls.forEach((url, i) => {
        fd.append(`image_url_${i}`, url)
        fd.append(`angle_${i}`, angleForIndex(i))
      })

      const res = await fetch('/api/score', { method: 'POST', body: fd })
      if (!res.ok) {
        const txt = await res.text()
        throw new Error(txt.slice(0, 200) || 'Rescore failed')
      }
      const json = (await res.json()) as ClassroomScoreResponse
      setResult(json)

      // Record the flagged error categories for the learning flywheel.
      const tineFlags = [
        { side: 'left', tines: Array.from(leftTines) },
        { side: 'right', tines: Array.from(rightTines) },
      ].filter((f) => f.tines.length > 0)
      try {
        await fetch('/api/classroom/rescore', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            buckId: selected.buckId,
            predictionId: selected.predictionId,
            oldGross: selected.predictedGross,
            newGross: json.estimatedScore ?? null,
            userId,
            categories: Array.from(categories),
            tineFlags,
          }),
        })
      } catch {
        // non-blocking — the score still rendered
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Rescore failed')
    } finally {
      setIsScoring(false)
    }
  }

  if (result) {
    return (
      <ClassroomResults
        result={result}
        oldGross={selected?.predictedGross ?? null}
        onReset={reset}
      />
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Pick a previously scored buck, flag what looked wrong, and re-run it (optionally with
        different features). The flags feed the learning system; you&apos;ll see the new score
        next to the old one.
      </p>

      {/* Buck picker */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Choose a buck</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading recent scores…
            </div>
          ) : bucks.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No scored bucks found yet. Score one on the Score tab or in the Exam lab first.
            </p>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {bucks.map((b) => {
                const isSel = selected?.buckId === b.buckId
                return (
                  <button
                    key={b.buckId}
                    type="button"
                    onClick={() => setSelected(b)}
                    className={`relative rounded-md overflow-hidden border text-left transition ${
                      isSel ? 'ring-2 ring-primary border-primary' : 'border-border hover:border-primary/50'
                    }`}
                  >
                    {b.thumbnail ? (
                      <Image
                        src={b.thumbnail}
                        alt={b.nickname ?? 'buck'}
                        width={120}
                        height={120}
                        className="h-20 w-full object-cover"
                        unoptimized
                      />
                    ) : (
                      <div className="h-20 w-full bg-muted" />
                    )}
                    <div className="px-1.5 py-1">
                      <p className="text-[11px] font-semibold tabular-nums">
                        {b.predictedGross != null ? `${b.predictedGross.toFixed(1)}"` : '—'}
                      </p>
                      <p className="text-[10px] text-muted-foreground truncate">
                        {b.nickname ?? b.buckId.slice(0, 6)}
                      </p>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {selected && (
        <>
          {/* Error categories */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">What looked wrong?</CardTitle>
              <CardDescription className="text-xs">
                Previous gross: {selected.predictedGross != null ? `${selected.predictedGross.toFixed(1)}"` : '—'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {CATEGORIES.map((c) => (
                  <label key={c.key} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox
                      checked={categories.has(c.key)}
                      onCheckedChange={() => setCategories((s) => toggle(s, c.key))}
                    />
                    {c.label}
                  </label>
                ))}
              </div>

              {(categories.has('left_antler_error') || categories.has('right_antler_error')) && (
                <div className="space-y-3 border-t pt-3">
                  {categories.has('left_antler_error') && (
                    <TineGroup
                      title="Left antler points"
                      selected={leftTines}
                      onToggle={(k) => setLeftTines((s) => toggle(s, k))}
                    />
                  )}
                  {categories.has('right_antler_error') && (
                    <TineGroup
                      title="Right antler points"
                      selected={rightTines}
                      onToggle={(k) => setRightTines((s) => toggle(s, k))}
                    />
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <FeaturesPanel value={config} onChange={setConfig} />

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button onClick={runRescore} disabled={isScoring} className="w-full">
            {isScoring ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Rescoring…
              </>
            ) : (
              'Rescore this buck'
            )}
          </Button>
        </>
      )}
    </div>
  )
}

function TineGroup({
  title,
  selected,
  onToggle,
}: {
  title: string
  selected: Set<string>
  onToggle: (key: string) => void
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{title}</Label>
      <div className="flex flex-wrap gap-2">
        {TINES.map((t) => {
          const on = selected.has(t.key)
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => onToggle(t.key)}
              className={`text-xs px-2 py-1 rounded border transition ${
                on ? 'bg-primary/10 border-primary text-foreground' : 'border-border text-muted-foreground'
              }`}
            >
              {t.label}
            </button>
          )
        })}
      </div>
      {selected.size > 0 && (
        <div className="flex flex-wrap gap-1 pt-1">
          {Array.from(selected).map((k) => (
            <Badge key={k} variant="secondary" className="text-[10px]">
              {TINES.find((t) => t.key === k)?.label ?? k}
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}
