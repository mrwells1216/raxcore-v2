# CLAUDE.md — RAX CORE v2

> This file is read first by Claude Code in plan mode. Treat it as authoritative.
> If anything here conflicts with the handoff document, the handoff document wins
> on intent; this file wins on what actually exists in the code today.
> Always commit directly to `main`. Never create feature branches.

---

## 1. Mission

Build the most accurate deer antler scoring app on the market.

- Accuracy first, gimmicks never.
- Measurement truth over visual flash.
- Confidence honesty over fake certainty.
- Correction workflow over black-box AI.
- Graph-native structure over loose JSON.
- Inferred is labeled inferred. Estimated is labeled estimated. Missing is labeled missing. Unverified is labeled unverified.

If a feature looks impressive but does not improve measurement truth, do not ship it. Label it, or remove it.

---

## 2. Stack

- **Framework**: Next.js 16 (App Router), React 19.2, TypeScript 5.7, Tailwind 4
- **Auth + DB + Storage**: Supabase (`@supabase/ssr`, `@supabase/supabase-js`)
- **AI**: OpenAI vision via `@ai-sdk/openai` + `ai` v6, plus a custom `detectRackWithOpenAI` admission layer. Anthropic + Gemini keys are env-ready for future ensemble scoring but not yet wired.
- **2D measurement**: Konva 10 + react-konva 19
- **3D**: `three@^0.177`, `@react-three/fiber@9.5`, `@react-three/drei@10.7`
  - React 19 compatible. The earlier `ReactSharedInternals.ReactCurrentOwner` crash from R3F v8 is resolved. **Do not downgrade these.**
- **State**: Zustand v5 (`components/measure/measure-store.ts`)
- **Jobs**: QStash (Upstash) — replaces Vercel cron. Routes: `/api/jobs/scheduler` (every minute), `/api/jobs/worker` (every 5 min). `vercel.json` crons block is REMOVED.
- **Maps**: Leaflet (imperative, dynamically imported — NOT react-leaflet). Full satellite + hillshade + elevation layers. `react-simple-maps` is installed but unused.
- **PDF**: jspdf, html2canvas
- **Billing**: Stripe
- **Reconstruction**: Luma AI (server-side only via `lib/reconstruction/luma-adapter.ts`); manual upload fallback always available
- **Image processing**: `sharp` (installed) — Trophy Room watermarks, HEIC depth extraction

`next.config.mjs`, `tsconfig.json`, and `proxy.ts` are intentionally permissive. Do not touch without a clear reason.

---

## 3. What is shipped (do not rebuild)

### 3.1. Truthful guided manual capture ✓ (PR #14)
- `lib/capture/scan-session.ts` — `analyseFrame` does optical-quality only. `hasDeer` / `hasRack` are hard-coded `false`. `shouldAutoCaptureFrame` is kept for backcompat but never called.
- `components/scanning/scan-mode-panel.tsx` — no auto-capture, no stableCount, no fake percent. RAF loop only updates optical validation. Capture fires only on `handleManualCapture`.
- `lib/scoring/resolve-image-roles.ts` — resolves angle fields to `'front' | 'left' | 'right' | 'unknown'` with claim-once backfill. Used twice in `scoring-wizard.tsx` so `selected_image_angles` is never `[null, null, null]`.

**Do not** reintroduce auto-capture, fake percentage, or live rack detection.

### 3.2. Detection-gated quick scoring ✓ (PR #14)
`POST /api/score` flow:
1. Rate-limit + billing
2. Upload images → Supabase
3. `detectRackWithOpenAI` — 422 with `errorType: 'detection_rejected'` if fails
4. `scoreBuck` (AI vision)
5. `persistInitialMeasurementGraph`
6. `scoreFromGraphNative` → `buildScoreComparison` → `activeSource: 'graph_native' | 'legacy'`
7. Confidence engine over all signals

### 3.3. Advanced scoring + Verified Score ✓ (PR #11)
`lib/advanced-scoring/cross-validation.ts` — strict Verified Score rules:
- ≥2 independent methods per B&C field; one must be `photo_polyline`, one `three_d_point_cloud`
- ≤3% pairwise disagreement
- Both calibrations must be `physical_reference`
- No source confidence < 0.5; no unresolved warnings
- `quick_ai` alone never verifies; `three_d_mesh_fallback` alone never verifies

`lib/advanced-scoring/confidence.ts` — method ranking: point cloud (0.92) > photo (0.78) > manual (0.65) > mesh fallback (0.50) > quick AI (0.45).
`lib/advanced-scoring/point-cloud.ts` — spatial-cell index for snapping up to 250k points.

### 3.4. Reconstruction (Luma + manual) ✓
`lib/reconstruction/luma-adapter.ts` is `server-only`. Missing env → `LumaConfigurationError` → manual fallback job. Never invents asset URLs.

### 3.5. Verified PDF export ✓
`lib/export/score-pdf-builder.ts` — title flips verified/unverified, per-field evidence table, disclaimer: *"RAX CORE measurements are AI-assisted and user-verified. Official acceptance depends on governing organization rules."* This is the only disclaimer text. Do not change it.

### 3.6. Ring + hat reference in Precision Mode ✓ (PR #17, #19)
`reference_type` in the scoring form now includes `'wedding_ring'` and `'hat'`. Sub-forms appear when selected. Confidence is always `'estimated'`. Never unlocks Verified Score alone.

### 3.7. AI Learning Flywheel WI-1 through WI-6 ✓ (PR #18)
- Supervision hooks wired: `onReversePassComplete`, `onStructuralSolverComplete`, `onIntervalMiss`, `onHighConfidenceMiss`
- `correction_events` table + `lib/training/correction-events.ts` — unified correction capture from all 4 sources (score editor, dpad, precision pass, review sheet)
- Prompt bias correction (`lib/scoring/prompt-bias-correction.ts`) — fires at ≥10 observations per field, |mean delta| ≥ 0.5", clamped ±3" (see §3.34 for the ground-truth fusion)
- Admin accuracy dashboard at `/admin/accuracy`
- Roboflow seed dataset infrastructure (`/admin/seed-dataset`)
- QStash migration: `lib/jobs/qstash-verify.ts`, scheduler + worker routes updated, `vercel.json` crons removed

### 3.8. Hat reference + Trophy Room ✓ (PR #19, #20)
- `trophy_room_entries` table with watermark generation, approval workflow, soft delete
- `lib/trophy-room/` — eligibility, watermark, service
- Eligibility: Verified Score OR `confidence_tier` in `{'high', 'very_high'}`
- Watermark: server-side `sharp`, stored in `trophy-watermarks` bucket
- Scoring results shows eligibility CTA; gallery at `/trophy-room`

### 3.9. LiDAR depth auto-calibration + landmark pixel detection ✓ (PR #21)
- `lib/calibration/depth-extractor.ts` — HEIC auxiliary depth map extraction
- `lib/calibration/depth-calibration.ts` — pixelsPerInch from depth + EXIF focal length
- `lib/scoring/landmark-detection.ts` — `AntlerLandmarkId` types, zone colors, `LandmarkDetection` shape
- `lib/scoring/landmark-prompt.ts` — prompt builder for pixel coordinate detection
- `lib/scoring/landmark-geometry.ts` — pixel distance → inch measurements, curvature correction
- `lib/scoring/calibration-resolver.ts` — depth > reference object > anatomical priors
- Landmark overlay on scoring results (Trace-style colored bounding boxes)
- Drag-to-correct feeds `correction_events`

### 3.10. QStash + scoring form UX ✓ (PR #22)
- Main Frame Points replaced with chip grid (not dropdown)
- Ring/hat in Precision Mode section (not a separate section)
- `vercel.json` crons removed; QStash fires routes externally

### 3.11. Elevation map ✓ (PR #23)
`components/map/map-viewer.tsx` — full Leaflet map:
- Satellite, Satellite+Labels, Topo, Terrain, Elevation Heat base layers
- Hillshade + Slope Shadow overlays (ESRI — free, no key)
- Live USGS 3DEP elevation on click
- Deer terrain intelligence zones (Bottom/Creek → High Country)
- All free, no API keys. Leaflet dynamically imported. `react-leaflet` NOT installed.
- Props + exports unchanged: `{ pins, onPinClick, onMapClick, selectedPinId }`, `LOCATION_TYPE_COLORS`, `LOCATION_TYPE_LABELS`

### 3.12. Render-time Zustand safety ✓
`useMeasureStore.getState()` only in event handlers and effect cleanups. Never at render time.

### 3.13. Crop box pinch-to-resize + bidirectional edge sliders ✓
`components/scoring/antler-crop-box.tsx` — removed expand-only arrow pad; added two-finger pinch-to-resize and four per-edge range sliders (Top/Bottom/Left/Right) that each control that edge bidirectionally. activePointersRef tracks pointer IDs for pinch detection. RAF-throttled onChange preserved.

### 3.14. Point count dual sliders ✓
Replaced 8-14pt chip grid with two `PointCountSlider` components (total 4-30; main frame 6-16, shown only when total >= 6; auto-corrects if main frame > total). New `total_points` field threads through ScoringFormData, wizard FormData, ScoringInput, VisionScoringInput, and the vision prompt. Files: new `components/scoring/point-count-slider.tsx`; modified `scoring-form.tsx`, `lib/types.ts`, `scoring-wizard.tsx`, `app/api/score/route.ts`, `lib/scoring/ai-service.ts`, `lib/scoring/vision-scorer.ts`.

### 3.16. Precision mode always visible + form reorganize ✓
Merged the toggle-gated Precision Mode card (8 reference types: none/ruler/card/coin/aruco/other/ring/hat) with the old limited ring/hat-only Reference Object section into one always-visible "Reference Object" section. Removed the `precision_mode_enabled` toggle from the UI; `scoring-wizard.tsx` now sends reference fields whenever `reference_type !== 'none'` (passes `precision_mode_enabled: 'true'` to the API so the existing API contract is unchanged). Removed the Ears Visible toggle (landmark detection handles it automatically). Made Optional Details (method/year/notes) a collapsible section moved after Irregular Points. New section order: Rack Info → Image Context → Reference Object → Known Measurements → Irregular Points → Optional Details. Files: `components/scoring/scoring-form.tsx`, `components/scoring/scoring-wizard.tsx`.

### 3.15. Pre-AI manual measurements panel ✓
Optional collapsible "Known Measurements" section in the scoring form lets users enter tape-measured B&C fields (main beams, G1–G4, H1–H4, inside spread) before submission. Non-null values are serialized to JSON in the wizard, parsed in route.ts, passed to `scoreBuck` → `VisionScoringInput`, and injected into the vision prompt as "USER-PROVIDED MEASUREMENTS (treat as ground truth) — DO NOT contradict them." Values are also stored in a new `user_measurements_metadata` JSONB column on `predictions`. Plausibility warnings shown inline; amber highlight on entered fields. Files: new `components/scoring/pre-scoring-measurements.tsx`, new `supabase/migrations/20260518000000_user_measurements_metadata.sql`; modified `lib/types.ts`, `lib/scoring/vision-scorer.ts`, `lib/scoring/ai-service.ts`, `app/api/score/route.ts`, `lib/storage/service.ts`, `components/scoring/scoring-form.tsx`, `components/scoring/scoring-wizard.tsx`.

### 3.17. Landmark dot position fix + trophy room overhaul + learning pipeline gaps ✓
- **Landmark dot fix**: `LandmarkOverlay` now computes object-contain letterbox/pillarbox offsets so colored dots and connector lines land on the actual antler pixels regardless of container aspect ratio. `scoring-results.tsx` uses `ResizeObserver` to pass actual rendered container dimensions instead of original image pixel dimensions. Also fixes drag-to-correct coordinate math (subtract offset before dividing by scale). Files: `components/scoring/landmark-overlay.tsx`, `components/scoring/scoring-results.tsx`.
- **Trophy room visual overhaul**: `TrophyDetailClient` fully redesigned with: (a) score thermometer chart (0–220" SVG gradient bar, tier markers at 115/130/150/170", animated buck marker); (b) schematic antler SVG diagram with tine lengths labeled by B&C zone color; (c) full B&C score sheet breakdown table (left/right per field, asymmetry ≠ indicators, gross/net totals); (d) learning contribution note. `TrophyCard` improved with mini score position bar, confidence color dot, verified shield badge, and hover glow. `lib/trophy-room/service.ts` adds `getTrophyEntryWithMeasurements()` joining predictions table. `lib/trophy-room/types.ts` adds `TrophyMeasurements` and `TrophyRoomEntryWithMeasurements`. Detail page uses new service function. Files: `components/trophy-room/trophy-detail-client.tsx`, `components/trophy-room/trophy-card.tsx`, `lib/trophy-room/service.ts`, `lib/trophy-room/types.ts`, `app/trophy-room/[id]/page.tsx`.
- **Learning pipeline**: `dpad-adjust/route.ts` now computes and records `confidence_tier_before` in correction_events. Bias corrections pre-loaded in `scoreBuck` and injected into the vision prompt (new `fieldBiases` field on `VisionScoringInput`) so AI pre-compensates for known systematic biases before generating numbers — closes the correction→prompt feedback loop. Admin accuracy dashboard shows bias correction report via `getBiasReport()`. Files: `app/api/scoring/dpad-adjust/route.ts`, `lib/scoring/vision-scorer.ts`, `lib/scoring/ai-service.ts`, `app/admin/accuracy/page.tsx`.

### 3.29. Admin gold standard — confirmed shipped ✓ (§4.8)
Final entry in the §4 close-out campaign. CLAUDE.md §4.8 was marked as
PARTIAL ("basic JSON paste, full UI missing") but audit on 2026-05-23 found
the entire workstream was already shipped: full B&C/P&Y field-by-field form
with per-image type tagging (`components/admin/training-import-form.tsx`,
455 lines), POST `/api/admin/training-import` to ingest sheets, GET
`/admin/training-import/[id]` with the AI-vs-official comparison table
(`components/admin/official-vs-ai-table.tsx`), POST
`/api/admin/training-import/[id]/run-ai` (calls `scoreBuck` and stores
deltas in `ai_run_result`), POST `/api/admin/training-import/[id]/promote`
(sets `is_benchmark`, creates/adds-to a benchmark pack via
`lib/training-packs/service.ts`). The pending sheet list and gold standard
list are both rendered on the main admin page. Tables in use:
`official_score_sheets` (with `is_benchmark`, `ai_run_result`,
`promoted_at`, `promoted_by` columns), `official_score_images`, and the
benchmark_pack infra under `training-packs/`. This entry exists only to
reconcile CLAUDE.md with reality — no new code was added for §4.8. The
remaining campaign closeout (this commit) updates §4 to mark the queue
empty.

### 3.28. Vanishing-point cross-check ✓ (§4.7)
Sixth entry in the §4 close-out campaign. NOT a primary calibration source —
standalone confidence would only be 0.30–0.55 and the algorithm's
absolute-degree estimates are biased without a known camera focal length.
Per CLAUDE.md §4.7, its job is to **disagree loudly** with the primary
calibration when perspective tilt is severe. New
`lib/scoring/vanishing-point-types.ts` defines `ParallelLinePair`,
`VanishingPointResult`, `PerspectiveDisagreement`, and the warn/crit
thresholds (35% / 50% of a 30° reference scale). New
`lib/scoring/vanishing-point-geometry.ts` is pure math: `lineIntersection`,
`analyzeVanishingPoint` (multi-pair fusion via median), `comparePerspectiveTilt`
(diff against an inferred primary tilt). New `vanishing_point`
`CalibrationSourceTag` value added to the resolver's union — reserved for
future use when a known-length object is supplied along one of the line
pairs. For now the public surface is `computeVanishingPointWarnings()`,
called by `app/api/score/route.ts` after the primary `resolveCalibration`
returns; appends any disagreement messages to `calibration.warnings` (never
overrides the primary). Landmark prompt extended with an optional
`parallelLinePairs` schema field (≤2 pairs) for fence rails / truck bed /
barn boards; model is explicitly told to omit when no clear pair is
visible, never invent. Prompt length budget bumped 4000 → 4500 chars to
accommodate the new section (still well under the original verbose
baseline). Per-image landmark result now carries the optional
`parallelLinePairs` field; vision-scorer maps the Zod schema into
`PerImageLandmarkResult.parallelLinePairs`. Verified Score gates unchanged
— vanishing-point is explicitly NOT `physical_reference`. Tests: 16 new
specs in `__tests__/scoring/vanishing-point.test.ts` cover line
intersection (parallel/non-finite/diagonal), VP analysis (empty/parallel/
centered/edge/multi-pair fusion), and perspective-tilt comparison
(no-pairs/agree/warn/critical/non-finite). Files: new
`lib/scoring/vanishing-point-types.ts`, new
`lib/scoring/vanishing-point-geometry.ts`, new
`__tests__/scoring/vanishing-point.test.ts`; modified
`lib/scoring/landmark-prompt.ts`, `lib/scoring/landmark-detection.ts`,
`lib/scoring/vision-scorer.ts`, `lib/scoring/calibration-resolver.ts`,
`app/api/score/route.ts`, `__tests__/scoring/prompt-snapshots.test.ts`.

### 3.27. Sub-pixel point refinement wiring ✓ (§4.6)
Fifth entry in the §4 close-out campaign. The math has been in
`lib/scoring/subpixel-refine.ts` (Sobel + Gaussian-2D / parabolic-fallback
peak fit) and `lib/advanced-scoring/subpixel-refine.ts` (line-aware
projection) with passing tests since §3 was built out; the Advanced Scoring
photo canvas just wasn't calling it for individual measurement-point
placement. Now wired: new POST route
`app/api/measure/refine-point/route.ts` decodes the in-browser photo data
URL via sharp, calls `refineSinglePoint`, and returns `{x, y, method,
refinementConfidence, deltaPx}`. New helper `refineMeasurementPoint()` in
`components/measure/photo-canvas.tsx` fires after each `addPoint2D` and uses
the existing `movePoint2D` store action to snap the placed point to the
gradient peak when (a) the user didn't already snap to an existing vertex,
(b) `refinementConfidence ≥ 0.4`, (c) `method !== 'unchanged'`, and (d) the
user hasn't already nudged that point manually (delta > 1px from raw =
skip). The existing `refineCalibrationLine` flow (server endpoint
`/api/measure/refine-reference`, store action
`applyRefinedCalibrationPoints`) is untouched — this is additive for
non-calibration points. Provenance: refined points end up in the same
`measurements2D[fieldId].points` array as raw points, no separate flag is
needed because the snap is sub-pixel; the existing `confidence` and
`calibrationSource` on the field already encode trust correctly. NEVER
unlocks Verified Score — Verified still requires the full
`physical_reference` calibration path. Tests: 5 new specs in
`__tests__/scoring/refine-point-flow.test.ts` cover flat-neighborhood
unchanged, edge-of-image unchanged, NaN/Infinity input coercion to 0,
synthetic strong-edge stays finite, and confidence band invariants. Files:
new `app/api/measure/refine-point/route.ts`, new
`__tests__/scoring/refine-point-flow.test.ts`; modified
`components/measure/photo-canvas.tsx`.

### 3.26. Circumference taper assist ✓ (§4.5)
Fourth entry in the §4 close-out campaign. NOT a new calibration source — a
post-score refinement that takes one tape-measured H1 (60 seconds with a soft
tape) and derives H2/H3/H4 plus the opposite-side ladder via published
whitetail taper ratios. Roughly halves circumference error, which today is the
least-accurate B&C field class. New `lib/scoring/circumference-taper.ts`
defines the constants (`TAPER_RATIOS.H2 = 0.94`, `H3 = 0.88`, `H4 = 0.84`),
exposes `deriveCircumferences(measuredInches, side)` and a helper
`applyTaperToMeasurements()` that splices the derived ladder into an existing
Measurements record. Sanity band 1.0–8.0" enforced by both client and server
(`CircumferenceTaperError`). New POST route
`app/api/scoring/refine-circumference/route.ts` validates the body via Zod,
loads the prediction, applies the taper, recomputes gross/net via the H-field
delta only (other fields untouched), and persists. Persistence reuses the
existing `user_measurements_metadata` JSONB column on `predictions` (added in
§3.15) under a new `circumferenceTaper` subkey — no migration. New
`components/scoring/circumference-taper-card.tsx` is the UI: collapsible
under the Measurement Breakdown card, side selector, H1 input, live preview
of the derived ladder, submit POSTs and reloads on success. Derived values
are tagged `source: 'derived_taper'` per CLAUDE.md §5 (never call them
"measured"); this NEVER unlocks Verified Score — only `physical_reference`
via Advanced Scoring does. Tests: 9 new specs in
`__tests__/scoring/circumference-taper.test.ts` cover taper math, opposite-
side mirroring, provenance tagging, out-of-band rejection (low and high),
NaN/Infinity guards, monotonically decreasing ladder, rounding, and the
applyTaperToMeasurements field surgery. Files: new
`lib/scoring/circumference-taper.ts`, new
`app/api/scoring/refine-circumference/route.ts`, new
`components/scoring/circumference-taper-card.tsx`, new
`__tests__/scoring/circumference-taper.test.ts`; modified
`components/scoring/scoring-results.tsx`.

### 3.25. ArUco marker calibration ✓ (§4.2)
Third entry in the §4 close-out campaign. Wires real GPT-4o detection behind
the already-existing `reference_type: 'aruco_marker'` form value. User prints
a free marker at arucogen.com, enters the side length (default 2"), and the
detector returns four pixel corners. Per-image PPI is computed as
`avgSidePx / knownSideInches`; multi-image fusion uses the same median ± 25%
outlier rejection pattern as pedicle dots and eye-circle. New
`aruco_marker` `CalibrationSourceTag` at slot 3 of §8 (between LiDAR and
pedicle dots), confidence lerps 0.55 → 0.72 based on the worst cosTilt across
surviving detections (cos θ ≤ 0.5 floors at 0.55, orthogonal markers hit
0.72). knownSideInches clamped server-side to 0.5–12.0" sanity band. Verified
Score gates unchanged — ArUco is explicitly NOT `physical_reference`.
Detector implementation: `lib/calibration/aruco-detector.ts` calls GPT-4o
with a surgical-precision prompt (`ARUCO_DETECTION_SYSTEM_PROMPT`) that
demands four corners in strict clockwise order, validates convexity via
cross-product signs, and rejects degenerate quadrilaterals before returning.
Detector runs in parallel with per-image landmark detection in
`app/api/score/route.ts` (one extra `Promise.all` task), and ONLY fires when
the user explicitly selected `reference_type === 'aruco_marker'` and supplied
a valid side length — keeps cost flat for the 99% of submissions that don't
use markers. Persistence reuses the existing `landmarks_detected` JSONB on
`buck_images` (no migration); resolver chosen ArUco source is recorded in
`pedicle_calibration_metadata` already-introduced field for traceability
when both are present. Tests: 12 new specs in
`__tests__/scoring/aruco-detector.test.ts` cover invalid knownSideInches,
empty detections, PPI math, confidence ceiling/floor, midpoint lerp,
worst-cosTilt selection, outlier rejection, sanity-band clamp, zero/NaN
guards, and prompt-style snapshot assertions. Files: new
`lib/scoring/aruco-types.ts`, new `lib/calibration/aruco-detector.ts`, new
`__tests__/scoring/aruco-detector.test.ts`; modified
`lib/scoring/calibration-resolver.ts`, `app/api/score/route.ts`.

### 3.24. AR pedicle calibration dots ✓ (§4.4)
Second entry in the §4 close-out campaign; sequenced second by peak confidence
(0.85 with user-supplied measurement — highest non-LiDAR/tape value in the §8
hierarchy). User drags two amber dots onto each antler's burr base, optionally
enters their measured pedicle spacing, and the resolver fuses across images
with the standard median + ±25% outlier rejection. Two new
`CalibrationSourceTag` values: `user_placed_known` (0.85, slot 4) when every
surviving observation came with a known measurement, and
`user_placed_anatomical` (0.68, slot 5) when any observation used the 3.8"
whitetail population average. Mixing demotes to anatomical — never claims a
known reading it can't substantiate. Pedicle dots are placed in priority 2 of
the resolver (just below LiDAR, above reference object and eye-circle). User
input is clamped server-side to a 2.0–8.0" sanity band; out-of-band inputs
fall back to the anatomical default and warn. Verified Score gates unchanged
— user_placed_* is explicitly NOT `physical_reference`. New
`components/scoring/calibration-dots.tsx` is a vanilla-React drag overlay (no
Konva dependency) with `ResizeObserver`-driven letterbox/pillarbox math
borrowed from the §3.17 LandmarkOverlay fix so dots land on actual image
pixels regardless of container aspect ratio. Wizard exposes an opt-in
collapsible "Pedicle Calibration" card under the crop section that renders the
overlay per uploaded image. Coordinates serialized as `pedicle_calibration` on
the API FormData; parsed and threaded through to `resolveCalibration`'s new
optional `pedicleCalibrations` arg. New JSONB column
`pedicle_calibration_metadata` on `predictions` stores the raw inputs alongside
the resolver's chosen source/confidence/PPI for learning-flywheel correlation.
Tests: 10 new specs in `__tests__/scoring/pedicle-calibration.test.ts` cover
empty/null inputs, sub-5px sanity floor, known vs anatomical confidence
selection, out-of-band knownInches clamp, mixed-source demotion, ±25%
outlier rejection across images, >12% disagreement warning, and NaN/Infinity
input guards. Files: new `components/scoring/calibration-dots.tsx`, new
`__tests__/scoring/pedicle-calibration.test.ts`, new migration
`supabase/migrations/20260524000100_pedicle_calibration_metadata.sql`; modified
`lib/scoring/calibration-resolver.ts`, `app/api/score/route.ts`,
`components/scoring/scoring-wizard.tsx`, `lib/storage/service.ts`.

### 3.23. Eye-circle anatomical calibration ✓ (§4.3)
First entry in the §4 close-out campaign; sequenced first by calibration impact
because it is zero-user-effort and shares the existing per-image landmark
GPT-4o call (no new API spend). Adds a new `eye_circle_anatomical` source to
the calibration resolver at §8 slot 6–7 (0.50–0.72), sitting above the legacy
`anatomical_prior` path because iris diameter varies <10% between adult bucks
versus ~20% for skull-spacing priors. The per-image landmark call now also
asks the model to report `eyeCircleLeftRadiusPx` / `eyeCircleRightRadiusPx`
alongside the existing landmark array; both are optional in the Zod schema so
older responses still parse. New `eyeCircleToPixelsPerInch()` helper in
`landmark-geometry.ts` fuses observations across images with the same median +
±25% relative-deviation outlier rejection pattern as the legacy anatomical
path; both-eyes-agree on a front view tops out at 0.72, single-eye side-view
caps at 0.50. New `CalibrationSourceTag` union exported from
`calibration-resolver.ts` (`'depth_map_lidar' | 'reference_object' |
'eye_circle_anatomical' | 'anatomical_prior'`) replaces the inline union on
`CalibrationResult.source`. `resolveCalibration` now takes an optional
`perImageLandmarks` arg; absent ⇒ eye-circle slot is skipped and behavior is
identical to before. Verified Score gates unchanged — eye-circle is explicitly
NOT `physical_reference`. Cost stays flat (~$0.05/run) because radii ride
along on the existing detection request. New `IRIS_RADIUS = 0.55` constant in
`lib/constants.ts` (whitetail adult iris radius head-on, derived from
1.05–1.15" diameter literature). Persistence reuses the existing
`landmarks_detected` JSONB on `buck_images` — no migration. Tests: 9 new
specs in `__tests__/scoring/eye-circle.test.ts` cover null/empty inputs,
failed-image skips, single-eye front, both-eyes-agree gold case, side-view
cap, outlier rejection, tight-agreement boost, zero/negative radii guards,
and degenerate-fallback path. Prompt-snapshot ceiling held at <4000 chars
after compacting the eye-circle prompt section. Files: modified
`lib/constants.ts`, `lib/scoring/landmark-detection.ts`,
`lib/scoring/landmark-prompt.ts`, `lib/scoring/landmark-geometry.ts`,
`lib/scoring/vision-scorer.ts`, `lib/scoring/calibration-resolver.ts`,
`app/api/score/route.ts`; new `__tests__/scoring/eye-circle.test.ts`.

### 3.22. UI polish + fresh-eyes fine-tune pass ✓
Surgical UI-only cleanup across the recently-shipped surfaces (no scoring/calibration logic touched, no API contracts changed). (a) **Debug noise**: removed 8 leftover `console.log` calls from `scoring-results.tsx` (`extractPrecisionPassPayload`, `extractFieldProvenance`, the two precision-pass override effects) that were leaking to the production console; deleted the stale "Debug logging removed" comment. (b) **Landmark overlay layering**: the absolute canvas previously had no z-index/pointer-events isolation, so it swallowed clicks meant for the carousel arrows and Landmarks toggle. Wrapper is now `pointerEvents:none` + `zIndex:5`, only the canvas itself is `pointerEvents:auto` (drag-to-correct preserved), tooltip dropped to z-2, and the zone legend moved from bottom-right to top-left positioned via the existing letterbox `offsetX/offsetY` so it never overlaps the carousel dots row or the top-right toggle. (c) **Carousel** (`antler-image-carousel.tsx`): desktop prev/next arrows bumped to `z-10` (above the overlay canvas); pagination dots now sit inside a 24×24 tap target (`grid place-items-center w-6 h-6`) with the visible dot kept small, and `aria-current` added. (d) **Per-image consensus card**: fixed a broken `w-full` div nested in a flex row (the excluded-reason note now wraps onto its own line correctly), added `aria-expanded` to both collapsible triggers, added dark-mode variants to the agreement-tier badges / ear-pose warning / excluded-reason text (were light-only `bg-*-50` on a dark UI), tightened the ear-pose copy ("perked ear detected … Ear-tip distance excluded from consensus"), and renamed the `ReferenceRow` prop `ref`→`data` (avoids the React-reserved-word footgun). (e) **Trophy card**: confidence was encoded by color alone (a bare dot with a hover `title`) — added a visible tier label ("Very High"/"High"/"Medium"/"Low") and marked the dot `aria-hidden`. (f) **Trophy detail**: the `≠` asymmetry chip in the score-sheet now has a `title`/`aria-label` explaining it ("Left and right differ by X\""). (g) **Map** (`map-viewer.tsx`): pending-pin pulse rewritten from SMIL `<animate>` to a CSS `transform: scale` keyframe gated behind `@media (prefers-reduced-motion: reduce)`; the redundant "Confirm or cancel" hint is hidden while the confirmation panel is open; the panel now spans full width above the legend on mobile (`left-3 right-3`) and anchors bottom-right only at `sm:`+. Validation: `tsc --noEmit` clean, `pnpm lint` 0 errors (69 pre-existing warnings unchanged), `vitest` 51/51 pass, `pnpm build` succeeds. Files: `components/scoring/scoring-results.tsx`, `components/scoring/landmark-overlay.tsx`, `components/scoring/antler-image-carousel.tsx`, `components/scoring/per-image-consensus-card.tsx`, `components/trophy-room/trophy-card.tsx`, `components/trophy-room/trophy-detail-client.tsx`, `components/map/map-viewer.tsx`.

### 3.21. SVG North American map + ESLint flat config ✓
Replaced the Leaflet elevation map with a self-contained SVG North American map. `components/map/map-viewer.tsx` is now built on `react-simple-maps` (was already a dep, not previously wired) using `geoMercator` centered on `[-95, 48]` with scale 520. Country outlines come from `world-atlas@2/countries-110m.json` filtered by ISO numeric codes to US/Canada/Mexico + Central America + Caribbean — no state borders, no tile servers, no elevation layers. Clicks on the SVG are inverted through the captured d3 projection (`projectionRef`) to produce `[lng, lat]`, surfaced via a confirmation panel before firing `onMapClick`. Pin markers render as colored drops keyed by `LOCATION_TYPE_COLORS`; **at ≥20 placed pins the visualization switches to heat mode** — markers shrink to 2.5px dots and a separate `<g filter="url(#rax-heat-blur)">` layer renders blurred radial-gradient blobs (`stdDeviation=6`, red radial gradient) at each pin to give a harvest-density readout. Mode badge ("Pin View N / 20" → "Heat Map N") sits top-left; legend bar across the bottom is unchanged. Public API preserved: `{ pins, onPinClick, onMapClick, selectedPinId }`, `LOCATION_TYPE_COLORS`, `LOCATION_TYPE_LABELS`. Also fixed `pnpm lint` (the script existed but no ESLint config did) — added `eslint@^9` + `eslint-config-next@16.2.0` as devDeps and authored `eslint.config.mjs` (flat config) that disables `react/no-unescaped-entities`, downgrades `@next/next/no-img-element` and `react-hooks/exhaustive-deps` to warnings, and downgrades the new React Compiler-class rules from `react-hooks` v7 (`purity`, `immutability`, `refs`, `use-memo`, `static-components`, `preserve-manual-memoization`, `component-hook-factories`, `set-state-in-effect`, `error-boundaries`) to warnings so the legacy codebase doesn't fail lint on rules it predates. Lint now reports 0 errors / 79 warnings (down from 118 errors). One real hook-rule bug fixed in `components/measure/scene-3d.tsx` (`MeasurementTube` was calling `useMemo` after a conditional `return null` — moved the early-return after the hooks and folded the empty-points guard inside the `useMemo`). Updated `react-simple-maps.d.ts` shim so `<Geographies>` render-prop type now includes `projection`, `path`, `outline`, `borders` (matches runtime). Files: modified `components/map/map-viewer.tsx`, `react-simple-maps.d.ts`, `components/measure/scene-3d.tsx`, `package.json`, `pnpm-lock.yaml`; new `eslint.config.mjs`.

### 3.20. Surgical Precision prompt rewrite + post-output plausibility validator ✓
Rewrote `buildVisionPrompt` (`lib/scoring/vision-scorer.ts`) and the rack-admission system prompt (`lib/detection/detect-rack-with-openai.ts`) to match the surgical structure of `lib/scoring/landmark-prompt.ts` — explicit ROLE / INPUT CONTRACT / OUTPUT CONTRACT / SCALING DECISION TREE / MEASUREMENT RULES / PLAUSIBILITY RULES / SELF-CHECK / REFUSE sections, imperative voice, no hedging prose, all existing tine/circumference/spread range hints preserved. Main scoring prompt token footprint drops from ~3,800 to ~2,200. Detection acceptance gate held at 0.45 — the new CONFIDENCE GUIDANCE band tightens self-calibration without trading false negatives for false positives. Three micro-edits to the landmark prompt for header consistency (`MISSING/OCCLUDED`, dedicated `REFUSE` section, plain `SELF-CHECK` header). New `lib/scoring/prompt-style.ts` exports `PROMPT_STYLE_VERSION = 'surgical-precision-v1'`, shared `PROMPT_SECTIONS` labels, and `roleIsolationParagraph(role)` so all three prompts share identical headers and role-isolation paragraphs. New `lib/scoring/scoring-plausibility.ts` runs 9 deterministic checks on the parsed `VisionOutput` (beam exceeds tines, paired-field asymmetry warn/crit at 35%/50%, spread present when G2 exists, deductions non-negative, net ≤ gross, gross within 40–280, confidence in 10–95, G2 ≥ G1, H taper distally) with `critical | warning` severity and per-field confidence-delta suggestions. Wired in `ai-service.ts` immediately after `visionResult.output` is parsed; critical violations OR into `selfCheckResult.triggerSecondPass` so the existing two-pass solver re-scores automatically — no changes to `self-check.ts`'s rule set, no changes to `lib/advanced-scoring/confidence.ts` per §7. Detection prompt extracted to `DETECTION_SYSTEM_PROMPT` constant for testability. New tests: `__tests__/scoring/scoring-plausibility.test.ts` (18 cases — one per rule plus aggregation), `__tests__/scoring/prompt-snapshots.test.ts` (14 cases — header presence, range-hint preservation, token-length floors/ceilings). vitest config now shims `server-only` to a noop so server-tagged modules import cleanly in node tests. Files: new `lib/scoring/prompt-style.ts`, new `lib/scoring/scoring-plausibility.ts`, new `__tests__/shims/server-only.ts`, new `__tests__/scoring/scoring-plausibility.test.ts`, new `__tests__/scoring/prompt-snapshots.test.ts`; modified `lib/scoring/vision-scorer.ts`, `lib/detection/detect-rack-with-openai.ts`, `lib/scoring/landmark-prompt.ts`, `lib/scoring/ai-service.ts`, `vitest.config.ts`.

### 3.19. Accuracy audit fix pack ✓
Four-part fix derived from the IMG_6534/IMG_6535 screenshots. (a) **Error-band invariant**: intersecting consensus and legacy error bands with `max(low)/min(high)` could produce a CI window that excluded `predicted_gross` (e.g. range 161–172 with gross 159.3). `ai-service.ts` now widens the intersected band when it excludes the point estimate, logs the disagreement, and surfaces it in the confidence explanations; `scoring-results.tsx` has a defense-in-depth clamp for pre-existing prediction rows; "Precision: -" is now "Precision: not run" so the missing pass is legible. (b) **Anatomical-prior calibration disagreement (141% spread)**: the `skull_width` spec in `per-image-consensus.ts` used the SAME `[pedicle_left, pedicle_right]` endpoint pair as `pedicle_spacing` but divided by a different inch constant — guaranteeing a ~37% mathematical disagreement; removed until a real orbital-ridge landmark pair exists. `EAR_BASE_SPACING` was 7.5" (too large vs published whitetail anatomy ~5.5"), corrected. `calibration-resolver.ts` kept its own local `ANATOMICAL_REFERENCES` table that drifted out of sync with `lib/constants.ts` (local `EYE_BOX_WIDTH=3.5` mislabeled as interocular vs canonical `EYE_TO_EYE=4.3`); now imports the canonical source. Resolver multi-estimate aggregation upgraded from "use highest confidence on >20% disagreement" to **median-based outlier rejection** (tolerates ±25% from median) with an agreement boost when survivors are tight. Each `REFERENCE_SPECS` entry now carries a `viewSensitivity: 'low' | 'medium' | 'high'` tier so future callers can pick the right priors for primary calibration vs cross-check duty (nose_bridge and ear_base_to_tip flagged 'high' — front-projected, need orthogonal views). (c) **Foreshortening correction**: `landmark-geometry.ts` now applies a `cos(θ)` recovery factor per measurement based on principal 3D axis (horizontal / parasagittal / vertical) vs viewing angle, clamped to 2.94× to avoid amplifying noise. Confidence drops as `cos²(θ)` so the correction is honest about its 3D-pose assumption. Only fires when both endpoints share a `sourceAngle`. (d) **Landmark prompt rewrite**: `buildLandmarkDetectionPrompt` (was unused) is now wired into `detectLandmarksForOneImage`, enforces float pixel coordinates with one decimal place (no integer rounding), explicit "you do not estimate scores or inches" role, per-landmark placement rules (pedicle vs burr, tine-base vs visual-start, skull-fixed ear bases), and a 4-step self-check before returning (pedicle symmetry, burr proximity, base/tip ordering, not-a-target guard). Files: modified `lib/scoring/ai-service.ts`, `lib/scoring/per-image-consensus.ts`, `lib/scoring/calibration-resolver.ts`, `lib/scoring/landmark-geometry.ts`, `lib/scoring/landmark-prompt.ts`, `lib/scoring/vision-scorer.ts`, `lib/constants.ts`, `components/scoring/scoring-results.tsx`.

### 3.18. Per-image anatomical reference capture + angle-distortion compensation ✓
Each anatomical reference (nose bridge, eye box, pedicle spacing, eye-to-pedicle, skull width, ear-base spacing, ear-base-to-tip) is now captured **per image** instead of once across the whole submission. The GPT-4o landmark detector runs once per image in parallel via new `detectLandmarkPositionsPerImage`; each call only sees one image so the model cannot mix up which image a coordinate came from. Per-image observations are fused with **median + MAD outlier rejection** (estimates >2.5× MAD from median are dropped with `excludedReason`) and per-reference agreement spread is computed across surviving images. Side-angle photos automatically take a +0.18 distortion bump for references that are only reliable head-on (eye box, pedicle spacing, skull width, nose bridge, ear-base spacing). Ear handling: new `ear_base_*` and `ear_tip_*` landmark IDs let `detectEarPosition()` flag perked/sideways ear poses and exclude `ear_base_to_tip` from the consensus for those images — ear-base spacing (skull-fixed) stays as a reference. Per-image landmarks are persisted into the existing `BuckImage.landmarks_detected` field (was null until now); aggregated `per_image_consensus` blob is cached on `predictions` via a new JSONB column for fast UI reads. The carousel now drives a `currentImageIndex` so `LandmarkOverlay` renders only that image's dots, and a new collapsible "Per-image anatomical references" card surfaces per-reference per-image breakdown with outlier badges and ear-pose warnings. Learning win: correction events now carry `source_image_index` + `sourceAngle` for free, so future bias-correction analytics can learn angle-specific biases ("AI overestimates eye box on left profiles"). Cost: ~$0.05/run vs $0.03 today (N parallel calls, modest prompt overhead duplication). Verified Score gates unchanged. Files: new `lib/scoring/ear-position.ts`, `lib/scoring/per-image-consensus.ts`, `components/scoring/per-image-consensus-card.tsx`, `supabase/migrations/20260520000000_per_image_consensus.sql`; modified `lib/scoring/landmark-detection.ts` (added ear landmark IDs + `PerImageLandmarkResult` type), `lib/scoring/vision-scorer.ts` (added `detectLandmarkPositionsPerImage`, legacy `detectLandmarkPositions` now a back-compat wrapper), `lib/types.ts` (added `PerImageReferenceObservation`, `PerReferenceFusion`, `PerImageConsensusResult`, `Prediction.per_image_consensus`), `lib/storage/service.ts` (added `updateBuckImageLandmarks`, `updatePredictionPerImageConsensus`, threaded `perImageConsensus` through `CreatePredictionParams`), `app/api/score/route.ts` (calls per-image detector, persists per-image data, exposes `perImageConsensus` and `landmarkDetections.perImage` in response), `components/scoring/scoring-results.tsx` (carousel index threading, per-image landmark overlay slicing), `components/scoring/antler-image-carousel.tsx` (new `onImageChange` callback).

### 3.30. Classroom (RAXam / RAXrs) + global calibration + precision-pass fix ✓
New public `/classroom` tab — a lab for testing and calibrating the scorer —
plus two fixes derived from the IMG_6534/IMG_6535 session (scores ~5-8" low,
precision pass spinning forever).
- **Global + learnable calibration**: `applyCalibration` (`lib/calibration.ts`)
  now supports a multiplicative scale and a seeded default offset
  (`DEFAULT_GLOBAL_GROSS_BIAS = 6`, in new client-safe `lib/calibration-constants.ts`).
  When no learned profile exists it applies the seeded offset so the live
  `/score` tab re-centers up; learned profiles (from ground-truth +
  classroom-rescore deltas via `buildProfileFromRows`) and per-request overrides
  supersede it. `calibrationMeta.source` is `'default' | 'profile' | 'override'`
  — the default is labeled estimated. New `calibration_profiles.gross_multiplier`
  / `net_multiplier` columns (default 1).
- **Per-request feature gating**: optional `experiment_config` FormData field on
  `/api/score` (absent ⇒ identical production behavior). `lib/scoring/experiment-config.ts`
  defines the feature keys (detection gate, landmarks, eye-circle, pedicle, ArUco,
  vanishing-point, per-image consensus, prompt-bias, plausibility, second pass,
  calibration, shadow precision pass), parses/sanitizes the blob, and maps it to
  calibration overrides + AI-service flags. Gates wired into `app/api/score/route.ts`
  and `lib/scoring/ai-service.ts` (bias, plausibility, second pass) + a custom-prompt
  append in `buildVisionPrompt` (`lib/scoring/vision-scorer.ts`).
- **RAXam (exam lab)**: compact reuse of `ScoringWizard` (`classroom` +
  `experimentConfig` props; `ScoringForm` gains `hideOptionalDetails`) with a
  Features &amp; Variables panel. **RAXrs (rescore)**: pick a recent buck
  (`GET /api/classroom/recent`), flag error categories (expected higher/lower,
  left/right antler → tine sub-options), re-run via `/api/score`, and record the
  flags as `correction_events` (`correction_source: 'classroom_rescore'`) via
  `POST /api/classroom/rescore`; compact results show new-vs-old.
- Classroom runs persist as normal predictions but flagged
  `predictions.is_classroom_run` (+ `experiment_config`, `features_used` JSONB) and
  show an asterisk in History.
- **Precision pass fix**: `app/api/reverse/predictions/[predictionId]/precision-pass/route.ts`
  now runs `executePrecisionPass` inline in all environments (was dev/preview only)
  with `maxDuration = 300`; `precision-pass-card.tsx` gained a ~90s poll cap so it
  can never spin forever.
- **Landmark clarity**: `landmark-overlay.tsx` legend now states landmarks are
  scale/QA reference points, not the score.
Verified Score gates unchanged (calibration/experiment overrides never unlock it).
Files: new `lib/calibration-constants.ts`, `lib/scoring/experiment-config.ts`,
`app/classroom/page.tsx`, `components/classroom/{features-panel,raxam-flow,raxrs-flow,classroom-results}.tsx`,
`app/api/classroom/{recent,rescore}/route.ts`, `supabase/migrations/20260524000000_classroom_predictions.sql`,
`__tests__/scoring/classroom-experiment.test.ts`; modified `lib/calibration.ts`,
`app/api/score/route.ts`, `lib/scoring/ai-service.ts`, `lib/scoring/vision-scorer.ts`,
`lib/storage/service.ts`, `lib/types.ts`, `lib/training/correction-events.ts`,
`components/scoring/{scoring-wizard,scoring-form,landmark-overlay,precision-pass-card}.tsx`,
`components/header.tsx`, `app/history/page.tsx`.

### 3.31. Prompt-only awareness boost: B&C 1-inch rule, broken tines, velvet ✓
Surgical, single-file addition to `buildVisionPrompt` in
`lib/scoring/vision-scorer.ts` — no schema, no DB, no UI, no form change. The
AI is now explicitly taught three things it previously had no language for:
(1) **B&C point qualification**: a bump only counts as a point when length
≥ 1" AND length > width measured at one inch from the tip; sub-1" stubs and
wider-than-long "stickers"/"worm holes" are excluded from both tine totals
and `abnormal_points` (3 added bullets in the MEASUREMENT RULES block).
(2) **Broken tines**: report the CURRENT remaining length, never the inferred
original, and flag the tine key in `quality_notes` (e.g. `broken: g3_left`).
(3) **Velvet (lean)**: score the underlying hard-antler dimensions visible
through the velvet; do not subtract for velvet bulk; do not add a separate
velvet measurement. PLAUSIBILITY RULES gain a sub-1" exclusion check and
SELF-CHECK gains a step asking the model to verify it dropped every sub-1"
bump and flagged any broken tines. Token impact: prompt grew by ~600 chars,
well under the existing 8000-char snapshot ceiling. A follow-up that was
considered and **scrapped during planning**: a post-harvest shrinkage range
sub-label on the results page (user declined). Verified Score gates and the
output schema are unchanged. File: modified `lib/scoring/vision-scorer.ts`.

### 3.32. Field-judge cross-checks (spread / G2 vs ear length) + headline phrasing ✓
Narrow cherry-pick from a 14-section Codex proposal to add a "Field Judging
Intelligence Layer." Inventory showed ~75% of the proposal duplicated shipped
infrastructure (calibration hierarchy, plausibility, vanishing-point,
anatomical refs, point qualification, error bands, correction flywheel) and
most of the remainder failed the §9 North-Star test (frame typology, body
maturity from photo, hunter-style commentary — narrative that looks
authoritative without improving measurement truth). Two surgical additions
adopted:
- **Two new plausibility rules** in `lib/scoring/scoring-plausibility.ts`
  (`spread_vs_ear_length`, `g2_vs_ear_length`). Each reads
  `output.landmarks.ear_base_to_tip_estimated` (already populated by the
  vision call — no signature change, no new pipeline data). Spread > 3.5×
  ear length warns; > 4.5× is critical (≈ 34"+ spread on a 7.5" ear). G2 >
  1.6× ear warns; > 2.5× is critical (≈ 19"+ G2). Ear length < 4" is
  ignored as too noisy to anchor. Critical findings OR into the existing
  `selfCheckResult.triggerSecondPass`, so the second-pass solver kicks in
  automatically when these fire — same wiring as the existing 9 rules.
  These never unlock Verified Score (still requires `physical_reference`
  per §8).
- **Headline range phrasing**: `ScoreDisplay` subtitle in
  `components/scoring/scoring-results.tsx` reads "Likely 148–155" instead
  of "148–155 range" — the band was already shown, this matches how
  experienced field judges actually phrase confidence.
Tests: 9 new specs in `__tests__/scoring/scoring-plausibility.test.ts`
covering missing ear data, normal proportions, warn/critical thresholds,
sub-4" ear ignore, and per-side G2 fielding. Full suite passes 135/135.
Files: modified `lib/scoring/scoring-plausibility.ts`,
`__tests__/scoring/scoring-plausibility.test.ts`,
`components/scoring/scoring-results.tsx`.

### 3.33. Benchmark run execution — measured accuracy (Phase 1) ✓
First entry in the post-§4 accuracy/flywheel campaign. The accuracy-measurement
machinery already existed but had no crank: `createBenchmarkRun` builds a pending
bulk-validation run from a promoted gold-standard pack, the bulk-validation
execute route scores every example against ground truth, and `evaluateGuardrails`
reads the results — but the `benchmark_run` job pipeline was a `not_implemented`
stub and nobody had run it end-to-end to produce a headline accuracy number.
This wires it shut. (a) Extracted the bulk-validation execute route body into a
reusable `executeBulkValidationRun(runId)` in `lib/validation/bulk-service.ts`
(self-contained: fetches run, guards pending via new `BulkRunNotFoundError` /
`BulkRunNotPendingError`, scores each snapshotted example with `scoreBuck`,
persists per-example gross/net error, computes summary metrics, marks
completed/failed). The route is now thin and gets `maxDuration = 300`. (b)
Replaced the `benchmark_run` export-stub registration with a real
`benchmarkRunPipeline` (`lib/jobs/pipelines/index.ts`) that chains load run →
`executeBulkValidationRun(bulk_validation_run_id)` → `evaluateGuardrails` →
finalize, mirroring the existing `sandbox_evaluation` pipeline structure.
`export_*` and `offline_evaluation` remain stubs (Phase 3). (c) New inline
trigger `POST /api/admin/benchmarks/runs/[id]/execute` (maxDuration 300, the
§3.30 precision-pass pattern) so the headline number can be produced without a
QStash worker, plus a `RunBenchmarkExecuteButton` client component shown on the
run detail page when status is `pending`. (d) New `BenchmarkHeadlineMetrics`
component surfaces MAE gross/net, median gross, within-5″/within-10″, and
over/under counts from the bulk run's `summary_metrics.primary_model` on the run
detail page. NOTE: the actual "run once on a real pack and record the number"
step is a manual admin action — it needs live Supabase data, real images, and
`OPENAI_API_KEY`, none of which exist in CI. tsc clean, build succeeds, existing
135 tests pass (run-execution unit tests deferred — the executor is tightly
coupled to Supabase `createClient` and `scoreBuck`, so a meaningful test needs
DB/AI mocking; tracked for a follow-up). Files: modified
`lib/validation/bulk-service.ts`, `lib/jobs/pipelines/index.ts`,
`app/api/admin/bulk-validation/runs/[id]/execute/route.ts`,
`app/admin/benchmarks/runs/[id]/page.tsx`; new
`app/api/admin/benchmarks/runs/[id]/execute/route.ts`,
`components/admin/run-benchmark-execute-button.tsx`,
`components/admin/benchmark-headline-metrics.tsx`.

### 3.34. Ground-truth bias fusion + official-sheet flattening fix (Phase 2) ✓
Second entry in the accuracy/flywheel campaign — hardens the correction
flywheel so it learns from certified score sheets, not just user guesses.
(a) **Threshold reconciliation**: §3.7 claimed bias "fires after 30+
corrections per field" but the code used `MIN_SAMPLE_COUNT = 10`. Doc now
matches code (≥10 observations, |mean| ≥ 0.5", clamped ±3").
(b) **Official-sheet flattening bug fix**: official score sheets store a
NESTED `score_data` (`{ left: {main_beam, g1..g5, h1..h4}, right: {…},
inside_spread, calculated_gross }`), but `app/api/admin/training-import/[id]/run-ai/route.ts`
read it as a FLAT `Record<string, number>` — so every paired tine/beam/circ
field silently mis-aligned (official came back null) and only
`inside_spread`/`abnormal_points` ever compared. New
`lib/training/official-measurements.ts` exports `flattenOfficialScoreData()`
(nested → flat `g2_left`/`h1_right`/… keys matching the AI scorer and
`correction_events`) and `officialGrossFromScoreData()` (reads
`calculated_gross`, the form's actual key, with `gross_score` fallback). This
also fixes the §3.29 AI-vs-official comparison table, which renders these
per-field deltas.
(c) **Ground-truth bias signal (the lever)**: `lib/scoring/prompt-bias-correction.ts`
now fuses two sources into the per-field bias: user corrections from
`correction_events` (delta = userValue − aiValue, weight 1) AND AI-vs-official
deltas from `official_score_sheets.ai_run_result.fields[]` (delta = ai −
official, sign-flipped to `official − ai`, weight 3 since certified sheets beat
user guesses). `loadFieldBiases` and `getBiasReport` compute a weighted mean
over the merged observations; the ±3" clamp, 0.5" magnitude floor, and ≥10
observation count are unchanged but now count ground-truth observations too.
No migration (reuses existing `ai_run_result` JSONB). The fused bias flows
through the existing consumers unchanged — injected into the vision prompt
(`vision-scorer.ts:462`) and applied additively (`ai-service.ts:973`) — so the
loop closes on ground truth automatically. Tests: 7 new specs in
`__tests__/scoring/prompt-bias-fusion.test.ts` (sign flip, weighting math,
sub-count/sub-magnitude no-fire, clamp, gross/net exclusion, combined sample
count) with a chainable Supabase mock. tsc clean, build succeeds, full suite
142/142. Files: new `lib/training/official-measurements.ts`, new
`__tests__/scoring/prompt-bias-fusion.test.ts`; modified
`lib/scoring/prompt-bias-correction.ts`,
`app/api/admin/training-import/[id]/run-ai/route.ts`, `CLAUDE.md` §3.7.

### 3.35. Flywheel A/B automation (Phase 2.3) ✓
Third entry in the accuracy/flywheel campaign. The sandbox A/B pieces all
existed but only as separate job handlers — there was no single "is this
candidate better?" path. New `lib/sandbox/ab-runner.ts` exports
`runAbEvaluation({ candidateVariantId, benchmarkPackId, productionVariantId? })`
which chains the existing real functions: evaluate candidate + production
variants against the SAME benchmark pack (`createEvaluationRun` +
`executeEvaluationRun`), build the comparison (`generateComparison`), run the
promotion gates (`evaluatePromotionGates`), and map `overall_status`
(eligible/needs_review/rejected) to a single `promote | review | reject`
recommendation. It NEVER promotes — promotion stays a deliberate human action
via `promoteVariant()` in the Variants tab. Surfaced two ways: inline route
`POST /api/admin/sandbox/ab-evaluate` (maxDuration 300, the §3.30 pattern) and
a new `sandbox_ab_evaluation` job handler (added to `JobType`) for
worker/scheduler use. New `components/admin/ab-evaluate-panel.tsx` is a
self-contained client panel (candidate-variant + benchmark-pack selectors,
run button, recommendation badge with hard-fail/warning counts and a link to
the full comparison), mounted as a new "Auto A/B" tab on `/admin/sandbox`.
Verified Score gates unchanged. tsc clean, build succeeds, full suite 142/142
(no new unit tests — the orchestrator is pure wiring over already-tested
functions and is tightly coupled to Supabase + scoreBuck; an integration test
needs DB/AI mocking, tracked with the §3.33 follow-up). Files: new
`lib/sandbox/ab-runner.ts`, new `app/api/admin/sandbox/ab-evaluate/route.ts`,
new `components/admin/ab-evaluate-panel.tsx`; modified `lib/jobs/types.ts`,
`lib/jobs/pipelines/index.ts`, `app/admin/sandbox/page.tsx`.

Phase 3 ("fill the stub pipelines") was investigated on 2026-05-29 and
deliberately NOT built — see §4. The optional user-supplied maturity-class
calibration shipped as §3.36.

### 3.36. Optional user-supplied maturity-class calibration ✓
The honest answer to "would age help scoring?" — age does NOT change the B&C
score (an inch is an inch), and photo-INFERRED age is rejected (circular +
authoritative-looking narrative, fails §9). But male whitetail skulls keep
growing into adulthood, so a younger buck scored with adult anatomical
constants biases the no-reference calibration high. This adds an OPTIONAL,
user-supplied age hint that nudges ONLY the anatomical-prior calibration paths
(§8 tiers 6–8). New `MaturityClass` (`unknown | yearling | mature_2 |
mature_3plus`) and `MATURITY_FACIAL_SCALE` / `maturityFacialScale()` in
`lib/constants.ts` — estimated cranial/facial scale factors (yearling 0.90,
2.5 0.96, adult 1.0) applied to `EYE_TO_EYE`, `PEDICLE_SPACING`, and
`IRIS_RADIUS` so the same pixel span maps to the correct (smaller) real size.
EARS are deliberately never scaled — ears reach full size by ~1.5 yr and field
judges rely on that age stability. The scale threads through
`resolveCalibration` (new trailing optional `maturityClass` arg →
`resolveAnatomicalPrior` + `eyeCircleToPixelsPerInch`); absent ⇒ 1.0 ⇒
identical to prior behavior. Verified Score gates UNCHANGED — maturity only
touches the estimated no-reference priors, never `physical_reference`, and any
run with a ruler / ArUco / LiDAR / reference object is unaffected (higher tiers
win first). Form: optional "Estimated Age" select in Rack Info with copy
stating it only refines scale when no reference exists and never affects a
Verified Score; threaded through `scoring-wizard.tsx` (`maturity_class`
FormData field, only sent when not 'unknown') → `app/api/score/route.ts`
(parsed, defaults to 'unknown'). Scale factors are ESTIMATES (not measured
means) — labeled as such in code and copy. Tests: 6 new specs in
`__tests__/scoring/maturity-calibration.test.ts` (scale monotonicity,
adult/unknown/absent equivalence, yearling ppi inflation, anatomical_prior
source preserved, reference-object unaffected). tsc clean, build succeeds,
full suite 148/148. Files: modified `lib/constants.ts`,
`lib/scoring/calibration-resolver.ts`, `lib/scoring/landmark-geometry.ts`,
`app/api/score/route.ts`, `lib/types.ts`,
`components/scoring/scoring-wizard.tsx`, `components/scoring/scoring-form.tsx`;
new `__tests__/scoring/maturity-calibration.test.ts`.

### 3.37. Map: US + Canada only, real state/province lines, pin-region highlight ✓
Reworked `components/map/map-viewer.tsx` per request. (a) **US + Canada only**:
dropped the world-atlas country layer and the North-America ISO filter (Mexico /
Central America / Caribbean / Greenland are gone). (b) **Correct state &
province lines**: now renders admin-1 boundaries from two GeoJSON
FeatureCollections — `click_that_hood` `united-states.geojson` (49: contiguous
48 + DC; Alaska/Hawaii absent, fine for Mercator framing + whitetail range) and
`canada.geojson` (13 provinces/territories), both keyed by `properties.name`
and served with permissive CORS by jsdelivr (data verified as valid
multi-feature collections). Each region is its own polygon, so internal
state/province borders render naturally. Two `<Geographies>` layers; the shared
d3 projection is captured from the first for click→lng/lat inversion
(unchanged). (c) **Visible borders (the actual fix in the revamp)**: the first
cut stroked borders at 0.4px low-contrast, which read as "country outline only,
no state lines." Borders are now a brighter warm tan (`#9c8568`) at 0.7px
(`STROKE` constants) with `vector-effect: non-scaling-stroke` so they stay
crisp at any size, over a darker land fill (`#231d18`) for contrast;
hover/pressed lift the stroke to amber. (d) **Minimal pin highlight**: a
self-contained `geometryContains()` (lng/lat ray-casting over
Polygon/MultiPolygon, including hole handling) — kept local so we avoid adding
`d3-geo` as a direct dep (pnpm doesn't expose it from app code). The
state/province under a pending pin gets an amber wash (`highlightFill` 0.20
alpha) + heavier stroke; everything else stays the neutral land fill.
Projection framed for the two countries (geoMercator, center `[-96, 53]`, scale
`430` — visually tunable). Public API preserved: `{ pins, onPinClick,
onMapClick, selectedPinId }`, `LOCATION_TYPE_COLORS`, `LOCATION_TYPE_LABELS`;
heat-mode, pending-pin confirmation panel, and legend unchanged. tsc clean,
build succeeds. File: `components/map/map-viewer.tsx`.

### 3.38. createPrediction schema-cache resilience (prod 503 fix) ✓
Production `/api/score` was returning **503** ("temporarily unavailable due to
a database configuration issue") on every scoring run. Vercel runtime logs
showed detection + image upload completing, then the request failing with a
PostgREST *"…column of 'predictions' in the schema cache"* error. Root cause:
`createPrediction` (`lib/storage/service.ts`) did a single `predictions` insert
that included columns from migrations not yet applied to the live DB
(`crop_box_metadata`, `user_measurements_metadata`, `per_image_consensus`,
`is_classroom_run`, `experiment_config`, `features_used`). Unlike `createBuck`
(§ optional-update guard) and `createTrainingExample` (fallback retry), it had
no defense and threw, which `app/api/score/route.ts:1469` maps to 503. Fix:
split the insert into a `corePayload` (base-schema columns) + `optionalPayload`
(migration-added columns); on an `isOptionalTableError` (matches `'schema
cache'`), warn and retry with core columns only so an already-successful
scoring run still persists instead of 503-ing. The optional feature fields
silently won't store until the pending migrations are applied — apply
`20260517000000_crop_box_metadata`, `20260518000000_user_measurements_metadata`,
`20260520000000_per_image_consensus`, `20260524000000_classroom_predictions`,
`20260524000100_pedicle_calibration_metadata` to fully restore them. The three
sibling update writers (`updatePredictionPerImageConsensus`,
`updatePredictionPedicleCalibration`, `updateBuckImageLandmarks`) were already
non-blocking and needed no change. tsc clean, build succeeds. File: modified
`lib/storage/service.ts`.

### 3.39. Scoring latency: parallel detection + overlapped landmark round ✓
Wall-clock fix for the "/api/score takes forever" complaint. The pipeline has
three GPT-4o rounds (admission detection, main vision scoring, per-image
landmarks+ArUco — the two-pass "solver" is deterministic, not an AI call) and
all three ran back-to-back. Two changes, zero behavior/accuracy change:
(a) **`detectRackWithOpenAI` parallelized** — was a serial `for` loop with one
awaited GPT-4o call per image (3 images = 3× detection latency before scoring
even started). Now `Promise.all` over an indexed map; result order and
throw semantics identical (any single failure rejects the batch, the route
already catches and continues to scoring).
(b) **Landmark + ArUco round overlapped with scoring** — the P2 per-image
landmark and ArUco calls only need `storedImageUrls` + angle types, all final
before scoring, but ran only after `scoreBuck` returned. The kickoff is now
hoisted in `app/api/score/route.ts` to immediately after the detection gate
passes (so rejected 422 submissions still never pay for these calls), and the
existing P2 block awaits the stored promises — which by then have been running
concurrently with the main vision call. `.catch` handlers on the kicked-off
promises return empty results (same degradation as before) and prevent an
early failure from becoming an unhandled rejection while `scoreBuck` awaits.
Net: wall clock drops from `N×detect + score + landmarks` to roughly
`detect + max(score, landmarks)`. Cost per run unchanged (same calls, same
models, same gating). Verified Score gates untouched. tsc clean, build
succeeds, full suite 148/148. Files: modified
`lib/detection/detect-rack-with-openai.ts`, `app/api/score/route.ts`.

### 3.40. Scoring latency round 2: maxDuration + parallel I/O phases ✓
Follow-up to §3.39 targeting the non-AI serial phases of `/api/score`.
Four edits, all behavior-preserving: (a) **`export const maxDuration = 300`**
on the score route — it runs three GPT-4o rounds but was the only
long-running route without an explicit duration pin (precision-pass,
benchmark execute, A/B evaluate all pin 300). (b) **Parallel storage
uploads** — the per-image Supabase upload loop was serial; now all uploads
run via `Promise.all` and outcomes are walked in index order afterward so
failure handling (including the OpenAI hard-fail 500 on the first failed
image) is unchanged. (c) **Parallel crop-box pipeline** — each image's
fetch→sharp-crop→upload chain was serial per image; now concurrent, with
identical per-image fallback-to-original semantics. (d) **LiDAR depth
extraction overlapped with detection** — the first-image fetch + HEIC depth
+ EXIF parse ran serially before the detection round despite its result
first being consumed post-scoring; now kicked off as a never-throwing
promise before detection and awaited after the detection gate. Net with
§3.39: upload, crop, depth, detection, landmarks, and ArUco all overlap
maximally; the serial spine is roughly `upload + detect + score` for a
typical run. No new calls, no model changes, Verified Score gates
untouched. tsc clean, build succeeds, full suite 148/148. File: modified
`app/api/score/route.ts`.

### 3.41. Blackout pen (pre-scoring redaction) ✓
Field-test-driven feature: photos routinely contain a second deer, a wall
of mounted racks, or a truck-bed pile behind the subject, and the AI has no
way to know which rack it is supposed to score. The user can now black out
anything the model shouldn't see, at the same stage as the antler crop box.
New `components/scoring/redaction-pen.tsx` exports `RedactionStroke`
(normalized 0–1 points + `size` as a fraction of image width, so strokes
replay identically at any resolution), three pen sizes (`PEN_SIZES`: S/M/L
at 0.03/0.065/0.13 of image width), the `RedactionPen` overlay component,
`estimateRedactionCoverage()` (rasterizes to a 96×96 offscreen canvas and
counts opaque pixels), and `bakeRedactionsIntoDataUrl()`.

The critical property is **the redaction is destructive before upload**:
`bakeRedactionsIntoDataUrl` draws the source image to a canvas at natural
resolution, strokes solid black over it, and re-encodes. That baked data URL
is what gets POSTed, so the blacked-out pixels never reach Supabase storage,
the detection gate, the vision scorer, the landmark round, or the stored
image the results page displays. There is no "original" copy to leak. No
strokes ⇒ the data URL passes through byte-identical, so the 99% path is
unchanged.

Failure semantics are deliberately strict: if preprocessing throws for an
image that has strokes, the wizard **aborts the submission** with an
actionable message rather than taking the existing raw-`File` fallback path,
because that fallback would upload the unredacted photo the user explicitly
marked up. `handleAnalyze`'s catch now surfaces `error.message` instead of
always showing the generic "Analysis failed" toast, so that abort (and API
`userMessage`s) actually reach the user.

UI is a collapsible card ("Blackout Pen (Optional)") between the crop
section and the Pedicle Calibration card, mirroring the existing card
pattern. Canvas overlay is DPR-aware and `ResizeObserver`-driven; drawing is
RAF-throttled; pointer capture makes drags work on touch. Per-photo Undo /
Clear, a live stroke + coverage readout, and an amber warning above 50%
coverage ("make sure the rack itself is untouched").

Known limitation (documented, not a bug): the debounced `/api/detect`
pre-check banner runs on the raw `gridImages` and does not see redactions,
so its advisory feedback can still mention a blacked-out subject. The real
scoring path is fully redacted; re-running detection post-redaction would
add API cost for an advisory-only banner. Verified Score gates unchanged —
redaction touches pixels, never calibration or provenance. Tests: 5 new
specs in `__tests__/scoring/redaction-pen.test.ts` (no-stroke pass-through
identity, empty-stroke resolve, zero coverage, non-DOM graceful degradation,
pen-size ordering/sanity). tsc clean, build succeeds, full suite 153/153.
Files: new `components/scoring/redaction-pen.tsx`, new
`__tests__/scoring/redaction-pen.test.ts`; modified
`components/scoring/scoring-wizard.tsx`.

### 3.42. Accuracy regression fix: bias double-application + seeded +6 ✓
Root-cause fix for "AI scoring has only gotten worse." Two compounding
score-inflation bugs, both of which grew over time — which is why the
degradation was gradual rather than present from day one.

(a) **Learned bias was applied TWICE.** `scoreBuck` called `loadFieldBiases()`
at `ai-service.ts:784` and passed the result to the vision prompt as
`fieldBiases` (`vision-scorer.ts` `biasBlock` → *"g2_left: historically
estimated LOW by ~2.1" — lean higher"*), instructing the model to
pre-compensate. It then called `loadFieldBiases()` **again** at
`ai-service.ts:970` and `applyBiasCorrections` ADDED the same inches to the
model's output (STAGE 2.5). When the model complied with the instruction, the
correction landed twice. Because bias only fires at ≥10 observations per
field (§3.7), almost nothing double-counted early on and progressively more
did as `correction_events` accumulated — and the resulting over-correction
generated *new* corrections in the opposite direction, so the flywheel
oscillated instead of converging. Fix: biases are now applied **exactly once,
arithmetically, after scoring**. The prompt injection is removed, the
`fieldBiases` field is deleted from `VisionScoringInput` (with a comment
explaining why it must not come back), and `buildVisionPrompt` ignores a
`fieldBiases`-shaped property if one is ever passed again. Arithmetic-only
was chosen over prompt-only because it is deterministic, auditable, and
unit-testable, whereas "did the model actually obey the instruction" is none
of those and varies run to run.

(b) **`DEFAULT_GLOBAL_GROSS_BIAS` / `NET_BIAS` 6 → 0.** The +6" was inferred
in §3.30 from two photos (IMG_6534/IMG_6535) reading low — n=2 — then applied
as a flat offset to every buck regardless of size, angle, or calibration
tier, stacked on top of (a). Held at 0 with a comment directing future
tuning to a measured MAE from a benchmark pack (§3.33) rather than eyeballed
runs. `applyCalibration` correctly now reports `calibrationApplied: false`
for the no-profile path, because nothing is applied — reporting `true` for a
no-op would violate the §5 provenance rule. The classroom test was updated
to assert the pass-through identity instead of the old +6 behavior.

(c) **Bias learning cutoff (added after field testing).** With (a) and (b)
fixed, scores came back closer but still read LOW — the true score landed
above the high end of the band on 2–3 bucks. Cause: the biases stored in
`correction_events` (and the AI-vs-official deltas in
`official_score_sheets.ai_run_result`) were all recorded while (a) was live.
The doubling made scores run hot, users corrected them back down, and those
downward deltas were stored as if they were the model's true bias. With the
doubling fixed and the +6 removed, that accumulated negative correction is no
longer offset by anything, so it drags every score down — and at ±3" per
field across ~20 fields, it dominates any other effect in the pipeline.
`loadUserCorrectionDeltas` now filters `created_at >= cutoff` and
`loadGroundTruthDeltas` filters on `ai_run_result.run_at` (undated rows are
treated as pre-cutoff). `DEFAULT_BIAS_LEARNING_CUTOFF = '2026-08-15T00:00:00Z'`,
overridable via the optional `BIAS_LEARNING_CUTOFF` env var; an empty string
learns from all history again. This is a FILTER, not a delete — rows remain
for audit, they simply stop training the corrector, and the decision is
reversible by changing one env var. `getBiasReport` reuses the same loaders,
so `/admin/accuracy` shows exactly what is being applied. Pre-cutoff official
sheets can be cleaned by re-running
`/api/admin/training-import/[id]/run-ai`, which regenerates `ai_run_result`
against the fixed pipeline.

Deliberately NOT changed pending measured evidence: the soft pull toward
"typical" ranges in `normalization.ts` (regresses exceptional racks toward
average on every field — a real suspect, but removing it without a benchmark
baseline repeats the mistake that produced the +6), and the four overlapping
learned correctors (measurement-level §Phase 21, segmented §Phase 41,
learning correction §Phase 10, global calibration). Tests: 3 new regression
guards in `__tests__/scoring/prompt-snapshots.test.ts` asserting the prompt
contains no bias block, never says "lean higher/lower", and is byte-identical
when a `fieldBiases` property is passed; 4 cutoff specs in
`__tests__/scoring/prompt-bias-fusion.test.ts` (pre-cutoff ignored, undated
treated as pre-cutoff, post-cutoff still learns, cleared cutoff learns from
all history). tsc clean, build succeeds, full suite 160/160. Files: modified
`lib/scoring/ai-service.ts`, `lib/scoring/vision-scorer.ts`,
`lib/calibration-constants.ts`, `lib/scoring/prompt-bias-correction.ts`,
`__tests__/scoring/prompt-snapshots.test.ts`,
`__tests__/scoring/classroom-experiment.test.ts`,
`__tests__/scoring/prompt-bias-fusion.test.ts`.

### 3.43. Unified per-photo editor + touch-friendly crop sliders ✓
Field-test UX pass. Crop, Blackout, and Pedicle each had their own wizard
section that looped over every photo, so (a) tools could not be chosen per
photo — it was all photos or none, and (b) the crop handles and the pedicle
dots were mounted over the same image simultaneously and stole each other's
drags.

New `components/scoring/photo-editor.tsx` gives each photo one card with a
three-way tool tab strip (Crop / Blackout / Pedicle). **Only the selected
tool's overlay is mounted**, which structurally eliminates the pointer
interference — there is no second interaction layer to fight with, so no
explicit "hide" toggle is needed. Each tool has an independent per-photo
on/off switch (`PhotoToolFlags`); the tab strip shows each tool's live state
(`off` / `on` / `2 strokes` / `placed`) so the whole photo's configuration is
readable at a glance. Switching tabs is non-destructive: every tool's data
lives in wizard state and survives while off-screen.

`DEFAULT_TOOL_FLAGS` has crop ON, blackout/pedicle OFF, and the section
renders un-collapsed, preserving the previous behavior where every photo
received a default centered crop region unless opted out. Submit now gates
all three payloads on the per-photo flags: crop regions serialize `null` when
crop is off, pedicle placements are skipped when pedicle is off, and
redaction strokes are treated as empty when blackout is off (so the data URL
passes through byte-identical rather than being needlessly re-encoded).
`AntlerCropBox` gained `hideSkipControl` so its built-in "Skip - use full
photo" button doesn't duplicate the new switch. Wizard state
`cropSkipped` / `redactionOpen` / `pedicleCalibrationOpen` are replaced by the
single `photoTools` record.

Crop fine-tuning sliders were an 8px track with a default thumb — nearly
undraggable on a phone. New `.rax-range` class in `app/globals.css` gives a
28px thumb over a 10px track inside a 34px touch target (with `:active`
feedback and a visible focus ring), and each `EdgeSlider` gained −/+ nudge
buttons (34px targets, 0.5% per press) for precision that dragging can't
achieve on a small screen. Scoring/calibration logic and API contracts are
untouched. tsc clean, lint 0 errors, build succeeds, full suite 160/160.
Files: new `components/scoring/photo-editor.tsx`; modified
`components/scoring/scoring-wizard.tsx`,
`components/scoring/antler-crop-box.tsx`, `app/globals.css`.

### 3.44. Scoring determinism (temperature 0) + editor cleanup ✓
(a) **The real cause of "same buck, same photos, different score."** None of
the four GPT-4o calls set `temperature`, so all of them ran at the OpenAI
default of **1.0** — full sampling randomness. Two identical submissions
could differ by several inches from sampling noise alone. That is corrosive
well beyond the visible number: it is indistinguishable from genuine
measurement error, it makes any A/B or benchmark comparison unreliable
(§3.33 MAE would partly measure noise), and every re-score users corrected
fed phantom deltas into `correction_events`, training the bias corrector on
randomness. `temperature: 0` is now set on the main vision scorer
(`vision-scorer.ts`), per-image landmark detection, the admission detector
(`detect-rack-with-openai.ts`), and the ArUco corner detector. Scoring is a
measurement task — greedy decoding is the correct setting; sampling
diversity has no value here. NOTE: this makes runs *near*-deterministic, not
bit-identical — GPT-4o retains minor nondeterminism from batching/floating
point, so small residual variation is expected and is not a bug. Genuinely
different inputs (extra criteria, pre-scoring measurements, reference object,
maturity class) still legitimately change the result.
(b) **Crop sliders reworked.** The −/+ nudge buttons added in §3.43 were
removed as clutter, and the four edge sliders moved from `grid-cols-2` to a
single full-width column. The short half-width rail was the actual cause of
the "too touchy" feel — a full-width rail roughly doubles travel distance, so
the same finger movement changes the crop half as much. Slider `step`
loosened 0.001 → 0.002.
(c) **Removed the redundant `EditableImageCarousel`** from the wizard (its
former crop role is fully covered by the §3.43 per-photo editor). The
component file is retained but no longer mounted; this also removes a
pre-existing display bug where its counter read "4 / 2".
tsc clean, lint 0 errors, build succeeds, full suite 160/160. Files: modified
`lib/scoring/vision-scorer.ts`, `lib/detection/detect-rack-with-openai.ts`,
`lib/calibration/aruco-detector.ts`,
`components/scoring/antler-crop-box.tsx`,
`components/scoring/scoring-wizard.tsx`.

### 3.45. Landmark placement fix (real image dimensions) + editor polish ✓
(a) **"Landmarks are way off" — root cause.** `detectLandmarksForOneImage`
passed `imageWidth: 0, imageHeight: 0` into `buildLandmarkDetectionPrompt`,
which switches the prompt to *"Report the actual image's pixel dimensions in
the imageWidth and imageHeight fields"* — i.e. **the model guessed the canvas
size**, and that guess was stored as `PerImageLandmarkResult.imageWidth`.
`LandmarkOverlay` then computes `scaleX = drawWidth / imageWidth`, so any
error in the guess displaced every dot proportionally (a model reporting
1024×1024 for a 1200×800 image throws the dots off by ~17% / ~30%). GPT-4o is
not reliable at reporting exact pixel dimensions and never should have been
the source of truth for a denominator. New `probeImageDimensions()` fetches
each image and reads true `width`/`height` via `sharp` (dynamically imported
so the module stays importable from tests), runs once per image in parallel
inside `detectLandmarkPositionsPerImage`, states the real size in the prompt,
and stores the measured value — the model's self-report is now only a
fallback when the probe fails. This also improves the geometry paths that
consume these dims (eye-circle, pedicle, per-image consensus), not just the
overlay.
(b) **Pedicle loupe** `LOUPE_ZOOM` 4 → 2.25 (and size 120 → 132). At 4× the
burr filled the loupe with no surrounding context, so it was hard to tell
what you were looking at.
(c) **Crop scales** tightened vertically (`gap-y-1` → none) now that the four
edge sliders are stacked full-width.
(d) **Precision pass poll cap** `MAX_POLLS` 60 → 200. The route runs the pass
inline with `maxDuration = 300`, but the card gave up polling after ~90s
(60 × 1.5s) and left the UI showing "Analyzing hypotheses" while the server
was still legitimately working. 200 × 1.5s = 300s now matches the server
budget. NOTE: this fixes the client-side give-up only. If a pass still hangs,
the remaining suspect is `executePrecisionPass` itself, which needs live logs
from a fresh run to diagnose — nothing conclusive was in the retention window.
tsc clean, lint 0 errors, build succeeds, full suite 160/160. Files: modified
`lib/scoring/vision-scorer.ts`, `components/scoring/calibration-dots.tsx`,
`components/scoring/antler-crop-box.tsx`,
`components/scoring/precision-pass-card.tsx`.

### 3.46. Editor layout-shift fix, static square loupe, results overflow ✓
(a) **Photo shifted when switching tools.** `CalibrationDots` wrapped its
image in a container with a forced `aspectRatio` (falling back to `4 / 3`)
plus `object-contain`, while `AntlerCropBox` and `RedactionPen` size to the
image's natural aspect. Switching tabs therefore re-laid-out the photo. Worse,
the aspect came from the `imageWidth`/`imageHeight` props, which the wizard
fills with placeholders (`img.width || 1024`) — so a portrait photo was being
letterboxed into a landscape box, which ALSO skewed the pixel→image mapping
used to place the dots. `CalibrationDots` now measures the real size from the
loaded `<img>` (`naturalWidth`/`naturalHeight`, same class of fix as §3.45)
and uses it for the aspect box, the contain-transform, and coordinate
clamping; the wrapper's border/radius now match the other two tools exactly.
(b) **Loupe** pinned to a fixed top-right corner instead of chasing the
dragged dot (a window that moves while you read it defeats the purpose),
switched from a circle to a square, and zoom pulled back 2.25× → 1.5×.
(c) **Results overflow**: the key-measurement row was `grid-cols-3` with no
`min-w-0`, so a long label set each track's min-content width and pushed the
row past the viewport on narrow phones. Cards gained `min-w-0` + wrapping
labels + slightly smaller mobile type; the tine row drops to 2 columns below
`sm`. NOTE: only real Tailwind breakpoints are used — this project defines no
`xs`, so an `xs:` variant silently never applies.
Still open, needs info: the 3D view symptom (blank / error / stuck loading is
unknown — `Scene3D` is dynamically imported and renders nothing when it has no
geometry or points, so the likely cause is missing reconstruction data rather
than a crash), and whether the reported horizontal overflow is this grid or
the intentionally `overflow-x-auto` score-sheet table.
tsc clean, lint 0 errors, build succeeds, full suite 160/160. Files: modified
`components/scoring/calibration-dots.tsx`,
`components/scoring/scoring-results.tsx`.

### 3.47. Gross score: abnormal points are rack-type aware ✓
Field report: "net is almost spot on, gross is off." That is diagnostic —
net is derived from gross, so a correct net alongside an inflated gross means
two errors were cancelling. Cause: `calculateScores` summed
`abnormal_points` INTO gross for every rack and then subtracted it again in
net (`gross - deductions - abnormal_points`), and the vision prompt stated the
same convention at `gross_score = ... + abnormal_points`. For a typical rack
that inflates gross by exactly the abnormal total while net lands correctly —
precisely the reported symptom, and only on bucks that actually have
abnormal points, which is why it looked intermittent. B&C treats abnormals by
rack type: on a typical rack they are NOT part of the gross typical frame
(they are a deduction toward net); on a non-typical they count positively and
belong in gross. `calculateScores` now takes `rackType` (defaulting to
`'typical'`) and both call sites pass `input.rackType`; the prompt's SCORING
block was rewritten to match so the model and the arithmetic agree. NOTE:
this changes the displayed gross for typical racks with abnormal points —
net is unchanged, and non-typical racks are unchanged. tsc clean, build
succeeds, full suite 161/161. Files: modified `lib/scoring/ai-service.ts`,
`lib/scoring/vision-scorer.ts`,
`__tests__/scoring/scoring-plausibility.test.ts`.

### 3.48. Score-sheet grid alignment, taper fallback, persistent loupe ✓
(a) **Score Sheet Review overlap + overflow.** `MeasurementRow` used
`grid-cols-[1fr_auto_80px_100px_60px]` (5 tracks — the `auto` is the
provenance badge) while the column header used
`grid-cols-[1fr_80px_100px_60px]` (4 tracks). Every header label therefore
sat over the wrong body column, which is the "Corrected" badge colliding with
the label in the report. The fixed tracks also summed past a phone viewport.
Both now share one template, `1fr` is `minmax(0,1fr)` so the label can
actually shrink, and the fixed columns narrow below `sm`.
(b) **"Apply taper" returned `no_measurements`.** `refine-circumference`
required `predictions.measurements`, but the results UI renders from
whichever source is populated — so a row could show numbers on screen while
that column was null, and the taper failed on a buck that visibly had
measurements. It now falls back to `raw_ai_response.measurements` and, if
both are genuinely empty, returns an actionable message instead of a bare
error code. NOTE: this error was surfacing in the UI directly beneath the
Precision Pass card, which made it look like a precision-pass failure; it was
always the taper request.
(c) **Loupe** `LOUPE_SIZE` 140 → 104 (smaller window, zoom held at 1.5× since
that level was right) and it is now **always visible**, pinned top-right,
tracking the dragged dot → else the selected dot → else the left dot.
Previously `loupeState` was only set during a touch drag, so the window
disappeared the instant you lifted your finger — exactly when you want to
check placement.
tsc clean, lint 0 errors, build succeeds, full suite 161/161. Files: modified
`components/scoring/score-sheet-editor.tsx`,
`app/api/scoring/refine-circumference/route.ts`,
`components/scoring/calibration-dots.tsx`.

### 3.49. Guide buck: per-angle accuracy ruler ✓
Ground truth, at last. Every accuracy decision up to now was made without it —
which is how the `+6` global bias (inferred from two photos) and the
double-applied per-field bias got in. The user is supplying a **guide buck**
(9 photos from different angles + certified measurements), with more to
follow. Scoped deliberately as an **accuracy ruler, not a prompt exemplar**:
it changes NOTHING about live scoring. Feeding a reference buck into the
vision prompt was considered and deferred — it would roughly 4× image cost per
score and risks anchoring every estimate toward one animal's proportions, and
there is no way to know whether it helps until a baseline exists. That
question is answerable later via the existing A/B runner (§3.35).

Most of the pipeline already existed (§3.29): `training-import-form.tsx` does
multi-image upload with per-image angle tagging plus a full B&C/P&Y field
form, `run-ai` compares AI vs official per field, and `promote` builds a
benchmark pack. Three real gaps were closed:
(a) **`run-ai` scored all images in ONE `scoreBuck` call**, so 9 angles gave
one number and zero per-angle signal. New
`POST /api/admin/training-import/[id]/run-ai-per-angle` (`maxDuration = 300`)
scores each image **alone** against the same flattened ground truth and stores
`{run_at, image_count, scored_count, mae_gross, best_angle, worst_angle,
angles[]}` in a new `ai_run_per_angle` JSONB column. Runs sequentially, since
each `scoreBuck` already fans out into several GPT-4o calls; a per-image
failure records an error row rather than losing the other results, and a
missing column returns the computed numbers with a migration hint instead of
discarding the work.
(b) **Angle mapping was lossy**: the old inline version only matched
`includes('side')`, so `angled`, `rear`, `live`, `mounted`, `harvest` and
`trail_cam` ALL silently became `'front'`. New shared
`officialImageTypeToAngle()` in `lib/training/official-measurements.ts` maps
rear tags to `back` before the left/right check (`rear_left_135` contains
"left" but is a rear aspect) and maps context tags to `'other'` rather than
claiming they are front-on views. Both routes now use it.
(c) **Hardcoded `1024x768`** in the scoring input — the per-angle route uses
the real size via `probeImageDimensions()` (now exported from
`vision-scorer.ts`, §3.45).
`IMAGE_TYPES` gained 6 angle positions (`front_left_45`, `rear_left_135`,
`rear`, `rear_right_135`, `front_right_45`, `elevated`) so 9 positions are
distinguishable; additive only, and the production `AngleType` union in
`lib/types.ts` is deliberately UNCHANGED. New
`components/admin/per-angle-accuracy.tsx` renders the run button + a table
sorted most-accurate-first with MAE / best / worst angle stats.
Deliberately NOT done: no global constant is derived from one buck. The bias
corrector still requires ≥10 observations and clamps ±3", so a single sheet
cannot move it — verify `/admin/accuracy` is unchanged after importing.
Tests: 8 specs in `__tests__/scoring/official-image-angle.test.ts` (front,
both sides, obliques, rear-not-side, context tags never claim 'front',
case-insensitivity, empty input, and a guard that the output never escapes the
production union). tsc clean, lint 0 errors, build succeeds, full suite
169/169. Files: new
`app/api/admin/training-import/[id]/run-ai-per-angle/route.ts`, new
`components/admin/per-angle-accuracy.tsx`, new
`supabase/migrations/20260817000000_ai_run_per_angle.sql`, new
`__tests__/scoring/official-image-angle.test.ts`; modified
`lib/training/official-measurements.ts`, `lib/scoring/vision-scorer.ts`,
`app/api/admin/training-import/[id]/run-ai/route.ts`,
`app/admin/training-import/[id]/page.tsx`,
`components/admin/training-import-form.tsx`.

### 3.50. `public.profiles` migration — the silent admin 403 ✓
Setting up the §3.49 guide-buck import surfaced a schema gap much broader than
the guide buck: **`public.profiles` did not exist** in the live database.
Every admin gate does
`.from('profiles').select('is_admin').eq('id', user.id).single()` and then
`if (!profile?.is_admin) return 403`. Against a missing table that query
errors, `profile` is `null`, and the route 403s — so the ENTIRE admin surface
(training import, `/admin/accuracy`, benchmarks, supervision, prompt-biases,
seed-dataset) was silently unreachable, with no error anywhere pointing at the
real cause. It presented as a permissions problem, not a missing table.
Nothing in `supabase/migrations/` created it (the base schema was built
outside version control), so a fresh environment or restored project would hit
the identical wall.
New `supabase/migrations/20260818000000_profiles_table.sql` records the schema:
columns matching the `Profile` interface in `lib/types.ts` (`id` UUID PK FK to
`auth.users` ON DELETE CASCADE, `display_name`, `is_admin` NOT NULL DEFAULT
FALSE, `created_at`, `updated_at`) **plus `role`**, which
`lib/structural-hypothesis/service.ts` selects but which is absent from that
interface. RLS is enabled with select/update/insert policies scoped to
`auth.uid() = id` — admin promotion stays a deliberate out-of-band SQL action
and is never something the app can grant itself. A `handle_new_user()`
trigger function (`SECURITY DEFINER`, so its insert is not blocked by those
same policies) on `on_auth_user_created` creates a profile row at signup;
without it every new account lands in exactly the broken state described
above, failing both the admin check and `getProfile()`
(`lib/auth/actions.ts`). Ends with a backfill for pre-existing accounts.
Every statement is guarded (`IF NOT EXISTS` / `DROP ... IF EXISTS` /
`CREATE OR REPLACE`), so it is a clean no-op against the operator's database
where the table was already created by hand. SQL only — no application code
changed. tsc clean, build succeeds, full suite 169/169. File: new
`supabase/migrations/20260818000000_profiles_table.sql`.

### 3.51. Official score sheet accepts eighths-of-an-inch ✓
Caught while preparing the guide-buck import — i.e. while preparing to enter
the **ground truth every later accuracy claim is measured against**, which is
the worst possible place for silent data corruption. Two compounding problems:
(a) `parseInch` (`components/admin/training-import-form.tsx`) was a bare
`parseFloat`, which stops at the first non-numeric character. B&C is recorded
in eighths — a scorer writes `4 6/8`, not `4.75` — so `"4 6/8"` silently
became **4** (losing 0.75") and `"6/8"` became **6** (a 5.25" error on one
field). Across ~19 measurement fields that is potentially double-digit inches
baked into the reference data, and it would have surfaced later as apparent AI
inaccuracy with no way to trace it back.
(b) The `MeasInput` was `type="number"`, so the browser **rejected** fraction
text outright — eighths could not be entered at all, only silently mangled if
pasted.
`parseInch` now accepts `4.75`, `4`, `4 6/8`, `4-6/8`, `6/8`, and any of those
with a trailing inch mark; a `/0` denominator returns 0 rather than `Infinity`
(§5 finite-guard rule), non-strings return 0, and plain decimals are
unchanged. It is exported so it is unit-testable without React. The input is
now `type="text"` with **no** `inputMode` — a `decimal` keypad has no `/` key,
which would have blocked fraction entry on the phone where these actually get
typed. Each field echoes its parsed value (`= 4.750"`) underneath, so a
misparse is visible at entry instead of discovered months later. Tests: 8
specs in `__tests__/scoring/parse-inch.test.ts` covering decimal
no-regression, mixed and bare fractions, trailing inch mark, the `/0` guard,
junk input, a non-string guard, and a sweep asserting no input can produce a
non-finite result. `calcGross`/`calcDeductions`, the stored `score_data`
shape, and `flattenOfficialScoreData()` are all unchanged — only input parsing
widened. tsc clean, lint 0 errors, build succeeds, full suite 177/177. Files:
modified `components/admin/training-import-form.tsx`; new
`__tests__/scoring/parse-inch.test.ts`.

### 3.52. Official score sheet: eighths dropdown ✓
Follow-up to §3.51. Accepting `4 6/8` as free text fixed the silent
truncation, but left three problems: an illegal value like `4.7` was still
storable (B&C has no such measurement), typing `/` meant switching to the
symbol keyboard ~22 times per sheet on a phone, and a fat-finger was only
caught if the user read the echoed decimal. Since this form enters the ground
truth everything else is measured against, constraining input is better than
validating it after the fact — an illegal value becomes unrepresentable.
`MeasInput` is now two controls: a short whole-inch box plus a `Select` of the
eight legal fractions (`—`, `1/8` … `7/8`). Kept in eighths rather than
reduced to `1/4`/`1/2` — scorers read a tape and write a sheet in eighths, so
a constant denominator removes a conversion step at entry.
**The value contract is unchanged**: `MeasInput` still takes/emits the same
`string` that `parseInch` reads (`"4 6/8"`, `"4"`, `""`), so `calcGross`,
`calcDeductions`, the stored `score_data` shape, and
`flattenOfficialScoreData()` are all untouched — only the widget changed. Two
exported pure helpers do the split: `toEighths()` (decomposes via the existing
`parseInch`, rounds to the nearest eighth, handles the `eighths === 8` carry
so `3.99` → whole 4 / 0 eighths, and returns `whole: null` for a blank field
so an unmeasured G5 stays blank instead of becoming a hard 0) and
`fromEighths()` (recomposes, clamps eighths to 0–7 and negative wholes to 0).
`parseInch` and its specs are unchanged — it still parses stored values and
guards any legacy decimal already in the database.
NOTE a deliberate behavior change: a previously stored non-eighth decimal
(e.g. `4.7`) now displays as `4 6/8` once it round-trips through the widget.
That is a correction toward legal B&C precision, not data loss. Tests: 8 new
specs in `__tests__/scoring/parse-inch.test.ts` including a full round-trip
across all 328 legal eighths from `0` to `40 7/8` asserting both the
whole/eighth split and the numeric value survive, plus blank-stays-blank,
explicit-zero preservation, sub-inch with no whole part, the carry case,
legacy-decimal snapping, out-of-range clamping, and a finite guard. tsc
clean, lint 0 errors, build succeeds, full suite 185/185. File: modified
`components/admin/training-import-form.tsx`,
`__tests__/scoring/parse-inch.test.ts`.

### 3.53. Migration filenames: unique 14-digit versions ✓
Applying migrations failed with
`duplicate key value violates unique constraint "schema_migrations_pkey",
Key (version)=(20260524) already exists`. Supabase derives a migration's
version from the **numeric prefix of the filename**, and this repo used an
8-digit `YYYYMMDD` prefix — so `20260524_classroom_predictions.sql` and
`20260524_pedicle_calibration_metadata.sql` both resolved to version
`20260524` and the second insert collided. Any two migrations authored on the
same day would have done the same; it only surfaced now because nobody had run
the migration set end-to-end against a database.
All eight files renamed via `git mv` to the standard `YYYYMMDDHHMMSS` form,
preserving chronological order and giving the same-day pair distinct versions
(`20260524000000` / `20260524000100`). Contents are byte-identical — only the
filenames changed. Re-applying is safe because every migration is guarded
(`ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`,
`CREATE OR REPLACE`, `DROP ... IF EXISTS`), so a database that already ran the
old versions simply no-ops on the new ones; the orphaned `20260524` row left
in `supabase_migrations.schema_migrations` is harmless.
CLAUDE.md file references in §3.15, §3.18, §3.24, §3.30, §3.38, §3.49 and
§3.50 updated to the new names so the documented paths still resolve. tsc
clean, build succeeds, full suite 185/185. Files: renamed all of
`supabase/migrations/*.sql`.

### 3.54. B&C spread credit cap ✓
Surfaced while answering whether B&C requires a point count (it does require
recording one, but the count adds **zero inches** — only lengths total). The
same chart carries a rule this codebase never implemented, on the Spread
Credit line: *"spread credit may equal but not exceed the length of the longer
antler."* Credited spread is therefore
`min(inside_spread, max(main_beam_left, main_beam_right))`, and both totalling
paths were adding the raw spread:
`calculateScores` (`lib/scoring/ai-service.ts`) and `calcGross`
(`components/admin/training-import-form.tsx`).
For most bucks the cap never binds — beams (22–26") normally exceed spread
(16–20"), which is why an uncapped total looked correct indefinitely. It bites
on **wide, short-beamed racks**: a 22" spread on 21" beams was credited 22"
instead of 21", and the overstatement grows with width. Those are exactly the
bucks users are most excited to score.
The urgent consequence was not the display: an official sheet has the cap
applied and the app did not, so the §3.49 per-angle accuracy run would have
reported that formula mismatch as **AI error**, silently poisoning the first
real accuracy baseline the project has ever had — before it was even measured.
New `spreadCredit()` helper in `ai-service.ts` and the same rule inline in
`calcGross`; both fall back to the raw spread when no beam is measured, since
with nothing to cap against zeroing the spread on a half-filled sheet would be
worse than not capping. The prompt's SCORING block now states the cap too, so
the model's own `gross_score` follows the same rule the arithmetic does — the
§3.47 lesson, where prompt and arithmetic disagreeing about abnormal points
produced a correct net beside an inflated gross. `calcDeductions` is
untouched; the cap is not an asymmetry deduction. NOTE: this **lowers**
displayed gross for wide, short-beamed racks, and net moves with it since net
derives from gross. Most bucks are unaffected. This is the second change to
what "gross" means after §3.47. Tests: 8 specs in
`__tests__/scoring/spread-credit.test.ts` (under-cap full credit as the key
regression guard, over-cap, exactly-equal "may equal", cap against the right
beam, no-beam fallback, single-beam, eighths notation, and finite/empty
guards); `calcGross` exported for testing. tsc clean, lint 0 errors, build
succeeds, full suite 193/193. Files: modified `lib/scoring/ai-service.ts`,
`components/admin/training-import-form.tsx`, `lib/scoring/vision-scorer.ts`;
new `__tests__/scoring/spread-credit.test.ts`.

---

## 4. What is NOT built yet

The §4 close-out campaign (2026-05-23) shipped the entire backlog. All
items previously listed here have either landed (§3.23–§3.28 in this
document) or were already complete in the codebase (§3.29). The queue is
empty.

If new initiatives are scoped in the future, add them under this section
with the same numbered structure (4.1, 4.2, …). For now, the next
strategic frontier sits inside the existing flywheel (§3.7) rather than as
a new feature workstream.

### 4.1. Phase 3 stub pipelines — investigated, deliberately NOT built (2026-05-29)
The accuracy/flywheel campaign's "Phase 3" was to fill the remaining
`not_implemented` job pipelines. Investigation found there is no high-value,
non-speculative work here, so it was intentionally skipped (per §9 — do not
ship machinery that doesn't improve measurement truth):
- **`export_run` / `export_pack_compute` / `offline_evaluation` / `render_*`
  pipelines**: registered as stubs but have **no callers** anywhere in `app/`
  or `lib/`. Export already works synchronously via routes
  (`app/api/training/export`, `app/api/admin/training-packs/[id]/export`,
  `exportBulkRunData`/`formatExportAsCSV` in `lib/validation/bulk-service.ts`).
  Implementing the background pipelines now would be unused dead code. Leave
  as documented stubs until a real batch/background caller exists.
- **Maintenance handlers** (`lib/jobs/pipelines/index.ts`): `cleanup_stale_jobs`
  is already real (`recoverStaleJobs` + `cleanupOldJobs`). The rest are honest
  no-ops — either the subsystem genuinely doesn't exist yet (event logging,
  temp-asset/blob cleanup, segment + confidence-profile caching) or it exists
  but is sensitive/outward-facing and intentionally not auto-wired here
  (`notification_digest`, `billing_usage_sync` — comments corrected to say so).
  None have a scheduled `job_definitions` row driving them.
- **`error_stability`** in `lib/health/service.ts` is hardcoded to 70 but is a
  **cosmetic reported factor only** — it is NOT part of the `rawScore` weight
  sum, so it affects no health decision. Computing it would be cosmetic; left
  as-is.

`render_*` remains deferred for the original §9 reason (schematic render is
decorative). If background export/eval is ever needed, wire the existing
route-level logic into the corresponding pipeline at that point.

---

## 5. Critical coding rules

### Truth and provenance
- Inferred = tagged inferred. Estimated = tagged estimated. Heuristic ≠ AI.
- `source: 'heuristic'` is correct for procedural landmark estimates. Never call them AI.
- Verified Score only from `computeVerifiedScoreStatus() → { verified: true }`. No other path.
- "Official certification" / "B&C accepted" / "P&Y accepted" must never appear in copy.
- Derived circumferences (from taper ratios) must be tagged `source: 'derived_taper'`, not `'measured'`.

### Safety
- Guard every numeric path with `isFiniteNumber` (`lib/advanced-scoring/geometry.ts`). No NaN or Infinity.
- API keys server-side only. No `NEXT_PUBLIC_*` for secrets.
- External failures (Supabase, QStash, USGS, Roboflow) → warn log + empty fallback. Never 500.

### Architecture
- `lib/advanced-scoring/*` types are additive. Do not break `MeasurementGraph` in `lib/types.ts`.
- Backward-compat on `/api/score` — clients read `prediction.*`. Add fields; never rename.
- Route handlers stay thin. Math lives in `lib/`.
- Three.js: dispose geometry/materials/textures in useEffect cleanup.
- Never `useMeasureStore.getState()` at render time. Only in event handlers and effects.
- Leaflet: always dynamically imported. Never `import L from 'leaflet'` at top level.
- QStash: all job routes must call `verifyQStashRequest()` before doing any work.

### Refactor discipline
- Surgical patches. Touch only files named in the plan. No formatting changes to unrelated files.
- Never start a new v0 project. Edit this repo in place.
- Always commit to `main`. Never create feature branches.
- After every work item: `pnpm exec tsc --noEmit && pnpm build`.

### CLAUDE.md maintenance
- After every work item, update Section 3 ("What is shipped") to reflect what was built. Add a new subsection numbered sequentially (3.13, 3.14, …) with: feature name, one-line summary, list of files changed, and any calibration-hierarchy or accuracy notes. Section 3 is the source of truth for what actually exists in the repo and must stay current with every commit to `main`.

### Files that must not be casually changed
- `lib/capture/scan-session.ts`
- `lib/scoring/resolve-image-roles.ts`
- `lib/advanced-scoring/cross-validation.ts`
- `lib/advanced-scoring/confidence.ts`
- `lib/reconstruction/luma-adapter.ts`
- `lib/export/score-pdf-builder.ts` (especially the disclaimer text)
- `next.config.mjs`, `tsconfig.json`, `proxy.ts`

---

## 6. Environment variables

| Variable | Required for | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | All Supabase | client-safe |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | All Supabase | client-safe |
| `SUPABASE_SERVICE_ROLE_KEY` | Server | **server-only** |
| `OPENAI_API_KEY` | Scoring, detection, landmarks | **server-only** |
| `QSTASH_TOKEN` | Job scheduling | **server-only**; absent ⇒ manual trigger only |
| `QSTASH_CURRENT_SIGNING_KEY` | QStash verification | **server-only** |
| `QSTASH_NEXT_SIGNING_KEY` | QStash verification | **server-only** |
| `CRON_SECRET` | Local dev job trigger | **server-only** |
| `BIAS_LEARNING_CUTOFF` | Bias corrector (§3.42c) | optional ISO 8601; ignore correction observations older than this. Absent ⇒ `DEFAULT_BIAS_LEARNING_CUTOFF`. Empty string ⇒ learn from all history |
| `LUMA_API_KEY` | Reconstruction | **server-only**; absent ⇒ manual fallback |
| `LUMA_RECON_SUBMIT_URL` | Reconstruction | absent ⇒ manual fallback |
| `LUMA_RECON_STATUS_URL` | Reconstruction | absent ⇒ manual fallback |
| `STRIPE_SECRET_KEY` | Billing | **server-only** |
| `STRIPE_WEBHOOK_SECRET` | Billing webhook | **server-only** |
| `ANTHROPIC_API_KEY` | Future ensemble scoring | **server-only**; not yet wired |
| `GEMINI_API_KEY` | Future ensemble scoring | **server-only**; not yet wired |

Optional keys must not block startup if missing — graceful degradation only.

---

## 7. Validation after every change

```
Routes load:  / /score /measure /map /results/[any] /library /history /settings
              /admin/training-import /admin/supervision /admin/accuracy /trophy-room

Camera:       No auto-capture. N/3 counter only on button press.

Quick score:  Non-deer → 422 detection_rejected
              Good image → 200 with scoreComparison + effectiveGraph + confidence_explanation
              selected_image_angles never [null, null, null]

Calibration:  LiDAR detected → calibration-resolver returns depth_map_lidar
              No LiDAR → falls back to next available source (not crash)
              Ring/hat selected → confidence is 'estimated', not 'physical_reference'

Landmarks:    Overlay renders on scoring result with zone colors
              Drag-to-correct → correction_events row created

Trophy Room:  LOW confidence → eligibility returns eligible: false
              HIGH/VERY_HIGH or Verified → eligible: true
              Approve → watermark generated within 15s
              Delete → soft delete (deleted_at set, not removed)

Verified:     Only true when ALL gates pass in cross-validation.ts
              Ring/hat/LiDAR/ArUco/pedicle alone never unlock it.

PDF:          Generates without throwing. Disclaimer present. Verified/Unverified correct.

Jobs:         /api/jobs/scheduler returns 401 without valid QStash sig or CRON_SECRET
              /api/jobs/worker same

Build:        pnpm exec tsc --noEmit clean
              pnpm build succeeds
```

---

## 8. The calibration hierarchy (always reference this)

| Priority | Source | `calibrationSource` value | Confidence | Notes |
|---|---|---|---|---|
| 1 | User ruler/tape (Advanced Scoring) | `physical_reference` | 0.95 | Only thing that unlocks Verified Score |
| 2 | LiDAR depth map + EXIF | `depth_map_lidar` | 0.85–0.90 | Auto — iPhone Pro Portrait Mode |
| 3 | ArUco marker (GPT-4o detected) | `aruco_marker` | 0.55–0.72 | Print free marker, any phone |
| 4 | Pedicle dots, known spacing | `user_placed_known` | 0.85 | User measured skull plate |
| 5 | Pedicle dots, avg spacing | `user_placed_anatomical` | 0.68 | User placed dots, avg 4.5" |
| 6 | Eye circle (both eyes agree) | `eye_circle_anatomical` | 0.72 | Auto from landmark detection |
| 7 | Eye circle (single eye) | `eye_circle_anatomical` | 0.50–0.65 | Partial face visible |
| 8 | Anatomical priors (eye box) | `anatomical_prior` | 0.50–0.65 | AI-estimated, no user input |
| 9 | Ring reference | `estimated_reference_object` | 0.45 | User selected in Precision Mode |
| 10 | Hat brim reference | `estimated_reference_object` | 0.40 | User selected in Precision Mode |
| 11 | Vanishing point | `vanishing_point` | 0.30–0.55 | Background parallel lines |
| — | None | `none` | 0.25 | Pure AI guess |

**Verified Score requires `physical_reference`.** Nothing else unlocks it alone.

An optional user-supplied maturity class (§3.36) scales the facial reference
sizes used by tiers 6–8 only (eye/pedicle/iris; never ears, never the higher
reference tiers). It is an estimated modifier, not a new source, and never
unlocks Verified Score.

---

## 9. North star

Every change must answer **yes** to:
1. Does this make a measurement more accurate or more honest about its accuracy?
2. Does this respect the provenance chain (`source`, `origin`, `calibrationSource`)?
3. Does this preserve graceful fallback when external services are absent?
4. Does this avoid claiming official certification?
5. Does this avoid auto-capture, fake detection, or fake percentages?
6. Does this let each system do what it's best at? (AI identifies; math measures; human corrects)
7. Does this make the training flywheel turn?

If any answer is no, the change is wrong even if the diff looks clean.
