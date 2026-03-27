/**
 * Phase 24: Image Input Validation
 * Validates images before vision scoring to catch issues early
 */

export type ImageValidationIssueType =
  | 'missing_url'
  | 'invalid_url_format'
  | 'url_inaccessible'
  | 'unsupported_file_type'
  | 'zero_byte_file'
  | 'file_too_large'
  | 'duplicate_image'
  | 'data_url_malformed'
  | 'signed_url_expired'
  | 'private_url'
  | 'timeout_checking'

export type ImageValidationSeverity = 'error' | 'warning' | 'info'

export interface ImageValidationIssue {
  imageIndex: number
  imageUrl: string
  issueType: ImageValidationIssueType
  severity: ImageValidationSeverity
  message: string
  recoverable: boolean
}

export interface ImageValidationResult {
  valid: boolean
  validImageCount: number
  totalImageCount: number
  issues: ImageValidationIssue[]
  validImageIndices: number[]
  warningsOnly: boolean
  summary: string
  // Normalized URLs for scoring (with any transformations applied)
  normalizedUrls: { index: number; url: string; original: string }[]
}

// Supported image MIME types
const SUPPORTED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
])

// Supported file extensions
const SUPPORTED_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif'
])

// Maximum file size in bytes (20MB)
const MAX_FILE_SIZE = 20 * 1024 * 1024

// Timeout for URL accessibility checks (5 seconds)
const URL_CHECK_TIMEOUT_MS = 5000

/**
 * Check if a URL is a valid data URL
 */
function isValidDataUrl(url: string): { valid: boolean; mimeType?: string; error?: string } {
  if (!url.startsWith('data:')) {
    return { valid: false, error: 'Not a data URL' }
  }

  const match = url.match(/^data:([^;,]+)(?:;base64)?,(.*)$/)
  if (!match) {
    return { valid: false, error: 'Malformed data URL format' }
  }

  const mimeType = match[1]
  const data = match[2]

  if (!SUPPORTED_MIME_TYPES.has(mimeType.toLowerCase())) {
    return { valid: false, error: `Unsupported MIME type: ${mimeType}` }
  }

  if (!data || data.length === 0) {
    return { valid: false, error: 'Empty data URL content' }
  }

  // Check base64 validity
  if (url.includes(';base64,')) {
    try {
      // Just check if it's valid base64 format
      const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/
      if (!base64Regex.test(data.replace(/\s/g, ''))) {
        return { valid: false, error: 'Invalid base64 encoding' }
      }
    } catch {
      return { valid: false, error: 'Failed to parse base64 data' }
    }
  }

  return { valid: true, mimeType }
}

/**
 * Check if a URL is a valid HTTP/HTTPS URL
 */
function isValidHttpUrl(url: string): { valid: boolean; parsedUrl?: URL; error?: string } {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { valid: false, error: `Unsupported protocol: ${parsed.protocol}` }
    }
    return { valid: true, parsedUrl: parsed }
  } catch {
    return { valid: false, error: 'Invalid URL format' }
  }
}

/**
 * Extract file extension from URL
 */
function getFileExtension(url: string): string | null {
  try {
    const parsed = new URL(url)
    const pathname = parsed.pathname
    const lastDot = pathname.lastIndexOf('.')
    if (lastDot === -1) return null
    const ext = pathname.substring(lastDot + 1).toLowerCase()
    // Remove any query params that might have slipped in
    return ext.split('?')[0]
  } catch {
    return null
  }
}

/**
 * Check if a signed URL appears to be expired
 */
function checkSignedUrlExpiration(url: string): { expired: boolean; expiresAt?: Date } {
  try {
    const parsed = new URL(url)
    const params = parsed.searchParams

    // Check common expiration parameter names
    const expirationParams = ['Expires', 'expires', 'X-Amz-Expires', 'se', 'exp']
    
    for (const param of expirationParams) {
      const value = params.get(param)
      if (value) {
        // Try to parse as Unix timestamp
        const timestamp = parseInt(value, 10)
        if (!isNaN(timestamp)) {
          // Check if it's in seconds or milliseconds
          const normalizedTimestamp = timestamp < 10000000000 ? timestamp * 1000 : timestamp
          const expiresAt = new Date(normalizedTimestamp)
          const now = new Date()
          
          if (expiresAt < now) {
            return { expired: true, expiresAt }
          }
        }
      }
    }

    return { expired: false }
  } catch {
    return { expired: false }
  }
}

/**
 * Check if URL is accessible via HEAD request
 * Returns null if the check times out or fails
 */
async function checkUrlAccessibility(url: string): Promise<{
  accessible: boolean | null
  statusCode?: number
  contentType?: string
  contentLength?: number
  error?: string
}> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), URL_CHECK_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      // Don't follow redirects to catch potential issues
      redirect: 'follow',
    })

    clearTimeout(timeoutId)

    const contentType = response.headers.get('content-type')
    const contentLengthStr = response.headers.get('content-length')
    const contentLength = contentLengthStr ? parseInt(contentLengthStr, 10) : undefined

    if (!response.ok) {
      if (response.status === 403) {
        return { accessible: false, statusCode: response.status, error: 'Access denied (403 Forbidden)' }
      }
      if (response.status === 404) {
        return { accessible: false, statusCode: response.status, error: 'Image not found (404)' }
      }
      if (response.status === 401) {
        return { accessible: false, statusCode: response.status, error: 'Authentication required (401)' }
      }
      return { accessible: false, statusCode: response.status, error: `HTTP ${response.status}` }
    }

    return {
      accessible: true,
      statusCode: response.status,
      contentType: contentType || undefined,
      contentLength,
    }
  } catch (error) {
    clearTimeout(timeoutId)

    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        return { accessible: null, error: 'URL check timed out' }
      }
      return { accessible: null, error: error.message }
    }
    return { accessible: null, error: 'Unknown error checking URL' }
  }
}

/**
 * Compute a simple hash for duplicate detection
 */
function computeUrlHash(url: string): string {
  // For data URLs, hash the content portion
  if (url.startsWith('data:')) {
    const dataStart = url.indexOf(',')
    if (dataStart > 0) {
      const data = url.substring(dataStart + 1)
      // Use first and last 100 chars plus length as a quick hash
      return `data:${data.length}:${data.substring(0, 100)}:${data.substring(Math.max(0, data.length - 100))}`
    }
  }
  // For regular URLs, normalize and hash
  try {
    const parsed = new URL(url)
    // Remove common tracking params
    parsed.searchParams.delete('_')
    parsed.searchParams.delete('t')
    return parsed.toString()
  } catch {
    return url
  }
}

export interface ImageInput {
  imageUrl: string
  angleType?: string
  width?: number
  height?: number
}

export interface ValidateImagesOptions {
  /** Skip URL accessibility checks (faster but less thorough) */
  skipAccessibilityChecks?: boolean
  /** Skip duplicate detection */
  skipDuplicateCheck?: boolean
  /** Minimum number of valid images required */
  minValidImages?: number
  /** Maximum number of images to validate */
  maxImages?: number
}

/**
 * Validate a set of images before vision scoring
 */
export async function validateImages(
  images: ImageInput[],
  options: ValidateImagesOptions = {}
): Promise<ImageValidationResult> {
  const {
    skipAccessibilityChecks = false,
    skipDuplicateCheck = false,
    minValidImages = 1,
    maxImages = 10,
  } = options

  const issues: ImageValidationIssue[] = []
  const validIndices: number[] = []
  const normalizedUrls: { index: number; url: string; original: string }[] = []
  const seenHashes = new Map<string, number>() // hash -> first index

  // Limit total images
  const imagesToValidate = images.slice(0, maxImages)
  if (images.length > maxImages) {
    issues.push({
      imageIndex: -1,
      imageUrl: '',
      issueType: 'file_too_large',
      severity: 'warning',
      message: `Only first ${maxImages} images will be processed (${images.length} provided)`,
      recoverable: true,
    })
  }

  // Validate each image
  for (let i = 0; i < imagesToValidate.length; i++) {
    const img = imagesToValidate[i]
    const url = img.imageUrl

    // Check for missing URL
    if (!url || url.trim() === '') {
      issues.push({
        imageIndex: i,
        imageUrl: url || '',
        issueType: 'missing_url',
        severity: 'error',
        message: 'Image URL is missing or empty',
        recoverable: false,
      })
      continue
    }

    // Check for duplicates
    if (!skipDuplicateCheck) {
      const hash = computeUrlHash(url)
      const existingIndex = seenHashes.get(hash)
      if (existingIndex !== undefined) {
        issues.push({
          imageIndex: i,
          imageUrl: url,
          issueType: 'duplicate_image',
          severity: 'warning',
          message: `Duplicate of image ${existingIndex + 1}`,
          recoverable: true,
        })
        // Still add to valid indices if first occurrence was valid
        if (validIndices.includes(existingIndex)) {
          // Don't add duplicate to valid indices
          continue
        }
      }
      seenHashes.set(hash, i)
    }

    // Handle data URLs
    if (url.startsWith('data:')) {
      const dataUrlResult = isValidDataUrl(url)
      if (!dataUrlResult.valid) {
        issues.push({
          imageIndex: i,
          imageUrl: url.substring(0, 50) + '...',
          issueType: 'data_url_malformed',
          severity: 'error',
          message: dataUrlResult.error || 'Invalid data URL',
          recoverable: false,
        })
        continue
      }

      // Data URL is valid
      validIndices.push(i)
      normalizedUrls.push({ index: i, url, original: url })
      continue
    }

    // Handle HTTP/HTTPS URLs
    const httpResult = isValidHttpUrl(url)
    if (!httpResult.valid) {
      issues.push({
        imageIndex: i,
        imageUrl: url,
        issueType: 'invalid_url_format',
        severity: 'error',
        message: httpResult.error || 'Invalid URL format',
        recoverable: false,
      })
      continue
    }

    // Check file extension
    const ext = getFileExtension(url)
    if (ext && !SUPPORTED_EXTENSIONS.has(ext)) {
      issues.push({
        imageIndex: i,
        imageUrl: url,
        issueType: 'unsupported_file_type',
        severity: 'error',
        message: `Unsupported file type: .${ext}`,
        recoverable: false,
      })
      continue
    }

    // Check for expired signed URL
    const expirationResult = checkSignedUrlExpiration(url)
    if (expirationResult.expired) {
      issues.push({
        imageIndex: i,
        imageUrl: url,
        issueType: 'signed_url_expired',
        severity: 'error',
        message: `Signed URL expired at ${expirationResult.expiresAt?.toISOString()}`,
        recoverable: false,
      })
      continue
    }

    // Check URL accessibility (if not skipped)
    if (!skipAccessibilityChecks) {
      const accessResult = await checkUrlAccessibility(url)
      
      if (accessResult.accessible === false) {
        const severity: ImageValidationSeverity = 
          accessResult.statusCode === 404 ? 'error' :
          accessResult.statusCode === 403 || accessResult.statusCode === 401 ? 'error' :
          'warning'
        
        issues.push({
          imageIndex: i,
          imageUrl: url,
          issueType: accessResult.statusCode === 403 || accessResult.statusCode === 401 
            ? 'private_url' 
            : 'url_inaccessible',
          severity,
          message: accessResult.error || 'URL is not accessible',
          recoverable: severity === 'warning',
        })
        
        if (severity === 'error') {
          continue
        }
      } else if (accessResult.accessible === null) {
        // Timeout or network error - treat as warning, proceed anyway
        issues.push({
          imageIndex: i,
          imageUrl: url,
          issueType: 'timeout_checking',
          severity: 'warning',
          message: accessResult.error || 'Could not verify URL accessibility',
          recoverable: true,
        })
      }

      // Check content type if available
      if (accessResult.contentType) {
        const mimeType = accessResult.contentType.split(';')[0].trim().toLowerCase()
        if (!SUPPORTED_MIME_TYPES.has(mimeType) && !mimeType.startsWith('image/')) {
          issues.push({
            imageIndex: i,
            imageUrl: url,
            issueType: 'unsupported_file_type',
            severity: 'warning',
            message: `Unexpected content type: ${accessResult.contentType}`,
            recoverable: true,
          })
        }
      }

      // Check file size if available
      if (accessResult.contentLength !== undefined) {
        if (accessResult.contentLength === 0) {
          issues.push({
            imageIndex: i,
            imageUrl: url,
            issueType: 'zero_byte_file',
            severity: 'error',
            message: 'Image file is empty (0 bytes)',
            recoverable: false,
          })
          continue
        }
        if (accessResult.contentLength > MAX_FILE_SIZE) {
          issues.push({
            imageIndex: i,
            imageUrl: url,
            issueType: 'file_too_large',
            severity: 'warning',
            message: `Image is very large (${(accessResult.contentLength / 1024 / 1024).toFixed(1)}MB)`,
            recoverable: true,
          })
        }
      }
    }

    // URL passed all checks
    validIndices.push(i)
    normalizedUrls.push({ index: i, url, original: url })
  }

  // Build result
  const errorIssues = issues.filter(i => i.severity === 'error')
  const warningIssues = issues.filter(i => i.severity === 'warning')
  const valid = validIndices.length >= minValidImages
  const warningsOnly = errorIssues.length === 0 && warningIssues.length > 0

  let summary: string
  if (valid && issues.length === 0) {
    summary = `All ${validIndices.length} image(s) validated successfully.`
  } else if (valid && warningsOnly) {
    summary = `${validIndices.length} image(s) valid with ${warningIssues.length} warning(s).`
  } else if (valid) {
    summary = `${validIndices.length} of ${images.length} image(s) valid. ${errorIssues.length} error(s), ${warningIssues.length} warning(s).`
  } else {
    summary = `Validation failed: only ${validIndices.length} valid image(s), need at least ${minValidImages}. ${errorIssues.length} error(s).`
  }

  return {
    valid,
    validImageCount: validIndices.length,
    totalImageCount: images.length,
    issues,
    validImageIndices: validIndices,
    warningsOnly,
    summary,
    normalizedUrls,
  }
}

/**
 * Quick synchronous validation (no network checks)
 * Use this for fast client-side validation
 */
export function validateImagesSync(images: ImageInput[]): ImageValidationResult {
  const issues: ImageValidationIssue[] = []
  const validIndices: number[] = []
  const normalizedUrls: { index: number; url: string; original: string }[] = []

  for (let i = 0; i < images.length; i++) {
    const img = images[i]
    const url = img.imageUrl

    if (!url || url.trim() === '') {
      issues.push({
        imageIndex: i,
        imageUrl: url || '',
        issueType: 'missing_url',
        severity: 'error',
        message: 'Image URL is missing or empty',
        recoverable: false,
      })
      continue
    }

    if (url.startsWith('data:')) {
      const result = isValidDataUrl(url)
      if (!result.valid) {
        issues.push({
          imageIndex: i,
          imageUrl: url.substring(0, 50) + '...',
          issueType: 'data_url_malformed',
          severity: 'error',
          message: result.error || 'Invalid data URL',
          recoverable: false,
        })
        continue
      }
    } else {
      const result = isValidHttpUrl(url)
      if (!result.valid) {
        issues.push({
          imageIndex: i,
          imageUrl: url,
          issueType: 'invalid_url_format',
          severity: 'error',
          message: result.error || 'Invalid URL format',
          recoverable: false,
        })
        continue
      }
    }

    validIndices.push(i)
    normalizedUrls.push({ index: i, url, original: url })
  }

  const valid = validIndices.length > 0
  const summary = valid 
    ? `${validIndices.length} image(s) passed basic validation.`
    : 'No valid images found.'

  return {
    valid,
    validImageCount: validIndices.length,
    totalImageCount: images.length,
    issues,
    validImageIndices: validIndices,
    warningsOnly: false,
    summary,
    normalizedUrls,
  }
}
