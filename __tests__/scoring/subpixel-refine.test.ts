import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import {
  refineSubPixelLandmarks,
  type SubPixelRefineCandidate,
} from '@/lib/scoring/subpixel-refine'

// ─── Test image generators ───────────────────────────────────────────────────

/**
 * Sub-pixel positioned Gaussian intensity blob. This is the canonical feature
 * shape the algorithm is designed for: log(|G|) is approximately quadratic
 * with a clean concave-down peak at (cx, cy).
 *
 * Note: an L-corner or checkerboard saddle does NOT produce a Sobel gradient
 * peak at the corner — the gradient is high along edges, not at intersections.
 * Tests use Gaussian blobs because that matches the algorithm's contract.
 */
async function makeGaussianBlob(
  width: number,
  height: number,
  cx: number,
  cy: number,
  sigma = 1.0,
  amplitude = 200,
  background = 20,
): Promise<Buffer> {
  const raw = new Uint8Array(width * height).fill(background)
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const dx = px - cx
      const dy = py - cy
      const v = amplitude * Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma))
      raw[py * width + px] = Math.min(255, Math.round(background + v))
    }
  }
  return sharp(Buffer.from(raw), { raw: { width, height, channels: 1 } })
    .png()
    .toBuffer()
}

async function makeFlatImage(
  width: number,
  height: number,
  value: number,
): Promise<Buffer> {
  const raw = new Uint8Array(width * height).fill(value)
  return sharp(Buffer.from(raw), { raw: { width, height, channels: 1 } })
    .png()
    .toBuffer()
}

/** Box-Muller Gaussian noise generator with a seedable LCG. */
function makeRng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x100000000
  }
}

function gaussianNoise(rng: () => number, sigma: number): number {
  const u1 = Math.max(1e-9, rng())
  const u2 = rng()
  return sigma * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

async function makeNoisyGaussianBlob(
  width: number,
  height: number,
  cx: number,
  cy: number,
  blobSigma: number,
  noiseSigma: number,
  seed: number,
  amplitude = 200,
  background = 20,
): Promise<Buffer> {
  const rng = makeRng(seed)
  const raw = new Uint8Array(width * height)
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const dx = px - cx
      const dy = py - cy
      const base = background + amplitude * Math.exp(-(dx * dx + dy * dy) / (2 * blobSigma * blobSigma))
      raw[py * width + px] = Math.max(
        0,
        Math.min(255, Math.round(base + gaussianNoise(rng, noiseSigma))),
      )
    }
  }
  return sharp(Buffer.from(raw), { raw: { width, height, channels: 1 } })
    .png()
    .toBuffer()
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('refineSubPixelLandmarks', () => {
  it('1. recovers a sub-pixel Gaussian peak within ±0.15 px', async () => {
    const buffer = await makeGaussianBlob(64, 64, 32.7, 41.3, 1.0)
    const result = await refineSubPixelLandmarks({
      imageBuffer: buffer,
      imageWidth: 64,
      imageHeight: 64,
      candidates: [{ id: 'corner', x: 33, y: 41 }],
    })

    expect(result).toHaveLength(1)
    const r = result[0]
    expect(r.method === 'gaussian_2d' || r.method === 'parabolic_fallback').toBe(true)
    expect(Math.abs(r.x - 32.7)).toBeLessThanOrEqual(0.15)
    expect(Math.abs(r.y - 41.3)).toBeLessThanOrEqual(0.15)
    expect(Number.isFinite(r.refinementConfidence)).toBe(true)
    expect(r.refinementConfidence).toBeGreaterThan(0)
  })

  it('2. returns unchanged on a flat neighborhood', async () => {
    const buffer = await makeFlatImage(64, 64, 128)
    const result = await refineSubPixelLandmarks({
      imageBuffer: buffer,
      imageWidth: 64,
      imageHeight: 64,
      candidates: [{ id: 'flat', x: 32, y: 32 }],
    })

    expect(result).toHaveLength(1)
    expect(result[0].method).toBe('unchanged')
    expect(result[0].reason).toBe('flat_neighborhood')
    expect(result[0].x).toBe(32)
    expect(result[0].y).toBe(32)
  })

  it('3. handles noise σ=2 within ±0.4 px of ground truth', async () => {
    const buffer = await makeNoisyGaussianBlob(64, 64, 32.7, 41.3, 1.0, 2, 12345)
    const result = await refineSubPixelLandmarks({
      imageBuffer: buffer,
      imageWidth: 64,
      imageHeight: 64,
      candidates: [{ id: 'noisy', x: 33, y: 41 }],
    })

    expect(result).toHaveLength(1)
    const r = result[0]
    expect(r.method === 'gaussian_2d' || r.method === 'parabolic_fallback').toBe(true)
    expect(Math.abs(r.x - 32.7)).toBeLessThanOrEqual(0.4)
    expect(Math.abs(r.y - 41.3)).toBeLessThanOrEqual(0.4)
  })

  it('4. returns edge_of_image when window touches the boundary', async () => {
    const buffer = await makeGaussianBlob(64, 64, 32.7, 41.3)
    const result = await refineSubPixelLandmarks({
      imageBuffer: buffer,
      imageWidth: 64,
      imageHeight: 64,
      candidates: [{ id: 'edge', x: 2, y: 2 }],
    })

    expect(result).toHaveLength(1)
    expect(result[0].method).toBe('unchanged')
    expect(result[0].reason).toBe('edge_of_image')
  })

  it('5. never emits NaN or Infinity on pathological input', async () => {
    const buffer = await makeFlatImage(64, 64, 0)
    const result = await refineSubPixelLandmarks({
      imageBuffer: buffer,
      imageWidth: 64,
      imageHeight: 64,
      candidates: [
        { id: 'nan_x', x: Number.NaN, y: 32 },
        { id: 'inf_y', x: 32, y: Number.POSITIVE_INFINITY },
        { id: 'normal', x: 32, y: 32 },
      ],
    })

    expect(result).toHaveLength(3)
    for (const r of result) {
      expect(Number.isFinite(r.x)).toBe(true)
      expect(Number.isFinite(r.y)).toBe(true)
      expect(Number.isFinite(r.deltaPx)).toBe(true)
      expect(Number.isFinite(r.refinementConfidence)).toBe(true)
    }
    expect(result[0].method).toBe('unchanged')
    expect(result[1].method).toBe('unchanged')
  })

  it('6. does not mutate the input candidates array', async () => {
    const buffer = await makeGaussianBlob(64, 64, 32.7, 41.3)
    const candidates: SubPixelRefineCandidate[] = [
      { id: 'a', x: 33, y: 41 },
      { id: 'b', x: 20, y: 20 },
    ]
    const snapshot = JSON.parse(JSON.stringify(candidates))
    await refineSubPixelLandmarks({
      imageBuffer: buffer,
      imageWidth: 64,
      imageHeight: 64,
      candidates,
    })
    expect(candidates).toEqual(snapshot)
  })
})
