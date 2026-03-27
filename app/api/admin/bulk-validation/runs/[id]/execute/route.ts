import { NextRequest, NextResponse } from 'next/server'
import {
  getBulkValidationRun,
  updateBulkRunStatus,
  updateBulkRunProgress,
  updateBulkRunSummary,
  createBulkValidationResult,
  getBulkValidationResults,
  getFilteredTrainingExamples,
  getTrainingExamplesByIds,
  calculateModelRunMetrics,
  calculateImprovementMetrics,
  getModelVersionInfo,
} from '@/lib/validation/bulk-service'
import { getCalibrationProfileById } from '@/lib/calibration/utils'
import { getBuckImages } from '@/lib/storage/service'
import { scoreBuck } from '@/lib/scoring/ai-service'
import type { BulkValidationFilters, ModelPredictionResult, BulkRunSummaryMetrics, RackType, SourceType } from '@/lib/types'

// POST /api/admin/bulk-validation/runs/[id]/execute - Execute a bulk validation run
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    const run = await getBulkValidationRun(id)

    if (!run) {
      return NextResponse.json(
        { success: false, error: 'Bulk validation run not found' },
        { status: 404 }
      )
    }

    if (run.status !== 'pending') {
      return NextResponse.json(
        { success: false, error: 'Only pending runs can be executed' },
        { status: 400 }
      )
    }

    // Mark as running
    await updateBulkRunStatus(id, 'running')

    // Use snapshotted example IDs if available (reproducibility), otherwise fall back to filter query
    let examples: Awaited<ReturnType<typeof getTrainingExamplesByIds>>
    
    if (run.example_ids && run.example_ids.length > 0) {
      // Use snapshotted IDs for reproducibility
      examples = await getTrainingExamplesByIds(run.example_ids)
    } else {
      // Legacy support: fall back to filter query for older runs without snapshotted IDs
      const filteredExamples = await getFilteredTrainingExamples(run.filters as BulkValidationFilters | undefined)
      examples = filteredExamples.map(e => ({
        ...e,
        ground_truth_net: null,
        capture_device: null,
        frame_size: null,
        ears_fully_visible: null,
        angle_tags: null,
      }))
    }

    if (examples.length === 0) {
      await updateBulkRunStatus(id, 'failed', 'No training examples found for this run')
      return NextResponse.json(
        { success: false, error: 'No training examples found for this run' },
        { status: 400 }
      )
    }

    await updateBulkRunProgress(id, examples.length, 0)
    
    // Load calibration profiles for model comparison
    const primaryCalibration = run.primary_calibration_profile_id 
      ? await getCalibrationProfileById(run.primary_calibration_profile_id)
      : null
    const comparisonCalibrations = await Promise.all(
      (run.comparison_calibration_profile_ids || []).map((cpId: string) => getCalibrationProfileById(cpId))
    )

    // Get model version info
    const primaryModelInfo = await getModelVersionInfo(run.primary_model_version_id)
    const comparisonModelInfos = await Promise.all(
      (run.comparison_model_version_ids || []).map((mvId: string) => getModelVersionInfo(mvId))
    )

    // Process each example
    let processed = 0
    const startTime = Date.now()

    for (const example of examples) {
      try {
        // Check if run was cancelled
        const currentRun = await getBulkValidationRun(id)
        if (currentRun?.status === 'cancelled') {
          break
        }

        // Get images for this buck if available
        let imageUrls = example.image_urls || []
        if (example.buck_id && imageUrls.length === 0) {
          const buckImages = await getBuckImages(example.buck_id)
          imageUrls = buckImages.map((img) => img.image_url)
        }

        if (imageUrls.length === 0) {
          // Skip examples without images
          processed++
          await updateBulkRunProgress(id, examples.length, processed)
          continue
        }

        // Score with each model version
        const modelResults: ModelPredictionResult[] = []

        // Primary model (or current active)
        try {
          const primaryStartTime = Date.now()
          
          // Use real metadata from the training example when available
          const primaryResult = await scoreBuck({
            images: imageUrls.map((url, i) => ({
              imageUrl: url,
              angleType: example.angle_tags?.[i] || (i === 0 ? 'front' : 'other'),
              width: 1024,
              height: 1024,
            })),
            state: example.state || undefined, // Let scoring use defaults if not available
            rackType: (example.rack_type || 'typical') as RackType,
            earsFullyVisible: example.ears_fully_visible ?? true,
            sourceType: example.source_type || undefined,
            captureDevice: example.capture_device || undefined,
            // Pass calibration profile for this model version
            calibrationProfile: primaryCalibration,
          })
          const primaryProcessingTime = Date.now() - primaryStartTime

          const primaryGross = primaryResult.predictedGross
          const primaryNet = primaryResult.predictedNet
          const errorGross = primaryGross - example.ground_truth_score
          const errorNet = primaryNet != null && example.ground_truth_score != null
            ? primaryNet - example.ground_truth_score
            : null

          modelResults.push({
            model_version_id: run.primary_model_version_id,
            model_version_name: primaryModelInfo.name,
            raw_vision_gross: primaryResult.rawVisionGross ?? primaryGross,
            raw_vision_net: primaryResult.rawVisionNet ?? primaryNet,
            normalized_gross: primaryResult.normalizedGross ?? primaryGross,
            normalized_net: primaryResult.normalizedNet ?? primaryNet,
            final_gross: primaryGross,
            final_net: primaryNet,
            error_gross: errorGross,
            error_net: errorNet,
            abs_error_gross: Math.abs(errorGross),
            abs_error_net: errorNet != null ? Math.abs(errorNet) : null,
            percent_error_gross: example.ground_truth_score > 0
              ? (errorGross / example.ground_truth_score) * 100
              : 0,
            percent_error_net: null,
            confidence_percent: primaryResult.confidencePercent,
            scoring_method: primaryResult.scoringMethod || 'vision',
            processing_time_ms: primaryProcessingTime,
          })
        } catch (err) {
          console.error(`Error scoring with primary model for example ${example.id}:`, err)
        }

        // Comparison models (for model comparison runs)
        if (run.run_type === 'model_comparison') {
          for (let i = 0; i < comparisonModelInfos.length; i++) {
            const compInfo = comparisonModelInfos[i]
            const compCalibration = comparisonCalibrations[i]
            try {
              const compStartTime = Date.now()
              // Score with the comparison model's calibration profile
              const compResult = await scoreBuck({
                images: imageUrls.map((url, idx) => ({
                  imageUrl: url,
                  angleType: example.angle_tags?.[idx] || (idx === 0 ? 'front' : 'other'),
                  width: 1024,
                  height: 1024,
                })),
                state: example.state || undefined,
                rackType: (example.rack_type || 'typical') as RackType,
                earsFullyVisible: example.ears_fully_visible ?? true,
                sourceType: example.source_type || undefined,
                captureDevice: example.capture_device || undefined,
                // Pass the comparison model's calibration profile
                calibrationProfile: compCalibration,
              })
              const compProcessingTime = Date.now() - compStartTime

              const compGross = compResult.predictedGross
              const compNet = compResult.predictedNet
              const errorGross = compGross - example.ground_truth_score
              const errorNet = compNet != null && example.ground_truth_score != null
                ? compNet - example.ground_truth_score
                : null

              modelResults.push({
                model_version_id: run.comparison_model_version_ids[i],
                model_version_name: compInfo.name,
                raw_vision_gross: compResult.rawVisionGross ?? compGross,
                raw_vision_net: compResult.rawVisionNet ?? compNet,
                normalized_gross: compResult.normalizedGross ?? compGross,
                normalized_net: compResult.normalizedNet ?? compNet,
                final_gross: compGross,
                final_net: compNet,
                error_gross: errorGross,
                error_net: errorNet,
                abs_error_gross: Math.abs(errorGross),
                abs_error_net: errorNet != null ? Math.abs(errorNet) : null,
                percent_error_gross: example.ground_truth_score > 0
                  ? (errorGross / example.ground_truth_score) * 100
                  : 0,
                percent_error_net: null,
                confidence_percent: compResult.confidencePercent,
                scoring_method: compResult.scoringMethod || 'vision',
                processing_time_ms: compProcessingTime,
              })
            } catch (err) {
              console.error(`Error scoring with comparison model ${compInfo.id} for example ${example.id}:`, err)
            }
          }
        }

        // Save result
        if (modelResults.length > 0) {
          await createBulkValidationResult({
            bulkRunId: id,
            trainingExampleId: example.id,
            buckId: example.buck_id,
            groundTruthGross: example.ground_truth_score,
            groundTruthNet: null,
            modelResults,
            state: example.state,
            rackType: example.rack_type as RackType | null,
            sourceType: example.source_type as SourceType | null,
            imageCount: imageUrls.length,
          })
        }

        processed++
        await updateBulkRunProgress(id, examples.length, processed)
      } catch (err) {
        console.error(`Error processing example ${example.id}:`, err)
        processed++
        await updateBulkRunProgress(id, examples.length, processed)
      }
    }

    // Calculate summary metrics
    const { data: allResults } = await getBulkValidationResults(id, { limit: 10000 })

    const primaryMetrics = calculateModelRunMetrics(
      allResults,
      run.primary_model_version_id,
      primaryModelInfo.name
    )

    const comparisonMetrics = comparisonModelInfos.map((info, i) =>
      calculateModelRunMetrics(
        allResults,
        run.comparison_model_version_ids[i],
        info.name
      )
    )

    const improvementMetrics = run.run_type === 'model_comparison'
      ? comparisonModelInfos.map((info, i) =>
          calculateImprovementMetrics(
            allResults,
            run.primary_model_version_id,
            run.comparison_model_version_ids[i],
            info.name
          )
        )
      : null

    const summaryMetrics: BulkRunSummaryMetrics = {
      primary_model: primaryMetrics,
      comparison_models: comparisonMetrics,
      improvement_vs_comparison: improvementMetrics,
    }

    await updateBulkRunSummary(id, summaryMetrics)

    // Check final status
    const finalRun = await getBulkValidationRun(id)
    if (finalRun?.status !== 'cancelled') {
      await updateBulkRunStatus(id, 'completed')
    }

    const totalTime = Date.now() - startTime

    return NextResponse.json({
      success: true,
      data: {
        processed,
        total: examples.length,
        totalTimeMs: totalTime,
        summaryMetrics,
      },
    })
  } catch (error) {
    console.error('Error executing bulk validation run:', error)
    await updateBulkRunStatus(id, 'failed', error instanceof Error ? error.message : 'Unknown error')
    return NextResponse.json(
      { success: false, error: 'Failed to execute bulk validation run' },
      { status: 500 }
    )
  }
}
