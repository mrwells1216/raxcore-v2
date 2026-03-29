import { NextRequest, NextResponse } from 'next/server'
import {
  listScoringVariants,
  getProductionVariant,
  createScoringVariant,
} from '@/lib/sandbox'
import type { ScoringVariantInput } from '@/lib/types'

export async function GET() {
  try {
    const { data: variants } = await listScoringVariants({ limit: 100 })
    const production = await getProductionVariant()

    return NextResponse.json({
      variants,
      productionId: production?.id || null,
    })
  } catch (error) {
    console.error('Error fetching variants:', error)
    return NextResponse.json(
      { error: 'Failed to fetch variants' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    const input: ScoringVariantInput = {
      name: body.name,
      version_tag: body.version_tag,
      variant_type: body.variant_type || 'pipeline',
      model_version_id: body.model_version_id,
      calibration_profile_id: body.calibration_profile_id,
      pipeline_config: body.pipeline_config,
      metadata: body.metadata,
      notes: body.notes,
      is_candidate: body.is_candidate ?? true,
    }

    const variant = await createScoringVariant(input)

    return NextResponse.json({ variant })
  } catch (error) {
    console.error('Error creating variant:', error)
    return NextResponse.json(
      { error: 'Failed to create variant' },
      { status: 500 }
    )
  }
}
