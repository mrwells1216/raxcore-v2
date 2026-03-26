import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Header } from '@/components/header'
import { ResultClient } from './result-client'
import { ArrowLeft } from 'lucide-react'
import { getBuckBundle } from '@/lib/storage/service'
import type { ScoringResult, ScoringFormData } from '@/lib/types'

export default async function ResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { buck, images, prediction } = await getBuckBundle(id)
  if (!buck || !prediction) return notFound()

  // Extract scoring metadata from raw response if available
  const rawResponse = (prediction as unknown as { raw_response?: { scoringMethod?: string; visionModelUsed?: string | null; visionConfidence?: number | null; learningSummary?: unknown; confidenceExplanation?: string[]; scalingReferencesUsed?: string[] } }).raw_response
  const scoringMethod = rawResponse?.scoringMethod as ScoringResult['scoringMethod'] || 'heuristic'
  const visionModelUsed = rawResponse?.visionModelUsed || null
  const visionConfidence = rawResponse?.visionConfidence || null

  const result: ScoringResult = {
    buck: { ...buck, property_id: (buck as any).property_id || null },
    images,
    prediction,
    confidence_explanation: rawResponse?.confidenceExplanation || (
      prediction.confidence_percent && prediction.confidence_percent >= 75
        ? ['Multi-angle / visible landmark heuristics produced a higher-confidence estimate.']
        : ['This estimate uses local heuristics and should be treated as a field estimate, not an official score.']
    ),
    scaling_references_used: rawResponse?.scalingReferencesUsed || [
      'Ear base-to-tip reference',
      'Eye-to-eye reference',
      'State calibration guardrail',
    ],
    disclaimer: 'This is an AI estimate, not an official score. Official scoring requires physical measurement.',
    scoringMethod,
    visionModelUsed,
    visionConfidence,
    learningSummary: rawResponse?.learningSummary as ScoringResult['learningSummary'],
  }

  const formData: ScoringFormData = {
    state: buck.state,
    rack_type: buck.rack_type,
    harvest_method: buck.harvest_method || undefined,
    source_type: buck.source_type || undefined,
    capture_device: buck.capture_device || undefined,
    ears_fully_visible: buck.ears_fully_visible || undefined,
    harvest_year: buck.harvest_year || undefined,
    main_frame_points: buck.main_frame_points || undefined,
    notes: buck.notes || undefined,
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container max-w-2xl mx-auto px-4 py-6 pb-24">
        <div className="mb-6">
          <Link href="/history" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-4">
            <ArrowLeft className="mr-1 h-4 w-4" />Back to History
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">Score Results</h1>
          <p className="text-muted-foreground text-sm">{buck.state} | {buck.rack_type} | {buck.main_frame_points ? `${buck.main_frame_points}-frame | ` : ''}{new Date(buck.created_at).toLocaleDateString()}</p>
        </div>
        <ResultClient result={result} formData={formData} />
      </main>
    </div>
  )
}
