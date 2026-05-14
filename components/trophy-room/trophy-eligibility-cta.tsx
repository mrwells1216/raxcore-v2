'use client'

import { useEffect, useState } from 'react'
import { Trophy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ApproveTrophyModal } from './approve-modal'
import type { TrophyEligibility } from '@/lib/trophy-room/types'

interface Props {
  buckId: string
}

export function TrophyEligibilityCta({ buckId }: Props) {
  const [eligibility, setEligibility] = useState<TrophyEligibility | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(`/api/trophy-room/eligibility/${buckId}`)
        if (!res.ok) return
        const data = await res.json() as TrophyEligibility
        if (!cancelled) setEligibility(data)
      } catch { /* silent */ }
    }
    load()
    return () => { cancelled = true }
  }, [buckId])

  if (!eligibility || !eligibility.eligible || dismissed || done) return null

  return (
    <>
      <Card className="border-amber-500/30 bg-gradient-to-br from-amber-500/5 to-transparent">
        <CardContent className="p-4 flex items-start gap-3">
          <div className="p-2 rounded-lg bg-amber-500/15 text-amber-500 shrink-0">
            <Trophy className="h-5 w-5" />
          </div>
          <div className="flex-1 space-y-1">
            <p className="font-semibold text-sm">Add to Trophy Room</p>
            <p className="text-xs text-muted-foreground">
              This buck qualifies for your Trophy Room.{' '}
              {eligibility.isVerifiedScore ? 'Verified Score.' : 'High confidence score.'}
            </p>
            <div className="flex gap-2 pt-2">
              <Button size="sm" onClick={() => setModalOpen(true)}>Preview &amp; Approve</Button>
              <Button size="sm" variant="ghost" onClick={() => setDismissed(true)}>Not now</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <ApproveTrophyModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        buckId={buckId}
        eligibility={eligibility}
        onApproved={() => setDone(true)}
      />
    </>
  )
}
