export function buildTrainingSample(params: {
  buckId: string
  predictionId: string
  reviewedSheet: any
  originalPrediction: any
}) {
  const { buckId, predictionId, reviewedSheet, originalPrediction } = params

  return {
    buck_id: buckId,
    prediction_id: predictionId,

    // INPUT (what AI saw)
    input: {
      images: originalPrediction?.image_urls ?? [],
      rack_type: originalPrediction?.rack_type,
      state: originalPrediction?.state,
    },

    // AI OUTPUT
    ai_output: {
      gross_score: originalPrediction?.predicted_gross,
      net_score: originalPrediction?.predicted_net,
      measurements: originalPrediction?.measurements,
    },

    // HUMAN TRUTH
    ground_truth: {
      gross_score: reviewedSheet?.grossScore,
      net_score: reviewedSheet?.netScore,
      measurements: reviewedSheet?.measurements,
    },

    created_at: new Date().toISOString(),
  }
}
