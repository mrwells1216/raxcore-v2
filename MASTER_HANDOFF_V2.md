# RAX CORE — Master Build Handoff v2

> Drop this file + CLAUDE.md into the repo root before starting Claude Code.
> Read CLAUDE.md first on every session. This document tells you the order.
> Always commit to `main`. Never create feature branches. One work item at a time.

---

## What is already shipped

These are DONE. Do not rebuild them.

| PR | What shipped |
|---|---|
| #14 | Truthful camera capture — no auto-capture, optical-only validation |
| #17 | Ring reference in Precision Mode |
| #18 | AI Learning Flywheel WI-1 through WI-6 — supervision hooks, correction_events, prompt bias, QStash |
| #19/#20 | Hat reference + Trophy Room — watermarks, eligibility, gallery, soft delete |
| #21 | LiDAR depth extraction + landmark pixel detection + calibration resolver |
| #22 | QStash migration + main-frame chip grid + Precision Mode UX |
| #23 | Leaflet elevation map — satellite, topo, hillshade, USGS elevation, deer terrain zones |

---

## The 8 pending work items

Ordered by priority. Each is independently shippable. Propose a plan, wait for approval, execute, validate, then stop and report before starting the next.

---

### ITEM 1 — Antler Crop Box
**Plan file**: `CROP_BOX_PLAN.md`
**Priority**: Highest — biggest single accuracy improvement available
**Build time**: 2 days
**What it does**: After upload, user draws a box around the antlers. Server crops with 12% padding before sending to OpenAI. AI gets 4–8× more detail. Original photo always preserved for display.

**Key constraint**: Crop is always optional. "Skip" proceeds with original. Never block scoring.

**Files**:
- New: `components/scoring/antler-crop-box.tsx`, `lib/scoring/crop-image.ts`, migration
- Modified: `scoring-wizard.tsx` (new step 2), `app/api/score/route.ts` (parse + apply crop), `vision-scorer.ts` (crop note in prompt)

**Gate**: Cropped image goes to OpenAI, original shown in UI. Prediction record has `crop_box_metadata`. Skip works cleanly.

---

### ITEM 2 — ArUco Marker Full Detection
**Plan file**: `ARUCO_MARKER_PLAN.md`
**Priority**: High — completes a half-built feature, highest auto-calibration for non-LiDAR phones
**Build time**: 1.5 days
**What it does**: The `aruco_marker` option already exists in `reference_type` but does nothing. This wires GPT-4o detection behind it. User prints a free marker at arucogen.com, places it near rack, uploads photo. Corner detection → exact pixelsPerInch (confidence 0.55–0.72).

**Key constraint**: GPT-4o vision detection only (no OpenCV WASM — bundle too large). Fallback gracefully if not detected.

**Files**:
- New: `lib/scoring/aruco-types.ts`, `lib/calibration/aruco-detector.ts`, migration
- Modified: `scoring-form.tsx` (marker size input), `score/route.ts`, `calibration-resolver.ts`, `vision-scorer.ts`, `scoring-results.tsx`

**Gate**: Photo with ArUco → `aruco_detection_metadata.detected: true` in prediction. Photo without ArUco → falls back to next source. Scoring works either way.

---

### ITEM 3 — Eye Circle Calibration
**Plan file**: `EYE_CIRCLE_CALIBRATION_PLAN.md`
**Priority**: High — zero user effort, zero extra API calls, meaningful accuracy improvement
**Build time**: 1 day
**What it does**: Upgrades the existing landmark prompt to return eye iris radius in pixels. Deer iris apparent radius is a known anatomical reference (~0.55" front-facing). Both eyes agreeing boosts confidence to 0.72. Single eye = 0.50–0.65.

**Key constraint**: This is a prompt addition to the existing landmark detection call. No second API call. No new files required.

**Files**:
- Modified only: `landmark-detection.ts` (add `radiusPx`, `radiusMajorPx`, `isElliptical` to type), `landmark-prompt.ts` (upgrade eye description), `landmark-geometry.ts` (add `computeCalibrationFromEyeCircle`), `calibration-resolver.ts` (add source), `vision-scorer.ts` (add eye circle block)

**Gate**: Front-facing photo with visible eyes → `eye_circle_anatomical` in calibration resolver. Photo without visible eyes → falls back. No regression in scoring.

---

### ITEM 4 — AR Calibration Dots (Pedicle Drag)
**Plan file**: `AR_CALIBRATION_DOTS_PLAN.md`
**Priority**: High — intuitive, no physical object needed, signature feature
**Build time**: 2 days
**What it does**: Two draggable amber dots overlaid on the photo after upload. User drags them to each antler burr base. Pixel distance ÷ average pedicle spacing (4.5") = pixelsPerInch. Optional: user enters known spacing from skull plate measurement → confidence jumps from 0.68 to 0.85.

**Key constraint**: Always skippable in one tap. Step only appears when no higher-confidence source (LiDAR, ArUco) already detected.

**Files**:
- New: `components/scoring/calibration-dots.tsx`, migration
- Modified: `scoring-wizard.tsx` (new optional step 3), `score/route.ts`, `calibration-resolver.ts`, `vision-scorer.ts`, `scoring-results.tsx`

**Gate**: Two dots placed and confirmed → `pedicle_calibration_metadata` in prediction. Skip → no metadata, falls back. Pedicle positions appear in vision prompt when provided.

---

### ITEM 5 — Circumference Taper Assist
**Plan file**: Inline spec below (§9 of this document)
**Priority**: High — single biggest impact on circumference accuracy, 60 seconds of user effort
**Build time**: 1.5 days
**What it does**: Post-score card asks the user to wrap a tape measure around the main beam just above the burr and enter H1 left. Derives H2–H4 and right-side estimates via published whitetail taper ratios. Tags derived values as `source: 'derived_taper'` (not measured). Gross score updates with "Refined" badge.

**Key constraint**: Derived values are NEVER labeled measured. Always show the derivation source in the UI. The taper ratios are approximate — label confidence accordingly (H2 0.72, H3 0.65, H4 0.58).

**Files**:
- New: `lib/scoring/circumference-taper.ts`, `app/api/scoring/refine-circumference/route.ts`
- Modified: `components/scoring/scoring-results.tsx` (post-score card)

**Gate**: Enter H1 → gross score updates → prediction updated → all derived fields tagged `derived_taper`. Skip → no change to existing score.

---

### ITEM 6 — Sub-Pixel Edge Refinement
**Plan file**: `SUBPIXEL_REFINEMENT_PLAN.md`
**Priority**: Medium — surgical, 1 day, no new packages, 10× precision improvement in Advanced Scoring
**Build time**: 1 day
**What it does**: When user places a measurement point in the Advanced Scoring photo canvas, analyzes the 9×9 pixel neighborhood via Sobel gradient + Gaussian fitting to find the true edge position at sub-pixel precision. Points land on the actual edge, not wherever the user's finger happened to land within ±0.5px.

**Key constraint**: Maximum refinement distance 8 pixels. If no strong edge found, use raw coordinate. Transparent to user — no UI change.

**Files**:
- New: `lib/measure/subpixel-refine.ts`
- Modified: `components/measure/photo-canvas.tsx` (wrap point recording), `measure-store.ts` (add optional `subpixelRefined` field to point type)

**Gate**: Place a point on a tine edge → stored coordinate is fractional (e.g. x: 412.37). Place a point in a low-contrast area → raw coordinate used. No visible UI change. No performance regression.

---

### ITEM 7 — Vanishing Point Perspective Calibration
**Plan file**: `VANISHING_POINT_PLAN.md`
**Priority**: Medium — free cross-check signal, catches bad perspective shots
**Build time**: 1.5 days
**What it does**: Appends a parallel-features request to the existing landmark detection prompt (no extra API call). When background parallel lines are visible (fence, truck, barn), computes vanishing point + camera tilt + pixelsPerInch from spacing. Primary value: if it disagrees with other calibration by >35%, warns user that perspective is unusual.

**Key constraint**: Lowest-priority calibration source. Its primary role is conflict detection, not primary calibration. Confidence capped at 0.55.

**Files**:
- New: `lib/scoring/vanishing-point-types.ts`, `lib/scoring/vanishing-point-geometry.ts`, migration
- Modified: `landmark-prompt.ts`, `calibration-resolver.ts`, `ai-service.ts`, `lib/types.ts`

**Gate**: Photo with fence in background → `vanishing_point_metadata` populated. Disagreement >35% → warning in confidence explanation. Photo with no parallel lines → empty array, no vanishing point, no regression.

---

### ITEM 8 — Admin Gold Standard (Full Build)
**Plan file**: `AI_LEARNING_PLAN.md` §WI-3
**Priority**: Strategic — competitive moat, data flywheel foundation
**Build time**: 3–4 days
**What it does**: Expands `app/admin/training-import` from free-form JSON paste to a full B&C/P&Y field-by-field form: scoring system picker, per-image type tagging, official measurement entry, AI vs official comparison table, "promote to benchmark pack" workflow. Each official sheet is a perfect ground truth example.

**Key constraint**: Admin only (403 for non-admin). Old JSON paste still accepted for backward compat. Disclaimer copy from `score-pdf-builder.ts` must appear on the form.

**Files**:
- New: `components/admin/official-vs-ai-table.tsx`, `api/admin/training-import/[id]/run-ai/route.ts`, `api/admin/training-import/[id]/promote/route.ts`, `app/admin/training-import/[id]/page.tsx`
- Modified: `app/admin/training-import/page.tsx`, `api/admin/training-import/route.ts`, `components/admin/training-import-form.tsx`

**Gate**: Admin enters B&C sheet + 6 images in <3 min. "Run AI" produces comparison table. Promote sets `is_benchmark: true` and adds to benchmark pack. Non-admin gets 403.

---

## Execution order for Claude Code

Give Claude Code this opening prompt at the start of each session:

```
Read CLAUDE.md at the repo root. Then read MASTER_HANDOFF_V2.md.

The following are already shipped and must not be rebuilt:
PR #14 (capture), #17 (ring ref), #18 (AI flywheel + QStash),
#19/#20 (hat + Trophy Room), #21 (LiDAR + landmarks), #22 (form UX), 
#23 (elevation map).

Start with ITEM [N] from MASTER_HANDOFF_V2.md.
Read the plan file first. Propose your approach. Wait for approval.
After executing, run: pnpm exec tsc --noEmit && pnpm build
Report results using the format in §10 of this document.
Stop and wait for me before starting the next item.
Always commit to main. Never create feature branches.
```

---

## Validation gates between items

### After Items 1–2 (Crop Box + ArUco)
- Upload a photo → crop step appears → draw box → submission uses cropped image
- Upload photo with ArUco marker → `detected: true` in metadata → calibration indicator shown
- Upload photo without ArUco → falls back to next source → no error

### After Items 3–4 (Eye Circle + Pedicle Dots)
- Front-facing photo → eye circle detected → `eye_circle_anatomical` in resolver
- Pedicle dots placed → pedicle metadata in prediction → vision prompt includes positions
- LiDAR photo → LiDAR still wins (higher priority than eye circle or pedicle dots)

### After Item 5 (Circumference Taper)
- Enter H1 → derived H2–H4 all labeled `derived_taper`
- Score updates with "Refined" badge
- Derived values never labeled `measured`
- Skip → no change

### After Item 6 (Sub-pixel)
- Measurement point on clear edge → fractional coordinates stored
- Measurement point on flat area → raw coordinate, no refinement
- No UI change visible to user

### After Item 7 (Vanishing Point)
- Photo with fence → vanishing point metadata populated
- Disagreement >35% → warning in confidence explanation
- No parallel lines → empty, no regression

### After Item 8 (Admin Gold Standard)
- Full sheet entry in <3 min
- AI comparison table renders
- Promote works
- Non-admin: 403
- Build: `pnpm exec tsc --noEmit && pnpm build` clean

---

## Reporting format (after every item)

```
## ITEM [N] — [Name] — DONE

### Files created
- path/to/file.ts  (purpose, ~N lines)

### Files modified
- path/to/file.ts  (what changed)

### Validation
- tsc:   PASS | FAIL (details)
- build: PASS | FAIL (details)
- Manual checks:
  - [✓] Check description
  - [✗] Check description (what went wrong, how fixed)

### Issues encountered
- ...

### Ready for next item?
YES | BLOCKED (reason)
```

---

## §9 — Circumference Taper Assist (full inline spec)

Since this plan has no separate file, the full spec is here.

### `lib/scoring/circumference-taper.ts` (NEW)

```ts
// Published B&C circumference taper ratios for typical whitetail.
// H1 is reference (1.0). H2 is widest, H4 tapers toward tip.
export const WHITETAIL_TAPER_RATIOS = {
  h1: 1.000,
  h2: 1.150,
  h3: 1.045,
  h4: 0.895,
} as const

// Confidence when deriving from H1 anchor
export const TAPER_CONFIDENCE_FROM_H1 = {
  h1: 1.00,   // exact — user measured
  h2: 0.72,   // 1 step from anchor
  h3: 0.65,   // 2 steps
  h4: 0.58,   // 3 steps — most uncertainty
}

// Symmetry: right side estimated from left at 97–103% ratio (avg 1.00)
export const DEFAULT_SYMMETRY_RATIO = 1.00

// Validation ranges for user-entered circumferences (inches)
export const CIRCUMFERENCE_PLAUSIBLE_RANGE = { min: 2.5, max: 8.0 }
export const H1_TYPICAL_RANGE = { min: 3.0, max: 6.5 }

export function deriveCircumferencesFromH1(h1LeftInches: number, h1RightInches?: number)
// Returns all 8 H-fields with value, source, and confidence

export function deriveCircumferencesFromH1H2(h1LeftInches: number, h2LeftInches: number)
// Fits exponential curve through two anchors, extrapolates H3/H4

export function validateCircumferenceEntry(
  field: 'h1' | 'h2' | 'h3' | 'h4',
  valueInches: number,
  otherKnownValues?: Partial<Record<'h1' | 'h2' | 'h3' | 'h4', number>>
): string | null
// Returns warning string if implausible, null if ok
// E.g.: "H1 should be the smallest circumference — did you measure at the right location?"
```

### `/api/scoring/refine-circumference/route.ts` (NEW)

POST endpoint. Accepts `{ predictionId, buckId, h1LeftInches, h1RightInches?, h2LeftInches? }`.
Validates the values. Derives all H-fields via `circumference-taper.ts`. Re-runs gross/net calculation. Updates the prediction record. Returns the updated score.

### `components/scoring/scoring-results.tsx` (MODIFIED)

After the score display, add a "Improve circumference accuracy" card:

```
┌──────────────────────────────────────────────────┐
│ 📏 Refine circumference measurements             │
│                                                  │
│ Wrap a soft tape around the main beam just      │
│ above the burr (H1 — thickest part of beam).    │
│                                                  │
│ Left beam H1: [_______] inches                  │
│                                                  │
│ Even one measurement improves all 8 H-fields.   │
│ Derived values are labeled as estimated.         │
│                                                  │
│ [ Refine score ]    [ Skip ]                    │
└──────────────────────────────────────────────────┘
```

Only show this card when:
- `confidence_tier` is not already `'very_high'`
- The prediction does not already have user-measured H-fields
- The score has at least one circumference field estimated by AI

When "Refine score" is clicked:
- Validate the input (show inline error if implausible)
- POST to `/api/scoring/refine-circumference`
- Show updated gross/net with a "📏 Refined" amber badge
- Replace the card with a summary: "H1–H4 refined from your measurement"

---

## §10 — Out of scope (do not start without explicit approval)

- Model fine-tuning (collect data first)
- Laser dot reference hardware integration
- Video frame scoring
- 3D terrain rendering (no DEM source chosen)
- Cross-user federated learning
- Switching AI providers (Anthropic/Gemini are ensemble additions, not replacements)
- `react-leaflet` installation
- Modifying `cross-validation.ts` Verified Score rules
- Removing `dpad_adjustment_records` table

---

## §11 — The accuracy picture

Honest projections with the full plan complete:

| Scenario | Expected gross accuracy |
|---|---|
| One photo, no calibration | ±10–15% |
| One photo + LiDAR auto | ±5–8% |
| Photo + LiDAR + crop box + eye circle | ±3–5% |
| Multi-signal + pedicle dots + H1 measured | ±1.5–3% |
| Advanced Scoring (Verified) | ±0.8–2% |

At 1,000 verified bucks in the training dataset, middle tiers improve by ~30%. Fine-tuning a specialist keypoint model becomes viable. Regional anatomical priors become meaningful.

The moat is not the accuracy number — it's the provenance. When RAX CORE shows "this measurement came from your LiDAR depth data, cross-validated by eye circle detection, pedicle calibration confirmed" — no competitor can say that.
