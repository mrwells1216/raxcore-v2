'use client'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { Header } from '@/components/header'
import { ScoringWizard } from '@/components/scoring/scoring-wizard'
import { ScoringResults } from '@/components/scoring/scoring-results'
import { createClient } from '@/lib/supabase/client'
import type { ScoringResult, ScoringFormData } from '@/lib/types'

export default function ScorePage() {
  const searchParams = useSearchParams()
  const initialMode = searchParams.get('mode') === 'upload' ? 'upload' : 'camera'
  
  const [result, setResult] = useState<ScoringResult | null>(null)
  const [formData, setFormData] = useState<ScoringFormData | null>(null)
  const [userId, setUserId] = useState<string | null>(null)

  useEffect(() => {
    createClient().auth.getUser().then(({ data: { user } }) => {
      setUserId(user?.id ?? null)
    })
  }, [])

  const handleScoringComplete = (scoringResult: ScoringResult, data: ScoringFormData) => {
    setResult(scoringResult)
    setFormData(data)
  }

  const handleReset = () => {
    setResult(null)
    setFormData(null)
  }

  return (
    <div className="min-h-svh flex flex-col bg-background">
      <Header />
      
      <main className="flex-1 container max-w-screen-xl mx-auto px-4 py-6">
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
