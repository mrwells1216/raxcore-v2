/**
 * Client-side image preprocessing for scoring requests
 * Resizes and compresses images to reduce payload size
 */

export interface PreprocessedImage {
  dataUrl: string
  width: number
  height: number
  originalWidth: number
  originalHeight: number
  sizeBytes: number
}

export interface PreprocessOptions {
  /** Maximum width or height in pixels (default: 1200) */
  maxDimension?: number
  /** JPEG quality 0-1 (default: 0.7) */
  quality?: number
  /** Target format (default: 'image/jpeg') */
  format?: 'image/jpeg' | 'image/webp'
}

const DEFAULT_OPTIONS: Required<PreprocessOptions> = {
  maxDimension: 1200,
  quality: 0.7,
  format: 'image/jpeg',
}

/**
 * Preprocess an image file or data URL for scoring
 * - Resizes to max dimension while preserving aspect ratio
 * - Compresses to JPEG with specified quality
 * - Returns data URL and metadata
 */
export async function preprocessImage(
  source: File | string,
  options: PreprocessOptions = {}
): Promise<PreprocessedImage> {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  
  // Load image
  const img = await loadImage(source)
  const originalWidth = img.width
  const originalHeight = img.height
  
  // Calculate new dimensions
  let newWidth = originalWidth
  let newHeight = originalHeight
  
  if (originalWidth > opts.maxDimension || originalHeight > opts.maxDimension) {
    if (originalWidth > originalHeight) {
      newWidth = opts.maxDimension
      newHeight = Math.round((originalHeight / originalWidth) * opts.maxDimension)
    } else {
      newHeight = opts.maxDimension
      newWidth = Math.round((originalWidth / originalHeight) * opts.maxDimension)
    }
  }
  
  // Create canvas and draw resized image
  const canvas = document.createElement('canvas')
  canvas.width = newWidth
  canvas.height = newHeight
  
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('Failed to get canvas context')
  }
  
  // Use high-quality image smoothing
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  
  // Draw the image
  ctx.drawImage(img, 0, 0, newWidth, newHeight)
  
  // Convert to data URL
  const dataUrl = canvas.toDataURL(opts.format, opts.quality)
  
  // Calculate approximate size
  const sizeBytes = Math.round((dataUrl.length - 22) * 0.75) // Rough base64 to bytes
  
  return {
    dataUrl,
    width: newWidth,
    height: newHeight,
    originalWidth,
    originalHeight,
    sizeBytes,
  }
}

/**
 * Preprocess multiple images in parallel
 */
export async function preprocessImages(
  sources: (File | string)[],
  options: PreprocessOptions = {}
): Promise<PreprocessedImage[]> {
  return Promise.all(sources.map(source => preprocessImage(source, options)))
}

/**
 * Load an image from File or data URL
 */
function loadImage(source: File | string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Failed to load image'))
    
    if (typeof source === 'string') {
      // Data URL or URL
      img.src = source
    } else {
      // File object
      const reader = new FileReader()
      reader.onload = (e) => {
        img.src = e.target?.result as string
      }
      reader.onerror = () => reject(new Error('Failed to read file'))
      reader.readAsDataURL(source)
    }
  })
}

/**
 * Estimate total payload size for multiple images
 */
export function estimatePayloadSize(images: PreprocessedImage[]): number {
  return images.reduce((total, img) => total + img.sizeBytes, 0)
}

/**
 * Format bytes as human-readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
