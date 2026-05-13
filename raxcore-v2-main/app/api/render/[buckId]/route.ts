import { NextRequest, NextResponse } from 'next/server'
import {
  createRenderJob,
  getLatestRenderJob,
  getRenderBundle,
  measurementsToGeometry,
  DEFAULT_RENDER_SETTINGS,
} from '@/lib/render/service'
import { createClient } from '@/lib/supabase/server'
import type { RenderSettings, RackType, Buck, Prediction } from '@/lib/types'

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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ buckId: string }> }
) {
  try {
    const { buckId } = await params

    const { buck, prediction } = await getBuckAndPrediction(buckId)
    if (!buck) {
      return NextResponse.json({ error: 'Buck not found' }, { status: 404 })
    }

    // Get render bundle
    const bundle = await getRenderBundle(
      buckId,
      prediction?.measurements ?? undefined,
      buck.rack_type as RackType,
      buck.main_frame_points ?? undefined
    )

    if (!bundle) {
      const geometry = prediction?.measurements
        ? measurementsToGeometry(
            prediction.measurements,
            buck.rack_type as RackType,
            buck.main_frame_points ?? undefined
          )
        : null

      return NextResponse.json({
        hasRenderJob: false,
        geometry,
        defaultSettings: DEFAULT_RENDER_SETTINGS,
      })
    }

    return NextResponse.json({ hasRenderJob: true, ...bundle })
  } catch (error) {
    console.error('Error fetching render data:', error)
    return NextResponse.json({ error: 'Failed to fetch render data' }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ buckId: string }> }
) {
  try {
    const { buckId } = await params
    const body = await request.json()
    const settings: Partial<RenderSettings> = body.settings || {}

    const { buck, prediction } = await getBuckAndPrediction(buckId)
    if (!buck) {
      return NextResponse.json({ error: 'Buck not found' }, { status: 404 })
    }

    const job = await createRenderJob(buckId, settings)

    const geometry = prediction?.measurements
      ? measurementsToGeometry(
          prediction.measurements,
          buck.rack_type as RackType,
          buck.main_frame_points ?? undefined
        )
      : null

    return NextResponse.json({ job, geometry, message: 'Render job created' }, { status: 201 })
  } catch (error) {
    console.error('Error creating render job:', error)
    return NextResponse.json({ error: 'Failed to create render job' }, { status: 500 })
  }
}
