# Claude Code Plan — AR Calibration Dots (Drag-to-Burr-Base)

> Read `CLAUDE.md` first. This is a new optional step in the capture
> flow — two draggable amber dots the user positions on the antler
> burr bases. The pixel distance between them, combined with the known
> anatomical pedicle spacing, produces a calibration factor. No
> physical reference object needed. No laser needed. Works on any
> photo or live camera preview.

---

## Mission

After upload (or during camera capture), show two draggable amber
dots overlaid on the photo. The user drags them to the base of each
antler (the burr, where antler meets skull). The pixel distance
between the dots divided by the known average pedicle spacing gives
`pixelsPerInch`. This is the most intuitive calibration UX possible
— point at what you know, get accurate measurements.

This is the same concept as AR tape measure apps, applied specifically
to the one anatomical feature that is always present in any antler
photo: the two pedicle bases.

---

## Why pedicle spacing works as a reference

Whitetail pedicle (burr-to-burr) spacing follows a tight distribution:
- Average: 4.5 inches (measured center to center)
- Range: 3.8–5.5 inches across adult bucks
- Correlation with body size: larger bucks = slightly wider spacing

This is the same anatomical prior the existing calibration system
uses for the eye box. The difference here is that the **user
explicitly confirms the position** by dragging the dots, rather than
the AI guessing from a bounding box. User-confirmed position is
significantly more accurate than AI-estimated position.

**Confidence tier**: `0.68` — higher than AI-estimated anatomical
priors (0.50–0.65), lower than ArUco (0.72) and LiDAR (0.87).

The user can optionally enter their specific pedicle measurement if
they know it (e.g., they measured it on the skull plate after harvest).
If they enter a real measurement, confidence jumps to `0.85`.

---

## Ground rules

1. **Optional, always skippable.** A "Skip / Use AI estimate" button
   is always visible. If skipped, calibration falls back to the
   existing anatomical prior.
2. **Two dots only.** Left pedicle and right pedicle. No more.
   Simple, fast, one gesture per dot.
3. **Works on both uploaded photos and camera preview.** The overlay
   is a React layer on top of the `<img>` or `<video>` element.
4. **User can enter known spacing.** Optional text input: "I know
   my pedicle spacing" → enters inches → confidence upgrades.
5. **Coordinates are normalized (0..1).** Resolution-independent.
   Stored as metadata, not baked into pixel values.

---

## Tasks

### Task 1 — New component: `components/scoring/calibration-dots.tsx`

```tsx
'use client'

import { useRef, useState, useCallback } from 'react'

export interface PedicleCalibrationResult {
  /** Normalized coordinates (0..1) of each dot */
  leftDot:  { x: number; y: number }
  rightDot: { x: number; y: number }
  /** Pixel distance between dots at the image's natural resolution */
  pixelDistance: number
  /** User-entered known spacing in inches (null = use anatomical prior) */
  knownSpacingInches: number | null
  /** Computed pixelsPerInch */
  pixelsPerInch: number
  /** 0..1 confidence */
  confidence: number
  source: 'user_placed_anatomical' | 'user_placed_known'
}

interface CalibrationDotsProps {
  /** The photo URL or object URL to overlay dots on */
  imageUrl: string
  /** Natural image dimensions (needed for pixel distance math) */
  imageNaturalWidth: number
  imageNaturalHeight: number
  /** Called when user confirms the dot positions */
  onConfirm: (result: PedicleCalibrationResult) => void
  /** Called when user skips */
  onSkip: () => void
}
```

**Visual design:**

The component renders a `position: relative` container with:
- The photo as `<img>` filling the container
- A `position: absolute` overlay div filling the same space
- Two draggable dot elements positioned via `left` / `top` CSS

Each dot:
- 28px diameter circle
- Amber fill: `rgba(251, 191, 36, 0.9)`
- White border: `2px solid rgba(255,255,255,0.8)`
- Drop shadow for visibility on any background
- A small label above: "L PEDICLE" / "R PEDICLE" in tiny amber caps
- Crosshair center indicator (2px white lines, 8px long)

Initial positions:
- Left dot starts at `{ x: 0.35, y: 0.55 }` (typical left pedicle region)
- Right dot starts at `{ x: 0.65, y: 0.55 }` (typical right pedicle region)
- These are reasonable defaults for a front-facing rack photo

A connecting line between the two dots:
- Dashed amber line, `opacity: 0.6`
- Shows the distance being measured
- Updates live as dots move

Distance badge in the center of the connecting line:
- Shows current pixel distance in real-time
- If `knownSpacingInches` is entered: shows computed `pixelsPerInch`
- If not: shows "≈ {anatomical estimate}" in smaller muted text

**Drag behavior:**
- `onPointerDown` on dot → set that dot as active
- `onPointerMove` on container → update active dot position
- `onPointerUp` → release
- Works with both mouse and touch (pointer events API)
- Clamp to container bounds (dot can't go outside image)

**Below the image:**

```
Section 1: Optional spacing input
  "Do you know the exact pedicle spacing?"
  [ Input: inches, placeholder "e.g. 4.5" ] 
  Helper: "Measure center-to-center on the skull plate if available.
           Leave blank to use the average (4.5")"

Section 2: Action buttons
  [ Confirm calibration ] (amber primary)
  [ Skip — use AI estimate ] (muted secondary)
```

**`onConfirm` logic:**
```ts
const containerRect = containerRef.current.getBoundingClientRect()

// Convert normalized to pixel coordinates at natural image resolution
const leftPx  = leftDot.x  * imageNaturalWidth
const rightPx = rightDot.x * imageNaturalWidth
const leftPy  = leftDot.y  * imageNaturalHeight
const rightPy = rightDot.y * imageNaturalHeight

const pixelDist = Math.sqrt(
  Math.pow(rightPx - leftPx, 2) + Math.pow(rightPy - leftPy, 2)
)

const spacingIn = knownSpacingInches ?? 4.5  // anatomical prior default
const ppi       = pixelDist / spacingIn

onConfirm({
  leftDot,
  rightDot,
  pixelDistance: pixelDist,
  knownSpacingInches: knownSpacingInches ?? null,
  pixelsPerInch: ppi,
  confidence: knownSpacingInches ? 0.85 : 0.68,
  source: knownSpacingInches ? 'user_placed_known' : 'user_placed_anatomical',
})
```

---

### Task 2 — Instruction overlay (shown before first drag)

On first load, show a brief instruction overlay on the image:

```
┌────────────────────────────────────────┐
│                                        │
│   Drag the dots to each antler base   │
│   (where the antler meets the skull)  │
│                                        │
│   [Animated arrows pointing to dots]  │
│                                        │
└────────────────────────────────────────┘
```

Disappears on first pointer interaction. Never shown again in that
session. No persistent storage needed.

---

### Task 3 — Wire into `components/scoring/scoring-wizard.tsx`

Add as an optional step after the crop box step (or after upload if
crop box is skipped):

```
Step flow:
  1. Upload / Camera capture
  2. Crop to antlers (optional)           ← existing plan
  3. Calibration dots (optional, NEW)     ← this plan
  4. Scoring options
  5. Submit
```

Step 3 only appears if:
- At least one photo has been uploaded
- The photo contains a visible rack (front-facing preferred)
- User has not already selected a higher-confidence reference object
  (LiDAR auto-detected, or ruler/ArUco selected)

The step is always skippable with one tap.

**State additions:**
```ts
pedicleCalibration: PedicleCalibrationResult | null
```

**Pass to FormData on submit:**
```ts
if (pedicleCalibration) {
  formData.append(
    'pedicle_calibration',
    JSON.stringify(pedicleCalibration)
  )
}
```

---

### Task 4 — Wire into `app/api/score/route.ts`

Parse pedicle calibration from FormData:

```ts
const pedicleCalibrationRaw = formData.get('pedicle_calibration')
let pedicleCalibration: PedicleCalibrationResult | null = null

if (pedicleCalibrationRaw) {
  try {
    pedicleCalibration = JSON.parse(pedicleCalibrationRaw as string)
  } catch { /* ignore */ }
}
```

Pass to `resolveCalibration`.

---

### Task 5 — Wire into `lib/scoring/calibration-resolver.ts`

Add pedicle calibration as priority 3 (after LiDAR and ArUco, before
ring/hat reference objects):

```ts
// Priority 3: User-placed pedicle calibration dots
if (pedicleCalibration?.pixelsPerInch &&
    pedicleCalibration.confidence > 0.5) {
  sources.push({
    pixelsPerInch: pedicleCalibration.pixelsPerInch,
    source: pedicleCalibration.source,
    confidence: pedicleCalibration.confidence,
  })
}
```

**Updated full calibration hierarchy:**

| Priority | Source | Confidence | Notes |
|---|---|---|---|
| 1 | LiDAR depth + EXIF | 0.85–0.90 | iPhone Pro auto |
| 2 | ArUco marker | 0.55–0.72 | Printed marker |
| 3 | **Pedicle dots (known spacing)** | 0.85 | User measured skull |
| 4 | **Pedicle dots (anatomical prior)** | 0.68 | User placed, avg spacing |
| 5 | Ruler (Advanced Scoring) | 0.95 | Physical reference |
| 6 | Ring / hat | 0.40–0.45 | Estimated only |
| 7 | Anatomical priors (AI-estimated) | 0.50–0.65 | No user input |
| 8 | Vanishing point | 0.30–0.55 | Background lines |
| — | None | 0.25 | Pure AI guess |

---

### Task 6 — Add to vision prompt

In `lib/scoring/vision-scorer.ts`, if pedicle calibration is present:

```ts
const pedicleBlock = pedicleCalibration
  ? `
PEDICLE CALIBRATION (user-confirmed)
- The user dragged calibration markers to the left and right pedicle
  bases in the image.
- Left pedicle: (${(pedicleCalibration.leftDot.x * 100).toFixed(1)}%,
                 ${(pedicleCalibration.leftDot.y * 100).toFixed(1)}%) of image
- Right pedicle: (${(pedicleCalibration.rightDot.x * 100).toFixed(1)}%,
                  ${(pedicleCalibration.rightDot.y * 100).toFixed(1)}%) of image
- Pedicle spacing: ${pedicleCalibration.knownSpacingInches ?? '4.5 (anatomical average)'} inches
- Computed scale: ${pedicleCalibration.pixelsPerInch.toFixed(1)} px/in
- Confidence: ${(pedicleCalibration.confidence * 100).toFixed(0)}%
- Use this as a confirmed scale reference. The pedicle positions
  also tell you exactly where the skull plate is in the image.
`
  : ''
```

The pedicle positions themselves are valuable beyond calibration —
they tell the AI exactly where to anchor its beam measurement
starting points.

---

### Task 7 — Migration

```sql
ALTER TABLE public.predictions
  ADD COLUMN IF NOT EXISTS pedicle_calibration_metadata JSONB;
```

Store the full `PedicleCalibrationResult` in the prediction.

Over time this data answers:
- How often do users use the calibration dots?
- Does user-placed pedicle calibration outperform AI-estimated?
- What is the average pedicle spacing in the dataset?
  (Real-world measurement data that improves anatomical priors)

---

### Task 8 — Scoring results indicator

In `components/scoring/scoring-results.tsx`:

```
┌──────────────────────────────────────────┐
│ 📍 Pedicle Calibration Applied           │
│                                          │
│ Spacing: {knownIn ?? '4.5" (average)"}  │
│ Scale: {ppi} px/in                      │
│ Confidence: {conf}%                     │
│                                          │
│ {knownIn ? 'Known spacing used.' :       │
│  'Average spacing used. Measure skull   │
│   plate for higher accuracy.'}           │
└──────────────────────────────────────────┘
```

---

## Validation checklist

```bash
pnpm exec tsc --noEmit
pnpm build
```

Manual:

1. Upload a front-facing rack photo → calibration dots step appears
2. Two amber dots visible with connecting line and distance badge
3. Drag left dot to left burr base → dot follows pointer/touch smoothly
4. Drag right dot to right burr base → distance updates live
5. Enter known pedicle spacing (e.g., 4.75") → confidence note updates
6. Tap "Confirm" → `pedicle_calibration` in FormData payload
7. Scoring result shows pedicle calibration indicator
8. Tap "Skip" → no pedicle calibration in payload, scoring works normally
9. Select ArUco marker in scoring options → calibration dots step is
   skipped (higher-confidence source already selected)
10. LiDAR detected automatically → calibration dots step skipped

---

## Files

**New:**
- `components/scoring/calibration-dots.tsx`
- `supabase/migrations/YYYYMMDD_pedicle_calibration.sql`

**Modified:**
- `components/scoring/scoring-wizard.tsx` — add step 3
- `app/api/score/route.ts` — parse pedicle calibration
- `lib/scoring/calibration-resolver.ts` — add source
- `lib/scoring/vision-scorer.ts` — add pedicle block
- `components/scoring/scoring-results.tsx` — add indicator
- `lib/types.ts` — add source types to calibration union

**Not touched:**
- Advanced Scoring
- Verified Score rules
- Any existing reference object handling
- Camera capture flow (dots work on uploaded photos initially;
  live camera preview integration is a future enhancement)
