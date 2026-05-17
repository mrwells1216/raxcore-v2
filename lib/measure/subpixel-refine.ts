/**
 * Sub-pixel edge refinement for measurement endpoint placement.
 * Pure math: Sobel gradient + 1D Gaussian peak fit along the dominant
 * gradient direction. No React, no browser APIs, no side effects.
 */

export interface PixelData {
  /** Raw RGBA pixel buffer from canvas.getImageData() */
  data: Uint8ClampedArray
  width: number
  height: number
}

export interface RefinedPoint {
  /** Refined x coordinate within the supplied pixel grid (may be fractional) */
  x: number
  /** Refined y coordinate within the supplied pixel grid (may be fractional) */
  y: number
  /** Euclidean distance from the input coordinate */
  refinementDistance: number
  /** True when sub-pixel refinement actually moved the point */
  refined: boolean
  /** Edge strength at the chosen edge pixel, normalised 0..1 */
  edgeStrength: number
}

function toLuma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function getLuma(pixels: PixelData, x: number, y: number): number {
  const cx = Math.max(0, Math.min(pixels.width - 1, Math.round(x)))
  const cy = Math.max(0, Math.min(pixels.height - 1, Math.round(y)))
  const idx = (cy * pixels.width + cx) * 4
  return toLuma(pixels.data[idx], pixels.data[idx + 1], pixels.data[idx + 2])
}

function sobelGradient(
  pixels: PixelData,
  x: number,
  y: number,
): { gx: number; gy: number; magnitude: number } {
  const gx =
    -getLuma(pixels, x - 1, y - 1) + getLuma(pixels, x + 1, y - 1) +
    -2 * getLuma(pixels, x - 1, y) + 2 * getLuma(pixels, x + 1, y) +
    -getLuma(pixels, x - 1, y + 1) + getLuma(pixels, x + 1, y + 1)
  const gy =
    -getLuma(pixels, x - 1, y - 1) - 2 * getLuma(pixels, x, y - 1) - getLuma(pixels, x + 1, y - 1) +
    getLuma(pixels, x - 1, y + 1) + 2 * getLuma(pixels, x, y + 1) + getLuma(pixels, x + 1, y + 1)
  return { gx, gy, magnitude: Math.sqrt(gx * gx + gy * gy) }
}

/**
 * Fit a 1D Gaussian through three samples (f[-1], f[0], f[+1]) and
 * return the fractional offset of the peak from the centre sample
 * (-0.5..+0.5). Returns 0 if the fit is invalid.
 */
function fitGaussianPeak(fm1: number, f0: number, f1: number): number {
  if (fm1 <= 0 || f0 <= 0 || f1 <= 0) return 0
  const logFm1 = Math.log(fm1)
  const logF0 = Math.log(f0)
  const logF1 = Math.log(f1)
  const denom = logFm1 - 2 * logF0 + logF1
  if (Math.abs(denom) < 1e-6) return 0
  const offset = 0.5 * (logFm1 - logF1) / denom
  if (!Number.isFinite(offset)) return 0
  if (offset < -0.5) return -0.5
  if (offset > 0.5) return 0.5
  return offset
}

/**
 * Refine a clicked point to the nearest sub-pixel edge.
 *
 * The input coordinates are relative to the supplied pixel grid
 * (typically a small ROI extracted around the click via getImageData).
 * The output coordinates are in the same coordinate space.
 */
export function refineToSubPixelEdge(
  pixels: PixelData,
  rawX: number,
  rawY: number,
): RefinedPoint {
  const NEIGHBORHOOD = 4
  const MAX_REFINE_PX = 8
  const MIN_EDGE_STR = 15

  const baseX = Math.round(rawX)
  const baseY = Math.round(rawY)

  let maxMag = 0
  let bestX = baseX
  let bestY = baseY

  for (let dy = -NEIGHBORHOOD; dy <= NEIGHBORHOOD; dy++) {
    for (let dx = -NEIGHBORHOOD; dx <= NEIGHBORHOOD; dx++) {
      const px = baseX + dx
      const py = baseY + dy
      const { magnitude } = sobelGradient(pixels, px, py)
      if (magnitude > maxMag) {
        maxMag = magnitude
        bestX = px
        bestY = py
      }
    }
  }

  if (maxMag < MIN_EDGE_STR) {
    return { x: rawX, y: rawY, refinementDistance: 0, refined: false, edgeStrength: 0 }
  }

  const { gx, gy } = sobelGradient(pixels, bestX, bestY)
  const angleRad = Math.atan2(gy, gx)
  const nx = Math.cos(angleRad)
  const ny = Math.sin(angleRad)

  const gm1 = sobelGradient(pixels, bestX - nx, bestY - ny).magnitude
  const g0 = sobelGradient(pixels, bestX, bestY).magnitude
  const gp1 = sobelGradient(pixels, bestX + nx, bestY + ny).magnitude

  const offset = fitGaussianPeak(gm1, g0, gp1)
  const refinedX = bestX + offset * nx
  const refinedY = bestY + offset * ny

  const dist = Math.sqrt(
    (refinedX - rawX) * (refinedX - rawX) + (refinedY - rawY) * (refinedY - rawY),
  )
  if (dist > MAX_REFINE_PX) {
    return {
      x: rawX,
      y: rawY,
      refinementDistance: 0,
      refined: false,
      edgeStrength: maxMag / 255,
    }
  }

  return {
    x: refinedX,
    y: refinedY,
    refinementDistance: dist,
    refined: true,
    edgeStrength: maxMag / 255,
  }
}
