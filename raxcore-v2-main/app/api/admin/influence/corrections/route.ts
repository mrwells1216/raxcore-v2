/**
 * Phase 28: Learning Corrections API
 * 
 * Endpoints for viewing and analyzing learning corrections
 */

import { NextRequest, NextResponse } from 'next/server'
import { 
  getRecentCorrections, 
  getCorrectionContributions 
} from '@/lib/influence'

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const action = searchParams.get('action') || 'list'
    const limit = parseInt(searchParams.get('limit') || '50', 10)
    
    if (action === 'list') {
      const corrections = await getRecentCorrections(limit)
      return NextResponse.json({ corrections })
    }
    
    if (action === 'contributions') {
      const correctionId = searchParams.get('correction_id')
      if (!correctionId) {
        return NextResponse.json({ error: 'correction_id required' }, { status: 400 })
      }
      const contributions = await getCorrectionContributions(correctionId)
      return NextResponse.json({ contributions })
    }
    
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('Error in corrections API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
