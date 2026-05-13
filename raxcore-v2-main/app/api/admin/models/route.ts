import { NextResponse } from 'next/server'
import { listModelVersions } from '@/lib/storage/service'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  try {
    const models = await listModelVersions()
    return NextResponse.json({ models })
  } catch (error) {
    console.error('List models error:', error)
    return NextResponse.json({ error: 'Failed to list models' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const { id } = await request.json()
    if (!id) {
      return NextResponse.json({ error: 'Model id is required' }, { status: 400 })
    }

    const supabase = await createClient()
    
    // Deactivate all models
    await supabase
      .from('model_versions')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .neq('id', id)

    // Activate the selected model
    const { error } = await supabase
      .from('model_versions')
      .update({ is_active: true, updated_at: new Date().toISOString() })
      .eq('id', id)

    if (error) {
      throw error
    }

    const models = await listModelVersions()
    return NextResponse.json({ success: true, models })
  } catch (error) {
    console.error('Activate model error:', error)
    return NextResponse.json({ error: 'Failed to activate model' }, { status: 500 })
  }
}
