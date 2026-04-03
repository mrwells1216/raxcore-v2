/**
 * Phase 53: Training Packs API
 * 
 * POST /api/admin/training-packs - Create a new training pack
 * GET /api/admin/training-packs - List training packs
 */

import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { createTrainingPack, listTrainingPacks } from '@/lib/training-packs/service'
import type { CreateTrainingPackInput, ListTrainingPacksOptions } from '@/lib/types'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    
    const input: CreateTrainingPackInput = {
      name: body.name,
      description: body.description,
      pack_type: body.pack_type,
      filter_config_json: body.filter_config_json,
      split_config_json: body.split_config_json,
      variant_id: body.variant_id,
      created_by: user.id,
    }

    const pack = await createTrainingPack(input)
    
    return NextResponse.json(pack)
  } catch (error) {
    console.error('[API] Error creating training pack:', error)
    return NextResponse.json(
      { error: 'Failed to create training pack' },
      { status: 500 }
    )
  }
}

export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    
    const options: ListTrainingPacksOptions = {
      pack_type: searchParams.get('pack_type') as ListTrainingPacksOptions['pack_type'],
      status: searchParams.get('status') as ListTrainingPacksOptions['status'],
      variant_id: searchParams.get('variant_id') || undefined,
      limit: searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : 50,
      offset: searchParams.get('offset') ? parseInt(searchParams.get('offset')!) : 0,
    }

    const packs = await listTrainingPacks(options)
    
    return NextResponse.json(packs)
  } catch (error) {
    console.error('[API] Error listing training packs:', error)
    return NextResponse.json(
      { error: 'Failed to list training packs' },
      { status: 500 }
    )
  }
}
