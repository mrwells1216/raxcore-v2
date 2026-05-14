'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Loader2, MoreHorizontal, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { TrophyRoomEntry } from '@/lib/trophy-room/types'

const SCORING_LABEL: Record<string, string> = {
  bc_typical: 'B&C TYPICAL',
  bc_nontypical: 'B&C NON-TYPICAL',
  py_typical: 'P&Y TYPICAL',
  py_nontypical: 'P&Y NON-TYPICAL',
}

const FRACTION_MAP: Record<number, string> = { 1: '⅛', 2: '¼', 3: '⅜', 4: '½', 5: '⅝', 6: '¾', 7: '⅞' }

function formatScore(n: number): string {
  const whole = Math.floor(n)
  const eighths = Math.round((n - whole) * 8)
  if (eighths === 0) return `${whole}`
  if (eighths === 8) return `${whole + 1}`
  return `${whole} ${FRACTION_MAP[eighths]}`
}

interface Props {
  entry: TrophyRoomEntry
  onDeleted?: (id: string) => void
}

export function TrophyCard({ entry, onDeleted }: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

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
      className="group relative block rounded-xl overflow-hidden bg-card border border-border/40 hover:border-amber-500/40 transition-colors"
    >
      <div className="aspect-[4/3] relative bg-black">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl} alt={entry.display_label ?? 'Trophy'} className="w-full h-full object-cover" />

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

        {/* Score overlay (only show on non-watermarked display) */}
        {entry.watermark_status !== 'ready' && (
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-3">
            <div className="text-amber-200 font-bold text-2xl tabular-nums">{formatScore(entry.display_gross)}</div>
            <div className="text-amber-200/70 text-[10px] tracking-[0.15em] uppercase">
              {SCORING_LABEL[entry.scoring_system] ?? entry.scoring_system}
              {entry.is_verified_score && ' · VERIFIED'}
            </div>
          </div>
        )}

        {/* Hover menu */}
        <div className="absolute top-2 right-2">
          <button
            type="button"
            onClick={e => { e.preventDefault(); e.stopPropagation(); setMenuOpen(o => !o) }}
            className="p-1.5 rounded-md bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/70"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
          {menuOpen && (
            <div
              className="absolute top-full right-0 mt-1 bg-card border border-border rounded-md shadow-lg overflow-hidden min-w-[140px] z-10"
              onClick={e => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {deleting ? 'Removing…' : 'Remove'}
              </button>
            </div>
          )}
        </div>
      </div>

      {entry.display_label && (
        <div className="p-2.5 text-sm font-medium truncate">{entry.display_label}</div>
      )}
    </Link>
  )
}
