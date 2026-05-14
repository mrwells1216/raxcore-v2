'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Cpu, Star } from 'lucide-react'

interface SheetDetailClientProps {
  sheetId: string
  isAlreadyBenchmark: boolean
  hasAiRun: boolean
}

export function SheetDetailClient({ sheetId, isAlreadyBenchmark, hasAiRun }: SheetDetailClientProps) {
  const router = useRouter()
  const [runningAi, setRunningAi] = useState(false)
  const [promoting, setPromoting] = useState(false)
  const [confirmPromote, setConfirmPromote] = useState(false)

  async function handleRunAi() {
    setRunningAi(true)
    try {
      const res = await fetch(`/api/admin/training-import/${sheetId}/run-ai`, { method: 'POST' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        alert(err.error ?? 'AI run failed')
        return
      }
      router.refresh()
    } catch {
      alert('Failed to run AI scoring')
    } finally {
      setRunningAi(false)
    }
  }

  async function handlePromote() {
    setPromoting(true)
    try {
      const res = await fetch(`/api/admin/training-import/${sheetId}/promote`, { method: 'POST' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        alert(err.error ?? 'Promotion failed')
        return
      }
      setConfirmPromote(false)
      router.refresh()
    } catch {
      alert('Failed to promote sheet')
    } finally {
      setPromoting(false)
    }
  }

  return (
    <div className="flex items-center gap-3 pt-2 border-t border-border/40">
      <button
        type="button"
        disabled={runningAi}
        onClick={handleRunAi}
        className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border border-border/60 bg-secondary/30 hover:bg-secondary/60 transition-colors disabled:opacity-50"
      >
        {runningAi ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cpu className="h-4 w-4" />}
        {hasAiRun ? 'Re-run AI' : 'Run AI'}
      </button>

      {!isAlreadyBenchmark && (
        <>
          {!confirmPromote ? (
            <button
              type="button"
              onClick={() => setConfirmPromote(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold border border-amber-500/40 bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 transition-colors"
            >
              <Star className="h-4 w-4" />
              Promote to Gold Standard
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Are you sure?</span>
              <button
                type="button"
                disabled={promoting}
                onClick={handlePromote}
                className="px-3 py-1.5 rounded text-xs font-semibold bg-amber-500 text-black hover:bg-amber-400 transition-colors disabled:opacity-50"
              >
                {promoting ? 'Promoting…' : 'Yes, promote'}
              </button>
              <button
                type="button"
                onClick={() => setConfirmPromote(false)}
                className="px-3 py-1.5 rounded text-xs text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
