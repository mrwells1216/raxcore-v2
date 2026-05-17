# Claude Code Plan — Deer Eye Circle Detection (Anatomical Calibration)

> Read `CLAUDE.md` first. This upgrades the existing eye-box
> anatomical prior from a bounding box estimate to a precise circle
> measurement. The change is in the landmark prompt (4 lines) and
> the calibration geometry (10 lines). Zero new dependencies.
> Zero new API calls — piggybacks on the existing landmark detection.

---

## Mission

The existing landmark detection prompt asks for `eye_left` and
`eye_right` as point coordinates (center of the eye). This plan
upgrades those landmarks to return the **eye circle** — center
coordinates AND radius in pixels. The deer eye globe is a known
physical size (~0.75 inches radius). Radius in pixels divided by
0.75 gives `pixelsPerInch`.

This is the eye-version of the "red-eye reference" idea: the eye
itself is a known-size sphere that appears as a known-size circle
in any photo where it is visible. Unlike red-eye (which requires
flash + specific conditions), the deer eye is visible in almost
every well-lit harvest, mount, or field photo.

---

## The physics

A whitetail deer eye globe (eyeball) has a well-documented size:
- **Transverse diameter**: ~38mm (~1.50 inches)
- **Visible iris diameter**: ~28mm (~1.10 inches, the part you see)
- **Apparent radius at photo plane**: varies with angle

The **visible portion of the eye** (the dark iris + pupil circle
visible in a photo) averages approximately:
- Front-facing: `radius ≈ 0.55 inches`
- Side-facing: appears elliptical, use semi-major axis ≈ `0.65 inches`

These values are tighter than the eye-BOX estimate (which includes
eyelid and surrounding fur) and give a cleaner calibration signal.

**Key insight**: The eye circle is a natural, always-present
reference that requires nothing special from the user. Every well-lit
rack photo with the deer's face visible contains this information.

---

## Why this is better than the current eye-box approach

Current approach: AI returns `eye_left` as a point (center).
The existing calibration uses `EYE_BOX_WIDTH` (the distance between
the two eye centers, ~5.5 inches) as a reference.

New approach: AI returns `eye_left` as circle (center + radius).
We use the **radius of a single eye** as a reference.

The radius approach is better because:
- Single eye measurement vs. distance between two eyes
- The inter-eye distance varies more across deer than individual eye size
- A circle fit to the visible iris is more precise than a box
- Works even in partial-face photos where only one eye is visible

---

## Ground rules

1. **Additive.** This upgrades existing `eye_left`/`eye_right`
   landmarks. It does not break anything if the radius is not
   returned — the fallback is the existing point-only behavior.
2. **Falls back gracefully.** If the AI returns point but not radius,
   the existing eye-box calibration still runs.
3. **No new API call.** The eye circle request is appended to the
   existing landmark detection prompt.
4. **Ellipse handling.** If the eye appears elliptical (side profile),
   use the semi-major axis (longer radius) as the reference.
   Reduce confidence by 0.10 for elliptical detections.

---

## Tasks

### Task 1 — Update `lib/scoring/landmark-detection.ts`

Extend the `LandmarkDetection` type to include optional circle data:

```ts
export interface LandmarkDetection {
  id:           AntlerLandmarkId
  px:           number | null
  py:           number | null
  confidence:   number
  visibility:   'clear' | 'partially_visible' | 'occluded' | 'not_visible'
  sourceAngle:  'front' | 'left' | 'right' | 'unknown'
  source:       'ai' | 'human'

  // ── NEW: circle data for eye landmarks ──────────────────────────────
  /**
   * Radius in pixels of the visible iris circle.
   * Only populated for eye_left and eye_right landmarks.
   * null if the radius could not be estimated.
   */
  radiusPx?:    number | null
  /**
   * If the eye appears elliptical (side profile), the longer radius.
   * Same as radiusPx if the eye appears circular (front-facing).
   */
  radiusMajorPx?: number | null
  /** True if the eye appears elliptical (side profile) */
  isElliptical?: boolean
}
```

This is a purely additive change — existing code that reads
`LandmarkDetection` objects ignores unknown fields.

---

### Task 2 — Update `lib/scoring/landmark-prompt.ts`

Find the section that defines the skull reference landmarks
(`eye_left`, `eye_right`). Replace the existing eye landmark
description with:

```ts
// Replace the existing eye landmark descriptions:
const eyeLandmarkBlock = `
SKULL REFERENCES — EYES (upgraded for circle detection):

For eye_left and eye_right, return:
  - px, py: center of the visible iris (same as before)
  - radiusPx: radius of the visible iris circle in pixels
              (the dark circular area of the eye, not including
               the white sclera or eyelid)
  - radiusMajorPx: if the eye appears elliptical (side-profile view),
                   the LONGER radius; same as radiusPx if circular
  - isElliptical: true if the eye appears as an ellipse rather
                  than a circle (indicates side profile angle)

Important:
  - Measure the IRIS (dark part), not the whole eye socket
  - For front-facing photos: the iris appears circular
  - For side-facing photos: the iris appears elliptical
  - If the eye is not clearly visible, set radiusPx: null
  - Be conservative — it is better to return null than to guess
    a radius on a partially-visible or blurry eye

Example (front-facing, eye clearly visible):
  { "id": "eye_left", "px": 412, "py": 380, "radiusPx": 24,
    "radiusMajorPx": 24, "isElliptical": false,
    "confidence": 0.88, "visibility": "clear" }

Example (side-facing, elliptical):
  { "id": "eye_right", "px": 890, "py": 445, "radiusPx": 18,
    "radiusMajorPx": 31, "isElliptical": true,
    "confidence": 0.72, "visibility": "partially_visible" }
`
```

---

### Task 3 — New geometry helper in `lib/scoring/landmark-geometry.ts`

Add a function to compute calibration from eye circle measurements:

```ts
/** Known deer eye iris physical dimensions */
const DEER_EYE_IRIS = {
  /** Apparent radius when viewed front-on (inches) */
  frontRadiusInches:  0.55,
  /** Semi-major axis when viewed from side (inches) */
  sideRadiusInches:   0.65,
  /** Minimum plausible radius in pixels to trust detection */
  minRadiusPx:        8,
  /** Maximum plausible radius (very close shot) */
  maxRadiusPx:        200,
}

export interface EyeCircleCalibrationResult {
  pixelsPerInch:   number
  eyeUsed:         'eye_left' | 'eye_right' | 'average'
  radiusPxUsed:    number
  referenceInches: number
  confidence:      number
  isElliptical:    boolean
  warnings:        string[]
}

/**
 * Compute pixelsPerInch from detected eye circle landmark(s).
 *
 * Uses the longer radius (radiusMajorPx) for elliptical eyes,
 * radiusPx for circular eyes.
 *
 * If both eyes detected and radii agree within 15%, average them.
 * If they disagree by more than 15%, use the higher-confidence one.
 *
 * Returns null if:
 *   - No eye landmarks have radius data
 *   - Radius is below minimum plausible threshold
 *   - Confidence of the eye landmark is < 0.5
 */
export function computeCalibrationFromEyeCircle(
  landmarks: LandmarkDetection[],
): EyeCircleCalibrationResult | null {

  const eyes = landmarks.filter(
    l => (l.id === 'eye_left' || l.id === 'eye_right') &&
         l.visibility !== 'not_visible' &&
         l.confidence >= 0.5 &&
         l.radiusPx != null &&
         l.radiusPx >= DEER_EYE_IRIS.minRadiusPx &&
         l.radiusPx <= DEER_EYE_IRIS.maxRadiusPx
  )

  if (eyes.length === 0) return null

  const warnings: string[] = []

  // Compute ppi for each eye
  const perEye = eyes.map(eye => {
    const r = eye.isElliptical ? (eye.radiusMajorPx ?? eye.radiusPx!) : eye.radiusPx!
    const refIn = eye.isElliptical
      ? DEER_EYE_IRIS.sideRadiusInches
      : DEER_EYE_IRIS.frontRadiusInches
    return {
      id:         eye.id as 'eye_left' | 'eye_right',
      ppi:        r / refIn,
      radiusPx:   r,
      refIn,
      confidence: eye.confidence * (eye.isElliptical ? 0.85 : 1.0),
      elliptical: eye.isElliptical ?? false,
    }
  })

  if (perEye.length === 2) {
    const delta = Math.abs(perEye[0].ppi - perEye[1].ppi) / perEye[0].ppi
    if (delta > 0.15) {
      warnings.push(
        `Left and right eye radii differ by ${(delta * 100).toFixed(0)}% — ` +
        `using higher-confidence eye only`
      )
      const best = perEye.sort((a, b) => b.confidence - a.confidence)[0]
      return {
        pixelsPerInch:   best.ppi,
        eyeUsed:         best.id,
        radiusPxUsed:    best.radiusPx,
        referenceInches: best.refIn,
        confidence:      best.confidence * 0.90,
        isElliptical:    best.elliptical,
        warnings,
      }
    } else {
      // Both eyes agree — average them
      const avgPpi      = (perEye[0].ppi + perEye[1].ppi) / 2
      const avgConf     = (perEye[0].confidence + perEye[1].confidence) / 2
      const avgRadiusPx = (perEye[0].radiusPx + perEye[1].radiusPx) / 2
      return {
        pixelsPerInch:   avgPpi,
        eyeUsed:         'average',
        radiusPxUsed:    avgRadiusPx,
        referenceInches: (perEye[0].refIn + perEye[1].refIn) / 2,
        confidence:      Math.min(0.72, avgConf * 1.05), // slight boost for agreement
        isElliptical:    perEye.some(e => e.elliptical),
        warnings,
      }
    }
  }

  // Single eye
  const e = perEye[0]
  if (e.elliptical) {
    warnings.push('Eye appears elliptical (side profile) — reduced confidence')
  }
  return {
    pixelsPerInch:   e.ppi,
    eyeUsed:         e.id,
    radiusPxUsed:    e.radiusPx,
    referenceInches: e.refIn,
    confidence:      e.confidence,
    isElliptical:    e.elliptical,
    warnings,
  }
}
```

---

### Task 4 — Wire into `lib/scoring/calibration-resolver.ts`

The eye circle result is computed from the same landmark detection
pass that already runs. Wire it as a source:

```ts
// After anatomical eye-box check, before vanishing point:
const eyeCircleResult = computeCalibrationFromEyeCircle(landmarks)

if (eyeCircleResult && eyeCircleResult.confidence > 0.45) {
  sources.push({
    pixelsPerInch: eyeCircleResult.pixelsPerInch,
    source:        'eye_circle_anatomical',
    confidence:    eyeCircleResult.confidence,
  })

  // Also add to confidence explanation
  if (eyeCircleResult.warnings.length > 0) {
    warnings.push(...eyeCircleResult.warnings)
  }
}
```

**Updated calibration hierarchy (full stack):**

| Priority | Source | Confidence |
|---|---|---|
| 1 | LiDAR depth + EXIF | 0.85–0.90 |
| 2 | ArUco marker | 0.55–0.72 |
| 3 | Pedicle dots (known spacing) | 0.85 |
| 4 | Pedicle dots (anatomical) | 0.68 |
| 5 | Ruler (Advanced Scoring) | 0.95 |
| 6 | **Eye circle (both eyes agree)** | 0.72 |
| 7 | **Eye circle (single eye)** | 0.50–0.65 |
| 8 | Eye box (existing AI estimate) | 0.50–0.65 |
| 9 | Ring / hat | 0.40–0.45 |
| 10 | Vanishing point | 0.30–0.55 |
| — | None | 0.25 |

---

### Task 5 — Update AI vision prompt note

In `lib/scoring/vision-scorer.ts`, when eye circle calibration is
available:

```ts
const eyeCircleBlock = eyeCircleResult
  ? `
EYE CIRCLE CALIBRATION
- Deer iris detected: ${eyeCircleResult.eyeUsed}
- Iris radius in image: ${eyeCircleResult.radiusPxUsed.toFixed(1)} pixels
- Physical reference: ${eyeCircleResult.referenceInches}" radius
  (${eyeCircleResult.isElliptical ? 'elliptical/side view' : 'circular/front view'})
- Computed scale: ${eyeCircleResult.pixelsPerInch.toFixed(1)} px/in
- Confidence: ${(eyeCircleResult.confidence * 100).toFixed(0)}%
${eyeCircleResult.warnings.map(w => `- Note: ${w}`).join('\n')}
`
  : ''
```

---

### Task 6 — No migration needed

Eye circle data is stored inside the existing
`landmark_detection_metadata` JSONB column (or the prediction's
JSON metadata). No new column required — the data is part of the
landmark detection result that is already persisted.

Update the `LandmarkDetection` type (Task 1) ensures the extended
fields are included when the landmark array is serialized.

---

## Validation checklist

```bash
pnpm exec tsc --noEmit
pnpm build
```

Manual:

1. Score a front-facing rack photo where both eyes are visible →
   landmark detection returns `eye_left` and `eye_right` with
   `radiusPx` values
2. Check `calibration-resolver.ts` picks up the eye circle as a
   source when no higher-priority source is available
3. Score a side-facing photo where one eye is elliptical →
   `isElliptical: true`, reduced confidence, warning in explanation
4. Score a photo where eyes are not visible or occluded →
   `radiusPx: null`, eye circle calibration skipped, falls back
   to eye-box prior
5. Both eyes detected and agree within 15% → confidence slightly
   boosted, `eyeUsed: 'average'`
6. Both eyes detected but disagree >15% → warning, lower confidence,
   better eye used
7. Existing scoring flow unchanged when no eye circle data returned
8. No second API call — eye radius is returned in the same landmark
   detection call that already runs

---

## Files

**New:**
- None (all changes are additions to existing files)

**Modified:**
- `lib/scoring/landmark-detection.ts` — add `radiusPx`, `radiusMajorPx`,
  `isElliptical` to `LandmarkDetection` type
- `lib/scoring/landmark-prompt.ts` — upgrade eye landmark description
- `lib/scoring/landmark-geometry.ts` — add `computeCalibrationFromEyeCircle`
- `lib/scoring/calibration-resolver.ts` — add eye circle source
- `lib/scoring/vision-scorer.ts` — add eye circle prompt block

**Not touched:**
- Any component files
- API route files
- Database migrations
- Verified Score rules
- Advanced Scoring

---

## What makes this special

This feature requires nothing from the user. No printed marker. No
reference object. No extra step. Every photo with a visible deer face
contains eye circles. The calibration happens automatically from data
the landmark detector was already finding.

The red-eye analogy holds: just as red-eye used the retina as a
known reference (though unreliable), we use the iris as a known
reference — but reliably, because deer iris size is well-documented
in veterinary literature and we are detecting it rather than waiting
for a flash artifact.

Combined with the pedicle calibration dots and LiDAR, RAX CORE now
has four independent automatic calibration signals that can
cross-validate each other. No other antler scoring app has any of
this.
