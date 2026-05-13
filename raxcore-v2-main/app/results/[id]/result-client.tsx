'use client'

import { useRouter } from 'next/navigation'
import { ScoringResults } from '@/components/scoring/scoring-results'
import type { ScoringResult, ScoringFormData } from '@/lib/types'

export function ResultClient({ result, formData }: { result: ScoringResult; formData: ScoringFormData }) {
  const router = useRouter()
  return <ScoringResults result={result} formData={formData} onReset={() => router.push('/score')} />
}
