'use client'

import { useEffect, useMemo, useState } from 'react'
import { Trophy, Loader2, Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import type { TrophyEligibility, TrophyScoringSystem } from '@/lib/trophy-room/types'

interface ApproveModalProps {
  open: boolean
  onClose: () => void
  buckId: string
  eligibility: TrophyEligibility
  onApproved?: (entryId: string) => void
}

const SCORING_LABEL: Record<TrophyScoringSystem, string> = {
  bc_typical: 'B&C TYPICAL',
  bc_nontypical: 'B&C NON-TYPICAL',
  py_typical: 'P&Y TYPICAL',
  py_nontypical: 'P&Y NON-TYPICAL',
}

const FRACTION_MAP: Record<number, string> = { 1: '⅛', 2: '¼', 3: '⅜', 4: '½', 5: '⅝', 6: '¾', 7: '⅞' }

function formatScore(n: number | null | undefined): string {
  if (typeof n !== 'number' || !isFinite(n)) return '—'
  const whole = Math.floor(n)
  const eighths = Math.round((n - whole) * 8)
  if (eighths === 0) return `${whole}`
  if (eighths === 8) return `${whole + 1}`
  return `${whole} ${FRACTION_MAP[eighths]}`
}

export function ApproveTrophyModal({ open, onClose, buckId, eligibility, onApproved }: ApproveModalProps) {
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(eligibility.defaultPhotoUrl)
  const [label, setLabel] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    setSelectedPhoto(eligibility.defaultPhotoUrl)
  }, [eligibility.defaultPhotoUrl])

  const verifiedSuffix = useMemo(() => (eligibility.isVerifiedScore ? ' · VERIFIED' : ''), [eligibility.isVerifiedScore])

  if (!open) return null

  async function handleApprove() {
    if (!selectedPhoto) {
      toast.error('Choose a display photo')
      return
    }
    if (eligibility.suggestedDisplayGross == null || !eligibility.suggestedScoringSystem) {
      toast.error('Missing required score data')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/trophy-room', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          buckId,
          predictionId: eligibility.predictionId,
          displayPhotoUrl: selectedPhoto,
          displayLabel: label.trim() || null,
          displayGross: eligibility.suggestedDisplayGross,
          displayNet: eligibility.suggestedDisplayNet,
          scoringSystem: eligibility.suggestedScoringSystem,
          confidenceTier: eligibility.suggestedConfidenceTier ?? 'high',
          isVerifiedScore: eligibility.isVerifiedScore,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? 'Failed to add')
      }
      const entry = await res.json()
      toast.success('Added to Trophy Room — generating watermark…')
      onApproved?.(entry.id)
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="bg-card rounded-xl border border-border max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-amber-500" />
            <h2 className="text-base font-semibold">Add to Trophy Room</h2>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-secondary/40">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        <div className="p-4 space-y-5">
          {/* Preview */}
          <div className="relative aspect-video rounded-lg overflow-hidden bg-black border border-border/40">
            {selectedPhoto ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={selectedPhoto} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">No photo selected</div>
            )}
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-3 sm:p-4">
              <div className="flex items-end justify-between gap-3">
                <div>
                  {label && <div className="text-amber-200/95 text-sm sm:text-base font-serif mb-1">{label}</div>}
                  <div className="text-amber-200 font-bold text-3xl sm:text-5xl tracking-tight leading-none">
                    {formatScore(eligibility.suggestedDisplayGross)}
                  </div>
                  <div className="text-amber-200/70 text-[10px] sm:text-xs tracking-[0.18em] mt-1">
                    {eligibility.suggestedScoringSystem ? SCORING_LABEL[eligibility.suggestedScoringSystem] : ''}{verifiedSuffix}
                  </div>
                </div>
                <div className="text-amber-200/85 text-[10px] sm:text-xs tracking-[0.32em] font-bold">
                  RAX CORE
                </div>
                {eligibility.suggestedDisplayNet != null && (
                  <div className="text-right">
                    <div className="text-amber-200/85 text-lg sm:text-2xl font-semibold tabular-nums">
                      {formatScore(eligibility.suggestedDisplayNet)}
                    </div>
                    <div className="text-amber-200/55 text-[10px] tracking-[0.12em]">NET</div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Buck name input */}
          <div className="space-y-1.5">
            <label htmlFor="trophy-label" className="text-sm font-medium">Buck name (optional)</label>
            <Input
              id="trophy-label"
              value={label}
              onChange={e => setLabel(e.target.value.slice(0, 40))}
              placeholder='e.g. "Big Eight"'
              maxLength={40}
            />
          </div>

          {/* Photo picker */}
          {eligibility.candidatePhotoUrls.length > 1 && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Choose display photo</label>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {eligibility.candidatePhotoUrls.map(url => (
                  <button
                    key={url}
                    type="button"
                    onClick={() => setSelectedPhoto(url)}
                    className={`relative aspect-square rounded-lg overflow-hidden border-2 transition ${
                      selectedPhoto === url ? 'border-amber-500' : 'border-border/40 hover:border-border'
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt="" className="w-full h-full object-cover" />
                    {selectedPhoto === url && (
                      <div className="absolute top-1 right-1 bg-amber-500 rounded-full p-0.5">
                        <Check className="h-3 w-3 text-black" strokeWidth={3} />
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            The watermark says <strong>RAX CORE Score</strong>. It does not claim official certification.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 p-4 border-t border-border">
          <Button variant="outline" type="button" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button type="button" onClick={handleApprove} disabled={submitting || !selectedPhoto}>
            {submitting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Adding…</> : <><Trophy className="h-4 w-4 mr-2" />Add to Trophy Room</>}
          </Button>
        </div>
      </div>
    </div>
  )
}
