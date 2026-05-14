'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { Header } from '@/components/header'
import { ScoringWizard } from '@/components/scoring/scoring-wizard'
import { ScoringResults } from '@/components/scoring/scoring-results'
import { createClient } from '@/lib/supabase/client'
import type { ScoringResult, ScoringFormData } from '@/lib/types'

const SESSION_KEY = 'raxcore_active_result'

function ScorePageContent() {
  const searchParams = useSearchParams()
  const initialMode = searchParams.get('mode') === 'upload' ? 'upload' : 'camera'
  
  const [result, setResult] = useState<ScoringResult | null>(null)
  const [formData, setFormData] = useState<ScoringFormData | null>(null)
  const [userId, setUserId] = useState<string | null>(null)

  // Restore result from sessionStorage on mount (survives refresh while on this tab)
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(SESSION_KEY)
      if (stored) {
        const { result: r, formData: fd } = JSON.parse(stored)
        if (r && fd) {
          setResult(r)
          setFormData(fd)
        }
      }
    } catch {
      // ignore parse errors
    }
  }, [])

  useEffect(() => {
    createClient().auth.getUser().then((result: { data: { user: { id: string } | null } }) => {
      setUserId(result.data.user?.id ?? null)
    })
  }, [])

  const handleScoringComplete = (scoringResult: ScoringResult, data: ScoringFormData) => {
    setResult(scoringResult)
    setFormData(data)
    // Persist so a refresh re-anchors to the results view
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ result: scoringResult, formData: data }))
    } catch {
      // ignore quota errors
    }
  }

  const handleReset = () => {
    setResult(null)
    setFormData(null)
    try {
      sessionStorage.removeItem(SESSION_KEY)
    } catch {
      // ignore
    }
  }

  return (
    <div className="min-h-svh flex flex-col bg-background">
      <Header />
      
      <main className="flex-1 overflow-y-auto container max-w-screen-xl mx-auto px-4 py-6 pb-safe">
        {result && formData ? (
          <ScoringResults 
            result={result} 
            formData={formData}
            onReset={handleReset} 
          />
        ) : (
          <ScoringWizard 
            initialMode={initialMode as 'camera' | 'upload'}
            userId={userId}
            onComplete={handleScoringComplete}
          />
        )}
      </main>
    </div>
  )
}

export default function ScorePage() {
  return (
    <Suspense fallback={
      <div className="min-h-svh flex flex-col items-center justify-center bg-background gap-4">
        <div className="spinner-bronze" />
        <p 
          className="text-xs font-mono tracking-widest uppercase"
          style={{ color: 'var(--bronze-mid)' }}
        >
          Loading...
        </p>
      </div>
    }>
      <ScorePageContent />
    </Suspense>
  )
}
