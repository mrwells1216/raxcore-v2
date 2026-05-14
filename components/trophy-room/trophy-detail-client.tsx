'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Download, Share2, Trash2, Loader2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import type { TrophyRoomEntry } from '@/lib/trophy-room/types'

const SCORING_LABEL: Record<string, string> = {
  bc_typical: 'B&C Typical',
  bc_nontypical: 'B&C Non-Typical',
  py_typical: 'P&Y Typical',
  py_nontypical: 'P&Y Non-Typical',
}

interface Props {
  entry: TrophyRoomEntry
}

export function TrophyDetailClient({ entry: initial }: Props) {
  const router = useRouter()
  const [entry, setEntry] = useState(initial)
  const [deleting, setDeleting] = useState(false)

  // Poll for watermark completion
  useEffect(() => {
    if (entry.watermark_status === 'ready' || entry.watermark_status === 'failed') return
    const interval = setInterval(async () => {
      const res = await fetch(`/api/trophy-room/${entry.id}`)
      if (res.ok) {
        const fresh = await res.json() as TrophyRoomEntry
        setEntry(fresh)
        if (fresh.watermark_status === 'ready' || fresh.watermark_status === 'failed') {
          clearInterval(interval)
        }
      }
    }, 4000)
    return () => clearInterval(interval)
  }, [entry.id, entry.watermark_status])

  const imageUrl =
    entry.watermark_status === 'ready' && entry.watermarked_url ? entry.watermarked_url : entry.display_photo_url

  async function handleShare() {
    if (!entry.watermarked_url) {
      toast.error('Watermark still generating')
      return
    }
    try {
      await navigator.clipboard.writeText(entry.watermarked_url)
      toast.success('Link copied to clipboard')
    } catch {
      toast.error('Failed to copy link')
    }
  }

  async function handleDownload() {
    if (!entry.watermarked_url) return
    const res = await fetch(entry.watermarked_url)
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${entry.display_label?.replace(/[^\w-]+/g, '_') ?? 'trophy'}-${entry.id.slice(0, 8)}.jpg`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  async function handleDelete() {
    if (!confirm('Remove this entry from your Trophy Room?')) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/trophy-room/${entry.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Delete failed')
      toast.success('Removed')
      router.push('/trophy-room')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed')
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl overflow-hidden bg-black border border-border/40 relative">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl} alt={entry.display_label ?? 'Trophy'} className="w-full max-h-[80vh] object-contain" />
        {entry.watermark_status !== 'ready' && (
          <div className="absolute inset-x-0 bottom-0 bg-black/60 text-amber-200 text-sm flex items-center justify-center gap-2 py-3">
            {entry.watermark_status === 'failed' ? (
              <span>Watermark generation failed</span>
            ) : (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Generating watermark…</span>
              </>
            )}
          </div>
        )}
      </div>

      <Card>
        <CardContent className="p-5 space-y-3">
          {entry.display_label && (
            <h2 className="text-xl font-serif">{entry.display_label}</h2>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">Gross</div>
              <div className="text-lg font-bold tabular-nums">{entry.display_gross.toFixed(1)}&quot;</div>
            </div>
            {entry.display_net != null && (
              <div>
                <div className="text-xs text-muted-foreground">Net</div>
                <div className="text-lg font-bold tabular-nums">{entry.display_net.toFixed(1)}&quot;</div>
              </div>
            )}
            <div>
              <div className="text-xs text-muted-foreground">System</div>
              <div className="font-medium">{SCORING_LABEL[entry.scoring_system] ?? entry.scoring_system}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">{entry.is_verified_score ? 'Status' : 'Confidence'}</div>
              <div className="font-medium">{entry.is_verified_score ? 'Verified' : entry.confidence_tier}</div>
            </div>
          </div>
          <div className="text-xs text-muted-foreground pt-2 border-t border-border/40">
            Added to Trophy Room on {new Date(entry.approved_at).toLocaleDateString()}
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button onClick={handleShare} disabled={!entry.watermarked_url} variant="outline">
          <Share2 className="h-4 w-4 mr-2" />Share link
        </Button>
        <Button onClick={handleDownload} disabled={!entry.watermarked_url} variant="outline">
          <Download className="h-4 w-4 mr-2" />Download
        </Button>
        <Button onClick={handleDelete} disabled={deleting} variant="destructive" className="ml-auto">
          <Trash2 className="h-4 w-4 mr-2" />
          {deleting ? 'Removing…' : 'Delete from Trophy Room'}
        </Button>
      </div>
    </div>
  )
}
