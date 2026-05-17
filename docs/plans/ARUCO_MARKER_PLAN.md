# Claude Code Plan — ArUco Marker Full Detection

> Read `CLAUDE.md` first. The `aruco_marker` option already exists in
> the `reference_type` dropdown in the scoring form. This plan wires
> real detection behind it. Currently it does nothing; after this plan
> it becomes the highest-confidence automatic calibration available to
> non-iPhone-Pro users.

---

## Mission

When a user selects "ArUco Marker" as their reference object and
uploads a photo containing a printed ArUco marker, detect the marker
server-side, compute its exact pixel dimensions, and derive a precise
`pixelsPerInch` calibration. The user prints a free marker, places it
near the rack, takes the photo. No ruler needed. Works on any phone.

---

## What an ArUco marker gives you

ArUco markers are black-and-white square patterns (like a QR code)
used in robotics, AR, and computer vision. Key properties:

- **Known physical size**: user prints at a declared size (e.g., 4"×4")
- **Four corners detectable**: exact pixel coordinates of all 4 corners
- **Sub-pixel accuracy**: corner detection is accurate to ~0.1 pixels
- **Pose recovery**: from 4 corners + known size, you get exact camera
  distance and angle — not just scale
- **Distortion correction**: the 4-corner geometry corrects barrel
  distortion automatically

**Confidence tier**: `0.82` — between LiDAR (0.87) and user-drawn
ruler in Advanced Scoring (0.95). Best automatic calibration available
on any phone without LiDAR.

---

## Ground rules

1. **Additive.** ArUco feeds into `calibration-resolver.ts` as a
   new high-priority source. It does not replace anything.
2. **Two detection paths.** Primary: server-side OpenCV detection
   (accurate). Fallback: ask GPT-4o to estimate marker pixel size
   (lower confidence but zero extra infrastructure).
3. **User declares the marker size.** The marker size in inches is
   entered by the user. The app does not guess the print size.
4. **Graceful degradation.** If detection fails, fall back to the
   next calibration source. Never block scoring.
5. **Free marker generation.** The app can link to or embed a marker
   generator so users never have to find one themselves.

---

## ArUco marker primer

The user visits a marker generator (or we generate one in-app) and
prints a marker at a known size. Common choices:

- **4" × 4"** — fits on a standard index card
- **3" × 3"** — fits on a business card
- **6" × 6"** — easier to detect from farther away

The user places the marker **flat, near the antlers** — on the skull
plate, on the antler base, or on a flat surface in the same plane as
the rack. Takes the photo normally.

We detect which ArUco dictionary the marker belongs to (DICT_4X4_50
is the most common), find the four corners, and compute:

```
pixelsPerInch = cornerPixelDistance / markerSizeInches
```

where `cornerPixelDistance` is the average of the four side lengths
in pixels.

---

## Tasks

### Task 1 — Marker size input in scoring form

In `components/scoring/scoring-form.tsx`, when
`watchReferenceType === 'aruco_marker'`, show a size input (currently
this branch may show nothing or a placeholder):

```tsx
{watchReferenceType === 'aruco_marker' && (
  <div className="space-y-3 p-3 rounded-lg"
    style={{ background: 'rgba(107,93,82,0.06)',
             border: '1px solid rgba(107,93,82,0.15)' }}>

    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">
        Marker Size (inches)
      </label>
      <p className="text-[10px] text-muted-foreground">
        Enter the printed size of your ArUco marker.
        Measure the black outer border corner to corner.
      </p>
    </div>

    {/* Size chips — common sizes */}
    <div className="flex gap-2 flex-wrap">
      {[2, 3, 4, 5, 6].map(size => {
        const selected = watchArucoSizeIn === size
        return (
          <button key={size} type="button"
            onClick={() => form.setValue('reference_aruco_size_inches',
              selected ? null : size, { shouldDirty: true })}
            className="px-3 py-2 rounded-xl text-sm font-bold
                       border transition-all touch-manipulation"
            style={{
              background: selected ? 'rgba(251,191,36,0.12)' : 'transparent',
              border:     selected ? '1px solid rgba(251,191,36,0.35)'
                                   : '1px solid rgba(107,93,82,0.3)',
              color:      selected ? 'rgba(251,191,36,0.95)'
                                   : 'rgba(180,163,145,0.75)',
            }}>
            {size}"
          </button>
        )
      })}
    </div>

    {/* Custom size input */}
    <Input type="number" min="1" max="12" step="0.25"
      inputMode="decimal" placeholder="Custom size..."
      className="min-h-[44px]"
      value={watchArucoSizeIn ?? ''}
      onChange={e => form.setValue('reference_aruco_size_inches',
        e.target.value ? Number(e.target.value) : null,
        { shouldDirty: true })} />

    {/* Link to free marker generator */}
    <p className="text-[10px]" style={{ color: 'rgba(107,93,82,0.65)' }}>
      Need a marker?{' '}
      <a href="https://chev.me/arucogen/" target="_blank"
        rel="noopener noreferrer"
        style={{ color: 'rgba(251,191,36,0.75)',
                 textDecoration: 'underline' }}>
        Generate a free ArUco marker
      </a>
      {' '}— print at your chosen size. Place flat, near the antlers.
    </p>

    <p className="text-[10px]"
      style={{ color: 'rgba(139,90,43,0.75)' }}>
      Measurement accuracy depends on the marker being flat and
      clearly visible. Folded or angled markers reduce precision.
    </p>
  </div>
)}
```

**Add to Zod schema:**
```ts
reference_aruco_size_inches: z.coerce.number()
  .min(1).max(12).optional().nullable(),
```

**Add to defaultValues:**
```ts
reference_aruco_size_inches: null,
```

**Add watch:**
```ts
const watchArucoSizeIn = form.watch('reference_aruco_size_inches')
```

---

### Task 2 — Types: `lib/scoring/aruco-types.ts`

```ts
export interface ArucoCorners {
  topLeft:     { x: number; y: number }
  topRight:    { x: number; y: number }
  bottomRight: { x: number; y: number }
  bottomLeft:  { x: number; y: number }
}

export interface ArucoDetectionResult {
  detected:          boolean
  markerId:          number | null
  dictionary:        string | null        // e.g. 'DICT_4X4_50'
  corners:           ArucoCorners | null
  /** Average side length in pixels */
  sidePixels:        number | null
  /** pixelsPerInch — only if user provided markerSizeInches */
  pixelsPerInch:     number | null
  /** Estimated camera distance to marker in inches */
  estimatedDistanceInches: number | null
  confidence:        number
  method:            'opencv' | 'gpt4o_fallback' | 'none'
  warnings:          string[]
}

export interface ArucoCalibrationInput {
  markerSizeInches:  number
  imageBuffer:       Buffer
  imageWidth:        number
  imageHeight:       number
  focalLengthPx?:    number | null
}
```

---

### Task 3 — Detection logic: `lib/calibration/aruco-detector.ts`

Two detection paths. Try path A first. Fall back to path B.

```ts
import 'server-only'
import type { ArucoDetectionResult, ArucoCalibrationInput } from '@/lib/scoring/aruco-types'
import { isFiniteNumber } from '@/lib/advanced-scoring/geometry'

/**
 * PATH A — GPT-4o visual detection (primary path, no native deps).
 *
 * Ask the vision model to find the ArUco marker in the image,
 * return the four corner pixel coordinates, and identify the
 * marker dictionary and ID.
 *
 * This is less accurate than OpenCV (~0.5–1 pixel vs ~0.1 pixel)
 * but requires zero native dependencies and works in Vercel's
 * serverless environment.
 *
 * Confidence: 0.70 when corners found, 0.55 if only size estimated.
 */
async function detectWithGPT4o(
  input: ArucoCalibrationInput,
  openaiClient: unknown,
): Promise<ArucoDetectionResult>

/**
 * PATH B — OpenCV.js detection (future — higher accuracy).
 *
 * Uses @techstark/opencv-js (WASM build of OpenCV) for sub-pixel
 * ArUco corner detection.
 *
 * NOTE: Do NOT implement this in the initial build. The WASM bundle
 * is ~35MB and may exceed Vercel's function bundle limit. Mark as
 * TODO and implement only if GPT-4o accuracy is insufficient.
 *
 * When implemented:
 *   - Use cv.aruco.detectMarkers()
 *   - Supports DICT_4X4_50, DICT_5X5_100, DICT_6X6_250
 *   - Returns exact float corner coordinates
 *   - Confidence: 0.88
 */
// TODO: implement after validating GPT-4o accuracy on real photos

/**
 * Main exported function. Always returns a result, never throws.
 */
export async function detectArucoMarker(
  input: ArucoCalibrationInput,
): Promise<ArucoDetectionResult>
```

**GPT-4o detection prompt (embed in the function):**

```
Look at this image carefully.

Is there an ArUco marker visible? ArUco markers are square black-and-white
patterns used for computer vision calibration — they look like a small QR
code with a thick black border and a unique binary pattern inside.

If you see one:
1. Return the pixel coordinates of all four corners:
   topLeft, topRight, bottomRight, bottomLeft (in clockwise order)
2. Estimate the marker dictionary if recognizable
   (DICT_4X4_50 is most common for small markers)
3. Estimate the marker ID number if visible

The image is {WIDTH}×{HEIGHT} pixels.

If no ArUco marker is visible, return detected: false.

Return JSON only:
{
  "detected": boolean,
  "markerId": number | null,
  "dictionary": string | null,
  "corners": {
    "topLeft":     { "x": number, "y": number },
    "topRight":    { "x": number, "y": number },
    "bottomRight": { "x": number, "y": number },
    "bottomLeft":  { "x": number, "y": number }
  } | null
}
```

**`pixelsPerInch` computation from corners:**

```ts
function cornersToPixelsPerInch(
  corners: ArucoCorners,
  markerSizeInches: number,
): { pixelsPerInch: number; sidePixels: number } | null {

  // Compute all four side lengths
  const sides = [
    dist(corners.topLeft, corners.topRight),
    dist(corners.topRight, corners.bottomRight),
    dist(corners.bottomRight, corners.bottomLeft),
    dist(corners.bottomLeft, corners.topLeft),
  ]

  // Average side length (robust to slight perspective distortion)
  const avgSide = sides.reduce((a, b) => a + b, 0) / 4

  // Reject if sides differ by more than 20% (marker too angled)
  const minSide = Math.min(...sides)
  const maxSide = Math.max(...sides)
  if (maxSide / minSide > 1.25) {
    return null  // marker is angled — measurements unreliable
  }

  const pixelsPerInch = avgSide / markerSizeInches
  return { pixelsPerInch, sidePixels: avgSide }
}

function dist(a: {x:number;y:number}, b: {x:number;y:number}): number {
  return Math.sqrt(Math.pow(b.x - a.x, 2) + Math.pow(b.y - a.y, 2))
}
```

**Confidence rules:**
- GPT-4o found all 4 corners + sides agree within 25%: `0.72`
- GPT-4o found corners but sides differ 25–40%: `0.55` + warning
- GPT-4o found corners but sides differ >40%: `0.35` + strong warning
- No marker detected: `0.0`

---

### Task 4 — Wire into `app/api/score/route.ts`

Parse the ArUco size from FormData. If `reference_type === 'aruco_marker'`
and `reference_aruco_size_inches` is set, run ArUco detection before
the scoring call:

```ts
const arucoSizeInches = formData.get('reference_aruco_size_inches')
let arucoResult: ArucoDetectionResult | null = null

if (referenceType === 'aruco_marker' && arucoSizeInches) {
  try {
    const firstImageBuf = Buffer.from(
      await fetch(storedImageUrls[0]).then(r => r.arrayBuffer())
    )
    const imgMeta = await sharp(firstImageBuf).metadata()
    arucoResult = await detectArucoMarker({
      markerSizeInches: Number(arucoSizeInches),
      imageBuffer: firstImageBuf,
      imageWidth: imgMeta.width ?? 0,
      imageHeight: imgMeta.height ?? 0,
    })

    if (arucoResult.detected) {
      console.log(
        `[aruco] detected: ${arucoResult.pixelsPerInch?.toFixed(1)} px/in, ` +
        `confidence ${arucoResult.confidence.toFixed(2)}, ` +
        `method ${arucoResult.method}`
      )
    }
  } catch (err) {
    console.warn('[aruco] detection failed (non-blocking)', err)
  }
}
```

Pass `arucoResult` to `resolveCalibration`.

---

### Task 5 — Wire into `lib/scoring/calibration-resolver.ts`

Add ArUco as priority 2 (after LiDAR, before reference objects):

```ts
// Priority 2: ArUco marker (if detected)
if (arucoResult?.detected && arucoResult.pixelsPerInch &&
    arucoResult.confidence > 0.5) {
  sources.push({
    pixelsPerInch: arucoResult.pixelsPerInch,
    source: 'aruco_marker',
    confidence: arucoResult.confidence,
  })
}
```

**Updated calibration hierarchy:**

| Priority | Source | Confidence |
|---|---|---|
| 1 | LiDAR depth + EXIF | 0.85–0.90 |
| 2 | **ArUco marker (GPT-4o)** | 0.55–0.72 |
| 3 | User ruler (Advanced Scoring) | 0.95 |
| 4 | Ring / hat reference | 0.40–0.45 |
| 5 | Anatomical priors | 0.50–0.65 |
| 6 | Vanishing point | 0.30–0.55 |
| — | None | 0.25 |

---

### Task 6 — Migration

```sql
ALTER TABLE public.predictions
  ADD COLUMN IF NOT EXISTS aruco_detection_metadata JSONB;
```

Store `arucoResult` in the prediction record. Over time this shows
real-world detection accuracy and whether GPT-4o is reliable enough
or if OpenCV.js is worth the bundle size tradeoff.

---

### Task 7 — AI prompt note

In `lib/scoring/vision-scorer.ts`, if ArUco was detected:

```ts
const arucoBlock = arucoResult?.detected && arucoResult.pixelsPerInch
  ? `
ARUCO MARKER DETECTED
- A printed ArUco calibration marker is visible in this image.
- Marker size: ${arucoSizeInches}" × ${arucoSizeInches}"
- Detected pixel size: ${arucoResult.sidePixels?.toFixed(1)} px per side
- Calibration: ${arucoResult.pixelsPerInch.toFixed(1)} px/in
  (confidence: ${(arucoResult.confidence * 100).toFixed(0)}%)
- Use this as a high-confidence scale reference.
- If the marker appears angled or folded in the image,
  apply a confidence penalty to scale-dependent measurements.
`
  : ''
```

---

### Task 8 — User-facing indicator

In `components/scoring/scoring-results.tsx`, when
`aruco_detection_metadata.detected === true`:

```
┌─────────────────────────────────────────────┐
│ 🎯 ArUco Marker Calibration                  │
│                                              │
│ Marker detected: {markerSizeIn}" × {size}"  │
│ Scale: {pixelsPerInch} px/in                │
│ Confidence: {confidence}%                   │
│                                              │
│ "Printed marker used for automatic scale    │
│  calibration."                              │
└─────────────────────────────────────────────┘
```

Only shows when `detected: true`. Hidden when not detected.

---

## Validation checklist

```bash
pnpm exec tsc --noEmit
pnpm build
```

Manual:

1. Select "ArUco Marker" in reference type → marker size input appears
2. Select 4" size chip → value stored in form state
3. Generate a marker at arucogen.com, print at 4", photograph it with
   a rack → upload → detection runs → `aruco_detection_metadata`
   populated with `detected: true` and `pixelsPerInch` value
4. ArUco calibration indicator shows on scoring results
5. Photo without a marker → `detected: false` → no indicator shown
6. Angled marker (>25% side length variation) → warning in confidence
   explanation
7. `reference_type = 'aruco_marker'` with no size entered → detection
   skipped, falls back to next calibration source
8. All existing reference types (ruler, ring, hat) still work
9. `calibration-resolver.ts` picks ArUco over anatomical priors
   when confidence > 0.5

---

## Files

**New:**
- `lib/scoring/aruco-types.ts`
- `lib/calibration/aruco-detector.ts`
- `supabase/migrations/YYYYMMDD_aruco_detection.sql`

**Modified:**
- `components/scoring/scoring-form.tsx` — add marker size input
- `app/api/score/route.ts` — parse size, run detection
- `lib/scoring/calibration-resolver.ts` — add ArUco source
- `lib/scoring/vision-scorer.ts` — add ArUco prompt block
- `components/scoring/scoring-results.tsx` — add indicator
- `lib/types.ts` — add `'aruco_marker'` to calibration source union
- `lib/env.ts` — no new keys (uses existing OPENAI_API_KEY)

**Not touched:**
- Advanced Scoring flow
- Verified Score rules
- Any existing reference type behavior
- `sharp` usage (existing)
