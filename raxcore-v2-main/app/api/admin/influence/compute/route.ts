/**
 * Phase 28: Influence Weight Computation API
 * 
 * Endpoints for computing and updating influence weights
 */

import { NextResponse } from 'next/server'
import { computeAllInfluenceWeights } from '@/lib/influence'

export async function POST() {
  try {
    const result = await computeAllInfluenceWeights()
    
    return NextResponse.json({
      success: true,
      processed: result.processed,
      updated: result.updated,
      errors: result.errors,
    })
  } catch (error) {
    console.error('Error computing influence weights:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
