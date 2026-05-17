export interface ArucoCorners {
  topLeft: { x: number; y: number }
  topRight: { x: number; y: number }
  bottomRight: { x: number; y: number }
  bottomLeft: { x: number; y: number }
}

export interface ArucoDetectionResult {
  detected: boolean
  markerId: number | null
  dictionary: string | null
  corners: ArucoCorners | null
  /** Average side length in pixels (null if undetected or rejected) */
  sidePixels: number | null
  /** pixelsPerInch — only when corners + markerSizeInches available */
  pixelsPerInch: number | null
  confidence: number
  method: 'gpt4o' | 'opencv' | 'none'
  warnings: string[]
  /** Reported marker size (inches) the user printed at */
  markerSizeInches: number | null
}

export interface ArucoCalibrationInput {
  markerSizeInches: number
  imageBuffer: Buffer
  imageWidth: number
  imageHeight: number
}
