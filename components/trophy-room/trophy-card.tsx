'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Loader2, MoreHorizontal, Trash2, Shield } from 'lucide-react'
import { toast } from 'sonner'
import type { TrophyRoomEntry } from '@/lib/trophy-room/types'

const SCORING_LABEL: Record<string, string> = {
  bc_typical: 'B&C Typical',
  bc_nontypical: 'B&C Non-Typical',
  py_typical: 'P&Y Typical',
  py_nontypical: 'P&Y Non-Typical',
}

const FRACTION_MAP: Record<number, string> = { 1: '⅛', 2: '¼', 3: '⅜', 4: '½', 5: '⅝', 6: '¾', 7: '⅞' }

function formatScore(n: number): string {
  const whole = Math.floor(n)
  const eighths = Math.round((n - whole) * 8)
  if (eighths === 0) return `${whole}`
  if (eighths === 8) return `${whole + 1}`
  return `${whole} ${FRACTION_MAP[eighths]}`
}

function getScoreColor(gross: number): string {
  if (gross >= 170) return '#f59e0b'
  if (gross >= 150) return '#f97316'
  if (gross >= 130) return '#22c55e'
  if (gross >= 115) return '#3b82f6'
  return '#8b5cf6'
}

function getConfidenceColor(tier: string): string {
  if (tier === 'very_high') return '#22c55e'
  if (tier === 'high') return '#f59e0b'
  return '#6b7280'
}

// Mini position bar showing score in 0–220" range
function ScoreBar({ gross }: { gross: number }) {
  const MAX = 220
  const pct = Math.min(gross / MAX * 100, 100)
  const color = getScoreColor(gross)
  return (
    <div className="relative h-1 rounded-full bg-white/10 overflow-visible mt-1">
      <div
        className="absolute top-0 left-0 h-full rounded-full transition-all"
        style={{ width: `${pct}%`, background: color }}
      />
      {/* Marker dot */}
      <div
        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full border-2 border-black/80 shadow-sm"
        style={{ left: `${pct}%`, background: color }}
      />
    </div>
  )
}

interface Props {
  entry: TrophyRoomEntry
  onDeleted?: (id: string) => void
}

export function TrophyCard({ entry, onDeleted }: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const scoreColor = getScoreColor(entry.display_gross)
  const confidenceColor = getConfidenceColor(entry.confidence_tier)

  const imageUrl =
    entry.watermark_status === 'ready' && entry.watermarked_url
      ? entry.watermarked_url
      : entry.display_photo_url

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (!confirm('Remove from Trophy Room? You can restore later.')) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/trophy-room/${entry.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Delete failed')
      toast.success('Removed from Trophy Room')
      onDeleted?.(entry.id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Link
      href={`/trophy-room/${entry.id}`}
      className="group relative block rounded-2xl overflow-hidden bg-zinc-950 border border-white/10 hover:border-amber-500/50 transition-all duration-200 hover:shadow-lg hover:shadow-amber-500/10 hover:-translate-y-0.5"
    >
      {/* Photo */}
      <div className="aspect-[4/3] relative bg-black">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl} alt={entry.display_label ?? 'Trophy'} className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" />

        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

        {/* Watermark status */}
        {entry.watermark_status !== 'ready' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-amber-200 text-xs gap-2">
            {entry.watermark_status === 'failed' ? (
              <span>Watermark failed</span>
            ) : (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Watermarking…</span>
              </>
            )}
          </div>
        )}

        {/* Verified badge */}
        {entry.is_verified_score && (
          <div className="absolute top-2 left-2 flex items-center gap-1 bg-amber-500 text-black text-[10px] font-bold px-1.5 py-0.5 rounded-full">
            <Shield className="h-2.5 w-2.5" />
            VERIFIED
          </div>
        )}

        {/* Score */}
        <div className="absolute bottom-0 inset-x-0 p-3">
          <div className="text-3xl font-black tabular-nums" style={{ color: scoreColor }}>
            {formatScore(entry.display_gross)}&quot;
          </div>
          {entry.display_net != null && (
            <div className="text-xs text-white/60">Net {entry.display_net.toFixed(1)}&quot;</div>
          )}
        </div>

        {/* Hover menu */}
        <div className="absolute top-2 right-2">
          <button
            type="button"
            onClick={e => { e.preventDefault(); e.stopPropagation(); setMenuOpen(o => !o) }}
            className="p-1.5 rounded-md bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/80"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
          {menuOpen && (
            <div
              className="absolute top-full right-0 mt-1 bg-zinc-900 border border-white/10 rounded-lg shadow-xl overflow-hidden min-w-[140px] z-10"
              onClick={e => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {deleting ? 'Removing…' : 'Remove'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Footer: label + score bar + system + confidence dot */}
      <div className="p-3 space-y-2">
        {entry.display_label && (
          <div className="text-sm font-semibold truncate">{entry.display_label}</div>
        )}

        {/* Mini score bar */}
        <ScoreBar gross={entry.display_gross} />

        <div className="flex items-center justify-between pt-1">
          <span className="text-[11px] text-muted-foreground">
            {SCORING_LABEL[entry.scoring_system] ?? entry.scoring_system}
          </span>
          <div
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ background: confidenceColor }}
            title={entry.confidence_tier}
          />
        </div>
      </div>
    </Link>
  )
}
