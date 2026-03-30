import { NextRequest, NextResponse } from 'next/server'
import { exportTrainingPack } from '@/lib/training-packs/service'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json()
    const { format = 'json', scope = 'full', filter_json } = body

    const exportId = await exportTrainingPack(params.id, {
      format,
      scope,
      filter_json,
    })
    
    return NextResponse.json({
      success: true,
      exportId,
      message: 'Export initiated',
    })
  } catch (error) {
    console.error('Error exporting pack:', error)
    return NextResponse.json(
      { error: 'Failed to export' },
      { status: 500 }
    )
  }
}
