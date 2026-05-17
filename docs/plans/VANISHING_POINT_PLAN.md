# Claude Code Plan — Vanishing Point Perspective Calibration

> Read `CLAUDE.md` first. This is an additive signal to the existing
> calibration resolver. It never replaces LiDAR, reference objects,
> or anatomical priors — it adds a cross-check that works when any
> straight parallel lines are visible in the photo.

---

## Mission

Many hunting photos contain straight parallel lines in the background
— fence rails, truck bed rails, barn boards, tailgates, floor tiles,
door frames. When the AI identifies two or more parallel lines, it
can compute vanishing points using projective geometry. Combined with
EXIF focal length, this yields an independent `pixelsPerInch` estimate
that cross-validates the other calibration sources.

This is **free** — it's a prompt engineering addition plus lightweight
geometry math. No new APIs, no new packages.

---

## Ground rules

1. **Additive only.** Vanishing point calibration feeds into the
   existing `calibration-resolver.ts` as a lower-priority source.
   It never overrides LiDAR or user-drawn reference objects.
2. **Confidence is honest.** Vanishing point estimates carry
   `confidence: 0.30–0.55` depending on how many lines were found
   and how well they converge. This is below anatomical priors
   (0.50–0.65) in most cases — it's a weak signal.
3. **Never fabricated.** If no parallel lines are visible, return
   `null`. The model must explicitly say "no usable parallel features
   found" — not guess.
4. **Cross-check value.** The primary value is conflict detection:
   if the vanishing point estimate is 40%+ different from the
   anatomical prior, surface a warning: "Photo perspective is
   unusual — Advanced Scoring recommended."

---

## How it works

**Step 1**: Ask GPT-4o (as part of the existing landmark detection
call — no extra API call) to identify any straight parallel lines in
the photo background: fence rails, vehicle body lines, floor boards,
roof lines, door frames, etc.

**Step 2**: For each pair of identified parallel lines, the AI returns
two line endpoints as pixel coordinates.

**Step 3**: Compute the vanishing point — the pixel coordinate where
the two lines would meet if extended. This is solved analytically
from the four endpoints using line intersection math.

**Step 4**: From the vanishing point + EXIF focal length + known
image dimensions, compute the camera tilt angle relative to the
plane the parallel lines are on.

**Step 5**: From the camera angle + any known dimension on that
plane (e.g., a standard fence rail spacing of 12"), estimate
`pixelsPerInch` at the depth of the antlers.

**The honest limitation**: Step 5 requires knowing at least one real
dimension on the plane the parallel lines occupy. Without that, the
vanishing point tells you the angle but not the scale. However, the
angle alone is useful for two things:
- Correcting the perspective distortion on landmark pixel distances
- Cross-checking that the anatomical prior calibration is reasonable

---

## Tasks

### Task 1 — Extend the landmark detection prompt

In `lib/scoring/landmark-prompt.ts`, add a section after the
existing antler landmark requests:

```ts
const parallelFeaturesBlock = `
PERSPECTIVE CALIBRATION (optional — look for these in the BACKGROUND):

Look for any straight parallel lines in the scene background.
Common examples: fence rails, fence posts, vehicle body lines,
truck bed rails, barn boards, floor/deck boards, door frames,
window frames, roof lines, concrete joints.

For each pair of parallel lines you can identify, return:
  - feature_type: what the lines are (e.g. "fence_rail", "truck_bed")
  - line_a: { x1, y1, x2, y2 } — pixel endpoints of first line
  - line_b: { x1, y1, x2, y2 } — pixel endpoints of second line
  - confidence: 0..1 (how confident are you these are truly parallel)
  - known_spacing_inches: your best estimate of the real-world
    distance between the lines IF you can reasonably identify the
    object (e.g., standard fence rail spacing ~12", truck bed side
    rail ~6" wide). Return null if unknown.

If no parallel lines are visible or usable, return an empty array.
Maximum 3 pairs.

Add this to your JSON response as: "parallel_features": [...]
`
```

Append `parallelFeaturesBlock` to the existing landmark prompt.
The model returns this alongside the antler landmark coordinates —
no second API call needed.

---

### Task 2 — Types: `lib/scoring/vanishing-point-types.ts`

```ts
export interface ParallelFeature {
  feature_type: string
  line_a: { x1: number; y1: number; x2: number; y2: number }
  line_b: { x1: number; y1: number; x2: number; y2: number }
  confidence: number
  known_spacing_inches: number | null
}

export interface VanishingPointResult {
  /** Pixel coordinate of vanishing point (may be outside image bounds) */
  vanishingPoint: { x: number; y: number } | null
  /** Camera tilt angle in degrees from horizontal */
  tiltAngleDeg: number | null
  /** pixelsPerInch estimate — only available if known_spacing_inches present */
  pixelsPerInch: number | null
  /** Which feature was used for scale (if any) */
  scaleSource: string | null
  confidence: number
  warnings: string[]
}
```

---

### Task 3 — Geometry: `lib/scoring/vanishing-point-geometry.ts`

Pure math. No side effects, no async, no external calls.

```ts
import { isFiniteNumber } from '@/lib/advanced-scoring/geometry'
import type { ParallelFeature, VanishingPointResult } from './vanishing-point-types'

/**
 * Compute the vanishing point from two lines defined by their endpoints.
 *
 * Each line is defined by two points (x1,y1) and (x2,y2).
 * The vanishing point is where the two lines (extended infinitely) meet.
 *
 * Uses Cramer's rule for line intersection:
 *   Line A: passes through (x1,y1) with direction (x2-x1, y2-y1)
 *   Line B: passes through (x3,y3) with direction (x4-x3, y4-y3)
 *
 * Returns null if lines are parallel (no intersection).
 */
export function computeVanishingPoint(
  feature: ParallelFeature
): { x: number; y: number } | null {
  const { line_a: a, line_b: b } = feature

  // Line A: parametric form P = (a.x1, a.y1) + t*(a.x2-a.x1, a.y2-a.y1)
  const ax = a.x2 - a.x1
  const ay = a.y2 - a.y1
  // Line B: parametric form P = (b.x1, b.y1) + s*(b.x2-b.x1, b.y2-b.y1)
  const bx = b.x2 - b.x1
  const by = b.y2 - b.y1

  // Solve: a.x1 + t*ax = b.x1 + s*bx
  //        a.y1 + t*ay = b.y1 + s*by
  const denom = ax * by - ay * bx
  if (Math.abs(denom) < 1e-6) return null  // parallel lines

  const dx = b.x1 - a.x1
  const dy = b.y1 - a.y1
  const t = (dx * by - dy * bx) / denom

  return {
    x: a.x1 + t * ax,
    y: a.y1 + t * ay,
  }
}

/**
 * Compute camera tilt angle from vanishing point + focal length.
 *
 * When horizontal lines converge to a vanishing point, the vertical
 * offset of that point from the image center reveals the camera tilt.
 *
 * tiltAngle = atan((vy - cy) / focalLengthPx)
 * where vy = vanishing point y, cy = image center y
 */
export function computeTiltAngle(
  vanishingPoint: { x: number; y: number },
  imageHeight: number,
  focalLengthPx: number
): number | null {
  if (!isFiniteNumber(focalLengthPx) || focalLengthPx <= 0) return null
  const cy = imageHeight / 2
  const offsetY = vanishingPoint.y - cy
  return (Math.atan2(offsetY, focalLengthPx) * 180) / Math.PI
}

/**
 * Compute pixelsPerInch from two parallel lines of known separation.
 *
 * If we know the real-world distance between two parallel lines
 * (e.g., fence rail spacing = 12"), and we can measure the pixel
 * distance between them (perpendicular distance), then:
 *
 *   pixelsPerInch = pixelDistance / knownSpacingInches
 *
 * Corrected for tilt using the cosine of the tilt angle:
 *   pixelDistance_corrected = pixelDistance * cos(tiltAngle)
 */
export function computePixelsPerInchFromSpacing(
  feature: ParallelFeature,
  tiltAngleDeg: number | null
): number | null {
  if (!feature.known_spacing_inches) return null

  // Compute midpoint-to-midpoint perpendicular pixel distance
  const a = feature.line_a
  const b = feature.line_b
  const midAx = (a.x1 + a.x2) / 2
  const midAy = (a.y1 + a.y2) / 2
  const midBx = (b.x1 + b.x2) / 2
  const midBy = (b.y1 + b.y2) / 2

  const pixelDist = Math.sqrt(
    Math.pow(midBx - midAx, 2) + Math.pow(midBy - midAy, 2)
  )

  // Apply tilt correction
  const tiltRad = tiltAngleDeg != null
    ? (tiltAngleDeg * Math.PI) / 180
    : 0
  const corrected = pixelDist * Math.cos(tiltRad)

  if (corrected < 1) return null
  const ppi = corrected / feature.known_spacing_inches
  return isFiniteNumber(ppi) && ppi > 0 ? ppi : null
}

/**
 * Master function: takes all detected parallel features and returns
 * the best vanishing point calibration result.
 */
export function analyzeVanishingPoints(
  features: ParallelFeature[],
  imageWidth: number,
  imageHeight: number,
  focalLengthPx: number | null,
): VanishingPointResult {
  const result: VanishingPointResult = {
    vanishingPoint: null,
    tiltAngleDeg: null,
    pixelsPerInch: null,
    scaleSource: null,
    confidence: 0,
    warnings: [],
  }

  if (!features || features.length === 0) return result

  // Use the highest-confidence feature
  const best = [...features].sort((a, b) => b.confidence - a.confidence)[0]
  if (best.confidence < 0.4) {
    result.warnings.push('Parallel features detected but confidence too low to use')
    return result
  }

  const vp = computeVanishingPoint(best)
  if (!vp) {
    result.warnings.push('Lines appear parallel — could not compute vanishing point')
    return result
  }

  result.vanishingPoint = vp

  // Tilt angle (requires focal length)
  if (focalLengthPx && focalLengthPx > 0) {
    result.tiltAngleDeg = computeTiltAngle(vp, imageHeight, focalLengthPx)
  } else {
    result.warnings.push('No EXIF focal length — tilt angle not computed')
  }

  // pixelsPerInch from known spacing
  if (best.known_spacing_inches) {
    result.pixelsPerInch = computePixelsPerInchFromSpacing(best, result.tiltAngleDeg)
    result.scaleSource = best.feature_type
  }

  // Confidence calculation
  let conf = best.confidence * 0.6  // base: AI confidence in lines
  if (result.tiltAngleDeg != null) conf += 0.15  // bonus: have tilt correction
  if (result.pixelsPerInch != null) conf += 0.20  // bonus: have scale
  // Penalty: vanishing point far outside image (less reliable)
  const vpOutsideFactor = (
    vp.x < -imageWidth || vp.x > 2 * imageWidth ||
    vp.y < -imageHeight || vp.y > 2 * imageHeight
  ) ? 0.7 : 1.0
  result.confidence = Math.min(0.55, conf * vpOutsideFactor)

  return result
}
```

---

### Task 4 — Wire into calibration resolver

In `lib/scoring/calibration-resolver.ts`, add vanishing point as
the lowest-priority source before the fallback to `'none'`:

```ts
// After anatomical prior check, before returning 'none':

// 4. Vanishing point (lowest priority — cross-check only)
if (vanishingPointResult?.pixelsPerInch && vanishingPointResult.confidence > 0.3) {
  sources.push({
    pixelsPerInch: vanishingPointResult.pixelsPerInch,
    source: 'vanishing_point',
    confidence: vanishingPointResult.confidence,
  })
}

// Cross-check conflict detection:
// If vanishing point estimate differs from the winning source by > 35%,
// add a warning to the confidence explanation.
if (vanishingPointResult?.pixelsPerInch && winningSouce?.pixelsPerInch) {
  const delta = Math.abs(
    vanishingPointResult.pixelsPerInch - winningSource.pixelsPerInch
  ) / winningSource.pixelsPerInch

  if (delta > 0.35) {
    warnings.push(
      `Perspective analysis suggests a different scale than the ` +
      `primary calibration source (${Math.round(delta * 100)}% difference). ` +
      `Advanced Scoring with a physical ruler is recommended.`
    )
  }
}
```

Update `calibrationSource` union type to include `'vanishing_point'`.

---

### Task 5 — Add to confidence explanation

In `lib/scoring/ai-service.ts`, in the confidence notes section:

```ts
if (vanishingResult?.pixelsPerInch) {
  confidenceExplanation.push(
    `Perspective calibration: ${vanishingResult.scaleSource} lines ` +
    `detected in background. Independent scale estimate: ` +
    `${vanishingResult.pixelsPerInch.toFixed(1)} px/in ` +
    `(confidence ${(vanishingResult.confidence * 100).toFixed(0)}%).`
  )
}

if (vanishingResult?.tiltAngleDeg != null) {
  const deg = Math.abs(vanishingResult.tiltAngleDeg)
  if (deg > 20) {
    confidenceExplanation.push(
      `Camera tilt detected: ${deg.toFixed(1)}° from horizontal. ` +
      `Steep angles reduce measurement accuracy — ` +
      `a more level photo improves results.`
    )
  }
}
```

---

### Task 6 — Store vanishing point metadata

```sql
-- Migration
ALTER TABLE public.predictions
  ADD COLUMN IF NOT EXISTS vanishing_point_metadata JSONB;
```

Store `VanishingPointResult` in the prediction record. Over time,
this data shows which types of backgrounds produce the most useful
calibration signals.

---

## Calibration resolver priority (updated full stack)

| Priority | Source | Confidence | Notes |
|---|---|---|---|
| 1 | LiDAR depth + EXIF | 0.85–0.90 | iPhone Pro portrait mode |
| 2 | User-drawn ruler/tape | 0.95 | Advanced Scoring only |
| 3 | Reference object (ring/hat) | 0.40–0.45 | Quick scoring |
| 4 | Anatomical priors | 0.50–0.65 | Eye box, pedicle spacing |
| 5 | Vanishing point | 0.30–0.55 | Background parallel lines |
| — | None | 0.25 | Pure AI guess |

---

## Validation checklist

```bash
pnpm exec tsc --noEmit
pnpm build
```

Manual:

1. Score a photo with a fence in the background → check prediction
   record for `vanishing_point_metadata` with detected lines
2. Score a photo with no background lines → `vanishing_point_metadata`
   shows empty features array, no vanishing point computed
3. `calibration-resolver.ts` returns `source: 'vanishing_point'`
   only when no higher-priority source is available
4. When vanishing point differs >35% from anatomical prior →
   warning appears in confidence explanation
5. Tilt angle >20° → tilt warning in confidence explanation
6. Scoring still works when no parallel features detected (no regression)
7. Unit sanity check: two perfectly horizontal fence rails (y=100 and
   y=200 pixels, both spanning the full width) → vanishing point at
   infinity → `null` returned correctly (parallel lines)

---

## Files

**New:**
- `lib/scoring/vanishing-point-types.ts`
- `lib/scoring/vanishing-point-geometry.ts`
- `supabase/migrations/YYYYMMDD_vanishing_point_metadata.sql`

**Modified:**
- `lib/scoring/landmark-prompt.ts` — add parallel features request
- `lib/scoring/calibration-resolver.ts` — add vanishing point source
- `lib/scoring/ai-service.ts` — add confidence notes
- `lib/types.ts` — add `'vanishing_point'` to calibration source union

**Not touched:**
- Direct AI scoring path (scoreBuck, vision-scorer prompt text)
- Verified Score rules
- Any component files
- Advanced Scoring
