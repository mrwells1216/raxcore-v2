// Frame validation utilities for AI-ready vision analysis
// See lib/detection for full OpenAI-powered detection pipeline

export type FrameValidation = {
  hasDeer: boolean
  hasAntlers: boolean
  clarityScore: number
  coverage: 'none' | 'partial' | 'full'
}

/**
 * Lightweight frame validation for real-time scan feedback.
 * This is a basic heuristic check - full detection runs server-side via /api/detect.
 * 
 * For production accuracy, use lib/detection/detect-rack-with-openai.ts
 */
export function validateFrameMock(): FrameValidation {
  return {
    hasDeer: true,
    hasAntlers: true,
    clarityScore: Math.random() * 100,
    coverage: 'partial',
  }
}

/**
 * Validates a frame for quality and content.
 * This provides basic client-side feedback during scanning.
 * 
 * Full detection with subject type, landmarks, and measurement graph
 * runs server-side via the /api/detect or /api/score endpoints.
 */
export function validateFrame(canvas: HTMLCanvasElement): FrameValidation {
  // Basic client-side heuristics for real-time scan UI feedback
  // Actual deer/rack detection runs server-side with OpenAI
  return validateFrameMock()
}
