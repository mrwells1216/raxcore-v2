export function buildTrainingSample(params: {
  buckId: string
  predictionId: string
  reviewedSheet: any
  originalPrediction: any
  reviewCompleteness?: number
  isOfficial?: boolean
  reviewedBy?: string | null
}) {
  const {
    buckId,
    predictionId,
    reviewedSheet,
    originalPrediction,
    reviewCompleteness = 0,
    isOfficial = false,
    reviewedBy = null,
  } = params

  const imageUrls =
    originalPrediction?.image_urls ??
    originalPrediction?.buck_images?.map((img: any) => img.image_url || img.public_url).filter(Boolean) ??
    []

  return {
    buck_id: buckId,
    prediction_id: predictionId,

    input: {
      images: imageUrls,
      image_count: Array.isArray(imageUrls) ? imageUrls.length : 0,
      rack_type: originalPrediction?.rack_type ?? null,
      state: originalPrediction?.state ?? null,
      source_type: originalPrediction?.source_type ?? null,
    },

    ai_output: {
      gross_score: originalPrediction?.predicted_gross ?? null,
      net_score: originalPrediction?.predicted_net ?? null,
      measurements:
        originalPrediction?.raw_ai_response?.measurements ??
        originalPrediction?.measurements ??
        null,
      calibration_applied:
        originalPrediction?.raw_ai_response?.calibrationApplied ?? false,
      calibration_meta:
        originalPrediction?.raw_ai_response?.calibrationMeta ?? null,
    },

    ground_truth: {
      gross_score:
        reviewedSheet?.measurements?.grossScore ??
        reviewedSheet?.grossScore ??
        null,
      net_score:
        reviewedSheet?.measurements?.netScore ??
        reviewedSheet?.netScore ??
        null,
      measurements: reviewedSheet?.measurements ?? null,
    },

    review_completeness: reviewCompleteness,
    is_official: isOfficial,
    reviewed_by: reviewedBy,
    reviewed_at: new Date().toISOString(),

    created_at: new Date().toISOString(),
  }
}
