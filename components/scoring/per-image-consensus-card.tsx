'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { PerImageConsensusResult, PerReferenceFusion, PerImageReferenceObservation } from '@/lib/types'

interface PerImageConsensusCardProps {
  consensus: PerImageConsensusResult
}

function formatLabel(label: string): string {
  return label.replace(/_/g, ' ')
}

function agreementColor(tier: PerReferenceFusion['agreementTier']): string {
  switch (tier) {
    case 'high':     return 'text-green-700 bg-green-50 border-green-200'
    case 'medium':   return 'text-amber-700 bg-amber-50 border-amber-200'
    case 'low':      return 'text-orange-700 bg-orange-50 border-orange-200'
    case 'fallback': return 'text-muted-foreground bg-muted border-border'
  }
}

function angleLabel(angle: PerImageReferenceObservation['angleType']): string {
  if (angle === 'front') return 'front'
  if (angle === 'left')  return 'left'
  if (angle === 'right') return 'right'
  return '?'
}

function ReferenceRow({ ref }: { ref: PerReferenceFusion }) {
  const [open, setOpen] = useState(false)
  const usable = ref.observations.filter(o => o.visible)
  if (usable.length === 0) return null

  return (
    <div className="rounded-md border bg-background">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium capitalize truncate">{formatLabel(ref.label)}</span>
          <span
            className={cn(
              'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium',
              agreementColor(ref.agreementTier),
            )}
          >
            {ref.agreementTier}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0 text-xs text-muted-foreground">
          <span>{usable.length} obs · spread {ref.spread.toFixed(2)}</span>
          {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </div>
      </button>

      {open && (
        <div className="border-t px-3 py-2 space-y-1.5">
          {ref.observations.map((obs, i) => {
            const dropped = obs.outlier || !!obs.excludedReason
            return (
              <div
                key={`${obs.imageIndex}-${i}`}
                className={cn(
                  'flex items-center justify-between gap-2 text-xs rounded px-2 py-1',
                  dropped ? 'bg-muted/50' : '',
                )}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {dropped
                    ? <AlertTriangle className="h-3 w-3 text-amber-600 shrink-0" />
                    : <CheckCircle2 className="h-3 w-3 text-green-600 shrink-0" />}
                  <span className="text-muted-foreground">img {obs.imageIndex + 1} ({angleLabel(obs.angleType)})</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="font-mono tabular-nums">
                    {obs.estimatedGross.toFixed(1)} px/in
                  </span>
                  <span className="text-muted-foreground">
                    q {(obs.quality * 100).toFixed(0)}% · d {(obs.distortion * 100).toFixed(0)}%
                  </span>
                </div>
                {dropped && obs.excludedReason && (
                  <div className="w-full text-[10px] text-amber-700 mt-0.5 pl-5">
                    {obs.excludedReason}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function PerImageConsensusCard({ consensus }: PerImageConsensusCardProps) {
  const [expanded, setExpanded] = useState(false)
  if (!consensus || !consensus.perReference || consensus.perReference.length === 0) {
    return null
  }

  // Filter to references that have at least one usable observation
  const visibleRefs = consensus.perReference.filter(r =>
    r.observations.some(o => o.visible),
  )
  if (visibleRefs.length === 0) return null

  // Surface perked-ear images as a quick warning
  const perkedImages = consensus.earPositions.filter(p => p.state === 'perked' || p.state === 'sideways')

  return (
    <Card>
      <CardHeader className="pb-2">
        <Button
          variant="ghost"
          className="w-full justify-between p-0 h-auto hover:bg-transparent"
          onClick={() => setExpanded(v => !v)}
        >
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm">Per-image anatomical references</CardTitle>
            <span className="text-xs text-muted-foreground">
              {consensus.contributingImageCount} image{consensus.contributingImageCount === 1 ? '' : 's'}
            </span>
          </div>
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>
      </CardHeader>
      {expanded && (
        <CardContent className="space-y-2 pt-0">
          {perkedImages.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <div className="flex items-center gap-2 font-medium">
                <AlertTriangle className="h-3.5 w-3.5" />
                Ear pose flagged
              </div>
              <div className="mt-1">
                {perkedImages.map(p => (
                  <div key={p.imageIndex}>
                    Image {p.imageIndex + 1} ({angleLabel(p.angleType)}): {p.state}
                    {p.reason ? ` — ${p.reason}` : ''}. ear-tip excluded from references.
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            {visibleRefs.map(ref => <ReferenceRow key={ref.label} ref={ref} />)}
          </div>
          <p className="text-[11px] text-muted-foreground pt-1">
            Each anatomical reference is captured independently per photo. Outliers (≥2.5× MAD from the median) are
            highlighted and excluded from the consensus. ear-tip distance is only used when ears are forward.
          </p>
        </CardContent>
      )}
    </Card>
  )
}
