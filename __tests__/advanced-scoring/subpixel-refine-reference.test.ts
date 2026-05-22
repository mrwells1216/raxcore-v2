import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { refineReferenceEndpoints } from '@/lib/advanced-scoring/subpixel-refine'

// ─── Test image generators ──────────────────────────────────────────────────

/**
 * Half-plane horizontal edge: white above lineY, black below, with
 * partial-pixel anti-aliasing on the boundary. Produces a single Sobel
 * gradient peak at y=lineY (no twin-edge ambiguity). The horizontal
 * extent [startX, endX] is just the section of the edge that's "inked";
 * outside that range the image is uniformly white so SP1's gradient
 * computation sees no edge.
 */
async function makeHorizontalRuler(
  width: number,
  height: number,
  lineY: number,
  startX: number,
  endX: number,
  contrast = 1,
): Promise<Buffer> {
  const raw = new Uint8Array(width * height).fill(255)
  for (let py = 0; py < height; py++) {
    // Anti-aliased step: above lineY → 0 black, below → full black.
    const yInk = Math.max(0, Math.min(1, py + 0.5 - lineY))
    for (let px = 0; px < width; px++) {
      const xCoverage = Math.max(0, Math.min(1, px + 0.5 - startX)) -
                        Math.max(0, Math.min(1, px + 0.5 - endX))
      const ink = yInk * xCoverage * 255 * contrast
      raw[py * width + px] = Math.max(0, Math.min(255, Math.round(255 - ink)))
    }
  }
  return sharp(Buffer.from(raw), { raw: { width, height, channels: 1 } })
    .png()
    .toBuffer()
}

/** 2-pixel-thick black diagonal line at 45° from (x1, y1) to (x2, y2). */
async function makeDiagonalRuler(
  width: number,
  height: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): Promise<Buffer> {
  const raw = new Uint8Array(width * height).fill(255)
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.hypot(dx, dy)
  const ux = dx / len
  const uy = dy / len
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      // Perpendicular distance from pixel center to the line segment.
      const vx = px + 0.5 - x1
      const vy = py + 0.5 - y1
      const t = vx * ux + vy * uy
      if (t < 0 || t > len) continue
      const perp = Math.abs(-vx * uy + vy * ux)
      const ink = Math.max(0, 1 - perp / 1.2) * 255
      raw[py * width + px] = Math.max(0, Math.min(255, Math.round(255 - ink)))
    }
  }
  return sharp(Buffer.from(raw), { raw: { width, height, channels: 1 } })
    .png()
    .toBuffer()
}

async function makeFlatImage(width: number, height: number, value: number): Promise<Buffer> {
  const raw = new Uint8Array(width * height).fill(value)
  return sharp(Buffer.from(raw), { raw: { width, height, channels: 1 } })
    .png()
    .toBuffer()
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('refineReferenceEndpoints', () => {
  it('1. horizontal ruler: parallel offset is corrected by centerline projection', async () => {
    // True line at y=100. User clicked both endpoints 3 px above (consistent
    // perpendicular offset). The line-aware step should detect the offset
    // and project both endpoints onto y=100.
    const buffer = await makeHorizontalRuler(200, 200, 100, 20.3, 180.7)
    const result = await refineReferenceEndpoints({
      imageBuffer: buffer,
      imageWidth: 200,
      imageHeight: 200,
      endpoints: [
        { x: 20, y: 97 },
        { x: 181, y: 97 },
      ],
    })

    expect(Number.isFinite(result.endpoints[0].x)).toBe(true)
    expect(Number.isFinite(result.endpoints[0].y)).toBe(true)
    expect(Number.isFinite(result.endpoints[1].x)).toBe(true)
    expect(Number.isFinite(result.endpoints[1].y)).toBe(true)

    // Both endpoints land within ±1 px of the true centerline at y=100.
    expect(Math.abs(result.endpoints[0].y - 100)).toBeLessThanOrEqual(1)
    expect(Math.abs(result.endpoints[1].y - 100)).toBeLessThanOrEqual(1)
    expect(result.lineQuality).toBeGreaterThan(0.5)
  })

  it('2. diagonal ruler: parallel offset is corrected, line direction preserved', async () => {
    // True line from (30, 30) to (170, 170) — 45°. User clicked endpoints
    // both shifted ~2 px perpendicular to the line. After refinement the
    // 45° direction should still hold (the projection preserves slope).
    const buffer = await makeDiagonalRuler(200, 200, 30, 30, 170, 170)
    const result = await refineReferenceEndpoints({
      imageBuffer: buffer,
      imageWidth: 200,
      imageHeight: 200,
      endpoints: [
        { x: 32, y: 28 },
        { x: 172, y: 168 },
      ],
    })

    expect(Number.isFinite(result.endpoints[0].x)).toBe(true)
    expect(Number.isFinite(result.endpoints[1].x)).toBe(true)

    const dx = result.endpoints[1].x - result.endpoints[0].x
    const dy = result.endpoints[1].y - result.endpoints[0].y
    const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI
    expect(Math.abs(angleDeg - 45)).toBeLessThanOrEqual(3)
    expect(result.lineQuality).toBeGreaterThan(0.2)
  })

  it('3. faint edge: low lineQuality, refinement does not wander', async () => {
    // 10× contrast reduction.
    const buffer = await makeHorizontalRuler(200, 200, 100, 20.3, 180.7, 0.1)
    const result = await refineReferenceEndpoints({
      imageBuffer: buffer,
      imageWidth: 200,
      imageHeight: 200,
      endpoints: [
        { x: 20, y: 100 },
        { x: 181, y: 100 },
      ],
    })

    expect(result.lineQuality).toBeLessThan(0.3)
    // Without a strong edge the line-aware step has nothing to project to,
    // so endpoints stay near where the user placed them — they may drift
    // by up to halfWindow=4 from SP1's Gaussian fit, never more.
    expect(Math.abs(result.lengthDelta)).toBeLessThan(8)
  })

  it('4. uniform gray: both endpoints unchanged, lineQuality < 0.1', async () => {
    const buffer = await makeFlatImage(200, 200, 128)
    const result = await refineReferenceEndpoints({
      imageBuffer: buffer,
      imageWidth: 200,
      imageHeight: 200,
      endpoints: [
        { x: 50, y: 100 },
        { x: 150, y: 100 },
      ],
    })

    expect(result.endpoints[0].method).toBe('unchanged')
    expect(result.endpoints[1].method).toBe('unchanged')
    expect(result.lineQuality).toBeLessThan(0.1)
    expect(result.endpoints[0].x).toBe(50)
    expect(result.endpoints[0].y).toBe(100)
    expect(result.endpoints[1].x).toBe(150)
    expect(result.endpoints[1].y).toBe(100)
  })

  it('5. never emits NaN/Infinity, even with degenerate input', async () => {
    const buffer = await makeFlatImage(200, 200, 0)
    const result = await refineReferenceEndpoints({
      imageBuffer: buffer,
      imageWidth: 200,
      imageHeight: 200,
      endpoints: [
        { x: Number.NaN, y: 50 },
        { x: 100, y: Number.POSITIVE_INFINITY },
      ],
    })

    for (const ep of result.endpoints) {
      expect(Number.isFinite(ep.x)).toBe(true)
      expect(Number.isFinite(ep.y)).toBe(true)
      expect(Number.isFinite(ep.refinementConfidence)).toBe(true)
    }
    expect(Number.isFinite(result.lineQuality)).toBe(true)
    expect(Number.isFinite(result.lengthDelta)).toBe(true)
  })
})
