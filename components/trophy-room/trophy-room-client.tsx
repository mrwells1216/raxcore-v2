'use client'

import { useEffect, useRef, useState } from 'react'
import useSWR from 'swr'
import { Trophy } from 'lucide-react'
import { TrophyCard } from './trophy-card'
import type { TrophyRoomEntry } from '@/lib/trophy-room/types'

interface Props {
  initialEntries: TrophyRoomEntry[]
  initialCursor: string | null
}

const fetcher = (url: string) => fetch(url).then(r => r.json())

export function TrophyRoomClient({ initialEntries, initialCursor }: Props) {
  const [entries, setEntries] = useState<TrophyRoomEntry[]>(initialEntries)
  const [cursor, setCursor] = useState<string | null>(initialCursor)
  const [done, setDone] = useState(initialCursor === null)

  // Poll for watermark updates if any are still pending
  const anyPending = entries.some(e => e.watermark_status === 'pending' || e.watermark_status === 'generating')
  const { data: refreshed } = useSWR<{ entries: TrophyRoomEntry[]; nextCursor: string | null }>(
    anyPending ? '/api/trophy-room?limit=20' : null,
    fetcher,
    { refreshInterval: 5000 },
  )

  useEffect(() => {
    if (refreshed?.entries) {
      setEntries(prev => {
        const byId = new Map(prev.map(e => [e.id, e]))
        for (const e of refreshed.entries) byId.set(e.id, e)
        return Array.from(byId.values()).sort((a, b) => b.created_at.localeCompare(a.created_at))
      })
    }
  }, [refreshed])

  const loadingMore = useRef(false)
  async function loadMore() {
    if (loadingMore.current || done || !cursor) return
    loadingMore.current = true
    try {
      const res = await fetch(`/api/trophy-room?limit=20&cursor=${encodeURIComponent(cursor)}`)
      if (!res.ok) return
      const data = await res.json() as { entries: TrophyRoomEntry[]; nextCursor: string | null }
      setEntries(prev => [...prev, ...data.entries])
      setCursor(data.nextCursor)
      if (!data.nextCursor) setDone(true)
    } finally {
      loadingMore.current = false
    }
  }

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="p-4 rounded-full bg-amber-500/10 mb-4">
          <Trophy className="h-10 w-10 text-amber-500" />
        </div>
        <h2 className="text-lg font-semibold mb-2">Your Trophy Room is empty</h2>
        <p className="text-sm text-muted-foreground max-w-md">
          Score a buck with high confidence and you&apos;ll be invited to add it here.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {entries.map(entry => (
          <TrophyCard
            key={entry.id}
            entry={entry}
            onDeleted={id => setEntries(prev => prev.filter(e => e.id !== id))}
          />
        ))}
      </div>

      {!done && cursor && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={loadMore}
            className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-secondary/40 transition"
          >
            Load more
          </button>
        </div>
      )}
    </div>
  )
}
