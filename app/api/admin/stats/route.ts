import { NextResponse } from 'next/server'
import { getAdminStats, listBucks, getActiveModelVersion } from '@/lib/storage/service'

export async function GET() {
  try {
    const stats = await getAdminStats()
    const { data: recentBucks } = await listBucks({ limit: 10 })
    const activeModel = await getActiveModelVersion()

    return NextResponse.json({
      totalSubmissions: stats.totalSubmissions,
      completedSubmissions: stats.completedSubmissions,
      pendingSubmissions: stats.totalSubmissions - stats.completedSubmissions,
      totalPredictions: stats.completedSubmissions,
      avgConfidence: 0, // Would need to aggregate from predictions
      groundTruthCount: stats.totalTrainingExamples,
      verifiedGroundTruth: stats.verifiedTraining,
      trainingExamples: stats.totalTrainingExamples,
      verifiedTraining: stats.verifiedTraining,
      avgGrossError: stats.avgGrossError,
      avgNetError: stats.avgNetError,
      activeModel: activeModel?.version_name || 'xrack-v1',
      recentSubmissions: recentBucks.map(buck => ({
        id: buck.id,
        session_id: buck.session_id,
        status: buck.status,
        created_at: buck.created_at,
        nickname: buck.nickname,
        location: buck.location
      }))
    })
  } catch (error) {
    console.error('Admin stats error:', error)
    return NextResponse.json({ error: 'Failed to fetch admin stats' }, { status: 500 })
  }
}
