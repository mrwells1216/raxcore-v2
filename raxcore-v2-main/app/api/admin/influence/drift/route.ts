/**
 * Phase 28: Drift Detection API
 * 
 * Endpoints for drift analysis and management
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { analyzeDrift, getActiveInfluenceConfig } from '@/lib/influence'

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const action = searchParams.get('action') || 'analyze'
    
    if (action === 'analyze') {
      const config = await getActiveInfluenceConfig()
      const analysis = await analyzeDrift(config)
      return NextResponse.json({ analysis })
    }
    
    if (action === 'alerts') {
      const supabase = await createClient()
      const resolved = searchParams.get('resolved') === 'true'
      const limit = parseInt(searchParams.get('limit') || '20', 10)
      
      let query = supabase
        .from('drift_detection_log')
        .select('*')
        .order('detected_at', { ascending: false })
        .limit(limit)
      
      if (!resolved) {
        query = query.eq('is_resolved', false)
      }
      
      const { data, error } = await query
      
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      
      return NextResponse.json({ alerts: data })
    }
    
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('Error in drift API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action, alert_id, resolution_notes, resolved_by } = body
    
    if (action === 'resolve') {
      if (!alert_id) {
        return NextResponse.json({ error: 'alert_id required' }, { status: 400 })
      }
      
      const supabase = await createClient()
      
      const { error } = await supabase
        .from('drift_detection_log')
        .update({
          is_resolved: true,
          resolved_at: new Date().toISOString(),
          resolved_by,
          resolution_notes,
        })
        .eq('id', alert_id)
      
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      
      return NextResponse.json({ success: true })
    }
    
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('Error in drift POST:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
