/**
 * Phase 28: Influence Configuration API
 * 
 * Endpoints for managing influence weighting configuration
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getActiveInfluenceConfig, clearInfluenceConfigCache } from '@/lib/influence'

export async function GET() {
  try {
    const config = await getActiveInfluenceConfig()
    return NextResponse.json({ config })
  } catch (error) {
    console.error('Error getting config:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { weight_factors, safety_caps, drift_protection, eligibility_rules } = body
    
    const supabase = await createClient()
    
    // Update the active config
    const updateData: Record<string, unknown> = {}
    
    if (weight_factors) updateData.weight_factors = weight_factors
    if (safety_caps) updateData.safety_caps = safety_caps
    if (drift_protection) updateData.drift_protection = drift_protection
    if (eligibility_rules) updateData.eligibility_rules = eligibility_rules
    
    const { error } = await supabase
      .from('influence_config')
      .update(updateData)
      .eq('is_active', true)
    
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    
    // Clear cache so next request gets fresh config
    clearInfluenceConfigCache()
    
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error updating config:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
