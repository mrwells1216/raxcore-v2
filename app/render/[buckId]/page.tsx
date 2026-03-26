import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Header } from '@/components/header'
import { RenderClient } from './render-client'
import { ArrowLeft, Box } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { measurementsToGeometry, DEFAULT_RENDER_SETTINGS } from '@/lib/render/service'
import type { Buck, Prediction, RackType } from '@/lib/types'

async function getBuckAndPrediction(buckId: string): Promise<{
  buck: Buck | null
  prediction: Prediction | null
}> {
  const supabase = await createClient()

  const { data: buck } = await supabase
    .from('bucks')
    .select('*')
    .eq('id', buckId)
    .single()

  if (!buck) return { buck: null, prediction: null }

  const { data: prediction } = await supabase
    .from('predictions')
    .select('*')
    .eq('buck_id', buckId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  return { buck: buck as Buck, prediction: prediction as Prediction | null }
}

export default async function RenderPage({ params }: { params: Promise<{ buckId: string }> }) {
  const { buckId } = await params
  const { buck, prediction } = await getBuckAndPrediction(buckId)

  if (!buck || !prediction) {
    return notFound()
  }

  const geometry = prediction.measurements
    ? measurementsToGeometry(
        prediction.measurements,
        buck.rack_type as RackType,
        buck.main_frame_points || 10
      )
    : null

  if (!geometry) {
    return notFound()
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container max-w-2xl mx-auto px-4 py-6 pb-24">
        <div className="mb-6">
          <Link
            href={`/results/${buckId}`}
            className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-4"
          >
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back to Results
          </Link>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Box className="h-6 w-6" />
            3D Antler Visualization
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {buck.state} | {buck.rack_type === 'typical' ? 'Typical' : 'Non-Typical'} |
            {buck.main_frame_points ? ` ${buck.main_frame_points}-point |` : ''}
            Gross: {prediction.predicted_gross?.toFixed(1)}&quot;
          </p>
        </div>

        <RenderClient
          buckId={buckId}
          geometry={geometry}
          initialSettings={DEFAULT_RENDER_SETTINGS}
          grossScore={prediction.predicted_gross || 0}
          netScore={prediction.predicted_net || 0}
        />
      </main>
    </div>
  )
}
