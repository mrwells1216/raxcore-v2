# Claude Code Plan — User-Drawn Antler Crop Box

> Read `CLAUDE.md` first. This is an additive feature — it does not
> replace any existing scoring flow. The crop box is optional. If the
> user skips it, scoring proceeds exactly as today.

---

## Mission

After a user uploads photos but before scoring runs, show each photo
with a draggable/resizable bounding box. The user drags the box around
the antlers. The server crops to that region (with padding) before
sending to the AI scorer. The original photo is always preserved for
display. The crop coordinates are stored as metadata.

This replaces the failed Roboflow auto-detection approach with
something better: user intelligence. 100% accurate, zero API cost,
zero failure mode.

---

## Why this matters for accuracy

- Antlers are typically 10–25% of the frame in a field photo
- The AI currently sees 100% of the image — hunter, trees, sky, truck
- Cropping to the antler region gives the model 4–8× more detail
- Better detail → better tine identification → better measurements
- The crop box coordinates become calibration metadata for future use

---

## Ground rules

1. **Crop is optional.** If user skips, scoring proceeds with the
   original image. Never block scoring because no crop was drawn.
2. **Original image is always preserved.** The cropped version is only
   used for AI scoring. The UI always shows the original.
3. **Crop coordinates are stored.** They become part of the prediction
   metadata for training and future calibration use.
4. **Padding is applied server-side.** 12% padding around the drawn
   box prevents tine tips from being cut off.
5. **No new npm packages.** The crop UI uses native canvas/pointer
   events. The server crop uses `sharp` (already installed).

---

## Tasks

### Task 1 — New component: `components/scoring/antler-crop-box.tsx`

A single-image crop box component. Renders the photo with an
interactive draggable/resizable selection rectangle overlay.

```tsx
'use client'

import { useRef, useState, useCallback, useEffect } from 'react'

export interface CropRegion {
  /** All values 0..1 (normalized, relative to image dimensions) */
  x: number
  y: number
  width: number
  height: number
}

interface AntlerCropBoxProps {
  /** The photo URL to display */
  imageUrl: string
  /** Called when user commits a crop region */
  onCrop: (region: CropRegion) => void
  /** Called when user clears the crop */
  onClear: () => void
  /** Initial region (if re-editing) */
  initialRegion?: CropRegion | null
}
```

**Visual behavior:**
- Image fills the container, aspect-ratio preserved
- On first load: show a pulsing dashed border hinting "draw a box"
- User taps/clicks and drags → draws a rectangle
- While dragging: show amber dashed border with semi-transparent
  amber fill inside the box
- After draw: show 8 resize handles (corners + midpoints) in amber
- Drag the box body to move it
- Drag handles to resize it
- Two action buttons below:
  - **"Score this region"** (amber, primary) → calls `onCrop`
  - **"Clear / Use full photo"** (muted) → calls `onClear`

**Helper copy inside the box (shown before any draw):**
```
Draw a box around the antlers
Drag from one burr base to the opposite beam tip
```

**After draw:**
Show dimensions badge: `{widthPct}% × {heightPct}% of photo`

**Implementation notes:**
- Use a `<canvas>` overlay on top of an `<img>` for the draw layer
- Track pointer events (works on both mouse and touch)
- Normalize coordinates to 0..1 so they're resolution-independent
- Minimum box size: 10% × 10% of image (prevent accidental tiny crops)
- The component is purely presentational — no API calls

---

### Task 2 — New step in `components/scoring/scoring-wizard.tsx`

Add a "Crop to antlers" step between "Photos uploaded" and
"Submit for scoring."

**Step flow (updated):**
```
1. Select photos (camera or upload)        ← existing
2. Crop to antlers (NEW — optional)        ← new
3. Scoring options (rack type, reference)  ← existing
4. Submit                                  ← existing
```

**Step 2 behavior:**
- Show each uploaded photo in sequence (or all at once if ≤ 3)
- For each photo, render `<AntlerCropBox>`
- User can draw a crop on any/all photos or skip any/all
- A "Skip cropping — use full photos" link skips the entire step
- A progress indicator: "Photo 1 of 3 — draw box or skip"

**State additions:**
```ts
// Add to wizard state
cropRegions: Record<string, CropRegion | null>  // keyed by photo index or url
```

**Pass crop regions to the form data:**
```ts
// In the submit handler, alongside existing form data
formData.append('crop_regions', JSON.stringify(cropRegions))
```

---

### Task 3 — Server-side crop: new helper `lib/scoring/crop-image.ts`

```ts
import 'server-only'
import sharp from 'sharp'
import type { CropRegion } from '@/components/scoring/antler-crop-box'

export interface CropResult {
  croppedBuffer: Buffer
  originalWidth: number
  originalHeight: number
  cropPxX: number
  cropPxY: number
  cropPxWidth: number
  cropPxHeight: number
  paddingApplied: number  // fraction, e.g. 0.12
}

/**
 * Crops an image buffer to the specified normalized region with padding.
 *
 * Padding rules:
 *   - Add 12% of the crop dimension on each side
 *   - Clamp to image bounds (never exceed original dimensions)
 *   - If crop + padding > 90% of original, skip padding (already large)
 *   - Minimum crop: 20% × 20% of original (reject tiny boxes)
 *
 * Returns null if:
 *   - Region is invalid (out of bounds, too small)
 *   - sharp fails for any reason
 * Never throws.
 */
export async function cropImageToRegion(
  imageBuffer: Buffer,
  region: CropRegion,
  options?: { paddingFraction?: number }
): Promise<CropResult | null>
```

**Algorithm:**
1. Load image metadata via `sharp(buffer).metadata()`
2. Convert normalized region to pixels
3. Apply padding: `padX = cropW × 0.12`, `padY = cropH × 0.12`
4. Clamp: `left = max(0, x - padX)`, `top = max(0, y - padY)`
5. Clamp width/height to not exceed image bounds
6. Reject if result < 20% of original in either dimension
7. `sharp(buffer).extract({ left, top, width, height }).toBuffer()`
8. Return result with full metadata for storage

---

### Task 4 — Wire into `app/api/score/route.ts`

Parse `crop_regions` from FormData. For each image that has a crop
region, download the original, crop it, and use the cropped version
for scoring. Keep the original URL for storage and display.

```ts
// Parse crop regions
const cropRegionsRaw = formData.get('crop_regions') as string | null
let cropRegions: Record<string, CropRegion | null> = {}
if (cropRegionsRaw) {
  try { cropRegions = JSON.parse(cropRegionsRaw) } catch { /* ignore */ }
}

// After image upload, before detectRackWithOpenAI:
const scoringImageUrls: string[] = []
const cropMetadata: Record<string, CropResult | null> = {}

for (let i = 0; i < storedImageUrls.length; i++) {
  const originalUrl = storedImageUrls[i]
  const region = cropRegions[i] ?? null

  if (!region) {
    // No crop for this image — use original
    scoringImageUrls.push(originalUrl)
    cropMetadata[i] = null
    continue
  }

  try {
    const imgRes  = await fetch(originalUrl)
    const imgBuf  = Buffer.from(await imgRes.arrayBuffer())
    const cropped = await cropImageToRegion(imgBuf, region)

    if (!cropped) {
      scoringImageUrls.push(originalUrl)
      cropMetadata[i] = null
      continue
    }

    // Upload cropped version
    const croppedUrl = await uploadCroppedImage(buckSessionId, cropped.croppedBuffer)
    scoringImageUrls.push(croppedUrl)
    cropMetadata[i] = cropped
  } catch (err) {
    console.warn('[crop-box] crop failed, using original', err)
    scoringImageUrls.push(originalUrl)
    cropMetadata[i] = null
  }
}

// Use scoringImageUrls (not storedImageUrls) for detectRackWithOpenAI
// and scoreBuck. storedImageUrls remains the display/storage URLs.
```

---

### Task 5 — Store crop metadata in prediction

```sql
-- Migration
ALTER TABLE public.predictions
  ADD COLUMN IF NOT EXISTS crop_box_metadata JSONB;
```

Store `cropMetadata` in the prediction row. This lets you later
analyze: do cropped-image predictions have better accuracy than
uncropped ones? This is the same measurement strategy as the
Roboflow plan, but now with real data.

---

### Task 6 — Update the AI prompt

In `lib/scoring/vision-scorer.ts`, when crop metadata is present,
add a line to the prompt:

```ts
const cropNote = hasCropBox
  ? `\nUSER CROP NOTE: This image has been cropped to focus on the
     antler region only. The full photo context (hunter, background)
     has been removed. The antlers fill most of this frame.`
  : ''
```

Append `cropNote` to the prompt. This tells the model it's seeing a
tight crop, so it shouldn't expect to see ears or body for anatomical
proportion references (and should rely on other calibration signals).

---

## Validation checklist

```bash
pnpm exec tsc --noEmit
pnpm build
```

Manual:

1. Upload 3 photos → crop step appears between upload and scoring options
2. Draw a box on photo 1, skip photos 2 and 3
3. Submit → photo 1 is cropped server-side, photos 2 and 3 use originals
4. Check prediction record → `crop_box_metadata` populated for photo 1, null for 2 and 3
5. AI prompt includes crop note for photo 1
6. UI always shows original uncropped photos (not the cropped versions)
7. Draw a box smaller than 10% of the image → minimum size enforced (box snaps to minimum)
8. Click "Skip cropping" → goes directly to scoring options, originals used
9. Upload 1 photo → crop step still works (single photo mode)
10. `pnpm build` — no regressions

---

## Files

**New:**
- `components/scoring/antler-crop-box.tsx`
- `lib/scoring/crop-image.ts`
- `supabase/migrations/YYYYMMDD_crop_box_metadata.sql`

**Modified:**
- `components/scoring/scoring-wizard.tsx` — add crop step
- `app/api/score/route.ts` — parse and apply crop regions
- `lib/scoring/vision-scorer.ts` — add crop note to prompt

**Not touched:**
- Any existing scoring logic
- Verified Score rules
- Advanced scoring
- The original image storage path
