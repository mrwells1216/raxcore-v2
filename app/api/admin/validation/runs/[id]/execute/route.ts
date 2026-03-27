import { NextRequest, NextResponse } from 'next/server'
import {
  getValidationRun,
  updateValidationRunStatus,
  updateValidationRunProgress,
  updateValidationRunMetrics,
  createValidationResult,
  getTrainingExamplesForValidation
} from '@/lib/validation/service'
import { getBuckById, getBuckImages } from '@/lib/storage/service'
import { scoreImages } from '@/lib/scoring'
import type { ValidationRunConfig } from '@/lib/types'

// POST /api/admin/validation/runs/[id]/execute - Execute validation run
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Get the validation run
    const run = await getValidationRun(id)
    if (!run) {
      return NextResponse.json(
        { success: false, error: 'Validation run not found' },
        { status: 404 }
      )
    }

    if (run.status !== 'pending') {
      return NextResponse.json(
        { success: false, error: `Cannot execute run with status: ${run.status}` },
        { status: 400 }
      )
    }

    // Get training examples to validate
    const config = run.config as ValidationRunConfig | null
    const examples = await getTrainingExamplesForValidation(config || undefined)

    if (examples.length === 0) {
      await updateValidationRunStatus(id, 'failed', 'No training examples found')
      return NextResponse.json(
        { success: false, error: 'No training examples found' },
        { status: 400 }
      )
    }

    // Start the run
    await updateValidationRunStatus(id, 'running')
    await updateValidationRunProgress(id, examples.length, 0)

    // Process examples
    const results: {
      absErrorGross: number
      absErrorNet: number | null
      percentErrorGross: number
    }[] = []

    let processedCount = 0
    const errors: string[] = []

    for (const example of examples) {
      try {
        // Check if run was cancelled
        const currentRun = await getValidationRun(id)
        if (currentRun?.status === 'cancelled') {
          break
        }

        // Get buck and images
        const buck = example.buck_id ? await getBuckById(example.buck_id) : null
        const images = example.buck_id ? await getBuckImages(example.buck_id) : []
        
        if (!images.length) {
          processedCount++
          await updateValidationRunProgress(id, examples.length, processedCount)
          continue
        }

        // Re-score the images
        const imageUrls = images.map(img => img.image_url)
        const startTime = Date.now()
        const scoringResult = await scoreImages(imageUrls, {
          state: buck?.location?.split(',').pop()?.trim() || 'TX',
          rackType: 'typical',
          harvestMethod: 'bow',
          sourceType: 'harvest_photo',
          mainFramePoints: 10
        })
        const processingTime = Date.now() - startTime

        // Create validation result
        const predictedGross = scoringResult.estimatedScore || 0
        const groundTruthGross = example.ground_truth_score

        await createValidationResult({
          runId: id,
          trainingExampleId: example.id,
          buckId: example.buck_id || '',
          groundTruthGross,
          groundTruthNet: null,
          predictedGross,
          predictedNet: null,
          confidencePercent: scoringResult.confidence === 'high' ? 80 : 
                            scoringResult.confidence === 'medium' ? 60 : 40,
          state: buck?.location?.split(',').pop()?.trim() || null,
          rackType: 'typical',
          scoringMethod: 'vision',
          processingTimeMs: processingTime
        })

        // Track for aggregate metrics
        const errorGross = predictedGross - groundTruthGross
        const absErrorGross = Math.abs(errorGross)
        const percentErrorGross = groundTruthGross > 0 
          ? (errorGross / groundTruthGross) * 100 
          : 0

        results.push({
          absErrorGross,
          absErrorNet: null,
          percentErrorGross
        })

        processedCount++
        await updateValidationRunProgress(id, examples.length, processedCount)
      } catch (err) {
        errors.push(`Example ${example.id}: ${err instanceof Error ? err.message : 'Unknown error'}`)
        processedCount++
        await updateValidationRunProgress(id, examples.length, processedCount)
      }
    }

    // Calculate aggregate metrics
    if (results.length > 0) {
      const absGrossErrors = results.map(r => r.absErrorGross)
      const percentErrors = results.map(r => Math.abs(r.percentErrorGross))

      // MAE
      const maeGross = absGrossErrors.reduce((a, b) => a + b, 0) / results.length

      // Median
      const sortedGross = [...absGrossErrors].sort((a, b) => a - b)
      const medianGross = sortedGross[Math.floor(sortedGross.length / 2)]

      // RMSE
      const squaredErrors = absGrossErrors.map(e => e * e)
      const rmseGross = Math.sqrt(squaredErrors.reduce((a, b) => a + b, 0) / results.length)

      // Within thresholds
      const within5Pct = (percentErrors.filter(e => e <= 5).length / results.length) * 100
      const within10Pct = (percentErrors.filter(e => e <= 10).length / results.length) * 100
      const within15Pct = (percentErrors.filter(e => e <= 15).length / results.length) * 100

      await updateValidationRunMetrics(id, {
        mean_absolute_error_gross: maeGross,
        median_absolute_error_gross: medianGross,
        rmse_gross: rmseGross,
        within_5_percent: within5Pct,
        within_10_percent: within10Pct,
        within_15_percent: within15Pct
      })
    }

    // Mark as completed
    const finalRun = await getValidationRun(id)
    if (finalRun?.status !== 'cancelled') {
      await updateValidationRunStatus(id, 'completed')
    }

    return NextResponse.json({
      success: true,
      message: 'Validation run completed',
      processed: processedCount,
      total: examples.length,
      errors: errors.length > 0 ? errors : undefined
    })
  } catch (error) {
    console.error('Error executing validation run:', error)
    
    // Mark run as failed
    try {
      const { id } = await params
      await updateValidationRunStatus(
        id, 
        'failed', 
        error instanceof Error ? error.message : 'Unknown error'
      )
    } catch {
      // Ignore cleanup errors
    }

    return NextResponse.json(
      { success: false, error: 'Failed to execute validation run' },
      { status: 500 }
    )
  }
}
