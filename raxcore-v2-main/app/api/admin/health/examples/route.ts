import { NextRequest, NextResponse } from 'next/server'
import { getTrainingExamplesWithHealth } from '@/lib/health'
import type { HealthTier, ScoreSourceStrength } from '@/lib/types'

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    
    // Parse query params
    const limit = parseInt(searchParams.get('limit') || '20')
    const offset = parseInt(searchParams.get('offset') || '0')
    const healthTier = searchParams.get('health_tier') as HealthTier | null
    const minHealthScore = searchParams.get('min_health_score')
    const maxHealthScore = searchParams.get('max_health_score')
    const usableForTraining = searchParams.get('usable_for_training')
    const usableForValidation = searchParams.get('usable_for_validation')
    const needsReview = searchParams.get('needs_review')
    const isDuplicate = searchParams.get('is_duplicate')
    const isOutlier = searchParams.get('is_outlier')
    const verifiedOnly = searchParams.get('verified_only')
    const excludeDuplicates = searchParams.get('exclude_duplicates')
    const excludeOutliers = searchParams.get('exclude_outliers')
    const scoreSourceStrength = searchParams.get('score_source_strength') as ScoreSourceStrength | null
    const orderBy = searchParams.get('order_by') || 'created_at'

    const { data, count } = await getTrainingExamplesWithHealth({
      limit,
      offset,
      orderBy,
      health_tier: healthTier || undefined,
      min_health_score: minHealthScore ? parseFloat(minHealthScore) : undefined,
      max_health_score: maxHealthScore ? parseFloat(maxHealthScore) : undefined,
      usable_for_training: usableForTraining !== null ? usableForTraining === 'true' : undefined,
      usable_for_validation: usableForValidation !== null ? usableForValidation === 'true' : undefined,
      needs_review: needsReview !== null ? needsReview === 'true' : undefined,
      is_duplicate: isDuplicate !== null ? isDuplicate === 'true' : undefined,
      is_outlier: isOutlier !== null ? isOutlier === 'true' : undefined,
      verified_only: verifiedOnly === 'true',
      exclude_duplicates: excludeDuplicates === 'true',
      exclude_outliers: excludeOutliers === 'true',
      score_source_strength: scoreSourceStrength || undefined,
    })

    return NextResponse.json({
      data,
      count,
      limit,
      offset,
    })
  } catch (error) {
    console.error('Failed to get training examples with health:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get examples' },
      { status: 500 }
    )
  }
}
