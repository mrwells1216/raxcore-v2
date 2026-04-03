import { NextResponse } from 'next/server'
import { 
  getCalibrationAuditTrail,
  getModelActivationHistory,
} from '@/lib/calibration/service'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const limitStr = searchParams.get('limit')
    const limit = limitStr ? parseInt(limitStr, 10) : 50
    const type = searchParams.get('type') || 'all'

    if (type === 'calibration') {
      const changes = await getCalibrationAuditTrail(limit)
      return NextResponse.json({ changes })
    }

    if (type === 'activation') {
      const events = await getModelActivationHistory(limit)
      return NextResponse.json({ events })
    }

    // Return both
    const [changes, events] = await Promise.all([
      getCalibrationAuditTrail(limit),
      getModelActivationHistory(limit),
    ])

    return NextResponse.json({ changes, events })
  } catch (error) {
    console.error('Get audit trail error:', error)
    return NextResponse.json(
      { error: 'Failed to get audit trail' }, 
      { status: 500 }
    )
  }
}
